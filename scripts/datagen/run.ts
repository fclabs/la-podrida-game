// The `run` command (spec 12 FR-1201, FR-1214..FR-1216): creates the run directory and the
// initial manifest, processes the shards with a pool of workers and prints the run summary.
// Only this (main) thread writes the manifest (BR-1206).
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Worker } from 'node:worker_threads';
import type { RunOptions } from './args';
import { newManifest, writeManifestAtomic } from './manifest';
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
 * Plays every shard of the run with at most `options.workers` workers. Each worker handles one
 * shard at a time and is reused: when it answers, the main thread updates the manifest and hands
 * it the next unprocessed shard (a shared queue, in shard order).
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

  const slot = (worker: Worker): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const next = (): void => {
        const shard = queue.shift();
        if (shard === undefined) return resolve();
        const request: ShardRequest = {
          kind: 'shard',
          params: { ...options },
          shard,
          runDir,
          git_commit: deps.gitInfo.git_commit,
          git_dirty: deps.gitInfo.git_dirty,
        };
        worker.postMessage(request);
      };
      worker.on('message', (message: ShardResponse | ShardErrorResponse) => {
        if (message.kind === 'shard-result') {
          const planned = manifest.shards[message.shard];
          const { result } = message;
          const entry: ShardEntry =
            result.status === 'complete'
              ? result
              : {
                  shard: planned.shard,
                  games: planned.games,
                  status: 'failed',
                  error: { seed: result.seed, message: result.message },
                };
          record(entry).then(next, reject);
        } else if (message.kind === 'shard-error') {
          reject(new Error(`shard ${message.shard}: ${message.message}`));
        }
      });
      worker.on('error', reject);
      worker.on('exit', (code) => reject(new Error(`worker exited unexpectedly (code ${code})`)));
      next();
    });

  const workers = Array.from({ length: Math.min(options.workers, queue.length) }, () =>
    startWorker(WORKER_ENTRY),
  );
  try {
    await Promise.all(workers.map(slot));
    await writing;
  } finally {
    await Promise.all(workers.map((w) => w.terminate()));
  }

  const seconds = (performance.now() - started) / 1000;
  (deps.write ?? ((text) => void process.stdout.write(text)))(formatSummary(manifest, 0, seconds));
  const allComplete = manifest.shards.every((s) => s.status === 'complete');
  return { manifest, exitCode: allComplete ? 0 : 1 };
}
