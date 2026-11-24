// GameService.submitMove input checks, rule rejections, retries and stale versions (spec 07
// FR-706, FR-709, FR-713–FR-716, BR-702; VC-708 submitMove cases, VC-711 submitMove part, VC-713,
// VC-716, VC-717, VC-718, VC-719, VC-726).
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESET_ID, getPreset } from '@/src/domain/presets';
import type { GameEvent, SeatInfo } from '@/src/domain/types';
import { createGame, currentActor, ENGINE_VERSION, legalMoves } from '@/src/engine/engine';
import {
  GameNotFound,
  GameUnsupported,
  IllegalMove,
  InvalidRequest,
  NotYourTurn,
  Unauthorized,
  VersionConflict,
} from '@/src/service/errors';
import type { CreateGameResult, SubmitMoveRequest } from '@/src/service/game-service';
import { buildPlayerView } from '@/src/service/player-view';
import { commitKey, commitsPrefix, MAX_COMMIT_VERSION, metaKey } from '@/src/state/keys';
import type { Commit } from '@/src/state/schemas';
import { putJson } from '@/src/storage/object-store';
import { GAME_ID } from '../state/support/fixtures';
import type { RecordingStore } from '../state/support/store-wrappers';
import {
  firstLegalMoveId,
  makeService,
  playToEnd,
  storeHandmadeGame,
} from './support/service-fixtures';

/** The rejection of `promise` (fails the test when it resolves). */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.unreachable('expected a rejection'),
    (e: unknown) => e,
  );
}

/** Create-only `put`s of commit keys recorded by `store`. */
function commitPuts(store: RecordingStore) {
  return store.callsOf('put').filter((c) => c.key?.includes('/commits/'));
}

/** A created game over a recording memory store, with the call log reset. */
async function createdGame() {
  const ctx = makeService();
  const created = await ctx.service.createGame({ humanName: 'Ana', aiCount: 3 });
  ctx.store.reset();
  return { ...ctx, created };
}

/** The request that plays seat 0's first legal move at `created.update`'s version. */
function firstMove(created: CreateGameResult, clientRequestId = 'req-1'): SubmitMoveRequest {
  return {
    version: created.update.version,
    moveId: firstLegalMoveId(created.update),
    clientRequestId,
  };
}

/** A created game advanced to `tip` through `submitMove`; every stored commit; log reset. */
async function gameAtTip(tip: number) {
  const ctx = await createdGame();
  const { service, state, store, created } = ctx;
  let update = created.update;
  for (let n = 1; n <= tip; n++) {
    update = await service.submitMove(created.gameId, created.seatToken, {
      version: update.version,
      moveId: firstLegalMoveId(update),
      clientRequestId: `req-${n}`,
    });
  }
  const commits: Commit[] = [];
  for (let v = 0; v <= tip; v++) commits.push(await state.load(created.gameId, v));
  store.reset();
  return { ...ctx, commits, update };
}

function eventsOf(commits: readonly Commit[]): GameEvent[] {
  return commits.flatMap((c) => c.events);
}

const HUMAN_TOKEN = 'handmade-human-token';

/** Seat 0 human, seats 1–3 random AIs (FR-703 shape). */
function oneHumanSeats(): SeatInfo[] {
  return [
    { seat: 0, playerId: 'human-0', name: 'Ana', kind: 'human' },
    ...[1, 2, 3].map((i): SeatInfo => ({
      seat: i,
      playerId: `ai-${i}`,
      name: `AI ${i}`,
      kind: 'ai',
      strategy: 'random',
    })),
  ];
}

/** The first seed `ai-first-<i>` whose fresh deal has an AI to act (engine createGame only). */
function aiFirstSeed(): string {
  for (let i = 0; i < 100; i++) {
    const seed = `ai-first-${i}`;
    const { state } = createGame({
      gameId: GAME_ID,
      rules: getPreset(DEFAULT_PRESET_ID),
      seats: oneHumanSeats(),
      seed,
    });
    if (currentActor(state) !== 0) return seed;
  }
  throw new Error('no AI-first seed found');
}

