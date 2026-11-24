// Input checks, loading and authentication of getUpdate (spec 07 FR-706–FR-709; VC-708 getUpdate
// cases, VC-709, VC-710 wrong token / other game's token, VC-711 getUpdate part).
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '@/src/engine/engine';
import { GameNotFound, GameUnsupported, Unauthorized } from '@/src/service/errors';
import { commitKey, commitsPrefix, metaKey } from '@/src/state/keys';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { putJson } from '@/src/storage/object-store';
import { RecordingStore } from '../state/support/store-wrappers';
import { makeService } from './support/service-fixtures';

const UNKNOWN_ID = 'zzzzzzzzzzzzzzzzzzzzzzzzzz';

/** The rejection of `promise` (fails the test when it resolves). */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => expect.unreachable('expected a rejection'),
    (e: unknown) => e,
  );
}

/** A created game over a recording memory store, with the call log reset. */
async function createdGame() {
  const ctx = makeService();
  const created = await ctx.service.createGame({ humanName: 'Ana', aiCount: 3 });
  ctx.store.reset();
  return { ...ctx, created };
}

describe('VC-708 (getUpdate): argument checks run before any I/O, first failure wins', () => {
  it("token '' → Unauthorized, 0 store calls", async () => {
    const { service, store, created } = await createdGame();
    expect(await rejection(service.getUpdate(created.gameId, ''))).toBeInstanceOf(Unauthorized);
    expect(store.calls).toHaveLength(0);
  });

  it('a non-string token → Unauthorized, 0 store calls', async () => {
    const { service, store, created } = await createdGame();
    const err = await rejection(service.getUpdate(created.gameId, 42 as unknown as string));
    expect(err).toBeInstanceOf(Unauthorized);
    expect(store.calls).toHaveLength(0);
  });

  it("gameId 'ABC' → GameNotFound naming it, 0 store calls", async () => {
    const { service, store, created } = await createdGame();
    const err = await rejection(service.getUpdate('ABC', created.seatToken));
    expect(err).toBeInstanceOf(GameNotFound);
    expect((err as GameNotFound).gameId).toBe('ABC');
    expect(store.calls).toHaveLength(0);
  });

  it("gameId 'ABC' + token '' + sinceVersion −1 → GameNotFound", async () => {
    const { service, store } = await createdGame();
    expect(await rejection(service.getUpdate('ABC', '', -1))).toBeInstanceOf(GameNotFound);
    expect(store.calls).toHaveLength(0);
  });

  it("valid gameId + token '' + bad sinceVersion → Unauthorized", async () => {
    const { service, store, created } = await createdGame();
    const err = await rejection(service.getUpdate(created.gameId, '', 1.5));
    expect(err).toBeInstanceOf(Unauthorized);
    expect(store.calls).toHaveLength(0);
  });
});

describe('VC-709: missing games and store errors', () => {
  it('an unknown valid gameId → GameNotFound', async () => {
    const { service, created } = await createdGame();
    const err = await rejection(service.getUpdate(UNKNOWN_ID, created.seatToken));
    expect(err).toBeInstanceOf(GameNotFound);
    expect((err as GameNotFound).gameId).toBe(UNKNOWN_ID);
  });

  it('a game whose commit 0 was deleted (meta present) → GameNotFound', async () => {
    const { service, store, created } = await createdGame();
    await store.inner.delete([commitKey(created.gameId, 0)]);
    expect(await store.inner.exists(metaKey(created.gameId))).toBe(true);
    const err = await rejection(service.getUpdate(created.gameId, created.seatToken));
    expect(err).toBeInstanceOf(GameNotFound);
    expect((err as GameNotFound).gameId).toBe(created.gameId);
  });

  it('a store whose get throws a non-storage error → that error propagates', async () => {
    const memory = new MemoryObjectStore();
    const { service: creator } = makeService(memory);
    const created = await creator.createGame({ humanName: 'Ana', aiCount: 3 });
    const boom = new Error('boom');
    const failing = new RecordingStore(memory, {
      get: () => Promise.reject(boom),
    });
    const { service } = makeService(failing);
    expect(await rejection(service.getUpdate(created.gameId, created.seatToken))).toBe(boom);
  });
});

describe('VC-710: tokens that match no seat', () => {
  it('a wrong token → Unauthorized', async () => {
    const { service, created } = await createdGame();
    const wrong = created.seatToken.startsWith('A')
      ? `B${created.seatToken.slice(1)}`
      : `A${created.seatToken.slice(1)}`;
    expect(await rejection(service.getUpdate(created.gameId, wrong))).toBeInstanceOf(Unauthorized);
  });

  it("another game's token → Unauthorized", async () => {
    const { service, created } = await createdGame();
    const other = await service.createGame({ humanName: 'Bea', aiCount: 2 });
    const err = await rejection(service.getUpdate(created.gameId, other.seatToken));
    expect(err).toBeInstanceOf(Unauthorized);
  });

  it('the right token authenticates seat 0', async () => {
    const { service, created } = await createdGame();
    const update = await service.getUpdate(created.gameId, created.seatToken);
    expect(update.view.you).toBe(0);
  });
});

describe('VC-711 (getUpdate): a game stored by another engine version', () => {
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

    const err = await rejection(service.getUpdate(created.gameId, created.seatToken, 0));
    expect(err).toBeInstanceOf(GameUnsupported);
    expect((err as GameUnsupported).engineVersion).toBe(ENGINE_VERSION + 1);
    expect((err as GameUnsupported).gameId).toBe(created.gameId);

    const after = await store.inner.list(commitsPrefix(created.gameId));
    expect(after.keys).toEqual(before.keys);
    expect(store.callsOf('put')).toHaveLength(0);
  });

  it('authentication still comes first: a wrong token → Unauthorized', async () => {
    const { service, state, store, created } = await createdGame();
    const other = await service.createGame({ humanName: 'Bea', aiCount: 2 });
    const meta = await state.loadMeta(created.gameId);
    await putJson(
      store.inner,
      metaKey(created.gameId),
      { ...meta, engineVersion: ENGINE_VERSION + 1 },
      { mode: 'overwrite' },
    );
    const err = await rejection(service.getUpdate(created.gameId, other.seatToken));
    expect(err).toBeInstanceOf(Unauthorized);
  });
});
