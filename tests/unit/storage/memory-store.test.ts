// MemoryObjectStore (spec 05 FR-507, FR-511; VC-508 1,001-key paging, VC-512; plan P-2, P-3).
import { describe, expect, it } from 'vitest';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { InvalidKeyError, MAX_LIST_LIMIT } from '@/src/storage/object-store';

describe('VC-512 bodies are copied', () => {
  it('mutating the array passed to put or returned by get never changes the stored body', async () => {
    const store = new MemoryObjectStore();
    const body = new Uint8Array([1, 2, 3]);
    await store.put('k', body);
    body[0] = 99;
    const first = (await store.get('k'))!.body;
    expect(Array.from(first)).toEqual([1, 2, 3]);
    first[1] = 99;
    expect(Array.from((await store.get('k'))!.body)).toEqual([1, 2, 3]);
  });

  it('copies a subarray view without its surrounding buffer', async () => {
    const store = new MemoryObjectStore();
    const backing = new Uint8Array([9, 1, 2, 9]);
    await store.put('k', backing.subarray(1, 3));
    const stored = (await store.get('k'))!.body;
    expect(Array.from(stored)).toEqual([1, 2]);
    expect(stored.buffer.byteLength).toBe(2);
  });

  it('two instances do not share keys', async () => {
    const a = new MemoryObjectStore();
    const b = new MemoryObjectStore();
    await a.put('k', 'x');
    expect(await b.exists('k')).toBe(false);
    expect(await b.list('')).toEqual({ keys: [] });
  });
});

describe('VC-508 default limit with 1,001 keys', () => {
  it('pages of 1000 and 1 cover every key once, in order', async () => {
    const store = new MemoryObjectStore();
    const keys = Array.from({ length: 1001 }, (_, i) => `k/${String(i).padStart(4, '0')}`);
    for (const key of [...keys].reverse()) await store.put(key, '');
    const first = await store.list('k/');
    expect(first.keys).toHaveLength(MAX_LIST_LIMIT);
    expect(first.cursor).toBe(keys[999]);
    const second = await store.list('k/', { cursor: first.cursor });
    expect(second).toEqual({ keys: [keys[1000]] });
    expect([...first.keys, ...second.keys]).toEqual(keys);
  });
});

describe('P-3 cursor rule', () => {
  async function seeded(): Promise<MemoryObjectStore> {
    const store = new MemoryObjectStore();
    for (const key of ['a/1', 'a/2', 'a/3', 'b/1']) await store.put(key, '');
    return store;
  }

  it('the next page holds the keys after the cursor, even when the cursor key is gone', async () => {
    const store = await seeded();
    const first = await store.list('a/', { limit: 1 });
    expect(first).toEqual({ keys: ['a/1'], cursor: 'a/1' });
    await store.delete(['a/1']);
    expect(await store.list('a/', { limit: 1, cursor: first.cursor })).toEqual({
      keys: ['a/2'],
      cursor: 'a/2',
    });
  });

  it.each([
    ['does not start with the prefix', 'b/1'],
    ['is not a valid key', 'a//x'],
    ['is empty', ''],
  ])('a cursor that %s rejects with RangeError naming cursor', async (_label, cursor) => {
    const store = await seeded();
    await expect(store.list('a/', { cursor })).rejects.toThrow(RangeError);
    await expect(store.list('a/', { cursor })).rejects.toThrow(/cursor/);
  });

  it('validates the prefix before the limit, and the limit before the cursor (P-2)', async () => {
    const store = await seeded();
    await expect(store.list('/bad', { limit: 0, cursor: 'zz' })).rejects.toBeInstanceOf(
      InvalidKeyError,
    );
    await expect(store.list('a/', { limit: 0, cursor: 'b/1' })).rejects.toThrow(/limit/);
  });
});

describe('P-2 validation errors are rejections', () => {
  it('no method throws synchronously', () => {
    const store = new MemoryObjectStore();
    expect(() => store.get('/x').catch(() => {})).not.toThrow();
    expect(() => store.put('/x', '').catch(() => {})).not.toThrow();
    expect(() => store.exists('/x').catch(() => {})).not.toThrow();
    expect(() => store.list('/x').catch(() => {})).not.toThrow();
    expect(() => store.delete(['/x']).catch(() => {})).not.toThrow();
  });
});
