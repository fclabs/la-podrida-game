// The `run` command (spec 12 FR-1201, FR-1214..FR-1216): creates the run directory and the
// initial manifest, processes the shards with a pool of workers and prints the run summary.
// Only this (main) thread writes the manifest (BR-1206).
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Worker } from 'node:worker_threads';
import type { RunOptions } from './args';
import { newManifest, shardFilePaths, writeManifestAtomic } from './manifest';
import type { CompleteShardEntry, Manifest, ShardEntry } from './schema';
import { startWorker } from './worker-host';
import type { ShardErrorResponse, ShardRequest, ShardResponse } from './worker-host';

export interface GitInfo {
  git_commit: string;
  git_dirty: boolean;
}

export interface RunDeps {
  /** ISO-8601 UTC clock (`created_at`). */
  now: () => string;
  /** Computed once by the caller and passed to every worker. */
  gitInfo: GitInfo;
  /** Where the summary goes (default: process stdout). */
  write?: (text: string) => void;
}

export interface RunOutcome {
  manifest: Manifest;
  /** 0 when every shard is complete, 1 otherwise. */
  exitCode: number;
}

/** One decimal, never `-0.0` (same as `pnpm simulate`). */
export function oneDecimal(value: number): string {
  const text = value.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
}

/**
 * The four summary lines of FR-1201 (trailing newline included). `rows` and `size` cover the
 * `complete` shards of the manifest; `skipped` is the number of shards left untouched.
 */
export function formatSummary(
  manifest: Manifest,
  skipped: number,
  durationSeconds: number,
): string {
  const complete = manifest.shards.filter((s): s is CompleteShardEntry => s.status === 'complete');
  const failed = manifest.shards.filter((s) => s.status === 'failed').length;
  let games = 0;
  let hands = 0;
  let decisions = 0;
  let bytes = 0;
  for (const shard of complete) {
    games += shard.files.games.rows;
    hands += shard.files.hands.rows;
    decisions += shard.files.decisions.rows;
    bytes += shard.files.games.bytes + shard.files.hands.bytes + shard.files.decisions.bytes;
  }
  const { params } = manifest;
  return (
    [
      `run: ${manifest.run_id}  preset: ${params.preset}  players: ${params.players}  games: ${params.games}  shards: ${manifest.shards.length}`,
      `shards: ${complete.length} complete (${skipped} skipped, ${failed} failed)`,
      `rows: games ${games}  hands ${hands}  decisions ${decisions}`,
      `size: ${oneDecimal(bytes / 1_000_000)} MB  duration: ${oneDecimal(durationSeconds)} s`,
    ].join('\n') + '\n'
  );
}

const WORKER_ENTRY = fileURLToPath(new URL('./worker.ts', import.meta.url));

/**
 * Deletes every file of `shard` that exists, final or `.tmp` (FR-1217). Call it only once the
 * shard's worker has stopped. A missing file is fine; any other failure is collected. Returns
 * `null` when everything is gone, else the reasons joined with `, `.
 */
export async function cleanupShardFiles(runDir: string, shard: number): Promise<string | null> {
  const problems: string[] = [];
  for (const file of Object.values(shardFilePaths(runDir, shard))) {
    for (const target of [file, `${file}.tmp`]) {
      try {
        await rm(target, { force: true });
      } catch (error) {
        problems.push(error instanceof Error ? error.message : String(error));
      }
    }
  }
  return problems.length === 0 ? null : problems.join(', ');
}

/** What became of one shard sent to one worker. */
type Exchange =
  { complete: CompleteShardEntry } | { failure: { seed: string | null; message: string } };

/**
 * Sends `request` to `worker` and waits for its answer, a `shard-error`, an uncaught worker
 * error, or the worker exiting (a worker that dies has `seed: null`).
 */
function exchange(worker: Worker, request: ShardRequest): Promise<Exchange> {
  return new Promise<Exchange>((resolve) => {
    const finish = (outcome: Exchange): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      resolve(outcome);
    };
    const onMessage = (message: ShardResponse | ShardErrorResponse): void => {
      if (message.kind === 'shard-result') {
        const { result } = message;
        finish(
          result.status === 'complete'
            ? { complete: result }
            : { failure: { seed: result.seed, message: result.message } },
        );
      } else if (message.kind === 'shard-error') {
        finish({ failure: { seed: null, message: message.message } });
      }
    };
    const onError = (error: unknown): void =>
      finish({
        failure: { seed: null, message: error instanceof Error ? error.message : String(error) },
      });
    const onExit = (code: number): void =>
      finish({ failure: { seed: null, message: `worker exited unexpectedly (code ${code})` } });
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    worker.postMessage(request);
  });
}

/**
 * Plays every shard of the run with at most `options.workers` workers. Each worker handles one
 * shard at a time and is reused: when it answers, the main thread updates the manifest and hands
 * it the next unprocessed shard (a shared queue, in shard order). A failing shard (a game
 * failure, a worker error or a dead worker) is cleaned up once its worker has stopped, recorded
 * as `failed`, and the worker is replaced; the other shards continue.
 */
export async function executeRun(options: RunOptions, deps: RunDeps): Promise<RunOutcome> {
  const started = performance.now();
  const runDir = path.resolve(options.out, options.run_id);
  await mkdir(runDir, { recursive: true });

  const manifest = newManifest({
    run_id: options.run_id,
    params: {
      preset: options.preset,
      players: options.players,
      games: options.games,
      shard_size: options.shard_size,
      strategies: options.strategies,
      replay_every: options.replay_every,
    },
    created_at: deps.now(),
  });
  await writeManifestAtomic(runDir, manifest);

  const queue = manifest.shards.map((s) => s.shard);
  let writing: Promise<void> = Promise.resolve();
  // Manifest rewrites are serialised so two shards finishing together never interleave.
  const record = (entry: ShardEntry): Promise<void> => {
    manifest.shards[entry.shard] = entry;
    writing = writing.then(() => writeManifestAtomic(runDir, manifest));
    return writing;
  };

  const live = new Set<Worker>();
  const spawn = (): Worker => {
    const worker = startWorker(WORKER_ENTRY);
    worker.on('error', () => undefined); // reported through `exchange` while a shard is out
    live.add(worker);
    return worker;
  };

  const slot = async (): Promise<void> => {
    let worker: Worker | null = null;
    for (let shard = queue.shift(); shard !== undefined; shard = queue.shift()) {
      worker ??= spawn();
      const outcome = await exchange(worker, {
        kind: 'shard',
        params: { ...options },
        shard,
        runDir,
        git_commit: deps.gitInfo.git_commit,
        git_dirty: deps.gitInfo.git_dirty,
      });
      if ('complete' in outcome) {
        await record(outcome.complete);
        continue;
      }
      // The worker must have exited before its files are deleted (I-6); then replace it.
      await worker.terminate();
      live.delete(worker);
      worker = null;
      const cleanup = await cleanupShardFiles(runDir, shard);
      const { seed, message } = outcome.failure;
      await record({
        shard,
        games: manifest.shards[shard].games,
        status: 'failed',
        error: {
          seed,
          message: cleanup === null ? message : `${message}; cleanup failed: ${cleanup}`,
        },
      });
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(options.workers, queue.length) }, slot));
    await writing;
  } finally {
    await Promise.all([...live].map((w) => w.terminate()));
  }

  const seconds = (performance.now() - started) / 1000;
  (deps.write ?? ((text) => void process.stdout.write(text)))(formatSummary(manifest, 0, seconds));
  const allComplete = manifest.shards.every((s) => s.status === 'complete');
  return { manifest, exitCode: allComplete ? 0 : 1 };
}