describe('VC-708 (submitMove): argument checks run before any I/O, first failure wins', () => {
  const BAD_REQ = { version: -1, moveId: '', clientRequestId: '' };

  it("token '' → Unauthorized, 0 store calls", async () => {
    const { service, store, created } = await createdGame();
    const err = await rejection(service.submitMove(created.gameId, '', firstMove(created)));
    expect(err).toBeInstanceOf(Unauthorized);
    expect(store.calls).toHaveLength(0);
  });

  it("gameId 'ABC' → GameNotFound, 0 store calls", async () => {
    const { service, store, created } = await createdGame();
    const err = await rejection(service.submitMove('ABC', created.seatToken, firstMove(created)));
    expect(err).toBeInstanceOf(GameNotFound);
    expect(store.calls).toHaveLength(0);
  });

  it("gameId 'ABC' + token '' + bad req → GameNotFound", async () => {
    const { service, store } = await createdGame();
    expect(await rejection(service.submitMove('ABC', '', BAD_REQ))).toBeInstanceOf(GameNotFound);
    expect(store.calls).toHaveLength(0);
  });

  it("valid gameId + token '' + bad req → Unauthorized", async () => {
    const { service, store, created } = await createdGame();
    const err = await rejection(service.submitMove(created.gameId, '', BAD_REQ));
    expect(err).toBeInstanceOf(Unauthorized);
    expect(store.calls).toHaveLength(0);
  });

  it("bad version and bad clientRequestId → reason 'version'", async () => {
    const { service, store, created } = await createdGame();
    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        version: 1.5,
        moveId: 'bid:0',
        clientRequestId: '',
      }),
    );
    expect(err).toBeInstanceOf(InvalidRequest);
    expect((err as InvalidRequest).reason).toBe('version');
    expect(store.calls).toHaveLength(0);
  });

  it("bad moveId and bad clientRequestId → reason 'moveId'", async () => {
    const { service, created } = await createdGame();
    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        version: 0,
        moveId: '',
        clientRequestId: '',
      }),
    );
    expect((err as InvalidRequest).reason).toBe('moveId');
  });
});

describe('VC-711 (submitMove): a game stored by another engine version', () => {
  it('rejects with GameUnsupported naming that version; no commit is added', async () => {
    const { service, state, store, created } = await createdGame();
    const meta = await state.loadMeta(created.gameId);
    await putJson(
      store.inner,
      metaKey(created.gameId),
      { ...meta, engineVersion: ENGINE_VERSION + 1 },
      { mode: 'overwrite' },
    );
    const before = await store.inner.list(commitsPrefix(created.gameId));
    store.reset();

    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, firstMove(created)),
    );
    expect(err).toBeInstanceOf(GameUnsupported);
    expect((err as GameUnsupported).engineVersion).toBe(ENGINE_VERSION + 1);
    expect((err as GameUnsupported).gameId).toBe(created.gameId);

    const after = await store.inner.list(commitsPrefix(created.gameId));
    expect(after.keys).toEqual(before.keys);
    expect(store.callsOf('put')).toHaveLength(0);
  });
});

