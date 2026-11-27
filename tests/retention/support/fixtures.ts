// Retention test fixtures (plan iteration 1): the store matrix, game builders, a snapshot helper
// and a recording wrapper. Games are written with the real key layout (spec 06).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileObjectStore } from '@/src/storage/file-store';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import type { ObjectStore } from '@/src/storage/object-store';
import { commitKey, finalScoresKey, headKey, indexCreatedKey, metaKey } from '@/src/state/keys';
import { RecordingStore, type StoreHooks } from '../../unit/state/support/store-wrappers';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** A store under test and the function that releases it. */
export interface MadeStore {
  store: ObjectStore;
  cleanup: () => Promise<void>;
}

/** `memory` and `file` (a fresh temp directory, removed by `cleanup`); use with `describe.each`. */
export const storeMatrix: { name: string; make: () => Promise<MadeStore> }[] = [
  {
    name: 'memory',
    make: async () => ({ store: new MemoryObjectStore(), cleanup: async () => {} }),
  },
  {
    name: 'file',
    make: async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'retention-'));
      return {
        store: new FileObjectStore(dir),
        cleanup: () => rm(dir, { recursive: true, force: true }),
      };
    },
  },
];

/** A valid 26-character game id, unique per non-negative integer `n` (`a` padding + 6 base32 digits). */
export function gameId(n: number): string {
  let rest = n;
  let digits = '';
  for (let i = 0; i < 6; i++) {
    digits = BASE32[rest % 32] + digits;
    rest = Math.floor(rest / 32);
  }
  return `${'a'.repeat(20)}${digits}`;
}

/**
 * Writes the marker `index/created/{day}/{id}` (empty) and `keys` objects under `games/{id}/`:
 * `meta.json`, `head.json`, then `commits/00000000.json`…; `final: true` writes
 * `scores/final.json` as one of those `keys` (after the first two). `keys` may be 0 (a marker with
 * no game keys). Returns the game's keys (marker excluded).
 */
export async function makeGameKeys(
  store: ObjectStore,
  game: { id: string; day: string; keys: number; final?: boolean },
): Promise<string[]> {
  const { id, day, keys, final = false } = game;
  await store.put(indexCreatedKey(day, id), '');
  const names = [metaKey(id), headKey(id)];
  if (final) names.push(finalScoresKey(id));
  for (let v = 0; names.length < keys; v++) names.push(commitKey(id, v));
  const written = names.slice(0, keys);
  for (const key of written) await store.put(key, `${id}:${key}`);
  return written;
}

/** Every key with its body (UTF-8), in sorted key order. */
export async function snapshot(store: ObjectStore): Promise<[string, string][]> {
  const out: [string, string][] = [];
  let cursor: string | undefined;
  do {
    const page = await store.list('', { cursor });
    for (const key of page.keys) {
      const stored = await store.get(key);
      out.push([key, new TextDecoder().decode(stored?.body)]);
    }
    cursor = page.cursor;
  } while (cursor !== undefined);
  return out;
}

/** A `RecordingStore` around `store`. */
export function wrap(store: ObjectStore): RecordingStore {
  return new RecordingStore(store);
}

/** Hooks that throw `Error('injected')` on the n-th (1-based) `list` of `prefix`; all else delegates. */
export function failOnNthList(prefix: string, n: number): Partial<StoreHooks> {
  let seen = 0;
  return {
    list: async ({ prefix: p, opts }, inner) => {
      if (p === prefix && ++seen === n) throw new Error('injected');
      return inner.list(p, opts);
    },
  };
}

/**
 * Hooks whose `list` of `prefix` always returns the first key it ever saw there, so a delete is
 * accepted but the listing never empties. Other prefixes and methods delegate.
 */
export function staleListing(prefix: string): Partial<StoreHooks> {
  let first: string | undefined;
  return {
    list: async ({ prefix: p, opts }, inner) => {
      if (p !== prefix) return inner.list(p, opts);
      if (first === undefined) {
        const { keys } = await inner.list(p, opts);
        first = keys[0];
      }
      return { keys: first === undefined ? [] : [first] };
    },
  };
}
