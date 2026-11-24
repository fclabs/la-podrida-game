// Commit races of submitMove (spec 07 FR-719, FR-720, BR-702; VC-720).
import { describe, expect, it } from 'vitest';
import type { PlayerUpdate } from '@/src/domain/types';
import { VersionConflict } from '@/src/service/errors';
import type { CreateGameResult, SubmitMoveRequest } from '@/src/service/game-service';
import { buildPlayerView } from '@/src/service/player-view';
import { GameStateManager } from '@/src/state/game-state-manager';
import { commitKey, headKey } from '@/src/state/keys';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { ObjectExistsError, type ObjectStore } from '@/src/storage/object-store';
import { RecordingStore, type StoreHooks } from '../state/support/store-wrappers';
import { GatedStore } from './support/gated-store';
import { firstLegalMoveId, makeService } from './support/service-fixtures';

/**
 * A game created on a plain memory store and advanced through `submitMove` until seat 0 has at
 * least two legal moves. Returns the memory store, the game and its latest update.
 */
async function gameWithChoice(): Promise<{
  memory: MemoryObjectStore;
  created: CreateGameResult;
  update: PlayerUpdate;
}> {
  const memory = new MemoryObjectStore();
  const { service } = makeService(memory);
  const created = await service.createGame({ humanName: 'Ana', aiCount: 3 });
  let update = created.update;
  while (update.legalMoves.length < 2) {
    update = await service.submitMove(created.gameId, created.seatToken, {
      version: update.version,
      moveId: firstLegalMoveId(update),
      clientRequestId: `setup-${update.version + 1}`,
    });
  }
  return { memory, created, update };
}

/** A service over `GatedStore(RecordingStore(memory, hooks))` with `barrierOnCommitPut(2)`. */
function racingService(memory: ObjectStore, hooks: Partial<StoreHooks> = {}) {
  const recording = new RecordingStore(memory, hooks);
  const gated = new GatedStore(recording);
  gated.barrierOnCommitPut(2);
  const { service } = makeService(gated);
  return { service, recording };
}

function commitPuts(store: RecordingStore) {
  return store.callsOf('put').filter((c) => c.key?.includes('/commits/'));
}

