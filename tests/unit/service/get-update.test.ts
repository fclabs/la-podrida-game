// GameService.getUpdate (spec 07 FR-710, FR-711, FR-716; VC-712, NFR-702 getUpdate counts, VC-729
// getUpdate first round).
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@/src/domain/types';
import { applyMove, legalMoves } from '@/src/engine/engine';
import { createPlayers } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { runAiLoop } from '@/src/service/ai-loop';
import { InvalidRequest } from '@/src/service/errors';
import { buildPlayerView } from '@/src/service/player-view';
import { GameStateManager } from '@/src/state/game-state-manager';
import { commitKey, MAX_COMMIT_VERSION } from '@/src/state/keys';
import type { Commit, CommitBody } from '@/src/state/schemas';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import type { ObjectStore } from '@/src/storage/object-store';
import { GAME_ID } from '../state/support/fixtures';
import { RecordingStore } from '../state/support/store-wrappers';
import { GatedStore } from './support/gated-store';
import { FIXED_NOW, makeService } from './support/service-fixtures';

/** The body of commit `prev.version + 1`: seat 0's first legal move, then the AI loop. */
function nextBody(prev: Commit): CommitBody {
  const [first] = legalMoves(prev.state, 0);
  if (first === undefined) throw new Error(`seat 0 has no legal move at version ${prev.version}`);
  const n = prev.version + 1;
  const human = applyMove(prev.state, 0, first.id);
  const loop = runAiLoop(human.state, createPlayers(human.state.seats));
  const state = { ...loop.state, version: n };
  return {
    version: n,
    at: FIXED_NOW.toISOString(),
    actorSeat: 0,
    clientRequestId: `req-${n}`,
    events: [...human.events, ...loop.events],
    state,
    scoreboard: evaluate(state),
  };
}

/**
 * A game created through the service on `memory`, then advanced to `tip` by committing bodies with
 * `state.commit` directly (`submitMove` is not used). Returns every commit by version.
 */
async function gameAtTip(memory: ObjectStore, tip: number) {
  const { service, state } = makeService(memory);
  const created = await service.createGame({ humanName: 'Ana', aiCount: 3 });
  const commits = [await state.load(created.gameId, 0)];
  for (let n = 1; n <= tip; n++) {
    commits.push(await state.commit(created.gameId, nextBody(commits[n - 1])));
  }
  return { created, commits };
}

/** A recording service over a memory store holding a game at `tip`, with the call log empty. */
async function recordedGameAtTip(tip: number) {
  const memory = new MemoryObjectStore();
  const game = await gameAtTip(memory, tip);
  const ctx = makeService(new RecordingStore(memory));
  return { ...ctx, ...game };
}

function eventsOf(commits: readonly Commit[]): GameEvent[] {
  return commits.flatMap((c) => c.events);
}

describe('VC-712: getUpdate events and versions', () => {
  it('after two moves: version 2, events [] without sinceVersion; view and moves of seat 0', async () => {
    const { service, created, commits } = await recordedGameAtTip(2);
    const update = await service.getUpdate(created.gameId, created.seatToken);
    expect(update.version).toBe(2);
    expect(update.events).toEqual([]);
    expect(update.view).toEqual(buildPlayerView(commits[2].state, 0));
    expect(update.legalMoves).toEqual(legalMoves(commits[2].state, 0));
  });

  it('since 0 → the events of commits 1–2 in order', async () => {
    const { service, created, commits } = await recordedGameAtTip(2);
    const update = await service.getUpdate(created.gameId, created.seatToken, 0);
    expect(update.version).toBe(2);
    expect(update.events).toEqual(eventsOf(commits.slice(1, 3)));
    expect(update.events.length).toBeGreaterThan(0);
  });

  it('since 1 → the events of commit 2', async () => {
    const { service, created, commits } = await recordedGameAtTip(2);
    const update = await service.getUpdate(created.gameId, created.seatToken, 1);
    expect(update.events).toEqual(commits[2].events);
  });

  it.each([2, 99, MAX_COMMIT_VERSION])('since %i → []', async (since) => {
    const { service, created } = await recordedGameAtTip(2);
    const update = await service.getUpdate(created.gameId, created.seatToken, since);
    expect(update.version).toBe(2);
    expect(update.events).toEqual([]);
  });

  it.each([-1, 1.5, MAX_COMMIT_VERSION + 1, Number.NaN, '0' as unknown as number])(
    'since %s → InvalidRequest sinceVersion, 0 store calls',
    async (since) => {
      const { service, store, created } = await recordedGameAtTip(2);
      const err = await service.getUpdate(created.gameId, created.seatToken, since).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(InvalidRequest);
      expect((err as InvalidRequest).reason).toBe('sinceVersion');
      expect(store.calls).toHaveLength(0);
    },
  );

  it('a third commit landing after loadLatest: version 2 and exactly the events of commits 1–2', async () => {
    const memory = new MemoryObjectStore();
    const { created, commits } = await gameAtTip(memory, 2);
    const third = nextBody(commits[2]);
    const key1 = commitKey(created.gameId, 1);
    let landed = false;
    const racing = new RecordingStore(memory, {
      get: async ({ key }, inner) => {
        if (key === key1 && !landed) {
          landed = true;
          await new GameStateManager(inner).commit(created.gameId, third);
        }
        return inner.get(key);
      },
    });
    const { service } = makeService(racing);

    const update = await service.getUpdate(created.gameId, created.seatToken, 0);
    expect(landed).toBe(true);
    expect(await memory.exists(commitKey(created.gameId, 3))).toBe(true);
    expect(update.version).toBe(2);
    expect(update.events).toEqual(eventsOf(commits.slice(1, 3)));
    expect(update.view).toEqual(buildPlayerView(commits[2].state, 0));
  });
});

