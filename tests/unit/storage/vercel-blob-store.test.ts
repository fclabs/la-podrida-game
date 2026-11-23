// VercelBlobObjectStore against a mocked @vercel/blob (spec 05 FR-513, BR-503; VC-514; plan P-6,
// P-8, P-14). No test reaches the network: put, get, list and del are vi.fn() stubs, while the
// real BlobError and BlobNotFoundError classes stay available.
import { BlobError, BlobNotFoundError, del, get, list, put } from '@vercel/blob';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidKeyError, ObjectExistsError } from '@/src/storage/object-store';
import { VercelBlobObjectStore } from '@/src/storage/vercel-blob-store';

vi.mock('@vercel/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vercel/blob')>()),
  put: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
}));

const putMock = vi.mocked(put);
const getMock = vi.mocked(get);
const listMock = vi.mocked(list);
const delMock = vi.mocked(del);

type GetResult = Awaited<ReturnType<typeof get>>;
type ListResultSdk = Awaited<ReturnType<typeof list>>;

/** A 200 `get` result whose stream yields `bytes`; `cancel` is spied on. */
function found(bytes: Uint8Array<ArrayBuffer>): {
  result: GetResult;
  cancel: ReturnType<typeof vi.fn>;
} {
  const stream = new Response(bytes).body!;
  const cancel = vi.fn(() => Promise.resolve());
  stream.cancel = cancel;
  const result = {
    statusCode: 200,
    stream,
    headers: new Headers(),
    blob: { pathname: 'k', contentType: 'application/octet-stream', size: bytes.byteLength },
  } as unknown as GetResult;
  return { result, cancel };
}

function page(pathnames: string[], hasMore: boolean, cursor?: string): ListResultSdk {
  return {
    blobs: pathnames.map((pathname) => ({ pathname })),
    hasMore,
    ...(cursor !== undefined ? { cursor } : {}),
  } as unknown as ListResultSdk;
}

function noSdkCalls(): void {
  expect(putMock).not.toHaveBeenCalled();
  expect(getMock).not.toHaveBeenCalled();
  expect(listMock).not.toHaveBeenCalled();
  expect(delMock).not.toHaveBeenCalled();
}

const ALREADY_EXISTS =
  'Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.';

beforeEach(() => {
  vi.resetAllMocks();
  putMock.mockResolvedValue(undefined as never);
  getMock.mockResolvedValue(null);
  listMock.mockResolvedValue(page([], false));
  delMock.mockResolvedValue(undefined);
});

