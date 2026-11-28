// bench-moves (spec 11 FR-1113..FR-1117; VC-1113..VC-1117, VC-1106 logic). Every test drives the
// real route handlers over a MemoryObjectStore through the in-process fetch; no network.
import { describe, expect, it } from 'vitest';
import { runBench, runCli, type BenchDeps, type BenchLine } from '@/scripts/bench-moves';
import { headKey } from '@/src/state/keys';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import type { ObjectStore, PutOptions } from '@/src/storage/object-store';
import { faultyStore } from './helpers/faulty-store';
import { inProcessApi } from './helpers/in-process-fetch';

const URL_ = 'https://bench.example.test';
const TOKEN = 'blob_rw_SECRETTOKEN123';
const BYPASS = 'bypass-SECRET-value-456';

/** A clock where every call advances by `step` ms: a timed request then lasts exactly `step`. */
function steppingClock(step: number): () => number {
  let t = 0;
  return () => {
    t += step;
    return t;
  };
}

function deps(over: Partial<BenchDeps> & Pick<BenchDeps, 'fetch'>): BenchDeps {
  return { now: steppingClock(7), ...over };
}

const warm = (samples: number) => ({
  baseUrl: URL_,
  scenario: 'warm' as const,
  samples,
  limitMs: 500,
});

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

describe('VC-1113 warm', () => {
  it('100 samples against the real handlers: n 100, integer p95, passed = p95 < 500', async () => {
    const api = inProcessApi();
    const { line, error } = await runBench(deps({ fetch: api.fetch }), warm(100));
    expect(error).toBeUndefined();
    expect(line.n).toBe(100);
    expect(Number.isInteger(line.p95Ms)).toBe(true);
    expect(line.passed).toBe(line.p95Ms < 500);
    expect(Object.keys(line)).toEqual([
      'check',
      'scenario',
      'baseUrl',
      'startedAt',
      'n',
      'minMs',
      'p50Ms',
      'p95Ms',
      'maxMs',
      'baselineMedianMs',
      'limitMs',
      'passed',
    ]);
    expect(line).toMatchObject({
      check: 'bench-moves',
      scenario: 'warm',
      baseUrl: URL_,
      limitMs: 500,
    });
    // 3 untimed warm-up moves precede the timed ones.
    const moves = api.requests.filter((r) => r.path.endsWith('/moves'));
    expect(moves.length).toBeGreaterThanOrEqual(103);
  });

  it('a clock that makes every request 600 ms gives passed false and exit 1', async () => {
    const api = inProcessApi();
    const { line } = await runBench(deps({ fetch: api.fetch, now: steppingClock(600) }), warm(10));
    expect(line).toMatchObject({
      n: 10,
      minMs: 600,
      p50Ms: 600,
      p95Ms: 600,
      maxMs: 600,
      passed: false,
    });
    const h = harness();
    const code = await runCli(['--base-url', URL_, '--scenario', 'warm', '--samples', '10'], {
      env: {},
      io: h.io,
      fetch: api.fetch,
      now: steppingClock(600),
      makeStore: () => new MemoryObjectStore(),
    });
    expect(code).toBe(1);
    expect(JSON.parse(h.stdout[0]).passed).toBe(false);
  });

  it('percentiles are nearest rank on the sorted samples', async () => {
    const api = inProcessApi();
    // Timed requests last 10, 20, ..., 100 ms in order; all other requests last 1 ms.
    let t = 0;
    const timedDurations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    let timed = 0;
    const now = (): number => t;
    const fetchWrapped: typeof fetch = async (input, init) => {
      const res = await api.fetch(input, init);
      const path = new URL(typeof input === 'string' ? input : (input as Request).url).pathname;
      if (path.endsWith('/moves')) {
        // The first 3 moves are untimed warm-up; their durations are discarded by the script.
        t += timed < 3 ? 1 : timedDurations[timed - 3];
        timed += 1;
      } else t += 1;
      return res;
    };
    const { line } = await runBench(deps({ fetch: fetchWrapped, now }), warm(10));
    expect(line).toMatchObject({
      n: 10,
      minMs: 10,
      p50Ms: 50,
      p95Ms: 100,
      maxMs: 100,
      passed: true,
    });
    expect(line.baselineMedianMs).toBe(1);
  });

  it('plays on across game over by creating a new game', async () => {
    const api = inProcessApi();
    const { line } = await runBench(deps({ fetch: api.fetch }), warm(400));
    expect(line.n).toBe(400);
    expect(
      api.requests.filter((r) => r.method === 'POST' && r.path === '/api/games').length,
    ).toBeGreaterThan(1);
  });
});