describe('VC-713: submitMove request checks', () => {
  it.each<[string, Partial<SubmitMoveRequest>, string]>([
    ['version −1', { version: -1 }, 'version'],
    ['version 1.5', { version: 1.5 }, 'version'],
    ['version MAX_COMMIT_VERSION', { version: MAX_COMMIT_VERSION }, 'version'],
    ["version '0'", { version: '0' as unknown as number }, 'version'],
    ["moveId ''", { moveId: '' }, 'moveId'],
    ['moveId of 33 characters', { moveId: 'x'.repeat(33) }, 'moveId'],
    ['moveId not a string', { moveId: 7 as unknown as string }, 'moveId'],
    ["clientRequestId ''", { clientRequestId: '' }, 'clientRequestId'],
    ['clientRequestId of 129 characters', { clientRequestId: 'c'.repeat(129) }, 'clientRequestId'],
  ])('%s → InvalidRequest, 0 store calls', async (_label, patch, reason) => {
    const { service, store, created } = await createdGame();
    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, { ...firstMove(created), ...patch }),
    );
    expect(err).toBeInstanceOf(InvalidRequest);
    expect((err as InvalidRequest).reason).toBe(reason);
    expect(store.calls).toHaveLength(0);
  });

  it('moveId of 32 characters passes validation (then IllegalMove unknown-move)', async () => {
    const { service, store, created } = await createdGame();
    const moveId = 'm'.repeat(32);
    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, { ...firstMove(created), moveId }),
    );
    expect(err).toBeInstanceOf(IllegalMove);
    expect((err as IllegalMove).reason).toBe('unknown-move');
    expect((err as IllegalMove).moveId).toBe(moveId);
    expect(store.calls.length).toBeGreaterThan(0);
  });

  it('clientRequestId of 128 characters is accepted', async () => {
    const { service, state, created } = await createdGame();
    const clientRequestId = 'c'.repeat(128);
    const update = await service.submitMove(
      created.gameId,
      created.seatToken,
      firstMove(created, clientRequestId),
    );
    expect(update.version).toBe(1);
    expect((await state.load(created.gameId, 1)).clientRequestId).toBe(clientRequestId);
  });

  it('version MAX_COMMIT_VERSION − 1 passes validation (then a VersionConflict)', async () => {
    const { service, created } = await createdGame();
    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        ...firstMove(created),
        version: MAX_COMMIT_VERSION - 1,
      }),
    );
    expect(err).toBeInstanceOf(VersionConflict);
  });
});

describe('VC-716: moves the rules refuse are not committed', () => {
  it('seat 0 moving while an AI must act → NotYourTurn { seat: 0 }; no commit', async () => {
    const { service, state, store } = makeService();
    const seed = aiFirstSeed();
    const { commit0 } = await storeHandmadeGame(state, {
      gameId: GAME_ID,
      seats: oneHumanSeats(),
      tokens: [HUMAN_TOKEN, null, null, null],
      seed,
      runLoop: false,
    });
    expect(currentActor(commit0.state)).not.toBe(0);
    store.reset();

    const err = await rejection(
      service.submitMove(GAME_ID, HUMAN_TOKEN, {
        version: 0,
        moveId: 'bid:0',
        clientRequestId: 'early',
      }),
    );
    expect(err).toBeInstanceOf(NotYourTurn);
    expect((err as NotYourTurn).seat).toBe(0);
    expect(commitPuts(store)).toHaveLength(0);
    expect(await store.inner.exists(commitKey(GAME_ID, 1))).toBe(false);
  });

  it("moveId 'bid:99' → IllegalMove { reason: 'unknown-move' }; no commit", async () => {
    const { service, store, created } = await createdGame();
    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        ...firstMove(created),
        moveId: 'bid:99',
      }),
    );
    expect(err).toBeInstanceOf(IllegalMove);
    expect((err as IllegalMove).reason).toBe('unknown-move');
    expect((err as IllegalMove).moveId).toBe('bid:99');
    expect(commitPuts(store)).toHaveLength(0);
    expect(await store.inner.exists(commitKey(created.gameId, 1))).toBe(false);
  });

  it("any move after game over → IllegalMove { reason: 'game-over' }; no commit", async () => {
    const { service, store, created } = await createdGame();
    const responses = await playToEnd(service, created);
    const last = responses[responses.length - 1];
    store.reset();
    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        version: last.version,
        moveId: 'bid:0',
        clientRequestId: 'after-the-end',
      }),
    );
    expect(err).toBeInstanceOf(IllegalMove);
    expect((err as IllegalMove).reason).toBe('game-over');
    expect(commitPuts(store)).toHaveLength(0);
    expect(store.callsOf('put')).toHaveLength(0);
    expect(await store.inner.exists(commitKey(created.gameId, last.version + 1))).toBe(false);
  });
});

