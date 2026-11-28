// Move latency benchmark (`pnpm bench-moves`, spec 11 FR-1113..FR-1117). Plays games over HTTP
// against a deployed URL and times `POST /api/games/{id}/moves` (client-observed, so it includes
// network distance; `baselineMedianMs`, 20 timings of `GET /api/presets`, documents that).
//
//   pnpm bench-moves --base-url <https url> --scenario warm|stale|cold
//                    [--samples <1-1000, default 100>] [--p95-limit-ms <default 500>]
//   env: VERCEL_PROTECTION_BYPASS (optional), BLOB_READ_WRITE_TOKEN (required for `stale`)
//
// One JSON line on stdout. Exit 0 = passed, 1 = failed or aborted, 2 = usage error. The bypass
// value and the token never appear in any output. `stale` also writes `games/{id}/head.json`.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { headKey } from '@/src/state/keys';
import { HeadSchema } from '@/src/state/schemas';
import type { ObjectStore } from '@/src/storage/object-store';
import { VercelBlobObjectStore } from '@/src/storage/vercel-blob-store';
import { UsageError, parseStrict } from './lib/args';
import { type FetchFn, request } from './lib/http';
import { median, p95, percentile, roundInt } from './lib/stats';

export const DEFAULT_SAMPLES = 100;
export const DEFAULT_P95_LIMIT_MS = 500;
export const WARMUP_MOVES = 3;
export const BASELINE_SAMPLES = 20;
const MAX_ERROR_MESSAGE = 200;

export type Scenario = 'warm' | 'stale' | 'cold';
const SCENARIOS: readonly Scenario[] = ['warm', 'stale', 'cold'];

export interface BenchDeps {
  fetch: FetchFn;
  /** Monotonic clock in ms (`main` passes `performance.now`). Samples are differences of it. */
  now: () => number;
  /** Required for `stale` (reads and overwrites `games/{id}/head.json`). */
  store?: ObjectStore;
  /** Value of `VERCEL_PROTECTION_BYPASS`; sent as a header iff non-empty. */
  bypass?: string;
  /** Strings replaced by `[redacted]` in error messages (token, bypass). */
  redact?: readonly string[];
  /** `crypto.randomUUID` by default (clientRequestId). */
  randomUUID?: () => string;
  /** Aborting ends the run between requests (`InterruptedError`). */
  signal?: AbortSignal;
  /** Per-request abort in ms (default 30 000; tests only). */
  timeoutMs?: number;
}

export interface BenchOptions {
  /** https URL of the deployment, without a path. */
  baseUrl: string;
  scenario: Scenario;
  samples: number;
  limitMs: number;
}

/** The JSON line (key order matters). Integers in ms; zero stats when no sample was taken. */
export interface BenchLine {
  check: 'bench-moves';
  scenario: Scenario;
  baseUrl: string;
  startedAt: string;
  n: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** null only when the run aborted before the baseline step. */
  baselineMedianMs: number | null;
  limitMs: number;
  passed: boolean;
}

export interface BenchOutcome {
  line: BenchLine;
  /** Why the run aborted; absent on a normal finish. Printed to stderr, never in the line. */
  error?: { name: string; message: string };
}

/** The run cannot continue (non-200, bad body, head mismatch, abort). */
class BenchAbort extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

interface Game {
  gameId: string;
  seatToken: string;
  version: number;
  over: boolean;
  firstMoveId: string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Reads `{ version, view.phase, legalMoves[0].id }` from a PlayerUpdate body. */
function readUpdate(body: string, context: string): Omit<Game, 'gameId' | 'seatToken'> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new BenchAbort('BadResponse', `${context}: response body is not JSON`);
  }
  const update = asRecord(parsed);
  const version = update.version;
  const phase = asRecord(update.view).phase;
  const legal = update.legalMoves;
  if (typeof version !== 'number' || !Number.isInteger(version) || typeof phase !== 'string') {
    throw new BenchAbort('BadResponse', `${context}: response is not a PlayerUpdate`);
  }
  const over = phase === 'game-over';
  const first = Array.isArray(legal) ? asRecord(legal[0]).id : undefined;
  if (!over && typeof first !== 'string') {
    throw new BenchAbort('BadResponse', `${context}: no legal move to play`);
  }
  return { version, over, firstMoveId: typeof first === 'string' ? first : undefined };
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

