// HTTP smoke test (`pnpm smoke`, spec 11 FR-1118, FR-1119). Plays one full game against a deployed
// URL and checks auth, the version conflict, resume, retry, secret hygiene and the cron route.
//
//   pnpm smoke --base-url <https url>
//   env: CRON_SECRET (required), VERCEL_PROTECTION_BYPASS (optional)
//
// Steps, in order (stops at the first failure): presets, create, auth, conflict, play, resume,
// retry, no-leak, cron-auth, cron-run. One JSON line on stdout. Exit 0 = passed, 1 = failed,
// 2 = usage error. No token, secret or bypass value appears in any output.
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { UsageError, parseStrict } from './lib/args';
import { type FetchFn, type HttpResponse, request } from './lib/http';

export const STEP_NAMES = [
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
] as const;
export type StepName = (typeof STEP_NAMES)[number];

export const MAX_PLAY_MOVES = 2000;
const AI_COUNT = 2;
const SEATS = AI_COUNT + 1;
const MAX_ERROR_MESSAGE = 200;

export interface SmokeDeps {
  fetch: FetchFn;
  /** Value of `CRON_SECRET` of the target environment. */
  cronSecret: string;
  /** Value of `VERCEL_PROTECTION_BYPASS`; sent as a header iff non-empty. */
  bypass?: string;
  /** Strings replaced by `[redacted]` in error messages. */
  redact?: readonly string[];
  /** `crypto.randomUUID` by default (clientRequestId). */
  randomUUID?: () => string;
  /** Per-request abort in ms (default 30 000; tests only). */
  timeoutMs?: number;
  /** Aborting ends the run between requests. */
  signal?: AbortSignal;
  /** Wall clock in ms for `durationMs` (`performance.now` in `main`). */
  now?: () => number;
}

export interface SmokeOptions {
  /** https URL of the deployment, without a path. */
  baseUrl: string;
}

export interface SmokeLine {
  check: 'smoke';
  baseUrl: string;
  startedAt: string;
  steps: Array<{ name: StepName; ok: boolean }>;
  passed: boolean;
  durationMs: number;
}

export interface SmokeOutcome {
  line: SmokeLine;
  /** Why a step failed (name and message, redacted); printed to stderr, never in the line. */
  error?: { name: string; message: string };
}

/** A step's expectation was not met. */
class StepFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepFailure';
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new StepFailure(message);
}

function hasKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => hasKey(item, key));
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(([k, v]) => k === key || hasKey(v, key));
}

function sanitize(error: unknown, redact: readonly string[]): { name: string; message: string } {
  const name = error instanceof Error ? error.name : 'Error';
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of redact) {
    if (secret !== '') message = message.split(secret).join('[redacted]');
  }
  message = message.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_MESSAGE);
  return { name, message };
}

interface LegalMove {
  id: string;
}

interface Update {
  version: number;
  phase: string;
  legalMoves: LegalMove[];
  finalRanking: unknown;
}

function readUpdate(value: unknown, context: string): Update {
  const update = asRecord(value);
  const view = asRecord(update.view);
  expect(
    typeof update.version === 'number' &&
      Number.isInteger(update.version) &&
      typeof view.phase === 'string' &&
      Array.isArray(update.legalMoves),
    `${context}: not a PlayerUpdate`,
  );
  const legalMoves = (update.legalMoves as unknown[]).map((m) => {
    const id = asRecord(m).id;
    expect(typeof id === 'string', `${context}: legal move without an id`);
    return { id };
  });
  return {
    version: update.version as number,
    phase: view.phase as string,
    legalMoves,
    finalRanking: view.finalRanking,
  };
}

/**
 * Runs the ten steps and returns the JSON line (and the failure reason, if any). Never throws and
 * never prints. A step that throws (non-expected status, network error, timeout) is `ok: false`.
 */
