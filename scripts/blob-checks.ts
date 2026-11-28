// Blob store checks (`pnpm blob-checks`, spec 11 FR-1107..FR-1111). Measures, against a real store,
// the three claims the architecture depends on: create-only exclusivity under concurrency,
// read-your-writes, and ascending listings; then deletes everything it wrote.
//
//   BLOB_READ_WRITE_TOKEN=... pnpm blob-checks [--rounds <1-1000>] [--writers <1-1000>]
//
// One JSON line on stdout. Exit 0 = passed, 1 = a check failed or a runtime error, 2 = usage error.
// Writes only under `checks/<runId>/`. The token never appears in any output.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ObjectExistsError, type ObjectStore } from '@/src/storage/object-store';
import { VercelBlobObjectStore } from '@/src/storage/vercel-blob-store';
import { UsageError, parseStrict } from './lib/args';

export const DEFAULT_ROUNDS = 100;
export const DEFAULT_WRITERS = 10;
export const LIST_KEY_COUNT = 25;
export const LIST_PAGE_SIZE = 10;
export const CLEANUP_ROUNDS = 20;
const MAX_LIST_PAGES = 100;
const MAX_ERROR_MESSAGE = 200;

export interface BlobChecksOptions {
  rounds: number;
  writers: number;
  runId: string;
  /** Aborting stops the run between steps; cleanup still runs. */
  signal?: AbortSignal;
  /** Strings (the token) replaced by `[redacted]` in any error message. */
  redact?: readonly string[];
  /** Monotonic clock in ms (default `performance.now`). */
  now?: () => number;
}

export interface BlobChecksResult {
  check: 'blob-checks';
  runId: string;
  startedAt: string;
  rounds: number;
  writers: number;
  exclusivity: { violations: number; zeroWinnerRounds: number; passed: boolean };
  consistency: {
    createThenGet: { n: number; falseMissing: number };
    overwriteThenGet: { n: number; stale: number };
    passed: boolean;
  };
  listing: { keys: number; pageSize: number; ordered: boolean; passed: boolean };
  delete: { remaining: number; passed: boolean };
  passed: boolean;
  durationMs: number;
  error?: { name: string; message: string };
}

const decoder = new TextDecoder();

function sanitize(error: unknown, redact: readonly string[]): { name: string; message: string } {
  const name = error instanceof Error ? error.name : 'Error';
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of redact) {
    if (secret !== '') message = message.split(secret).join('[redacted]');
  }
  message = message.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_MESSAGE);
  return { name, message };
}

class InterruptedError extends Error {
  constructor() {
    super('interrupted by signal');
    this.name = 'InterruptedError';
  }
}

/** Lists `prefix` and deletes what it finds, repeating up to 20 rounds. True when a listing came back empty. */
async function cleanup(store: ObjectStore, prefix: string): Promise<boolean> {
  for (let round = 0; round < CLEANUP_ROUNDS; round += 1) {
    const { keys } = await store.list(prefix);
    if (keys.length === 0) return true;
    await store.delete(keys);
  }
  return false;
}

/**
 * Runs every check against `store` and returns the result (never throws, never prints). An
 * unexpected error ends the run with `passed: false` and an `error` field; sections not reached
 * keep their zero counts. Everything written lives under `checks/<runId>/` and is deleted at the end.
 */