/**
 * Runs one scenario and returns the JSON line (and the abort reason, if any). Never throws and
 * never prints. Aborted runs (non-200 on any request, network error, timeout, bad body, head
 * mismatch, signal) give `passed: false`, `baselineMedianMs: null` and `n` = samples taken.
 */
export async function runBench(deps: BenchDeps, options: BenchOptions): Promise<BenchOutcome> {
  const { now } = deps;
  const uuid = deps.randomUUID ?? randomUUID;
  const base = options.baseUrl.replace(/\/+$/, '');
  const redact = deps.redact ?? [];
  const startedAt = new Date().toISOString();
  const timings: number[] = [];
  let baseline: number | null = null;
  let error: { name: string; message: string } | undefined;

  const send = (path: string, init: RequestInit) =>
    request(deps.fetch, `${base}${path}`, init, {
      ...(deps.bypass !== undefined ? { bypass: deps.bypass } : {}),
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    });
  const checkSignal = (): void => {
    if (deps.signal?.aborted) throw new BenchAbort('InterruptedError', 'run interrupted');
  };

  async function createGame(): Promise<Game> {
    checkSignal();
    const res = await send('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ humanName: 'bench', aiCount: 2 }),
    });
    if (res.status !== 201)
      throw new BenchAbort('HttpStatusError', `create game answered ${res.status}`);
    const parsed = asRecord(safeJson(res.body));
    const gameId = parsed.gameId;
    const seatToken = parsed.seatToken;
    if (typeof gameId !== 'string' || typeof seatToken !== 'string') {
      throw new BenchAbort('BadResponse', 'create game: response has no gameId or seatToken');
    }
    const update = readUpdate(JSON.stringify(parsed.update ?? null), 'create game');
    return { gameId, seatToken, ...update };
  }

  /** Plays the game's first legal move; returns the elapsed ms (only the caller decides to keep it). */
  async function move(game: Game, label: string): Promise<number> {
    checkSignal();
    if (game.firstMoveId === undefined)
      throw new BenchAbort('BadResponse', `${label}: game is over`);
    const init: RequestInit = {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${game.seatToken}` },
      body: JSON.stringify({
        version: game.version,
        moveId: game.firstMoveId,
        clientRequestId: uuid(),
      }),
    };
    const start = now();
    const res = await send(`/api/games/${game.gameId}/moves`, init);
    const elapsed = now() - start;
    if (res.status !== 200)
      throw new BenchAbort('HttpStatusError', `${label} answered ${res.status}`);
    Object.assign(game, readUpdate(res.body, label));
    return elapsed;
  }

  async function startGame(untimedMoves: number): Promise<Game> {
    const game = await createGame();
    for (let i = 0; i < untimedMoves && !game.over; i += 1) await move(game, 'untimed move');
    return game;
  }

  async function readHead(store: ObjectStore, game: Game): Promise<number> {
    const stored = await store.get(headKey(game.gameId));
    if (stored === null) throw new BenchAbort('HeadMismatch', 'head.json is missing');
    const head = HeadSchema.safeParse(safeJson(new TextDecoder().decode(stored.body)));
    if (!head.success) throw new BenchAbort('HeadMismatch', 'head.json is not a valid head');
    return head.data.version;
  }

  /** FR-1114: head must hold `version` before the overwrite and `version - 1` after it. */
  async function makeStale(store: ObjectStore, game: Game): Promise<void> {
    checkSignal();
    const before = await readHead(store, game);
    if (before !== game.version) {
      throw new BenchAbort('HeadMismatch', 'head.json does not hold the last received version');
    }
    await store.put(
      headKey(game.gameId),
      JSON.stringify({ schemaVersion: 1, version: game.version - 1 }),
      { mode: 'overwrite', contentType: 'application/json' },
    );
    const after = await readHead(store, game);
    if (after !== game.version - 1) {
      throw new BenchAbort(
        'HeadMismatch',
        'head.json does not hold version - 1 after the overwrite',
      );
    }
  }

  try {
    if (options.scenario === 'cold') {
      const game = await startGame(0);
      timings.push(await move(game, 'timed move'));
    } else {
      const store = deps.store;
      if (options.scenario === 'stale' && store === undefined) {
        throw new BenchAbort('NoStore', 'stale scenario needs a store');
      }
      const untimed = options.scenario === 'warm' ? WARMUP_MOVES : 1;
      let game = await startGame(untimed);
      while (timings.length < options.samples) {
        if (game.over) game = await startGame(untimed);
        if (options.scenario === 'stale' && store !== undefined) await makeStale(store, game);
        timings.push(await move(game, 'timed move'));
      }
    }

    const presets: number[] = [];
    for (let i = 0; i < BASELINE_SAMPLES; i += 1) {
      checkSignal();
      const start = now();
      const res = await send('/api/presets', { method: 'GET' });
      presets.push(now() - start);
      if (res.status !== 200)
        throw new BenchAbort('HttpStatusError', `presets answered ${res.status}`);
    }
    baseline = roundInt(median(presets));
  } catch (caught) {
    error = sanitize(caught, redact);
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const stat = (pick: (s: number[]) => number): number =>
    sorted.length === 0 ? 0 : roundInt(pick(sorted));
  const p95Ms = stat((s) => p95(s));
  const completed = error === undefined;
  const line: BenchLine = {
    check: 'bench-moves',
    scenario: options.scenario,
    baseUrl: options.baseUrl,
    startedAt,
    n: timings.length,
    minMs: stat((s) => s[0]),
    p50Ms: stat((s) => percentile(s, 50)),
    p95Ms,
    maxMs: stat((s) => s[s.length - 1]),
    baselineMedianMs: baseline,
    limitMs: options.limitMs,
    passed: completed && (options.scenario === 'cold' || p95Ms < options.limitMs),
  };
  return error === undefined ? { line } : { line, error };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export interface CliIo {
  stdout(line: string): void;
  stderr(line: string): void;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  io: CliIo;
  fetch: FetchFn;
  now: () => number;
  /** Builds the store from the token; `main` passes `VercelBlobObjectStore`. */
  makeStore: (token: string) => ObjectStore;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Parses arguments and env, runs the benchmark, prints, and returns the exit code (0, 1 or 2). */
export async function runCli(args: readonly string[], deps: CliDeps): Promise<number> {
  const { env, io } = deps;
  let options: BenchOptions;
  let store: ObjectStore | undefined;
  let token: string | undefined;
  try {
    const parsed = parseStrict(args, {
      'base-url': { type: 'string' },
      scenario: { type: 'string', choices: SCENARIOS },
      samples: { type: 'integer', min: 1, max: 1000 },
      'p95-limit-ms': { type: 'integer', min: 1, max: 600_000, default: DEFAULT_P95_LIMIT_MS },
    });
    const baseUrl = parsed['base-url'];
    const scenario = parsed.scenario as Scenario | undefined;
    if (baseUrl === undefined) throw new UsageError('--base-url is required');
    if (scenario === undefined) throw new UsageError('--scenario is required');
    let url: URL | undefined;
    try {
      url = new URL(baseUrl);
    } catch {
      url = undefined;
    }
    if (url === undefined || url.protocol !== 'https:') {
      throw new UsageError('--base-url must be an https URL');
    }
    if (scenario === 'cold' && parsed.samples !== undefined) {
      throw new UsageError('--samples is not allowed with --scenario cold');
    }
    if (scenario === 'stale') {
      const raw = env.BLOB_READ_WRITE_TOKEN;
      if (raw === undefined || raw === '') {
        throw new UsageError('BLOB_READ_WRITE_TOKEN is not set (required for --scenario stale)');
      }
      token = raw;
      store = deps.makeStore(raw);
    }
    options = {
      baseUrl,
      scenario,
      samples: scenario === 'cold' ? 1 : (parsed.samples ?? DEFAULT_SAMPLES),
      limitMs: parsed['p95-limit-ms'],
    };
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`bench-moves: ${error.message}`);
      return 2;
    }
    throw error;
  }

  const bypass = env.VERCEL_PROTECTION_BYPASS;
  const outcome = await runBench(
    {
      fetch: deps.fetch,
      now: deps.now,
      ...(store !== undefined ? { store } : {}),
      ...(bypass !== undefined && bypass !== '' ? { bypass } : {}),
      redact: [token, bypass].filter((s): s is string => s !== undefined && s !== ''),
      ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    },
    options,
  );
  if (outcome.error !== undefined) {
    io.stderr(`bench-moves: run aborted: ${outcome.error.name}: ${outcome.error.message}`);
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
    makeStore: (token) => new VercelBlobObjectStore({ token }),
    signal: controller.signal,
  });
}

// Run only when executed as a script, so tests can import `runBench` and `runCli`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
