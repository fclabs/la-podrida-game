// Core cleanup walk (spec 10: VC-1002–VC-1005, VC-1009, VC-1010, VC-1016, VC-1019; plan iteration
// 1). Every test uses a fixed `now` and explicit marker days, on the memory and the file store.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from '@/app/api/_lib/cleanup';
import type { ObjectStore } from '@/src/storage/object-store';
import { gameKeyPrefix, indexCreatedKey, indexCreatedPrefix } from '@/src/state/keys';
import { RecordingStore } from '../unit/state/support/store-wrappers';
import { gameId, makeGameKeys, snapshot, storeMatrix, wrap } from './support/fixtures';

const NOW = new Date('2026-11-27T03:00:00.000Z');

function run(
  store: ObjectStore,
  over: { now?: Date; retentionDays?: number; pageSize?: number } = {},
) {
  return runCleanup({
    store,
    now: over.now ?? NOW,
    retentionDays: over.retentionDays ?? 365,
    batchSize: 500,
    pageSize: over.pageSize ?? 1000,
  });
}

async function markers(store: ObjectStore): Promise<string[]> {
  return (await store.list(indexCreatedPrefix)).keys;
}

describe.each(storeMatrix)('runCleanup on the $name store', ({ make }) => {
  let store: ObjectStore;
  let release: () => Promise<void>;

  beforeEach(async () => {
    ({ store, cleanup: release } = await make());
  });
  afterEach(async () => {
    await release();
  });

  it('VC-1002: deletes only markers strictly before the cutoff day (365 days)', async () => {
    const days = ['2025-11-25', '2025-11-26', '2025-11-27', '2025-11-28', '2026-11-27'];
    for (const [i, day] of days.entries())
      await makeGameKeys(store, { id: gameId(i), day, keys: 3 });
    const result = await run(store);
    expect(result).toEqual({ gamesDeleted: 2, capReached: false, skippedMarkers: 0 });
    expect(await markers(store)).toEqual(
      days.slice(2).map((d, i) => indexCreatedKey(d, gameId(i + 2))),
    );
    for (const i of [0, 1]) expect((await store.list(gameKeyPrefix(gameId(i)))).keys).toEqual([]);
    for (const i of [2, 3, 4])
      expect((await store.list(gameKeyPrefix(gameId(i)))).keys).toHaveLength(3);
  });

  it('VC-1002: a leap-year cutoff keeps the cutoff day itself (1 day at 2028-03-01)', async () => {
    await makeGameKeys(store, { id: gameId(1), day: '2028-02-28', keys: 2 });
    await makeGameKeys(store, { id: gameId(2), day: '2028-02-29', keys: 2 });
    const result = await run(store, {
      now: new Date('2028-03-01T00:00:00.000Z'),
      retentionDays: 1,
    });
    expect(result.gamesDeleted).toBe(1);
    expect(await markers(store)).toEqual([indexCreatedKey('2028-02-29', gameId(2))]);
  });

  it.each(['2026-11-27T23:59:59.999Z', '2026-11-27T00:00:00.000Z'])(
    'VC-1002: now %s gives the same result as any other time of that day',
    async (iso) => {
      await makeGameKeys(store, { id: gameId(1), day: '2025-11-26', keys: 2 });
      await makeGameKeys(store, { id: gameId(2), day: '2025-11-27', keys: 2 });
      const result = await run(store, { now: new Date(iso) });
      expect(result.gamesDeleted).toBe(1);
      expect(await markers(store)).toEqual([indexCreatedKey('2025-11-27', gameId(2))]);
    },
  );

  it('VC-1003: lists index/created/ once per page up to the first non-expired marker, in order', async () => {
    const days = [
      '2025-01-01',
      '2025-01-01',
      '2025-01-02',
      '2025-01-02',
      '2025-01-03',
      '2025-01-03',
    ];
    for (const [i, day] of days.entries())
      await makeGameKeys(store, { id: gameId(i), day, keys: 1 });
    await makeGameKeys(store, { id: gameId(6), day: '2026-11-27', keys: 1 });
    await makeGameKeys(store, { id: gameId(7), day: '2026-11-28', keys: 1 });
    const rec = wrap(store);
    const result = await run(rec, { pageSize: 1 });
    expect(result.gamesDeleted).toBe(6);
    expect(rec.callsOf('list').filter((c) => c.prefix === indexCreatedPrefix)).toHaveLength(7);
    const deletedMarkers = rec
      .callsOf('delete')
      .map((c) => c.keys![0]!)
      .filter((k) => k.startsWith(indexCreatedPrefix));
    expect(deletedMarkers).toEqual([...deletedMarkers].sort());
    expect(deletedMarkers).toEqual(days.map((d, i) => indexCreatedKey(d, gameId(i))).sort());
  });

  it('VC-1004: deletes only the expired games and their markers', async () => {
    const expiredA = gameId(1);
    const expiredB = gameId(2);
    const keptSamePrefix = gameId(3);
    const keptNew = gameId(4);
    await makeGameKeys(store, { id: expiredA, day: '2025-01-01', keys: 6, final: true });
    await makeGameKeys(store, { id: expiredB, day: '2025-01-02', keys: 4 });
    await makeGameKeys(store, { id: keptSamePrefix, day: '2026-11-26', keys: 5 });
    await makeGameKeys(store, { id: keptNew, day: '2026-11-27', keys: 3, final: true });
    await store.put('other/x', 'unrelated');
    const before = await snapshot(store);
    const result = await run(store);
    expect(result.gamesDeleted).toBe(2);
    const after = await snapshot(store);
    const gone = (id: string) => (k: string) => !k.includes(id);
    expect(after.map(([k]) => k)).toEqual(
      before
        .map(([k]) => k)
        .filter(gone(expiredA))
        .filter(gone(expiredB)),
    );
    const beforeMap = new Map(before);
    for (const [k, body] of after) expect(body).toBe(beforeMap.get(k));
    expect(after.some(([k]) => k === 'other/x')).toBe(true);
  });

  it('VC-1005: the marker is deleted last, after an empty listing of the game', async () => {
    const ids = [gameId(1), gameId(2)];
    for (const [i, id] of ids.entries())
      await makeGameKeys(store, { id, day: `2025-01-0${i + 1}`, keys: 7 });
    const lastListEmpty = new Map<string, boolean>();
    const observed: { id: string; innerKeys: string[]; emptyListSeen: boolean }[] = [];
    const rec: RecordingStore = new RecordingStore(store, {
      list: async ({ prefix, opts }, inner) => {
        const result = await inner.list(prefix, opts);
        if (prefix.startsWith('games/')) lastListEmpty.set(prefix, result.keys.length === 0);
        return result;
      },
      delete: async ({ keys }, inner) => {
        const marker = keys.find((k) => k.startsWith(indexCreatedPrefix));
        if (marker !== undefined) {
          const id = marker.split('/').pop()!;
          observed.push({
            id,
            innerKeys: (await inner.list(gameKeyPrefix(id))).keys,
            emptyListSeen: lastListEmpty.get(gameKeyPrefix(id)) === true,
          });
        }
        return inner.delete(keys);
      },
    });
    await run(rec, { pageSize: 3 });
    expect(observed.map((o) => o.id)).toEqual(ids);
    for (const o of observed) {
      expect(o.innerKeys).toEqual([]);
      expect(o.emptyListSeen).toBe(true);
    }
  });

  it('VC-1009: only non-expired markers: zero summary and no delete', async () => {
    await makeGameKeys(store, { id: gameId(1), day: '2026-11-27', keys: 2 });
    await makeGameKeys(store, { id: gameId(2), day: '2026-11-28', keys: 2 });
    const rec = wrap(store);
    expect(await run(rec)).toEqual({ gamesDeleted: 0, capReached: false, skippedMarkers: 0 });
    expect(rec.callsOf('delete')).toHaveLength(0);
  });

  it('VC-1009: an empty store: zero summary and no delete', async () => {
    const rec = wrap(store);
    expect(await run(rec)).toEqual({ gamesDeleted: 0, capReached: false, skippedMarkers: 0 });
    expect(rec.callsOf('delete')).toHaveLength(0);
  });

  it('VC-1010: skips malformed markers, never deletes them, stops at the first non-expired', async () => {
    const [idA, idB, idC, idD, idE, idF] = [1, 2, 3, 4, 5, 6].map(gameId);
    await makeGameKeys(store, { id: idA!, day: '2024-12-31', keys: 2 });
    await makeGameKeys(store, { id: idC!, day: '2025-03-01', keys: 2 });
    await makeGameKeys(store, { id: idF!, day: '2026-11-27', keys: 2 });
    const malformed = [
      'index/created/2025-01-01/SHORT',
      `index/created/2025-02-30/${idB}`,
      `index/created/2025-13-01/${idE}`,
      `index/created/not-a-date/${idD}`,
    ];
    for (const key of malformed) await store.put(key, '');
    const result = await run(store);
    expect(result).toEqual({ gamesDeleted: 2, capReached: false, skippedMarkers: 3 });
    expect(await markers(store)).toEqual([
      malformed[0],
      malformed[1],
      malformed[2],
      indexCreatedKey('2026-11-27', idF!),
      malformed[3],
    ]);
  });

  it('VC-1016: one game with 25 keys, page size 10: 4 lists, 3 key deletes, 1 marker delete', async () => {
    const id = gameId(1);
    await makeGameKeys(store, { id, day: '2025-01-01', keys: 25 });
    const rec = wrap(store);
    expect((await run(rec, { pageSize: 10 })).gamesDeleted).toBe(1);
    expect(rec.callsOf('list').filter((c) => c.prefix === gameKeyPrefix(id))).toHaveLength(4);
    const deletes = rec.callsOf('delete');
    expect(deletes.map((c) => c.keys!.length)).toEqual([10, 10, 5, 1]);
    expect(deletes[3]!.keys).toEqual([indexCreatedKey('2025-01-01', id)]);
    for (const m of ['get', 'exists', 'put'] as const) expect(rec.callsOf(m)).toHaveLength(0);
    expect(await snapshot(store)).toEqual([]);
  });

  it('VC-1019: a marker with no game keys: counted, removed, one delete, never empty', async () => {
    const id = gameId(1);
    await makeGameKeys(store, { id, day: '2025-01-01', keys: 0 });
    const rec = wrap(store);
    expect(await run(rec)).toEqual({ gamesDeleted: 1, capReached: false, skippedMarkers: 0 });
    expect(await markers(store)).toEqual([]);
    const deletes = rec.callsOf('delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.keys).toEqual([indexCreatedKey('2025-01-01', id)]);
  });
});