describe('VC-717: a stale or future version → VersionConflict with a fresh update', () => {
  it('stale version, different clientRequestId → tip update with the events since req.version', async () => {
    const { service, store, created, commits } = await gameAtTip(3);
    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        version: 0,
        moveId: firstLegalMoveId(created.update),
        clientRequestId: 'someone-else',
      }),
    );
    expect(err).toBeInstanceOf(VersionConflict);
    const { update } = err as VersionConflict;
    expect(update.version).toBe(3);
    expect(update.events).toEqual(eventsOf(commits.slice(1, 4)));
    expect(update.view).toEqual(buildPlayerView(commits[3].state, 0));
    expect(update.legalMoves).toEqual(legalMoves(commits[3].state, 0));
    expect(commitPuts(store)).toHaveLength(0);
    expect(await store.inner.exists(commitKey(created.gameId, 4))).toBe(false);
  });

  it('stale by one (req.version = tip − 1) → events of the tip commit only', async () => {
    const { service, created, commits } = await gameAtTip(2);
    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        version: 1,
        moveId: 'bid:0',
        clientRequestId: 'late',
      }),
    );
    expect((err as VersionConflict).update.events).toEqual(commits[2].events);
  });

  it('req.version = tip + 5 → VersionConflict at the tip with events []', async () => {
    const { service, store, created, commits } = await gameAtTip(2);
    const err = await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        version: 7,
        moveId: 'bid:0',
        clientRequestId: 'from-the-future',
      }),
    );
    expect(err).toBeInstanceOf(VersionConflict);
    const { update } = err as VersionConflict;
    expect(update.version).toBe(2);
    expect(update.events).toEqual([]);
    expect(update.view).toEqual(buildPlayerView(commits[2].state, 0));
    expect(commitPuts(store)).toHaveLength(0);
    expect(await store.inner.exists(commitKey(created.gameId, 3))).toBe(false);
  });
});

describe('VC-718: a retried request resolves to its original result', () => {
  it('the same request sent again after it committed v+1 → deep-equal response, no commit', async () => {
    const { service, store, created } = await createdGame();
    const req = firstMove(created);
    const first = await service.submitMove(created.gameId, created.seatToken, req);
    store.reset();
    const again = await service.submitMove(created.gameId, created.seatToken, req);
    expect(again).toEqual(first);
    expect(commitPuts(store)).toHaveLength(0);
    expect(store.callsOf('put')).toHaveLength(0);
    expect(await store.inner.exists(commitKey(created.gameId, 2))).toBe(false);
  });

  it('also after a further commit v+2 has landed', async () => {
    const { service, store, created } = await createdGame();
    const req = firstMove(created);
    const first = await service.submitMove(created.gameId, created.seatToken, req);
    const second = await service.submitMove(created.gameId, created.seatToken, {
      version: first.version,
      moveId: firstLegalMoveId(first),
      clientRequestId: 'req-2',
    });
    expect(second.version).toBe(2);
    store.reset();

    const again = await service.submitMove(created.gameId, created.seatToken, req);
    expect(again).toEqual(first);
    expect(commitPuts(store)).toHaveLength(0);
    expect(await store.inner.exists(commitKey(created.gameId, 3))).toBe(false);
  });
});