describe('NFR-702 (getUpdate): store calls with head.json exact', () => {
  it.each([0, 2, 4])('tip %i without sinceVersion → 6 calls', async (tip) => {
    const { service, store, created } = await recordedGameAtTip(tip);
    await service.getUpdate(created.gameId, created.seatToken);
    expect(store.calls).toHaveLength(6);
    expect(store.callsOf('put')).toHaveLength(0);
  });

  it.each([
    [2, 0],
    [2, 1],
    [4, 0],
    [4, 1],
    [4, 3],
  ])('tip %i, since %i → 6 + 2·(t − v − 1) calls', async (tip, since) => {
    const { service, store, created } = await recordedGameAtTip(tip);
    await service.getUpdate(created.gameId, created.seatToken, since);
    expect(store.calls).toHaveLength(6 + 2 * (tip - since - 1));
    expect(store.callsOf('put')).toHaveLength(0);
  });

  it.each([
    [2, 2],
    [2, 7],
  ])('tip %i, since %i (≥ tip) → 6 calls', async (tip, since) => {
    const { service, store, created } = await recordedGameAtTip(tip);
    await service.getUpdate(created.gameId, created.seatToken, since);
    expect(store.calls).toHaveLength(6);
  });
});

describe('VC-729 (getUpdate): the first round has 4 calls in flight together', () => {
  it('4 calls are pending before the first is released', async () => {
    const memory = new MemoryObjectStore();
    const { created } = await gameAtTip(memory, 2);
    const gated = new GatedStore(memory);
    const { service } = makeService(gated);

    const pending = service.getUpdate(created.gameId, created.seatToken);
    await gated.whenPending(4);
    await gated.settle();
    expect(gated.pending).toBe(4);
    gated.release();
    const update = await pending;
    expect(update.version).toBe(2);
    expect(gated.pending).toBe(0);
  });
});

describe('GatedStore.barrierOnCommitPut (support self-check)', () => {
  it('holds create-only commit puts until n are pending; other calls pass through', async () => {
    const memory = new MemoryObjectStore();
    const gated = new GatedStore(memory);
    gated.barrierOnCommitPut(2);

    let firstDone = false;
    const first = gated.put(commitKey(GAME_ID, 1), 'a').then(() => {
      firstDone = true;
    });
    await gated.settle();
    expect(gated.pending).toBe(1);
    expect(firstDone).toBe(false);
    expect(await gated.exists(commitKey(GAME_ID, 1))).toBe(false);

    const second = gated.put(commitKey(GAME_ID, 2), 'b');
    await Promise.all([first, second]);
    expect(gated.pending).toBe(0);
    expect(await memory.exists(commitKey(GAME_ID, 2))).toBe(true);

    await gated.put(commitKey(GAME_ID, 3), 'c');
    expect(await memory.exists(commitKey(GAME_ID, 3))).toBe(true);
  });
});
