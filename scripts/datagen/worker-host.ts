// Starts a generator worker (spec A-2): a `worker_threads` worker that loads TypeScript through
// `tsx`, so the worker entry and its `@/` imports resolve like they do in the CLI process.
import { Worker } from 'node:worker_threads';

export function startWorker(entryFile: string | URL, workerData?: unknown): Worker {
  return new Worker(entryFile, { execArgv: ['--import', 'tsx'], workerData });
}
