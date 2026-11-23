// JSON helpers and their errors (spec 05 FR-509, FR-510, BR-504; VC-510, VC-511, plan P-1).
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { CorruptObjectError, getJson, putJson } from '@/src/storage/object-store';

async function corrupt(promise: Promise<unknown>): Promise<CorruptObjectError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CorruptObjectError);
    return error as CorruptObjectError;
  }
  throw new Error('expected a CorruptObjectError');
}

describe('CorruptObjectError messages (P-1)', () => {
  it("invalid JSON: names the key, reason 'invalid-json', no issuePath", () => {
    const error = new CorruptObjectError('a/b', 'invalid-json');
    expect(error.name).toBe('CorruptObjectError');
    expect(error.message).toBe('Corrupt object a/b: invalid JSON');
    expect(error.issuePath).toBeUndefined();
  });

  it('schema: names the key and the issue path', () => {
    const error = new CorruptObjectError('a/b', 'schema', 'seats.0.name');
    expect(error.message).toBe('Corrupt object a/b: schema mismatch at seats.0.name');
    expect(error.issuePath).toBe('seats.0.name');
  });

  it("a root-level issue has issuePath '' and says (root)", () => {
    const error = new CorruptObjectError('k', 'schema', '');
    expect(error.issuePath).toBe('');
    expect(error.message).toBe('Corrupt object k: schema mismatch at (root)');
  });
});

describe('VC-511 getJson', () => {
  it('a document of the wrong root type fails at the root', async () => {
    const store = new MemoryObjectStore();
    await store.put('doc', '5');
    const error = await corrupt(getJson(store, 'doc', z.object({ n: z.number() })));
    expect(error.reason).toBe('schema');
    expect(error.issuePath).toBe('');
    expect(error.message).toContain('(root)');
  });

  it('joins a nested issue path with dots', async () => {
    const store = new MemoryObjectStore();
    await store.put('doc', '{"seats":[{"name":1}]}');
    const schema = z.object({ seats: z.array(z.object({ name: z.string() })) });
    const error = await corrupt(getJson(store, 'doc', schema));
    expect(error.issuePath).toBe('seats.0.name');
    expect(error.message).toBe('Corrupt object doc: schema mismatch at seats.0.name');
  });

  it('messages never contain the body, for invalid JSON either', async () => {
    const store = new MemoryObjectStore();
    await store.put('doc', 'SECRET-SEED-123 not json');
    const error = await corrupt(getJson(store, 'doc', z.unknown()));
    expect(error.reason).toBe('invalid-json');
    expect(error.message).toBe('Corrupt object doc: invalid JSON');
  });

  it('returns the schema output (transforms applied)', async () => {
    const store = new MemoryObjectStore();
    await store.put('doc', '{"n":"7"}');
    const schema = z.object({ n: z.string().transform(Number) });
    expect(await getJson(store, 'doc', schema)).toEqual({ n: 7 });
  });
});

describe('VC-510 putJson', () => {
  it("calls put with JSON text, mode 'create-only' and contentType application/json", async () => {
    const store = new MemoryObjectStore();
    const put = vi.spyOn(store, 'put');
    await putJson(store, 'k', { a: 1 });
    expect(put).toHaveBeenCalledWith('k', '{"a":1}', {
      mode: 'create-only',
      contentType: 'application/json',
    });
    await putJson(store, 'k', [1], { mode: 'overwrite' });
    expect(put).toHaveBeenLastCalledWith('k', '[1]', {
      mode: 'overwrite',
      contentType: 'application/json',
    });
  });

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('s')],
  ])('rejects %s with TypeError before calling put', async (_label, value) => {
    const store = new MemoryObjectStore();
    const put = vi.spyOn(store, 'put');
    await expect(putJson(store, 'u', value)).rejects.toBeInstanceOf(TypeError);
    expect(put).not.toHaveBeenCalled();
  });
});
