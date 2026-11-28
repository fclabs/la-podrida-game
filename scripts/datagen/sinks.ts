// Gzip JSONL file writer (spec 12 FR-1214, Format choices): rows are appended as games finish,
// written to `<final name>.tmp` and renamed to the final name by `finish()`.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

export interface SinkResult {
  /** The final path, as given to `createJsonlGzipSink`. */
  path: string;
  /** Size of the stored (compressed) file. */
  bytes: number;
  /** SHA-256 (hex) of the stored bytes. */
  sha256: string;
  /** Number of rows (lines) written. */
  rows: number;
}

export interface JsonlGzipSink {
  /** Appends rows, one JSON object per line, keys in the object's own (schema) order. */
  append(rows: readonly unknown[]): Promise<void>;
  /** Closes the stream, renames `<path>.tmp` to `<path>` and returns the file's description. */
  finish(): Promise<SinkResult>;
  /** Closes the stream and leaves `<path>.tmp` in place (cleanup belongs to the caller). */
  abort(): Promise<void>;
}

export function createJsonlGzipSink(finalPath: string): JsonlGzipSink {
  const tmpPath = `${finalPath}.tmp`;
  const gzip = createGzip();
  const done = pipeline(gzip, createWriteStream(tmpPath));
  done.catch(() => undefined); // observed through `done` itself; avoids an unhandled rejection
  let rows = 0;
  let closed = false;

  return {
    async append(batch) {
      if (closed) throw new Error('sink is closed');
      if (batch.length === 0) return;
      let text = '';
      for (const row of batch) text += `${JSON.stringify(row)}\n`;
      rows += batch.length;
      if (!gzip.write(text, 'utf8')) await Promise.race([once(gzip, 'drain'), done]);
    },

    async finish() {
      if (closed) throw new Error('sink is closed');
      closed = true;
      gzip.end();
      await done;
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(tmpPath)) hash.update(chunk as Buffer);
      const { size } = await stat(tmpPath);
      await rename(tmpPath, finalPath);
      return { path: finalPath, bytes: size, sha256: hash.digest('hex'), rows };
    },

    async abort() {
      if (closed) return;
      closed = true;
      gzip.destroy();
      await done.catch(() => undefined);
    },
  };
}
