// Fixture for worker-bootstrap.test.ts: run from a `tsx` process, starts the real worker entry
// through `startWorker`, asks for a selftest game and prints the totals as JSON.
import { fileURLToPath } from 'node:url';
import { startWorker } from '../../../../scripts/datagen/worker-host';

const seed = process.argv[2] ?? 'selftest';
const worker = startWorker(
  fileURLToPath(new URL('../../../../scripts/datagen/worker.ts', import.meta.url)),
);

worker.on('message', (message: { kind: string; totals: number[] }) => {
  if (message.kind === 'selftest-result') {
    process.stdout.write(`${JSON.stringify(message.totals)}\n`);
    void worker.terminate();
  }
});
worker.on('error', (error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
worker.postMessage({ kind: 'selftest', seed });