describe('VC-720: two submitMoves raced from the same version', () => {
  it('different moves → exactly one resolves, the other rejects with VersionConflict; one commit added', async () => {
    const { memory, created, update } = await gameWithChoice();
    const v = update.version;
    const { service, recording } = racingService(memory);
    const reqA: SubmitMoveRequest = {
      version: v,
      moveId: update.legalMoves[0].id,
      clientRequestId: 'race-a',
    };
    const reqB: SubmitMoveRequest = {
      version: v,
      moveId: update.legalMoves[1].id,
      clientRequestId: 'race-b',
    };

    const outcomes = await Promise.allSettled([
      service.submitMove(created.gameId, created.seatToken, reqA),
      service.submitMove(created.gameId, created.seatToken, reqB),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const conflict = (rejected[0] as PromiseRejectedResult).reason as unknown;
    expect(conflict).toBeInstanceOf(VersionConflict);

    const state = new GameStateManager(memory);
    const winner = await state.load(created.gameId, v + 1);
    const winning = (fulfilled[0] as PromiseFulfilledResult<PlayerUpdate>).value;
    expect(winning.version).toBe(v + 1);
    expect(winning.events).toEqual(winner.events);
    const { update: fresh } = conflict as VersionConflict;
    expect(fresh.version).toBe(v + 1);
    expect(fresh.events).toEqual(winner.events);
    expect(fresh.view).toEqual(buildPlayerView(winner.state, 0));
    expect(await memory.exists(commitKey(created.gameId, v + 2))).toBe(false);
    // BR-702: each request made one commit put (the loser's was refused).
    expect(commitPuts(recording)).toHaveLength(2);
  });

  it('two copies of the same request → both resolve deep-equal; one commit added', async () => {
    const { memory, created, update } = await gameWithChoice();
    const v = update.version;
    const { service } = racingService(memory);
    const req: SubmitMoveRequest = {
      version: v,
      moveId: update.legalMoves[0].id,
      clientRequestId: 'same',
    };
    const [a, b] = await Promise.all([
      service.submitMove(created.gameId, created.seatToken, req),
      service.submitMove(created.gameId, created.seatToken, req),
    ]);
    expect(a).toEqual(b);
    expect(a.version).toBe(v + 1);
    expect(await memory.exists(commitKey(created.gameId, v + 1))).toBe(true);
    expect(await memory.exists(commitKey(created.gameId, v + 2))).toBe(false);
  });

  it('the same request with different bytes (another clock) → the loser resolves to the winner’s update', async () => {
    const { memory, created, update } = await gameWithChoice();
    const v = update.version;
    const recording = new RecordingStore(memory);
    const gated = new GatedStore(recording);
    gated.barrierOnCommitPut(2);
    const { service: early } = makeService(gated, { now: () => new Date('2026-11-23T15:00:00Z') });
    const { service: late } = makeService(gated, { now: () => new Date('2026-11-23T16:00:00Z') });
    const req: SubmitMoveRequest = {
      version: v,
      moveId: update.legalMoves[0].id,
      clientRequestId: 'same-but-later',
    };
    const [a, b] = await Promise.all([
      early.submitMove(created.gameId, created.seatToken, req),
      late.submitMove(created.gameId, created.seatToken, req),
    ]);
    expect(a).toEqual(b);
    expect(a.version).toBe(v + 1);
    expect(await memory.exists(commitKey(created.gameId, v + 2))).toBe(false);
    // The loser read the key after its refused put (CommitConflictError), then loaded the winner.
    const target = commitKey(created.gameId, v + 1);
    expect(recording.callsOf('get').filter((c) => c.key === target)).toHaveLength(2);
  });

  it('a collision while head.json still says v (head write fails) → update.version ≥ v + 1', async () => {
    const { memory, created, update } = await gameWithChoice();
    const v = update.version;
    const { service } = racingService(memory, {
      put: ({ key, body, opts }, inner) =>
        key === headKey(created.gameId)
          ? Promise.reject(new Error('head write failed'))
          : inner.put(key, body, opts),
    });
    const outcomes = await Promise.allSettled([
      service.submitMove(created.gameId, created.seatToken, {
        version: v,
        moveId: update.legalMoves[0].id,
        clientRequestId: 'head-a',
      }),
      service.submitMove(created.gameId, created.seatToken, {
        version: v,
        moveId: update.legalMoves[1].id,
        clientRequestId: 'head-b',
      }),
    ]);
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected).toHaveLength(1);
    const conflict = (rejected[0] as PromiseRejectedResult).reason as unknown;
    expect(conflict).toBeInstanceOf(VersionConflict);

    const head = await memory.get(headKey(created.gameId));
    expect(JSON.parse(new TextDecoder().decode(head?.body)).version).toBe(v);
    expect((conflict as VersionConflict).update.version).toBeGreaterThanOrEqual(v + 1);
  });

  it('CommitConflictError while commit v + 1 does not exist → VersionConflict at version v', async () => {
    const { memory, created, update } = await gameWithChoice();
    const v = update.version;
    const target = commitKey(created.gameId, v + 1);
    const recording = new RecordingStore(memory, {
      put: ({ key, body, opts }, inner) =>
        key === target && (opts?.mode ?? 'create-only') === 'create-only'
          ? Promise.reject(new ObjectExistsError(key))
          : inner.put(key, body, opts),
    });
    const { service } = makeService(recording);
    const err = await service
      .submitMove(created.gameId, created.seatToken, {
        version: v,
        moveId: update.legalMoves[0].id,
        clientRequestId: 'phantom',
      })
      .then(
        () => expect.unreachable('expected a rejection'),
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(VersionConflict);
    const fresh = (err as VersionConflict).update;
    expect(fresh.version).toBe(v);
    expect(fresh.events).toEqual([]);
    expect(await memory.exists(target)).toBe(false);
    expect(commitPuts(recording)).toHaveLength(1);
  });

  it('a commit put that throws a generic error → that error propagates', async () => {
    const { memory, created, update } = await gameWithChoice();
    const boom = new Error('disk on fire');
    const recording = new RecordingStore(memory, {
      put: ({ key, body, opts }, inner) =>
        key.includes('/commits/') ? Promise.reject(boom) : inner.put(key, body, opts),
    });
    const { service } = makeService(recording);
    const err = await service
      .submitMove(created.gameId, created.seatToken, {
        version: update.version,
        moveId: update.legalMoves[0].id,
        clientRequestId: 'boom',
      })
      .then(
        () => expect.unreachable('expected a rejection'),
        (e: unknown) => e,
      );
    expect(err).toBe(boom);
    expect(await memory.exists(commitKey(created.gameId, update.version + 1))).toBe(false);
  });
});