export async function runSmoke(deps: SmokeDeps, options: SmokeOptions): Promise<SmokeOutcome> {
  const clock = deps.now ?? (() => performance.now());
  const uuid = deps.randomUUID ?? randomUUID;
  const base = options.baseUrl.replace(/\/+$/, '');
  const redact = deps.redact ?? [];
  const startedAt = new Date().toISOString();
  const t0 = clock();
  const steps: SmokeLine['steps'] = [];
  const bodies: string[] = []; // every response body of the run, in order
  let error: { name: string; message: string } | undefined;

  const send = async (path: string, init: RequestInit): Promise<HttpResponse> => {
    if (deps.signal?.aborted) throw new StepFailure('run interrupted');
    const res = await request(deps.fetch, `${base}${path}`, init, {
      ...(deps.bypass !== undefined ? { bypass: deps.bypass } : {}),
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    });
    bodies.push(res.body);
    return res;
  };

  // State shared between steps.
  let gameId = '';
  let seatToken = '';
  let createUpdate: Update | undefined;
  let createBody = '';
  let winner: { init: RequestInit; path: string; body: string; update: Update } | undefined;
  let last: Update | undefined;

  const auth = (): Record<string, string> => ({ authorization: `Bearer ${seatToken}` });
  const moveInit = (version: number, moveId: string): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth() },
    body: JSON.stringify({ version, moveId, clientRequestId: uuid() }),
  });

  const runners: Record<StepName, () => Promise<void>> = {
    presets: async () => {
      const res = await send('/api/presets', { method: 'GET' });
      expect(res.status === 200, `presets answered ${res.status}`);
      const body = asRecord(parseJson(res.body));
      const presets = body.presets;
      expect(Array.isArray(presets), 'presets: no presets list');
      const ids = (presets as unknown[]).map((p) => asRecord(p).id);
      expect(
        typeof body.defaultPresetId === 'string' && ids.includes(body.defaultPresetId),
        'presets: defaultPresetId is not one of the presets',
      );
    },
    create: async () => {
      const res = await send('/api/games', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ humanName: 'smoke', aiCount: AI_COUNT }),
      });
      expect(res.status === 201, `create answered ${res.status}`);
      const body = asRecord(parseJson(res.body));
      expect(
        typeof body.gameId === 'string' && typeof body.seatToken === 'string',
        'create: no gameId or seatToken',
      );
      gameId = body.gameId as string;
      seatToken = body.seatToken as string;
      createBody = res.body;
      createUpdate = readUpdate(body.update, 'create');
      last = createUpdate;
    },
    auth: async () => {
      const res = await send(`/api/games/${gameId}`, { method: 'GET' });
      expect(res.status === 401, `get without Authorization answered ${res.status}`);
    },
    conflict: async () => {
      expect(createUpdate !== undefined, 'conflict: no create state');
      expect(createUpdate.legalMoves.length >= 2, 'conflict: fewer than 2 legal moves');
      const path = `/api/games/${gameId}/moves`;
      const inits = [0, 1].map((i) =>
        moveInit(createUpdate!.version, createUpdate!.legalMoves[i].id),
      );
      const results = await Promise.all(inits.map((init) => send(path, init)));
      const statuses = results.map((r) => r.status).sort();
      expect(statuses[0] === 200 && statuses[1] === 409, `conflict answered ${statuses.join(',')}`);
      const loser = results.find((r) => r.status === 409)!;
      expect(
        asRecord(parseJson(loser.body)).update !== undefined,
        'conflict: 409 body has no update',
      );
      const index = results.findIndex((r) => r.status === 200);
      const update = readUpdate(parseJson(results[index].body), 'conflict winner');
      winner = { init: inits[index], path, body: results[index].body, update };
      last = update;
    },
    play: async () => {
      expect(last !== undefined, 'play: no state');
      const path = `/api/games/${gameId}/moves`;
      let moves = 0;
      while (last.phase !== 'game-over') {
        expect(moves < MAX_PLAY_MOVES, `play: not finished after ${MAX_PLAY_MOVES} moves`);
        expect(last.legalMoves.length > 0, 'play: no legal move');
        const res = await send(path, moveInit(last.version, last.legalMoves[0].id));
        expect(res.status === 200, `move answered ${res.status}`);
        last = readUpdate(parseJson(res.body), 'move');
        moves += 1;
      }
      const ranking = last.finalRanking;
      expect(Array.isArray(ranking), 'play: no finalRanking');
      const seats = new Set((ranking as unknown[]).map((r) => asRecord(r).seat));
      expect(
        seats.size === SEATS && [...Array(SEATS).keys()].every((s) => seats.has(s)),
        'play: finalRanking lacks a seat',
      );
    },
    resume: async () => {
      expect(last !== undefined, 'resume: no state');
      const current = await send(`/api/games/${gameId}`, { method: 'GET', headers: auth() });
      expect(current.status === 200, `resume answered ${current.status}`);
      expect(
        readUpdate(parseJson(current.body), 'resume').version === last.version,
        'resume: version differs from the last move response',
      );
      const since = await send(`/api/games/${gameId}?since=0`, { method: 'GET', headers: auth() });
      expect(since.status === 200, `resume since=0 answered ${since.status}`);
      const events = asRecord(parseJson(since.body)).events;
      expect(Array.isArray(events) && events.length > 0, 'resume: since=0 has no events');
    },
    retry: async () => {
      expect(winner !== undefined, 'retry: no accepted move');
      const res = await send(winner.path, winner.init);
      expect(res.status === 200, `retry answered ${res.status}`);
      expect(
        isDeepStrictEqual(parseJson(res.body), parseJson(winner.body)),
        'retry: body differs from the original response',
      );
    },
    'no-leak': async () => {
      expect(
        bodies.every((body) => !hasKey(parseJson(body), 'seed')),
        'a response has a key named seed',
      );
      expect(createBody.includes(seatToken), 'create response lacks the seat token');
      expect(
        bodies.every((body) => body === createBody || !body.includes(seatToken)),
        'the seat token appears outside the create response',
      );
    },
    'cron-auth': async () => {
      const res = await send('/api/cron/cleanup', { method: 'GET' });
      expect(res.status === 401, `cron without Authorization answered ${res.status}`);
    },
    'cron-run': async () => {
      const res = await send('/api/cron/cleanup', {
        method: 'GET',
        headers: { authorization: `Bearer ${deps.cronSecret}` },
      });
      expect(res.status === 200, `cron answered ${res.status}`);
      const body = asRecord(parseJson(res.body));
      expect(
        Number.isInteger(body.gamesDeleted) &&
          typeof body.capReached === 'boolean' &&
          Number.isInteger(body.skippedMarkers),
        'cron: unexpected body shape',
      );
    },
  };

  for (const name of STEP_NAMES) {
    try {
      await runners[name]();
      steps.push({ name, ok: true });
    } catch (caught) {
      steps.push({ name, ok: false });
      error = sanitize(caught, redact);
      break;
    }
  }

  const line: SmokeLine = {
    check: 'smoke',
    baseUrl: options.baseUrl,
    startedAt,
    steps,
    passed: error === undefined,
    durationMs: Math.round(clock() - t0),
  };
  return error === undefined ? { line } : { line, error };
}