describe('VC-514 put', () => {
  it('create-only (default) is private, unsuffixed and refuses to overwrite', async () => {
    await new VercelBlobObjectStore().put('games/a', 'body');
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(putMock.mock.calls[0]![0]).toBe('games/a');
    expect(putMock.mock.calls[0]![1]).toBe('body');
    expect(putMock.mock.calls[0]![2]).toStrictEqual({
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  });

  it('overwrite with a content type allows overwriting and forwards the content type', async () => {
    await new VercelBlobObjectStore().put('k', 'x', {
      mode: 'overwrite',
      contentType: 'application/json',
    });
    expect(putMock.mock.calls[0]![2]).toStrictEqual({
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
    });
  });

  it('an explicit create-only mode sends allowOverwrite: false', async () => {
    await new VercelBlobObjectStore().put('k', 'x', { mode: 'create-only' });
    expect(putMock.mock.calls[0]![2]).toMatchObject({ allowOverwrite: false });
  });

  it('a Uint8Array body reaches the SDK as a Buffer with the same bytes', async () => {
    const backing = new Uint8Array([9, 0, 1, 254, 255, 9]);
    await new VercelBlobObjectStore().put('k', backing.subarray(1, 5));
    const sent = putMock.mock.calls[0]![1];
    expect(Buffer.isBuffer(sent)).toBe(true);
    expect(Array.from(sent as Buffer)).toEqual([0, 1, 254, 255]);
  });

  it('an "already exists" rejection becomes ObjectExistsError with the key', async () => {
    putMock.mockRejectedValueOnce(new Error(ALREADY_EXISTS));
    const error = await new VercelBlobObjectStore().put('games/a', 'x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ObjectExistsError);
    expect((error as ObjectExistsError).key).toBe('games/a');
  });

  it('any other put error propagates as the same object', async () => {
    const failure = new BlobError('Bad request');
    putMock.mockRejectedValueOnce(failure);
    await expect(new VercelBlobObjectStore().put('k', 'x')).rejects.toBe(failure);
  });
});

describe('VC-514 get and exists', () => {
  it('get reads uncached and private, and maps null to null', async () => {
    expect(await new VercelBlobObjectStore().get('games/a')).toBeNull();
    expect(getMock).toHaveBeenCalledWith('games/a', { access: 'private', useCache: false });
  });

  it('get returns the stream body as bytes', async () => {
    const bytes = new Uint8Array([0, 1, 2, 255]);
    getMock.mockResolvedValueOnce(found(bytes).result);
    const stored = await new VercelBlobObjectStore().get('k');
    expect(stored!.body).toBeInstanceOf(Uint8Array);
    expect(Array.from(stored!.body)).toEqual([0, 1, 2, 255]);
  });

  it('get of an empty stream returns an empty body', async () => {
    getMock.mockResolvedValueOnce(found(new Uint8Array(0)).result);
    expect((await new VercelBlobObjectStore().get('k'))!.body.byteLength).toBe(0);
  });

  it('a BlobError from get propagates as the same object', async () => {
    const failure = new BlobError('Bad request');
    getMock.mockRejectedValueOnce(failure);
    await expect(new VercelBlobObjectStore().get('k')).rejects.toBe(failure);
    getMock.mockRejectedValueOnce(failure);
    await expect(new VercelBlobObjectStore().exists('k')).rejects.toBe(failure);
  });

  it('exists uses the same uncached get: null → false', async () => {
    expect(await new VercelBlobObjectStore().exists('games/a')).toBe(false);
    expect(getMock).toHaveBeenCalledWith('games/a', { access: 'private', useCache: false });
  });

  it('exists → true and cancels the stream unread', async () => {
    const { result, cancel } = found(new Uint8Array([1, 2, 3]));
    getMock.mockResolvedValueOnce(result);
    expect(await new VercelBlobObjectStore().exists('k')).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('VC-514 list', () => {
  it('sorts an unsorted page and returns the cursor when hasMore', async () => {
    listMock.mockResolvedValueOnce(page(['b', 'a'], true, 'c1'));
    expect(await new VercelBlobObjectStore().list('')).toEqual({ keys: ['a', 'b'], cursor: 'c1' });
  });

  it('sorts in code-unit order', async () => {
    listMock.mockResolvedValueOnce(page(['a/2', 'a/10', 'B', 'a/1', 'ab'], false));
    const result = await new VercelBlobObjectStore().list('');
    expect(result.keys).toEqual(['B', 'a/1', 'a/10', 'a/2', 'ab']);
  });

  it('omits the cursor when hasMore is false', async () => {
    listMock.mockResolvedValueOnce(page(['b', 'a'], false, 'stale'));
    const result = await new VercelBlobObjectStore().list('');
    expect(result).toEqual({ keys: ['a', 'b'] });
    expect('cursor' in result).toBe(false);
  });

  it('passes prefix, cursor, limit and expanded mode', async () => {
    await new VercelBlobObjectStore().list('games/', { cursor: 'c1', limit: 5 });
    expect(listMock).toHaveBeenCalledWith({
      prefix: 'games/',
      cursor: 'c1',
      limit: 5,
      mode: 'expanded',
    });
  });

  it('always passes an explicit limit, 1000 by default (P-8)', async () => {
    await new VercelBlobObjectStore().list('a');
    expect(listMock).toHaveBeenCalledWith({ prefix: 'a', limit: 1000, mode: 'expanded' });
  });

  it('passes an opaque SDK cursor through unchanged (no memory/file cursor rule)', async () => {
    await new VercelBlobObjectStore().list('games/', { cursor: 'opaque:/==' });
    expect(listMock.mock.calls[0]![0]).toMatchObject({ cursor: 'opaque:/==' });
  });
});

describe('VC-514 delete', () => {
  it('2,001 distinct keys → three del calls of 1000, 1000 and 1, in order (P-6)', async () => {
    const keys = Array.from({ length: 2001 }, (_, i) => `k/${i}`);
    await new VercelBlobObjectStore().delete(keys);
    expect(delMock).toHaveBeenCalledTimes(3);
    expect(delMock.mock.calls.map((call) => (call[0] as string[]).length)).toEqual([1000, 1000, 1]);
    expect(delMock.mock.calls.flatMap((call) => call[0] as string[])).toEqual(keys);
  });

  it('removes duplicates in first-seen order before batching (P-6)', async () => {
    await new VercelBlobObjectStore().delete(['b', 'a', 'b', 'c', 'a']);
    expect(delMock).toHaveBeenCalledTimes(1);
    expect(delMock.mock.calls[0]![0]).toEqual(['b', 'a', 'c']);
  });

  it('delete([]) calls nothing', async () => {
    await new VercelBlobObjectStore().delete([]);
    expect(delMock).not.toHaveBeenCalled();
  });

  it('swallows BlobNotFoundError and keeps deleting later batches', async () => {
    delMock.mockRejectedValueOnce(new BlobNotFoundError());
    const keys = Array.from({ length: 1001 }, (_, i) => `k/${i}`);
    await expect(new VercelBlobObjectStore().delete(keys)).resolves.toBeUndefined();
    expect(delMock).toHaveBeenCalledTimes(2);
  });

  it('any other del error propagates as the same object', async () => {
    const failure = new BlobError('Bad request');
    delMock.mockRejectedValueOnce(failure);
    await expect(new VercelBlobObjectStore().delete(['k'])).rejects.toBe(failure);
  });
});

describe('VC-514 validation happens before any SDK call', () => {
  const store = new VercelBlobObjectStore();

  it.each([
    ['get', () => store.get('../x')],
    ['put', () => store.put('../x', 'x')],
    ['exists', () => store.exists('../x')],
    ['delete', () => store.delete(['ok', '../x'])],
    ['list', () => store.list('../')],
  ])('%s with an invalid key or prefix → InvalidKeyError, no SDK call', async (_name, call) => {
    await expect(call()).rejects.toBeInstanceOf(InvalidKeyError);
    noSdkCalls();
  });

  it.each([0, 1001, 1.5])('list limit %s → RangeError naming limit, no SDK call', async (limit) => {
    await expect(store.list('', { limit })).rejects.toThrow(RangeError);
    await expect(store.list('', { limit })).rejects.toThrow(/limit/);
    noSdkCalls();
  });

  it('an invalid prefix is reported before an invalid limit', async () => {
    await expect(store.list('../', { limit: 0 })).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it('validation failures are rejections, never synchronous throws', () => {
    expect(() => void store.get('../x').catch(() => {})).not.toThrow();
    expect(() => void store.list('', { limit: 0 }).catch(() => {})).not.toThrow();
  });
});

describe('VC-514 authentication', () => {
  it("with { token: 't' } every SDK call receives token: 't'", async () => {
    const store = new VercelBlobObjectStore({ token: 't' });
    await store.put('k', 'x');
    await store.get('k');
    await store.exists('k');
    await store.list('');
    await store.delete(['k']);
    expect(putMock.mock.calls[0]![2]).toMatchObject({ token: 't' });
    expect(getMock.mock.calls[0]![1]).toMatchObject({ token: 't' });
    expect(getMock.mock.calls[1]![1]).toMatchObject({ token: 't' });
    expect(listMock.mock.calls[0]![0]).toMatchObject({ token: 't' });
    expect(delMock.mock.calls[0]![1]).toMatchObject({ token: 't' });
  });

  it('without a token no SDK call receives a token property', async () => {
    const store = new VercelBlobObjectStore();
    await store.put('k', 'x');
    await store.get('k');
    await store.list('');
    await store.delete(['k']);
    expect(putMock.mock.calls[0]![2]).not.toHaveProperty('token');
    expect(getMock.mock.calls[0]![1]).not.toHaveProperty('token');
    expect(listMock.mock.calls[0]![0]).not.toHaveProperty('token');
    expect(delMock.mock.calls[0]![1] ?? {}).not.toHaveProperty('token');
  });
});