export async function runBlobChecks(
  store: ObjectStore,
  options: BlobChecksOptions,
): Promise<BlobChecksResult> {
  const { rounds, writers, runId, signal } = options;
  const redact = options.redact ?? [];
  const now = options.now ?? (() => performance.now());
  const prefix = `checks/${runId}/`;
  const startedAt = new Date().toISOString();
  const started = now();

  const result: BlobChecksResult = {
    check: 'blob-checks',
    runId,
    startedAt,
    rounds,
    writers,
    exclusivity: { violations: 0, zeroWinnerRounds: 0, passed: false },
    consistency: {
      createThenGet: { n: 0, falseMissing: 0 },
      overwriteThenGet: { n: 0, stale: 0 },
      passed: false,
    },
    listing: { keys: 0, pageSize: LIST_PAGE_SIZE, ordered: false, passed: false },
    delete: { remaining: 0, passed: false },
    passed: false,
    durationMs: 0,
  };

  const checkSignal = (): void => {
    if (signal?.aborted) throw new InterruptedError();
  };

  let runError: { name: string; message: string } | undefined;
  try {
    // FR-1107 exclusivity.
    for (let round = 0; round < rounds; round += 1) {
      checkSignal();
      const key = `${prefix}excl/${round}`;
      const bodies = Array.from(
        { length: writers },
        (_, w) => `writer-${w}-round-${round}-${runId}`,
      );
      const settled = await Promise.allSettled(
        bodies.map((body) => store.put(key, body, { mode: 'create-only' })),
      );
      const winners: number[] = [];
      let unexpected: unknown;
      settled.forEach((outcome, w) => {
        if (outcome.status === 'fulfilled') winners.push(w);
        else if (!(outcome.reason instanceof ObjectExistsError) && unexpected === undefined) {
          unexpected = outcome.reason;
        }
      });
      if (unexpected !== undefined) throw unexpected;
      if (winners.length === 0) {
        result.exclusivity.zeroWinnerRounds += 1;
        continue;
      }
      const stored = await store.get(key);
      const storedWriter = stored === null ? -1 : bodies.indexOf(decoder.decode(stored.body));
      if (winners.length > 1 || storedWriter === -1 || winners[0] !== storedWriter) {
        result.exclusivity.violations += 1;
      }
    }
    result.exclusivity.passed = result.exclusivity.violations === 0;

    // FR-1108 consistent reads.
    for (let round = 0; round < rounds; round += 1) {
      checkSignal();
      const key = `${prefix}create/${round}`;
      const body = `created-${round}-${runId}`;
      await store.put(key, body, { mode: 'create-only' });
      const read = await store.get(key);
      result.consistency.createThenGet.n += 1;
      if (read === null) result.consistency.createThenGet.falseMissing += 1;
    }
    for (let round = 0; round < rounds; round += 1) {
      checkSignal();
      const key = `${prefix}overwrite/${round}`;
      const next = `new-${round}-${runId}`;
      await store.put(key, `old-${round}-${runId}`, { mode: 'create-only' });
      await store.put(key, next, { mode: 'overwrite' });
      const read = await store.get(key);
      result.consistency.overwriteThenGet.n += 1;
      if (read === null || decoder.decode(read.body) !== next) {
        result.consistency.overwriteThenGet.stale += 1;
      }
    }
    result.consistency.passed =
      result.consistency.createThenGet.falseMissing === 0 &&
      result.consistency.overwriteThenGet.stale === 0;

    // FR-1109 listing and delete.
    checkSignal();
    const listPrefix = `${prefix}list/`;
    const created = Array.from(
      { length: LIST_KEY_COUNT },
      (_, i) => `${listPrefix}${String(i).padStart(3, '0')}`,
    );
    for (const key of created) await store.put(key, 'x', { mode: 'create-only' });
    const listed: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const res = await store.list(listPrefix, {
        limit: LIST_PAGE_SIZE,
        ...(cursor !== undefined ? { cursor } : {}),
      });
      listed.push(...res.keys);
      cursor = res.cursor;
      if (cursor === undefined) break;
    }
    result.listing.keys = listed.length;
    result.listing.ordered = listed.every((key, i) => i === 0 || listed[i - 1] < key);
    result.listing.passed = result.listing.ordered && result.listing.keys === LIST_KEY_COUNT;

    checkSignal();
    await store.delete(created);
    for (const key of created) {
      if (await store.exists(key)) result.delete.remaining += 1;
    }
    result.delete.passed = result.delete.remaining === 0;
  } catch (error) {
    runError = sanitize(error, redact);
  } finally {
    // FR-1111: always sweep the run's prefix, even after an error or an abort.
    try {
      const clean = await cleanup(store, prefix);
      if (!clean && runError === undefined) {
        runError = {
          name: 'CleanupError',
          message: `keys may remain under ${prefix} after ${CLEANUP_ROUNDS} cleanup rounds`,
        };
      }
    } catch (error) {
      const detail = sanitize(error, redact);
      if (runError === undefined) {
        runError = {
          name: 'CleanupError',
          message: `cleanup of ${prefix} failed (${detail.name}); keys may remain`.slice(
            0,
            MAX_ERROR_MESSAGE,
          ),
        };
      }
    }
  }

  result.passed =
    runError === undefined &&
    result.exclusivity.passed &&
    result.consistency.passed &&
    result.listing.passed &&
    result.delete.passed;
  result.durationMs = Math.round(now() - started);
  if (runError !== undefined) result.error = runError;
  return result;
}

export interface CliIo {
  stdout(line: string): void;
  stderr(line: string): void;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  io: CliIo;
  /** Builds the store from the token; `main` passes `VercelBlobObjectStore`. */
  makeStore: (token: string) => ObjectStore;
  signal?: AbortSignal;
  runId?: string;
}

/** Parses arguments and env, runs the checks, prints, and returns the exit code (0, 1 or 2). */
export async function runCli(args: readonly string[], deps: CliDeps): Promise<number> {
  const { env, io } = deps;
  let rounds: number;
  let writers: number;
  let token: string;
  try {
    const parsed = parseStrict(args, {
      rounds: { type: 'integer', min: 1, max: 1000, default: DEFAULT_ROUNDS },
      writers: { type: 'integer', min: 1, max: 1000, default: DEFAULT_WRITERS },
    });
    rounds = parsed.rounds;
    writers = parsed.writers;
    const raw = env.BLOB_READ_WRITE_TOKEN;
    if (raw === undefined || raw === '') {
      throw new UsageError('BLOB_READ_WRITE_TOKEN is not set');
    }
    token = raw;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr(`blob-checks: ${error.message}`);
      return 2;
    }
    throw error;
  }

  const runId = deps.runId ?? randomUUID();
  io.stderr(`blob-checks run ${runId}`);
  const result = await runBlobChecks(deps.makeStore(token), {
    rounds,
    writers,
    runId,
    redact: [token],
    ...(deps.signal !== undefined ? { signal: deps.signal } : {}),
  });
  io.stdout(JSON.stringify(result));
  return result.passed ? 0 : 1;
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
    makeStore: (token) => new VercelBlobObjectStore({ token }),
    signal: controller.signal,
  });
}

// Run only when executed as a script, so tests can import `runBlobChecks` and `runCli`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
