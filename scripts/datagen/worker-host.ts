// Starts a generator worker (spec A-2): a `worker_threads` worker that loads TypeScript through
// `tsx`, so the worker entry and its `@/` imports resolve like they do in the CLI process.
// Also holds the message protocol between the main thread and the worker entry (worker.ts).
import { Worker } from 'node:worker_threads';
import type { ShardParams, ShardResult } from './shard';

export function startWorker(entryFile: string | URL, workerData?: unknown): Worker {
  return new Worker(entryFile, { execArgv: ['--import', 'tsx'], workerData });
}

/** main -> worker: process one shard. A worker handles one such message at a time. */
export interface ShardRequest {
  kind: 'shard';
  params: ShardParams;
  shard: number;
  runDir: string;
  git_commit: string;
  git_dirty: boolean;
}

/** worker -> main: the shard finished (complete entry, or the first failing game). */
export interface ShardResponse {
  kind: 'shard-result';
  shard: number;
  result: ShardResult;
}

/** worker -> main: processing the shard threw something that is not a game failure. */
export interface ShardErrorResponse {
  kind: 'shard-error';
  shard: number;
  message: string;
}
