import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  assertValidKey,
  checkListArgs,
  ObjectExistsError,
  pageKeys,
  type ListOptions,
  type ListResult,
  type ObjectStore,
  type PutOptions,
  type StoredObject,
} from './object-store';

/** Error codes that mean "no object at this key" for reads, probes and deletes. */
const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);

function errorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

function isMissing(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && MISSING_CODES.has(code);
}

async function unlinkIfPresent(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch (err) {
    if (!isMissing(err)) throw err;
  }
}

/**
 * Flushes a folder's entries (the new name made by `link`/`rename`) to disk. Some filesystems do
 * not support `fsync` on a folder; any error here is ignored, since the object is already
 * published and readable.
 */
async function syncFolder(dir: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dir, 'r');
    await handle.sync();
  } catch {
    // Best effort only.
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Filesystem object store (FR-512): key `a/b/c` is the file `<rootDir>/a/b/c`. Every put writes
 * a hidden temp file `.tmp-<uuid>` in the target's folder, fsyncs and closes it, then publishes it
 * atomically: `link` for create-only (fails with `EEXIST` when the key exists), `rename` for
 * overwrite. Readers therefore see no object, the previous body or the complete new body. Names
 * starting with `.` are never keys, so temp files never appear in `list`.
 */
export class FileObjectStore implements ObjectStore {
  readonly #root: string;

  constructor(rootDir: string) {
    this.#root = path.resolve(rootDir);
  }

  #pathOf(key: string): string {
    return path.join(this.#root, ...key.split('/'));
  }

  async get(key: string): Promise<StoredObject | null> {
    assertValidKey(key);
    try {
      const data = await fs.readFile(this.#pathOf(key));
      return { body: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
    } catch (err) {
      if (isMissing(err) || errorCode(err) === 'EISDIR') return null;
      throw err;
    }
  }

  async put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    assertValidKey(key);
    const target = this.#pathOf(key);
    const dir = path.dirname(target);
    await fs.mkdir(dir, { recursive: true });
    const temp = path.join(dir, `.tmp-${randomUUID()}`);
    try {
      const handle = await fs.open(temp, 'wx');
      try {
        await handle.writeFile(body);
        await handle.sync();
      } finally {
        await handle.close();
      }
      if ((opts?.mode ?? 'create-only') === 'create-only') {
        try {
          await fs.link(temp, target);
        } catch (err) {
          if (errorCode(err) === 'EEXIST') throw new ObjectExistsError(key);
          throw err;
        }
      } else {
        await fs.rename(temp, target);
      }
    } finally {
      await unlinkIfPresent(temp);
    }
    await syncFolder(dir);
  }

  async exists(key: string): Promise<boolean> {
    assertValidKey(key);
    try {
      return (await fs.stat(this.#pathOf(key))).isFile();
    } catch (err) {
      if (isMissing(err)) return false;
      throw err;
    }
  }

  async list(prefix: string, opts?: ListOptions): Promise<ListResult> {
    const args = checkListArgs(prefix, opts);
    const keys: string[] = [];
    await this.#walk(this.#root, '', prefix, keys);
    return pageKeys(keys, prefix, args);
  }

  /** Collects every file key under `dir` (relative path `rel`), skipping names that start with `.`. */
  async #walk(dir: string, rel: string, prefix: string, out: string[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (isMissing(err)) return; // a missing root lists nothing
      throw err;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const key = rel + entry.name;
      if (entry.isFile()) {
        out.push(key);
      } else if (entry.isDirectory()) {
        const sub = key + '/';
        // Only descend into folders whose keys could match the prefix.
        if (sub.startsWith(prefix) || prefix.startsWith(sub)) {
          await this.#walk(path.join(dir, entry.name), sub, prefix, out);
        }
      }
    }
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) assertValidKey(key);
    for (const key of keys) await unlinkIfPresent(this.#pathOf(key));
  }
}