describe('VC-1114 stale', () => {
  /** A spy over `inner` recording the head.json operations the script performs. */
  function spyStore(inner: ObjectStore): { store: ObjectStore; ops: string[] } {
    const ops: string[] = [];
    const store = faultyStore(inner, (i) => ({
      get: async (key) => {
        const found = await i.get(key);
        if (key.endsWith('/head.json') && found) {
          ops.push(
            `get:${(JSON.parse(new TextDecoder().decode(found.body)) as { version: number }).version}`,
          );
        }
        return found;
      },
      put: async (key, body, opts?: PutOptions) => {
        if (key.endsWith('/head.json')) {
          expect(opts?.mode).toBe('overwrite');
          ops.push(`put:${(JSON.parse(String(body)) as { version: number }).version}`);
        }
        return i.put(key, body, opts);
      },
    }));
    return { store, ops };
  }

  it('every sample: head held version before the overwrite and version - 1 after it', async () => {
    const shared = new MemoryObjectStore();
    const api = inProcessApi({ store: shared });
    const { store, ops } = spyStore(shared);
    const { line, error } = await runBench(deps({ fetch: api.fetch, store }), {
      baseUrl: URL_,
      scenario: 'stale',
      samples: 30,
      limitMs: 500,
    });
    expect(error).toBeUndefined();
    expect(line.n).toBe(30);
    expect(line.passed).toBe(true);
    expect(ops).toHaveLength(90);
    for (let i = 0; i < ops.length; i += 3) {
      const v = Number(ops[i].split(':')[1]);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(ops.slice(i, i + 3)).toEqual([`get:${v}`, `put:${v - 1}`, `get:${v - 1}`]);
    }
  });

  it("a store different from the handlers' store exits 1 at the first pre-overwrite read", async () => {
    const api = inProcessApi();
    const other = new MemoryObjectStore();
    const puts: string[] = [];
    const store = faultyStore(other, (i) => ({
      put: async (key, body, opts) => {
        puts.push(key);
        return i.put(key, body, opts);
      },
    }));
    const h = harness();
    const code = await runCli(['--base-url', URL_, '--scenario', 'stale', '--samples', '5'], {
      env: { BLOB_READ_WRITE_TOKEN: TOKEN },
      io: h.io,
      fetch: api.fetch,
      now: steppingClock(3),
      makeStore: () => store,
    });
    expect(code).toBe(1);
    const line = JSON.parse(h.stdout[0]) as BenchLine;
    expect(line).toMatchObject({ n: 0, passed: false, baselineMedianMs: null });
    expect(puts).toEqual([]);
    expect(h.stderr.join('\n')).toContain('head.json is missing');
    expect(h.stderr.join('\n')).not.toContain(TOKEN);
    expect(await other.get(headKey('x'.repeat(26)))).toBeNull();
  });

  it('a head that stays at version after the overwrite ends the run with exit 1', async () => {
    const shared = new MemoryObjectStore();
    const api = inProcessApi({ store: shared });
    const store = faultyStore(shared, () => ({ put: async () => undefined }));
    const { line, error } = await runBench(deps({ fetch: api.fetch, store }), {
      baseUrl: URL_,
      scenario: 'stale',
      samples: 3,
      limitMs: 500,
    });
    expect(line).toMatchObject({ n: 0, passed: false, baselineMedianMs: null });
    expect(error?.name).toBe('HeadMismatch');
  });
});

