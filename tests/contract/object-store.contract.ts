// Shared ObjectStore contract (spec 05 FR-500 to FR-510, BR-504; VC-501 to VC-511 driver parts).
// Not a test file itself: each `<driver>-store.contract.test.ts` calls `runObjectStoreContract`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CorruptObjectError,
  getJson,
  InvalidKeyError,
  ObjectExistsError,
  putJson,
  type ObjectStore,
} from '@/src/storage/object-store';

export interface ContractStore {
  store: ObjectStore;
  cleanup(): Promise<void>;
}

export interface ContractOptions {
  /** `true` when the cursor is present iff more keys exist (memory, file); `false` for Blob. */
  exactCursor: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The stored body of `key` as text, or `null` when missing. */
async function text(store: ObjectStore, key: string): Promise<string | null> {
  const stored = await store.get(key);
  return stored === null ? null : decoder.decode(stored.body);
}

/** Awaits `promise`, expects it to reject with an instance of `type`, and returns the error. */
async function rejection<E extends Error>(
  promise: Promise<unknown>,
  type: new (...args: never[]) => E,
): Promise<E> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(type);
    return error as E;
  }
  throw new Error(`expected a rejection with ${type.name}`);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(
    Buffer.from(b.buffer, b.byteOffset, b.byteLength),
  );
}

const MIB = 1024 * 1024;

