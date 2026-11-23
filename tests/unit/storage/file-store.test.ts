// FileObjectStore (spec 05 FR-512; VC-513; plan P-5, P-11: VC-508 1,001-key paging on file).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileObjectStore } from '@/src/storage/file-store';
import { MAX_LIST_LIMIT, ObjectExistsError } from '@/src/storage/object-store';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'lp-store-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/** Every file and folder name under `dir`, recursively (relative paths with `/`). */
async function allEntries(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true });
  return entries.map((e) => e.split(path.sep).join('/')).sort();
}

async function tempFiles(dir: string): Promise<string[]> {
  return (await allEntries(dir)).filter((e) => path.posix.basename(e).startsWith('.tmp-'));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

describe('VC-513 on-disk layout', () => {
  it('creates nothing until the first put', async () => {
    const root = path.join(tmp, 'root');
    const store = new FileObjectStore(root);
    expect(await store.get('a')).toBeNull();
    expect(await store.exists('a')).toBe(false);
    expect(await store.list('')).toEqual({ keys: [] });
    await store.delete(['a', 'b/c']);
    expect(await pathExists(root)).toBe(false);
  });

  it("put('a/b/c', 'x') creates <root>/a/b/c containing x", async () => {
    const root = path.join(tmp, 'root');
    const store = new FileObjectStore(root);
    await store.put('a/b/c', 'x');
    expect(await fs.readFile(path.join(root, 'a', 'b', 'c'), 'utf8')).toBe('x');
    expect(await allEntries(root)).toEqual(['a', 'a/b', 'a/b/c']);
  });

  it('resolves a relative rootDir against the current working directory', async () => {
    const store = new FileObjectStore(path.relative(process.cwd(), tmp));
    await store.put('rel', 'y');
    expect(await fs.readFile(path.join(tmp, 'rel'), 'utf8')).toBe('y');
  });

  it('a store on a missing root lists no keys', async () => {
    const store = new FileObjectStore(path.join(tmp, 'does', 'not', 'exist'));
    expect(await store.list('')).toEqual({ keys: [] });
    expect(await store.list('a/', { limit: 1 })).toEqual({ keys: [] });
  });
});

describe('VC-513 temp files never remain', () => {
  it('after the VC-504 race', async () => {
    const store = new FileObjectStore(tmp);
    const bodies = Array.from({ length: 10 }, (_, i) => `body-${i}`);
    const results = await Promise.allSettled(bodies.map((b) => store.put('g/race', b)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 'rejected' && r.reason instanceof ObjectExistsError),
    ).toHaveLength(9);
    expect(await tempFiles(tmp)).toEqual([]);
    expect(await allEntries(tmp)).toEqual(['g', 'g/race']);
  });

  it('after a sequence of successful, conflicting and overwriting puts', async () => {
    const store = new FileObjectStore(tmp);
    await store.put('a/1', 'one');
    await expect(store.put('a/1', 'again')).rejects.toBeInstanceOf(ObjectExistsError);
    await store.put('a/1', 'two', { mode: 'overwrite' });
    await store.put('a/2', 'three', { mode: 'overwrite' });
    await store.put('b', new Uint8Array([1, 2, 3]));
    await expect(store.put('b', '')).rejects.toBeInstanceOf(ObjectExistsError);
    await Promise.allSettled([
      store.put('c/x', 'p', { mode: 'overwrite' }),
      store.put('c/x', 'q', { mode: 'overwrite' }),
      store.put('c/x', 'r'),
    ]);
    expect(await tempFiles(tmp)).toEqual([]);
    expect(await store.list('')).toEqual({ keys: ['a/1', 'a/2', 'b', 'c/x'] });
  });
});

describe('VC-513 hidden names and folders', () => {
  it('a hand-made <root>/a/.tmp-zzz is not listed and the folder a is not an object', async () => {
    const store = new FileObjectStore(tmp);
    await store.put('a/real', 'r');
    await fs.writeFile(path.join(tmp, 'a', '.tmp-zzz'), 'partial');
    expect(await store.list('')).toEqual({ keys: ['a/real'] });
    expect(await store.list('a/')).toEqual({ keys: ['a/real'] });
    expect(await store.get('a')).toBeNull();
    expect(await store.exists('a')).toBe(false);
  });

  it('hidden folders and their contents are never listed', async () => {
    const store = new FileObjectStore(tmp);
    await store.put('k', 'v');
    await fs.mkdir(path.join(tmp, '.hidden', 'sub'), { recursive: true });
    await fs.writeFile(path.join(tmp, '.hidden', 'sub', 'file'), 'x');
    await fs.writeFile(path.join(tmp, '.dotfile'), 'x');
    await fs.mkdir(path.join(tmp, 'empty', 'nested'), { recursive: true });
    expect(await store.list('')).toEqual({ keys: ['k'] });
  });

  it('a key below an existing file counts as missing', async () => {
    const store = new FileObjectStore(tmp);
    await store.put('f', 'file');
    expect(await store.get('f/x')).toBeNull();
    expect(await store.exists('f/x')).toBe(false);
    await store.delete(['f/x']);
    expect(await store.exists('f')).toBe(true);
  });

  it('deleting the only key in a/b/ removes it from the listing', async () => {
    const store = new FileObjectStore(tmp);
    await store.put('a/b/only', 'x');
    await store.put('z', 'y');
    await store.delete(['a/b/only']);
    expect(await store.list('')).toEqual({ keys: ['z'] });
    expect(await store.get('a/b/only')).toBeNull();
  });

  it('lists across folders in code-unit order with prefixes inside segments', async () => {
    const store = new FileObjectStore(tmp);
    for (const key of ['b/2', 'a/1', 'a/10', 'a/2', 'ab', 'c', 'a-z/q']) {
      await store.put(key, '');
    }
    expect((await store.list('')).keys).toEqual(['a-z/q', 'a/1', 'a/10', 'a/2', 'ab', 'b/2', 'c']);
    expect((await store.list('a/1')).keys).toEqual(['a/1', 'a/10']);
    expect((await store.list('a')).keys).toEqual(['a-z/q', 'a/1', 'a/10', 'a/2', 'ab']);
  });
});

describe('P-11 default limit with 1,001 keys', () => {
  it('pages of 1000 and 1 cover every key once, in order', async () => {
    const store = new FileObjectStore(tmp);
    const keys = Array.from({ length: 1001 }, (_, i) => `k/${String(i).padStart(4, '0')}`);
    // Files are written directly: each put fsyncs twice, which makes 1,001 puts take ~14 s on
    // macOS. Listing reads whatever is on disk, so this exercises the same paging path.
    await store.put(keys[0], '');
    await Promise.all(keys.slice(1).map((key) => fs.writeFile(path.join(tmp, key), '')));
    const first = await store.list('k/');
    expect(first.keys).toHaveLength(MAX_LIST_LIMIT);
    expect(first.cursor).toBe(keys[999]);
    const second = await store.list('k/', { cursor: first.cursor });
    expect(second).toEqual({ keys: [keys[1000]] });
    expect([...first.keys, ...second.keys]).toEqual(keys);
  });
});