export interface CliIo {
  stdout(line: string): void;
  stderr(line: string): void;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  io: CliIo;
  fetch: FetchFn;
  now?: () => number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Parses arguments and env, runs the smoke test, prints, and returns the exit code (0, 1 or 2). */
export async function runCli(args: readonly string[], deps: CliDeps): Promise<number> {
  const { env, io } = deps;
  let baseUrl: string;
  let cronSecret: string;
  try {
    const parsed = parseStrict(args, { 'base-url': { type: 'string' } });
    const given = parsed['base-url'];
    if (given === undefined) throw new UsageError('--base-url is required');
    let url: URL | undefined;
    try {
      url = new URL(given);
    } catch {
      url = undefined;
    }
    if (url === undefined || url.protocol !== 'https:') {
      throw new UsageError('--base-url must be an https URL');
    }
    baseUrl = given;
    const secret = env.CRON_SECRET;
    if (secret === undefined || secret === '') throw new UsageError('CRON_SECRET is not set');
    cronSecret = secret;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`smoke: ${error.message}`);
      return 2;
    }
    throw error;
  }

  const bypass = env.VERCEL_PROTECTION_BYPASS;
  const outcome = await runSmoke(
    {
      fetch: deps.fetch,
      cronSecret,
      ...(bypass !== undefined && bypass !== '' ? { bypass } : {}),
      redact: [cronSecret, bypass].filter((s): s is string => s !== undefined && s !== ''),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
      ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    },
    { baseUrl },
  );
  if (outcome.error !== undefined) {
    io.stderr(`smoke: failed: ${outcome.error.name}: ${outcome.error.message}`);
  }
  io.stdout(JSON.stringify(outcome.line));
  return outcome.line.passed ? 0 : 1;
}

async function main(): Promise<number> {
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  return runCli(process.argv.slice(2), {
    env: process.env,
    io: {
      stdout: (line) => void process.stdout.write(`${line}\n`),
      stderr: (line) => void process.stderr.write(`${line}\n`),
    },
    fetch: (input, init) => fetch(input, init),
    now: () => performance.now(),
    signal: controller.signal,
  });
}

// Run only when executed as a script, so tests can import `runSmoke` and `runCli`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