export function runObjectStoreContract(
  name: string,
  makeStore: () => Promise<ContractStore>,
  opts: ContractOptions,
): void {
  describe(`ObjectStore contract: ${name}`, () => {
    let current: ContractStore;
    let store: ObjectStore;

    beforeEach(async () => {
      current = await makeStore();
      store = current.store;
    });

    afterEach(async () => {
      await current.cleanup();
    });

    describe('VC-501 invalid keys are rejected before any I/O', () => {
      it('get, put, exists and delete reject ../x with InvalidKeyError naming it', async () => {
        const calls: Promise<unknown>[] = [
          store.get('../x'),
          store.put('../x', 'b'),
          store.put('../x', 'b', { mode: 'overwrite' }),
          store.exists('../x'),
          store.delete(['../x']),
        ];
        for (const call of calls) {
          const error = await rejection(call, InvalidKeyError);
          expect(error.key).toBe('../x');
          expect(error.message).toContain('../x');
        }
      });

      it("delete(['ok', '../x']) deletes nothing", async () => {
        await store.put('ok', 'body');
        await rejection(store.delete(['ok', '../x']), InvalidKeyError);
        expect(await store.exists('ok')).toBe(true);
      });
    });

    describe('VC-502 invalid prefixes are rejected', () => {
      it("list('../') rejects with InvalidKeyError naming the prefix", async () => {
        const error = await rejection(store.list('../'), InvalidKeyError);
        expect(error.key).toBe('../');
      });
    });

    describe('VC-503 create-only put then get returns the exact bytes', () => {
      it('stores a string as its UTF-8 encoding', async () => {
        await store.put('s', 'héllo');
        const stored = await store.get('s');
        expect(Array.from(stored!.body)).toEqual(Array.from(encoder.encode('héllo')));
      });

      it('stores a 256-byte body holding every byte value', async () => {
        const body = Uint8Array.from({ length: 256 }, (_, i) => i);
        await store.put('bytes', body, { mode: 'create-only' });
        expect(Array.from((await store.get('bytes'))!.body)).toEqual(Array.from(body));
      });

      it('stores an empty body', async () => {
        await store.put('empty', new Uint8Array(0));
        const stored = await store.get('empty');
        expect(stored).not.toBeNull();
        expect(stored!.body.byteLength).toBe(0);
        expect(await store.exists('empty')).toBe(true);
      });
    });

    describe('VC-504 create-only conflicts', () => {
      it('a second create-only put rejects with ObjectExistsError and keeps the body', async () => {
        await store.put('k', 'first-body');
        const error = await rejection(store.put('k', 'second-body'), ObjectExistsError);
        expect(error.key).toBe('k');
        expect(error.message).toContain('k');
        expect(error.message).not.toContain('second-body');
        expect(error.message).not.toContain('first-body');
        expect(await text(store, 'k')).toBe('first-body');
      });

      it('10 concurrent create-only puts: exactly one wins and its body is stored', async () => {
        const bodies = Array.from({ length: 10 }, (_, i) => `body-${i}`);
        const results = await Promise.allSettled(bodies.map((b) => store.put('race', b)));
        const fulfilled = results.flatMap((r, i) => (r.status === 'fulfilled' ? [i] : []));
        const rejected = results.filter((r) => r.status === 'rejected');
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(9);
        for (const r of rejected) {
          expect(r.reason).toBeInstanceOf(ObjectExistsError);
          expect((r.reason as ObjectExistsError).key).toBe('race');
        }
        expect(await text(store, 'race')).toBe(bodies[fulfilled[0]]);
      });
    });

    describe('VC-505 overwrite', () => {
      it('creates a missing key', async () => {
        await store.put('o', 'one', { mode: 'overwrite' });
        expect(await text(store, 'o')).toBe('one');
      });

      it('replaces an existing body', async () => {
        await store.put('o', 'one');
        await store.put('o', 'two', { mode: 'overwrite' });
        expect(await text(store, 'o')).toBe('two');
      });

      it('a put with no options on an existing key is create-only', async () => {
        await store.put('o', 'one');
        await rejection(store.put('o', 'two'), ObjectExistsError);
        expect(await text(store, 'o')).toBe('one');
      });
    });

    describe('VC-506 get and exists', () => {
      it('track a key through missing, stored and deleted', async () => {
        expect(await store.get('m')).toBeNull();
        expect(await store.exists('m')).toBe(false);
        await store.put('m', 'x');
        expect(await text(store, 'm')).toBe('x');
        expect(await store.exists('m')).toBe(true);
        await store.delete(['m']);
        expect(await store.get('m')).toBeNull();
        expect(await store.exists('m')).toBe(false);
      });
    });

    describe('VC-507 concurrent reads never see a partial body', () => {
      /**
       * Starts `write`, then reads `key` in a loop until the write settles. Every read must pass
       * `check`; returns how many reads were issued before the write settled.
       */
      async function readDuring(
        write: () => Promise<void>,
        key: string,
        check: (body: Uint8Array | null) => boolean,
      ): Promise<number> {
        let settled = false;
        const pending = write().finally(() => {
          settled = true;
        });
        let issuedBeforeSettle = 0;
        let bad = 0;
        do {
          if (!settled) issuedBeforeSettle += 1;
          const stored = await store.get(key);
          if (!check(stored === null ? null : stored.body)) bad += 1;
        } while (!settled);
        await pending;
        expect(bad).toBe(0);
        return issuedBeforeSettle;
      }

      it('8 MiB create-only then overwrite: only null, old or new full body', async () => {
        const oldBody = new Uint8Array(8 * MIB).fill(0xa5);
        const newBody = new Uint8Array(8 * MIB).fill(0x5a);

        const createReads = await readDuring(
          () => store.put('big', oldBody, { mode: 'create-only' }),
          'big',
          (body) => body === null || sameBytes(body, oldBody),
        );
        expect(createReads).toBeGreaterThanOrEqual(1);

        const overwriteReads = await readDuring(
          () => store.put('big', newBody, { mode: 'overwrite' }),
          'big',
          (body) => body !== null && (sameBytes(body, oldBody) || sameBytes(body, newBody)),
        );
        expect(overwriteReads).toBeGreaterThanOrEqual(1);

        expect(sameBytes((await store.get('big'))!.body, newBody)).toBe(true);
      }, 30_000);
    });

    describe('VC-508 list', () => {
      const KEYS = ['b/2', 'a/1', 'a/10', 'a/2', 'ab', 'c'];
      const SORTED = ['a/1', 'a/10', 'a/2', 'ab', 'b/2', 'c'];

      beforeEach(async () => {
        for (const key of KEYS) await store.put(key, key);
      });

      it('filters by plain string prefix and sorts by code unit', async () => {
        expect(await store.list('a/')).toEqual({ keys: ['a/1', 'a/10', 'a/2'] });
        expect((await store.list('a')).keys).toEqual(['a/1', 'a/10', 'a/2', 'ab']);
        expect((await store.list('')).keys).toEqual(SORTED);
      });

      it('a prefix matching nothing gives no keys and no cursor', async () => {
        expect(await store.list('zz')).toEqual({ keys: [] });
      });

      it('pages with a cursor: 4 + 2 keys, concatenation equals the full listing', async () => {
        const first = await store.list('', { limit: 4 });
        expect(first.keys).toHaveLength(4);
        expect(first.cursor).toBeDefined();
        const second = await store.list('', { limit: 4, cursor: first.cursor });
        expect(second.keys).toHaveLength(2);
        expect(second.cursor).toBeUndefined();
        expect([...first.keys, ...second.keys]).toEqual((await store.list('')).keys);
      });

      it.runIf(opts.exactCursor)(
        'a page ending exactly at the last key has no cursor',
        async () => {
          expect(await store.list('a/', { limit: 3 })).toEqual({ keys: ['a/1', 'a/10', 'a/2'] });
        },
      );

      it.each([0, 1001, 1.5])('limit %s rejects with RangeError naming limit', async (limit) => {
        const error = await rejection(store.list('', { limit }), RangeError);
        expect(error.message).toContain('limit');
      });
    });

    describe('VC-509 delete', () => {
      it('ignores duplicates and missing keys', async () => {
        await store.put('x', 'x');
        await store.put('y', 'y');
        await store.delete(['x', 'x', 'missing']);
        expect(await store.exists('x')).toBe(false);
        expect((await store.list('')).keys).toEqual(['y']);
      });

      it('delete([]) changes nothing', async () => {
        await store.put('y', 'y');
        await store.delete([]);
        expect((await store.list('')).keys).toEqual(['y']);
        expect(await text(store, 'y')).toBe('y');
      });
    });

    describe('VC-510 putJson', () => {
      it('stores JSON.stringify(value), create-only by default', async () => {
        await putJson(store, 'k', { a: 1 });
        expect(await text(store, 'k')).toBe('{"a":1}');
        await rejection(putJson(store, 'k', { a: 2 }), ObjectExistsError);
        await putJson(store, 'k', { a: 3 }, { mode: 'overwrite' });
        expect(await text(store, 'k')).toBe('{"a":3}');
      });

      it('rejects undefined with TypeError and stores nothing', async () => {
        await rejection(putJson(store, 'u', undefined), TypeError);
        expect(await store.exists('u')).toBe(false);
      });
    });

    describe('VC-511 getJson', () => {
      const schema = z.object({ schemaVersion: z.literal(1), n: z.number() });

      it('a missing key resolves to null', async () => {
        expect(await getJson(store, 'missing', schema)).toBeNull();
      });

      it('a valid document resolves to the parsed data', async () => {
        await store.put('doc', '{"schemaVersion":1,"n":2}');
        expect(await getJson(store, 'doc', schema)).toEqual({ schemaVersion: 1, n: 2 });
      });

      it("an unknown schemaVersion rejects with reason 'schema' at 'schemaVersion'", async () => {
        await store.put('doc', '{"schemaVersion":2,"n":2}');
        const error = await rejection(getJson(store, 'doc', schema), CorruptObjectError);
        expect(error.key).toBe('doc');
        expect(error.reason).toBe('schema');
        expect(error.issuePath).toBe('schemaVersion');
      });

      it("text that is not JSON rejects with reason 'invalid-json'", async () => {
        await store.put('doc', 'not json');
        const error = await rejection(getJson(store, 'doc', schema), CorruptObjectError);
        expect(error.reason).toBe('invalid-json');
        expect(error.key).toBe('doc');
      });

      it("invalid UTF-8 rejects with reason 'invalid-json'", async () => {
        await store.put('doc', new Uint8Array([0xff, 0xfe]));
        const error = await rejection(getJson(store, 'doc', schema), CorruptObjectError);
        expect(error.reason).toBe('invalid-json');
      });

      it('the error message names the key and never the body', async () => {
        await store.put('secret/doc', '{"schemaVersion":1,"n":"SECRET-SEED-123"}');
        const error = await rejection(getJson(store, 'secret/doc', schema), CorruptObjectError);
        expect(error.message).toContain('secret/doc');
        expect(error.message).not.toContain('SECRET-SEED-123');
      });
    });
  });
}
