// Batch cap, round limit and failure reporting (spec 10: VC-1006, VC-1007 (store part), VC-1011;
// plan iteration 2). Fixed `now` and explicit marker days, on the memory and the file store.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CleanupFailedError, MAX_LIST_ROUNDS_PER_GAME, runCleanup } from '@/app/api/_lib/cleanup';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import type { ObjectStore } from '@/src/storage/object-store';
import { gameKeyPrefix, indexCreatedKey, indexCreatedPrefix } from '@/src/state/keys';
import { RecordingStore } from '../unit/state/support/store-wrappers';
import {
  failOnNthList,
  gameId,
  makeGameKeys,
  snapshot,
  staleListing,
  storeMatrix,
} from './support/fixtures';

const NOW = new Date('2026-11-27T03:00:00.000Z');

function run(store: ObjectStore, over: { batchSize?: number; pageSize?: number } = {}) {
  return runCleanup({
    store,
    now: NOW,
    retentionDays: 365,
    batchSize: over.batchSize ?? 500,
    pageSize: over.pageSize ?? 1000,
  });
}

async function markers(store: ObjectStore): Promise<string[]> {
  return (await store.list(indexCreatedPrefix)).keys;
}

describe.each(storeMatrix)('runCleanup limits on the $name store', ({ make }) => {
  let store: ObjectStore;
  let release: () => Promise<void>;

  beforeEach(async () => {
    ({ store, cleanup: release } = await make());
  });
  afterEach(async () => {
    await release();
  });

  it('VC-1006: 5 expired games, batch size 2: 2/true, 2/true, 1/false, 0/false', async () => {
    const days = ['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05'];
    for (const [i, day] of days.entries())
      await makeGameKeys(store, { id: gameId(i), day, keys: 3 });
    await makeGameKeys(store, { id: gameId(9), day: '2026-11-27', keys: 3 });
    const marker = (i: number) => indexCreatedKey(days[i]!, gameId(i));

    expect(await run(store, { batchSize: 2 })).toEqual({
      gamesDeleted: 2,
      capReached: true,
      skippedMarkers: 0,
    });
    expect((await markers(store)).slice(0, 3)).toEqual([2, 3, 4].map(marker));
    for (const i of [0, 1]) expect((await store.list(gameKeyPrefix(gameId(i)))).keys).toEqual([]);
    for (const i of [2, 3, 4, 9])
      expect((await store.list(gameKeyPrefix(gameId(i)))).keys).toHaveLength(3);

    expect((await run(store, { batchSize: 2 })).gamesDeleted).toBe(2);
    expect((await markers(store)).slice(0, 1)).toEqual([marker(4)]);
    expect(await run(store, { batchSize: 2 })).toMatchObject({
      gamesDeleted: 1,
      capReached: false,
    });
    expect(await run(store, { batchSize: 2 })).toMatchObject({
      gamesDeleted: 0,
      capReached: false,
    });
    expect(await markers(store)).toEqual([indexCreatedKey('2026-11-27', gameId(9))]);
    expect((await store.list(gameKeyPrefix(gameId(9)))).keys).toHaveLength(3);
  });

  it('VC-1006: second run of the cap returns capReached true again', async () => {
    for (let i = 0; i < 4; i++)
      await makeGameKeys(store, { id: gameId(i), day: `2025-01-0${i + 1}`, keys: 2 });
    const first = await run(store, { batchSize: 2 });
    const second = await run(store, { batchSize: 2 });
    expect([first.capReached, second.capReached]).toEqual([true, true]);
    expect(await markers(store)).toEqual([]);
  });

  it('VC-1006: exactly 2 expired games with batch size 2: 2/true, then 0/false', async () => {
    for (let i = 0; i < 2; i++)
      await makeGameKeys(store, { id: gameId(i), day: `2025-01-0${i + 1}`, keys: 2 });
    await makeGameKeys(store, { id: gameId(5), day: '2026-11-27', keys: 2 });
    expect(await run(store, { batchSize: 2 })).toEqual({
      gamesDeleted: 2,
      capReached: true,
      skippedMarkers: 0,
    });
    expect(await run(store, { batchSize: 2 })).toEqual({
      gamesDeleted: 0,
      capReached: false,
      skippedMarkers: 0,
    });
  });

  it('VC-1007: a failing list rejects with CleanupFailedError (gamesDeleted 0); the next run resumes', async () => {
    const expired = gameId(1);
    const kept = gameId(2);
    await makeGameKeys(store, { id: expired, day: '2025-01-01', keys: 4 });
    await makeGameKeys(store, { id: kept, day: '2026-11-27', keys: 4 });
    const keptBefore = (await snapshot(store)).filter(([k]) => k.includes(kept));

    const rec = new RecordingStore(store, failOnNthList(gameKeyPrefix(expired), 2));
    const error = await run(rec, { pageSize: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CleanupFailedError);
    const failed = error as CleanupFailedError;
    expect(failed.name).toBe('CleanupFailedError');
    expect(failed.gamesDeleted).toBe(0);
    expect(failed.cause).toBeInstanceOf(Error);
    expect((failed.cause as Error).message).toBe('injected');
    expect((await store.list(gameKeyPrefix(expired))).keys).toHaveLength(3);
    expect(await markers(store)).toContain(indexCreatedKey('2025-01-01', expired));

    expect(await run(store, { pageSize: 1 })).toEqual({
      gamesDeleted: 1,
      capReached: false,
      skippedMarkers: 0,
    });
    expect(await snapshot(store)).toEqual(keptBefore);
    expect(keptBefore.map(([k]) => k)).toContain(indexCreatedKey('2026-11-27', kept));
  });

  it('VC-1007: gamesDeleted counts the games fully deleted before the error', async () => {
    const [a, b] = [gameId(1), gameId(2)];
    await makeGameKeys(store, { id: a, day: '2025-01-01', keys: 2 });
    await makeGameKeys(store, { id: b, day: '2025-01-02', keys: 2 });
    const rec = new RecordingStore(store, failOnNthList(gameKeyPrefix(b), 1));
    const error = (await run(rec).catch((e: unknown) => e)) as CleanupFailedError;
    expect(error).toBeInstanceOf(CleanupFailedError);
    expect(error.gamesDeleted).toBe(1);
    expect(await markers(store)).toEqual([indexCreatedKey('2025-01-02', b)]);
  });

  it('FR-1009: a failing marker walk list is wrapped too', async () => {
    const rec = new RecordingStore(store, failOnNthList(indexCreatedPrefix, 1));
    await expect(run(rec)).rejects.toBeInstanceOf(CleanupFailedError);
  });

  it.each([0, -1, 1.5, Number.NaN])('batchSize %s rejects with RangeError', async (batchSize) => {
    const error = await run(store, { batchSize }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RangeError);
    expect(error).not.toBeInstanceOf(CleanupFailedError);
  });

  it.each([0, 1001, 2.5, Number.NaN])('pageSize %s rejects with RangeError', async (pageSize) => {
    const error = await run(store, { pageSize }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RangeError);
    expect(error).not.toBeInstanceOf(CleanupFailedError);
  });

  it('batchSize 1 and pageSize 1000 are accepted', async () => {
    expect(await run(store, { batchSize: 1, pageSize: 1000 })).toEqual({
      gamesDeleted: 0,
      capReached: false,
      skippedMarkers: 0,
    });
  });
});

describe('runCleanup round limit on the memory store', () => {
  it('VC-1011: a stale listing fails after exactly MAX_LIST_ROUNDS_PER_GAME lists; the marker stays', async () => {
    const store = new MemoryObjectStore();
    const id = gameId(1);
    await makeGameKeys(store, { id, day: '2025-01-01', keys: 3 });
    const rec = new RecordingStore(store, staleListing(gameKeyPrefix(id)));
    const error = await run(rec).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CleanupFailedError);
    expect((error as CleanupFailedError).gamesDeleted).toBe(0);
    expect((error as CleanupFailedError).cause).toBeInstanceOf(Error);
    expect(rec.callsOf('list').filter((c) => c.prefix === gameKeyPrefix(id))).toHaveLength(
      MAX_LIST_ROUNDS_PER_GAME,
    );
    expect(await markers(store)).toEqual([indexCreatedKey('2025-01-01', id)]);
  });
});