describe('VC-719: a matching clientRequestId from another seat is not a retry', () => {
  const TOKEN_0 = 'first-human-token';
  const TOKEN_1 = 'second-human-token';
  const seats: SeatInfo[] = [
    { seat: 0, playerId: 'human-0', name: 'Ana', kind: 'human' },
    { seat: 1, playerId: 'human-1', name: 'Bea', kind: 'human' },
    { seat: 2, playerId: 'ai-2', name: 'AI 2', kind: 'ai', strategy: 'random' },
  ];

  it('the other human seat sending the same clientRequestId → VersionConflict', async () => {
    const { service, state, store } = makeService();
    const { commit0 } = await storeHandmadeGame(state, {
      gameId: GAME_ID,
      seats,
      tokens: [TOKEN_0, TOKEN_1, null],
      seed: 'two-humans',
    });
    const actor = currentActor(commit0.state);
    expect(actor === 0 || actor === 1).toBe(true);
    const tokens = [TOKEN_0, TOKEN_1];
    const other = actor === 0 ? 1 : 0;
    const req: SubmitMoveRequest = {
      version: 0,
      moveId: legalMoves(commit0.state, actor as number)[0].id,
      clientRequestId: 'shared-id',
    };
    const first = await service.submitMove(GAME_ID, tokens[actor as number], req);
    expect(first.version).toBe(1);
    store.reset();

    const err = await rejection(service.submitMove(GAME_ID, tokens[other], req));
    expect(err).toBeInstanceOf(VersionConflict);
    const { update } = err as VersionConflict;
    expect(update.version).toBe(1);
    expect(update.view.you).toBe(other);
    expect(commitPuts(store)).toHaveLength(0);

    // The seat that made the commit still gets its original response back.
    expect(await service.submitMove(GAME_ID, tokens[actor as number], req)).toEqual(first);
  });
});

describe('VC-726: one request, at most one commit', () => {
  it('createGame makes exactly one create-only put of meta.json and one of commit 0', async () => {
    const { service, store } = makeService();
    for (let i = 0; i < 3; i++) {
      store.reset();
      const { gameId } = await service.createGame({ humanName: 'Ana', aiCount: 3 });
      const puts = store.callsOf('put');
      expect(puts.filter((c) => c.key === metaKey(gameId))).toEqual([
        { method: 'put', key: metaKey(gameId), mode: 'create-only' },
      ]);
      expect(puts.filter((c) => c.key?.includes('/commits/'))).toEqual([
        { method: 'put', key: commitKey(gameId, 0), mode: 'create-only' },
      ]);
    }
  });

  it('a successful submitMove makes exactly one create-only commit put', async () => {
    const { service, store, created } = await createdGame();
    await service.submitMove(created.gameId, created.seatToken, firstMove(created));
    expect(commitPuts(store)).toEqual([
      { method: 'put', key: commitKey(created.gameId, 1), mode: 'create-only' },
    ]);
  });

  it('every submitMove of a full game makes exactly one commit put', async () => {
    const { service, store, created } = await createdGame();
    const responses = await playToEnd(service, created);
    expect(commitPuts(store)).toHaveLength(responses.length);
  });

  it('rejected and matched-retry paths (VC-716–VC-719) make no commit put', async () => {
    const { service, store, created } = await gameAtTip(2);
    const { seatToken, gameId } = created;
    const attempts: Array<Promise<unknown>> = [
      service.submitMove(gameId, seatToken, { version: 2, moveId: 'bid:99', clientRequestId: 'a' }),
      service.submitMove(gameId, seatToken, { version: 0, moveId: 'bid:0', clientRequestId: 'b' }),
      service.submitMove(gameId, seatToken, { version: 9, moveId: 'bid:0', clientRequestId: 'c' }),
      service.submitMove(gameId, seatToken, {
        version: 0,
        moveId: firstLegalMoveId(created.update),
        clientRequestId: 'req-1',
      }),
    ];
    const outcomes = await Promise.allSettled(attempts);
    expect(outcomes.map((o) => o.status)).toEqual([
      'rejected',
      'rejected',
      'rejected',
      'fulfilled',
    ]);
    expect(commitPuts(store)).toHaveLength(0);
    expect(store.callsOf('put')).toHaveLength(0);
  });
});