describe('VC-1115 cold', () => {
  it('times one first move: n 1 and passed true whatever the time', async () => {
    const api = inProcessApi();
    const { line } = await runBench(deps({ fetch: api.fetch, now: steppingClock(9000) }), {
      baseUrl: URL_,
      scenario: 'cold',
      samples: 1,
      limitMs: 500,
    });
    expect(line).toMatchObject({ n: 1, p95Ms: 9000, passed: true });
    expect(api.requests.map((r) => `${r.method} ${r.path}`).slice(0, 2)).toEqual([
      'POST /api/games',
      expect.stringMatching(/^POST \/api\/games\/[a-z2-7]{26}\/moves$/),
    ]);
  });

  it('--scenario cold --samples 2 exits 2 with one stderr line', async () => {
    const h = harness();
    const code = await runCli(['--base-url', URL_, '--scenario', 'cold', '--samples', '2'], {
      env: {},
      io: h.io,
      fetch: inProcessApi().fetch,
      now: steppingClock(1),
      makeStore: () => new MemoryObjectStore(),
    });
    expect(code).toBe(2);
    expect(h.stdout).toEqual([]);
    expect(h.stderr).toHaveLength(1);
  });
});

describe('VC-1116 baseline', () => {
  it('takes 20 presets timings after the samples and reports an integer median', async () => {
    const api = inProcessApi();
    const { line } = await runBench(deps({ fetch: api.fetch }), warm(5));
    expect(Number.isInteger(line.baselineMedianMs)).toBe(true);
    const presets = api.requests.filter((r) => r.path === '/api/presets');
    expect(presets).toHaveLength(20);
    const lastMove = api.requests.map((r) => r.path.endsWith('/moves')).lastIndexOf(true);
    expect(api.requests.findIndex((r) => r.path === '/api/presets')).toBeGreaterThan(lastMove);
  });
});

describe('VC-1117 failure and boundary paths', () => {
  it('a server answering 404 on moves gives exit 1 with passed false', async () => {
    const api = inProcessApi();
    const fetch404: typeof fetch = async (input, init) => {
      const path = new URL(typeof input === 'string' ? input : (input as Request).url).pathname;
      return path.endsWith('/moves') ? new Response('{}', { status: 404 }) : api.fetch(input, init);
    };
    const h = harness();
    const code = await runCli(['--base-url', URL_, '--scenario', 'warm', '--samples', '5'], {
      env: {},
      io: h.io,
      fetch: fetch404,
      now: steppingClock(1),
      makeStore: () => new MemoryObjectStore(),
    });
    expect(code).toBe(1);
    expect(JSON.parse(h.stdout[0])).toMatchObject({ passed: false, baselineMedianMs: null, n: 0 });
  });

  it('a 404 on a timed move after some samples keeps n = samples taken', async () => {
    const api = inProcessApi();
    let moves = 0;
    const flaky: typeof fetch = async (input, init) => {
      const path = new URL(typeof input === 'string' ? input : (input as Request).url).pathname;
      if (path.endsWith('/moves') && (moves += 1) > 6) return new Response('{}', { status: 404 });
      return api.fetch(input, init);
    };
    const { line, error } = await runBench(deps({ fetch: flaky }), warm(10));
    expect(line).toMatchObject({ n: 3, passed: false, baselineMedianMs: null });
    expect(error?.name).toBe('HttpStatusError');
  });

  it('a network error and a timeout end the run with exit 1', async () => {
    const boom: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    expect((await runBench(deps({ fetch: boom }), warm(3))).line.passed).toBe(false);
    const hang: typeof fetch = () => new Promise<Response>(() => undefined);
    const out = await runBench(deps({ fetch: hang, timeoutMs: 20 }), warm(3));
    expect(out.line).toMatchObject({ passed: false, n: 0, baselineMedianMs: null });
    expect(out.error?.name).toBe('RequestTimeoutError');
  });

  it('an aborted signal ends the run with passed false', async () => {
    const c = new AbortController();
    c.abort();
    const out = await runBench(deps({ fetch: inProcessApi().fetch, signal: c.signal }), warm(3));
    expect(out.line.passed).toBe(false);
    expect(out.error?.name).toBe('InterruptedError');
  });

  it.each([
    ['--samples 0', ['--base-url', URL_, '--scenario', 'warm', '--samples', '0'], {}],
    ['missing --scenario', ['--base-url', URL_], {}],
    ['missing --base-url', ['--scenario', 'warm'], {}],
    ['http base url', ['--base-url', 'http://x.test', '--scenario', 'warm'], {}],
    ['bad base url', ['--base-url', 'nope', '--scenario', 'warm'], {}],
    ['unknown scenario', ['--base-url', URL_, '--scenario', 'hot'], {}],
    ['--samples 1001', ['--base-url', URL_, '--scenario', 'warm', '--samples', '1001'], {}],
    ['stale without a token', ['--base-url', URL_, '--scenario', 'stale'], {}],
    [
      'stale with an empty token',
      ['--base-url', URL_, '--scenario', 'stale'],
      { BLOB_READ_WRITE_TOKEN: '' },
    ],
  ])('usage error exits 2 with one stderr line: %s', async (_name, args, env) => {
    const h = harness();
    const code = await runCli(args, {
      env,
      io: h.io,
      fetch: inProcessApi().fetch,
      now: steppingClock(1),
      makeStore: () => new MemoryObjectStore(),
    });
    expect(code).toBe(2);
    expect(h.stdout).toEqual([]);
    expect(h.stderr).toHaveLength(1);
    expect(h.stderr[0]).toMatch(/^bench-moves: /);
  });

  it('the stale token error names the variable', async () => {
    const h = harness();
    await runCli(['--base-url', URL_, '--scenario', 'stale'], {
      env: {},
      io: h.io,
      fetch: inProcessApi().fetch,
      now: steppingClock(1),
      makeStore: () => new MemoryObjectStore(),
    });
    expect(h.stderr[0]).toContain('BLOB_READ_WRITE_TOKEN');
  });

  it('--p95-limit-ms is honoured', async () => {
    const h = harness();
    const code = await runCli(
      ['--base-url', URL_, '--scenario', 'warm', '--samples', '4', '--p95-limit-ms', '5'],
      {
        env: {},
        io: h.io,
        fetch: inProcessApi().fetch,
        now: steppingClock(7),
        makeStore: () => new MemoryObjectStore(),
      },
    );
    expect(code).toBe(1);
    expect(JSON.parse(h.stdout[0])).toMatchObject({ limitMs: 5, p95Ms: 7, passed: false });
  });
});

