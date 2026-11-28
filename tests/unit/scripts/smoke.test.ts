// smoke (spec 11 FR-1118, FR-1119; VC-1118, VC-1119, VC-1106 logic). Every test drives the real
// route handlers (including the cron route) over a MemoryObjectStore through the in-process fetch.
import { describe, expect, it } from 'vitest';
import { STEP_NAMES, runCli, runSmoke, type SmokeDeps } from '@/scripts/smoke';
import { BYPASS_HEADER } from '@/scripts/lib/http';
import { inProcessApi } from './helpers/in-process-fetch';

const URL_ = 'https://smoke.example.test';
const SECRET = 'cron-SECRET-value-123';
const BYPASS = 'bypass-SECRET-value-456';

type Fetch = typeof fetch;

function deps(fetchFn: Fetch, over: Partial<SmokeDeps> = {}): SmokeDeps {
  return { fetch: fetchFn, cronSecret: SECRET, ...over };
}

/** Wraps a fetch: `rewrite` may return a replacement body for a response. */
function tamper(
  inner: Fetch,
  rewrite: (
    req: { method: string; path: string; body: string; seen: number },
    body: string,
  ) => string | undefined,
): Fetch {
  const seen = new Map<string, number>();
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = init?.body === undefined ? '' : String(init.body);
    const path = new URL(req.url).pathname;
    const key = `${req.method} ${path} ${body}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    const res = await inner(input, init);
    const text = await res.text();
    const replaced = rewrite({ method: req.method, path, body, seen: count }, text);
    return new Response(replaced ?? text, { status: res.status, headers: res.headers });
  }) as Fetch;
}

interface Harness {
  stdout: string[];
  stderr: string[];
  io: { stdout(l: string): void; stderr(l: string): void };
}
function harness(): Harness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { stdout: (l) => void stdout.push(l), stderr: (l) => void stderr.push(l) },
  };
}

describe('VC-1118 smoke passes on the real handlers', () => {
  it('lists the ten steps in order, all ok, passed true', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    const { line, error } = await runSmoke(deps(api.fetch), { baseUrl: URL_ });
    expect(error).toBeUndefined();
    expect(line.passed).toBe(true);
    expect(line.steps).toEqual(
      [
        'presets',
        'create',
        'auth',
        'conflict',
        'play',
        'resume',
        'retry',
        'no-leak',
        'cron-auth',
        'cron-run',
      ].map((name) => ({ name, ok: true })),
    );
    expect([...STEP_NAMES]).toEqual(line.steps.map((s) => s.name));
    expect(Object.keys(line)).toEqual([
      'check',
      'baseUrl',
      'startedAt',
      'steps',
      'passed',
      'durationMs',
    ]);
    expect(line.check).toBe('smoke');
    expect(line.baseUrl).toBe(URL_);
    expect(Number.isInteger(line.durationMs)).toBe(true);
    const cron = api.requests.filter((r) => r.path === '/api/cron/cleanup');
    expect(cron.map((r) => r.headers.get('authorization'))).toEqual([null, `Bearer ${SECRET}`]);
  });
});

describe('VC-1119 CRON_SECRET handling', () => {
  it('unset exits 2 with one stderr line naming CRON_SECRET, nothing on stdout', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    for (const env of [{}, { CRON_SECRET: '' }]) {
      const h = harness();
      const code = await runCli(['--base-url', URL_], { env, io: h.io, fetch: api.fetch });
      expect(code).toBe(2);
      expect(h.stdout).toEqual([]);
      expect(h.stderr).toHaveLength(1);
      expect(h.stderr[0]).toContain('CRON_SECRET');
    }
    expect(api.requests).toHaveLength(0);
  });

  it('a wrong secret fails at cron-run with exit 1 and the value is in no output', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    const wrong = 'wrong-SECRET-value-789';
    const h = harness();
    const code = await runCli(['--base-url', URL_], {
      env: { CRON_SECRET: wrong },
      io: h.io,
      fetch: api.fetch,
    });
    expect(code).toBe(1);
    const line = JSON.parse(h.stdout[0]);
    expect(line.passed).toBe(false);
    expect(line.steps.at(-1)).toEqual({ name: 'cron-run', ok: false });
    expect(line.steps).toHaveLength(10);
    const all = [...h.stdout, ...h.stderr].join('\n');
    expect(all).not.toContain(wrong);
    expect(all).not.toContain(SECRET);
  });

  it('a normal run exits 0 and prints one line without the secret or the bypass value', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    const h = harness();
    const code = await runCli(['--base-url', URL_], {
      env: { CRON_SECRET: SECRET, VERCEL_PROTECTION_BYPASS: BYPASS },
      io: h.io,
      fetch: api.fetch,
    });
    expect(code).toBe(0);
    expect(h.stdout).toHaveLength(1);
    expect(h.stderr).toEqual([]);
    const all = h.stdout.join('\n');
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain(BYPASS);
    expect(JSON.parse(h.stdout[0]).passed).toBe(true);
  });

  it('usage errors: missing or non-https --base-url, unknown option', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    for (const args of [
      [],
      ['--base-url', 'http://x.test'],
      ['--base-url', 'nope'],
      ['--x', '1'],
    ]) {
      const h = harness();
      const code = await runCli(args, { env: { CRON_SECRET: SECRET }, io: h.io, fetch: api.fetch });
      expect(code).toBe(2);
      expect(h.stderr).toHaveLength(1);
      expect(h.stdout).toEqual([]);
      expect(h.stderr[0]).not.toContain(SECRET);
    }
  });
});

describe('failure paths stop the run at the failing step', () => {
  it('a server that changes the body of a retried move fails at retry', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    const broken = tamper(api.fetch, (req, body) => {
      if (req.path.endsWith('/moves') && req.seen > 1) {
        const parsed = JSON.parse(body);
        return JSON.stringify({ ...parsed, version: parsed.version + 1 });
      }
      return undefined;
    });
    const { line, error } = await runSmoke(deps(broken), { baseUrl: URL_ });
    expect(line.passed).toBe(false);
    expect(line.steps.at(-1)).toEqual({ name: 'retry', ok: false });
    expect(line.steps.map((s) => s.name)).toEqual(STEP_NAMES.slice(0, 7));
    expect(error?.message).toContain('retry');
    expect(api.requests.some((r) => r.path === '/api/cron/cleanup')).toBe(false);
  });

  it('a response with a seed key fails at no-leak', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    const leaky = tamper(api.fetch, (req, body) =>
      req.method === 'GET' && req.path === '/api/presets'
        ? JSON.stringify({ ...JSON.parse(body), debug: { seed: 42 } })
        : undefined,
    );
    const { line } = await runSmoke(deps(leaky), { baseUrl: URL_ });
    expect(line.passed).toBe(false);
    expect(line.steps.at(-1)).toEqual({ name: 'no-leak', ok: false });
    expect(line.steps).toHaveLength(8);
    expect(api.requests.some((r) => r.path === '/api/cron/cleanup')).toBe(false);
  });

  it('the seat token echoed outside the create response fails at no-leak', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    let token = '';
    const leaky = tamper(api.fetch, (req, body) => {
      if (req.method === 'POST' && req.path === '/api/games') token = JSON.parse(body).seatToken;
      if (req.method === 'GET' && req.path === '/api/presets') return body;
      if (req.method === 'GET' && req.path.startsWith('/api/games/') && token !== '') {
        return JSON.stringify({ ...JSON.parse(body), echo: token });
      }
      return undefined;
    });
    const { line, error } = await runSmoke(deps(leaky), { baseUrl: URL_ });
    expect(line.steps.at(-1)).toEqual({ name: 'no-leak', ok: false });
    expect(error?.message).not.toContain(token);
  });

  it('a server that never conflicts fails at conflict', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    const lax = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await api.fetch(input, init);
      return new Response(await res.text(), { status: res.status === 409 ? 200 : res.status });
    }) as Fetch;
    const { line } = await runSmoke(deps(lax), { baseUrl: URL_ });
    expect(line.steps.at(-1)).toEqual({ name: 'conflict', ok: false });
    expect(line.steps).toHaveLength(4);
  });

  it('a network error fails the current step and does not throw', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    const down = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(String(input)).pathname === '/api/games') throw new TypeError('connect refused');
      return api.fetch(input, init);
    }) as Fetch;
    const { line, error } = await runSmoke(deps(down), { baseUrl: URL_ });
    expect(line.steps).toEqual([
      { name: 'presets', ok: true },
      { name: 'create', ok: false },
    ]);
    expect(error?.name).toBe('TypeError');
  });

  it('a request that hangs is cut by the timeout and fails its step', async () => {
    const hang = (() => new Promise<Response>(() => undefined)) as Fetch;
    const { line, error } = await runSmoke(deps(hang, { timeoutMs: 20 }), { baseUrl: URL_ });
    expect(line.steps).toEqual([{ name: 'presets', ok: false }]);
    expect(error?.name).toBe('RequestTimeoutError');
  });
});

describe('VC-1106 bypass header logic', () => {
  it('is sent on every request when the variable is set', async () => {
    const api = inProcessApi({ cronSecret: SECRET });
    const { line } = await runSmoke(deps(api.fetch, { bypass: BYPASS }), { baseUrl: URL_ });
    expect(line.passed).toBe(true);
    expect(api.requests.length).toBeGreaterThan(10);
    expect(api.requests.every((r) => r.headers.get(BYPASS_HEADER) === BYPASS)).toBe(true);
  });

  it('is not sent when the variable is unset or empty', async () => {
    for (const env of [
      { CRON_SECRET: SECRET },
      { CRON_SECRET: SECRET, VERCEL_PROTECTION_BYPASS: '' },
    ]) {
      const api = inProcessApi({ cronSecret: SECRET });
      const h = harness();
      expect(await runCli(['--base-url', URL_], { env, io: h.io, fetch: api.fetch })).toBe(0);
      expect(api.requests.some((r) => r.headers.has(BYPASS_HEADER))).toBe(false);
    }
  });

  it('a bypass value in an error message is redacted', async () => {
    const boom = (async () => {
      throw new Error(`failed with ${BYPASS}`);
    }) as Fetch;
    const h = harness();
    const code = await runCli(['--base-url', URL_], {
      env: { CRON_SECRET: SECRET, VERCEL_PROTECTION_BYPASS: BYPASS },
      io: h.io,
      fetch: boom,
    });
    expect(code).toBe(1);
    expect([...h.stdout, ...h.stderr].join('\n')).not.toContain(BYPASS);
  });
});
