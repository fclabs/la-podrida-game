// Store-call budgets of submitMove and createGame (spec 07 NFR-702; VC-729 submitMove and
// createGame counts, and the submitMove first round). The getUpdate half is in get-update.test.ts.
import { describe, expect, it } from 'vitest';
import type { PlayerUpdate } from '@/src/domain/types';
import { VersionConflict } from '@/src/service/errors';
import type { CreateGameResult } from '@/src/service/game-service';
import { commitKey, finalScoresKey, headKey } from '@/src/state/keys';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { RecordingStore } from '../state/support/store-wrappers';
import { GatedStore } from './support/gated-store';
import { firstLegalMoveId, makeService } from './support/service-fixtures';

/** A game created on `memory` and advanced to `tip` through `submitMove` (head.json exact). */
async function gameAtTip(memory: MemoryObjectStore, tip: number) {
  const { service } = makeService(memory);
  const created = await service.createGame({ humanName: 'Ana', aiCount: 3 });
  let update: PlayerUpdate = created.update;
  for (let n = 1; n <= tip; n++) {
    update = await service.submitMove(created.gameId, created.seatToken, {
      version: update.version,
      moveId: firstLegalMoveId(update),
      clientRequestId: `req-${n}`,
    });
  }
  return { created, update };
}

/** The next move of seat 0 as a request. */
function nextRequest(update: PlayerUpdate, clientRequestId: string) {
  return { version: update.version, moveId: firstLegalMoveId(update), clientRequestId };
}

describe('VC-729 (submitMove): store calls with head.json exact', () => {
  it.each([0, 1, 3])(
    'a successful submitMove at tip %i = 8 calls (1 meta, 5 loadLatest, 2 puts)',
    async (tip) => {
      const memory = new MemoryObjectStore();
      const { created, update } = await gameAtTip(memory, tip);
      const store = new RecordingStore(memory);
      const { service } = makeService(store);
      const next = await service.submitMove(
        created.gameId,
        created.seatToken,
        nextRequest(update, 'counted'),
      );
      expect(next.view.phase).not.toBe('game-over');
      expect(store.calls).toHaveLength(8);
      expect(store.callsOf('put').map((c) => [c.key, c.mode])).toEqual([
        [commitKey(created.gameId, tip + 1), 'create-only'],
        [headKey(created.gameId), 'overwrite'],
      ]);
    },
  );

  it('every move of a full game = 8 calls, and the final move = 9 (+1 put of final.json)', async () => {
    const store = new RecordingStore(new MemoryObjectStore());
    const { service } = makeService(store);
    const created: CreateGameResult = await service.createGame({ humanName: 'Ana', aiCount: 3 });
    let update = created.update;
    const counts: number[] = [];
    while (update.view.phase !== 'game-over') {
      store.reset();
      update = await service.submitMove(
        created.gameId,
        created.seatToken,
        nextRequest(update, `m-${update.version + 1}`),
      );
      counts.push(store.calls.length);
    }
    expect(counts.slice(0, -1).every((n) => n === 8)).toBe(true);
    expect(counts[counts.length - 1]).toBe(9);
    expect(store.callsOf('put').map((c) => c.key)).toContain(finalScoresKey(created.gameId));
  });

  it.each([
    [2, 0],
    [2, 1],
    [4, 0],
    [4, 2],
    [5, 1],
  ])(
    'a stale VersionConflict at tip %i from version %i = 8 + 2·(t − v − 1) calls',
    async (tip, v) => {
      const memory = new MemoryObjectStore();
      const { created } = await gameAtTip(memory, tip);
      const store = new RecordingStore(memory);
      const { service } = makeService(store);
      const err = await service
        .submitMove(created.gameId, created.seatToken, {
          version: v,
          moveId: 'bid:0',
          clientRequestId: 'no-match',
        })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(VersionConflict);
      expect(store.calls).toHaveLength(8 + 2 * (tip - v - 1));
      expect(store.callsOf('put')).toHaveLength(0);
    },
  );

  it('createGame = 4 puts and 0 reads', async () => {
    const store = new RecordingStore(new MemoryObjectStore());
    const { service } = makeService(store);
    await service.createGame({ humanName: 'Ana', aiCount: 3 });
    expect(store.calls).toHaveLength(4);
    expect(store.callsOf('put')).toHaveLength(4);
  });
});

describe('VC-729 (submitMove): the first round has 4 calls in flight together', () => {
  it('4 calls are pending before the first is released', async () => {
    const memory = new MemoryObjectStore();
    const { created, update } = await gameAtTip(memory, 2);
    const gated = new GatedStore(memory);
    const { service } = makeService(gated);

    const pending = service.submitMove(
      created.gameId,
      created.seatToken,
      nextRequest(update, 'gated'),
    );
    await gated.whenPending(4);
    await gated.settle();
    expect(gated.pending).toBe(4);
    gated.release();
    const next = await pending;
    expect(next.version).toBe(3);
    expect(gated.pending).toBe(0);
  });
});