describe('VC-1106 bypass header (logic)', () => {
  async function run(env: Record<string, string>) {
    const api = inProcessApi();
    const h = harness();
    const code = await runCli(['--base-url', URL_, '--scenario', 'stale', '--samples', '3'], {
      env: { BLOB_READ_WRITE_TOKEN: TOKEN, ...env },
      io: h.io,
      fetch: api.fetch,
      now: steppingClock(2),
      makeStore: () => api.store,
    });
    return { api, h, code };
  }

  it('is sent on every request when set, and its value never reaches the output', async () => {
    const { api, h, code } = await run({ VERCEL_PROTECTION_BYPASS: BYPASS });
    expect(code).toBe(0);
    expect(api.requests.length).toBeGreaterThan(20);
    for (const r of api.requests) expect(r.headers.get('x-vercel-protection-bypass')).toBe(BYPASS);
    const all = [...h.stdout, ...h.stderr].join('\n');
    expect(all).not.toContain(BYPASS);
    expect(all).not.toContain(TOKEN);
  });

  it('is sent on no request when not set', async () => {
    const { api, code } = await run({});
    expect(code).toBe(0);
    for (const r of api.requests) expect(r.headers.has('x-vercel-protection-bypass')).toBe(false);
  });

  it('a failing run does not leak the bypass value or the token in its error line', async () => {
    const h = harness();
    const leaky: typeof fetch = async () => {
      throw new TypeError(`connect failed ${BYPASS} ${TOKEN}`);
    };
    const code = await runCli(['--base-url', URL_, '--scenario', 'stale'], {
      env: { BLOB_READ_WRITE_TOKEN: TOKEN, VERCEL_PROTECTION_BYPASS: BYPASS },
      io: h.io,
      fetch: leaky,
      now: steppingClock(1),
      makeStore: () => new MemoryObjectStore(),
    });
    expect(code).toBe(1);
    const all = [...h.stdout, ...h.stderr].join('\n');
    expect(all).not.toContain(BYPASS);
    expect(all).not.toContain(TOKEN);
    expect(all).toContain('[redacted]');
  });
});
