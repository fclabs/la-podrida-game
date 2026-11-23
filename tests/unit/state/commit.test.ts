// GameStateManager commits (spec 06 FR-600, FR-611–FR-614, BR-602; VC-601 for the remaining
// methods, VC-615–VC-618).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CommitConflictError,
  GameNotFoundError,
  InvalidCommitError,
  InvalidGameIdError,
} from '@/src/state/errors';
import { GameStateManager } from '@/src/state/game-state-manager';
import { commitKey, headKey } from '@/src/state/keys';
import type { CommitBody } from '@/src/state/schemas';
import { FileObjectStore } from '@/src/storage/file-store';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { ObjectExistsError, putJson, type ObjectStore } from '@/src/storage/object-store';
import {
  GAME_ID,
  makeCommitBody,
  makeInitial,
  makeMeta,
  OTHER_GAME_ID,
  toCommit,
} from './support/fixtures';
import { RecordingStore } from './support/store-wrappers';

const g = GAME_ID;
const decoder = new TextDecoder();

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

async function readText(store: ObjectStore, key: string): Promise<string | null> {
  const stored = await store.get(key);
  return stored === null ? null : decoder.decode(stored.body);
}

/** A created game (via the manager) and the body of commit 1. */
async function createdGame(
  store: ObjectStore,
): Promise<{ manager: GameStateManager; v1: CommitBody }> {
  const manager = new GameStateManager(store);
  const initial = makeInitial();
  await manager.create(makeMeta(), initial);
  return { manager, v1: makeCommitBody(initial, 1) };
}

describe('VC-601 — invalid gameId rejects before any I/O (remaining methods)', () => {
  const board = makeInitial().scoreboard;
  const cases: [string, (m: GameStateManager) => Promise<unknown>][] = [
    ['commit (invalid body too)', (m) => m.commit('BAD', { ...makeInitial(), version: -5 })],
    ['eventsSince', (m) => m.eventsSince('BAD', 0)],
    ['eventsSince (invalid version too)', (m) => m.eventsSince('BAD', -1)],
    ['writeFinalScores', (m) => m.writeFinalScores('BAD', 0, board)],
    ['writeFinalScores (invalid version too)', (m) => m.writeFinalScores('BAD', -1, board)],
    ['readFinalScores', (m) => m.readFinalScores('BAD')],
  ];
  for (const [name, call] of cases) {
    it(`${name} → InvalidGameIdError, 0 store calls`, async () => {
      const store = new RecordingStore(new MemoryObjectStore());
      const err = await rejectionOf(call(new GameStateManager(store)));
      expect(err).toBeInstanceOf(InvalidGameIdError);
      expect((err as InvalidGameIdError).gameId).toBe('BAD');
      expect(store.calls).toEqual([]);
    });
  }
});

describe('VC-615 — commit appends a version', () => {
  it('stores commit 1, sets head to 1 and returns load(g, 1)', async () => {
    const memory = new MemoryObjectStore();
    const { manager, v1 } = await createdGame(memory);
    const result = await manager.commit(g, v1);
    expect(result).toEqual(toCommit(v1));
    expect(await manager.load(g, 1)).toEqual(result);
    expect(JSON.parse((await readText(memory, headKey(g)))!)).toEqual({
      schemaVersion: 1,
      version: 1,
    });
  });

  it('stores JSON.stringify of the document with keys in the documented order', async () => {
    const memory = new MemoryObjectStore();
    const { manager, v1 } = await createdGame(memory);
    await manager.commit(g, v1);
    const expected = JSON.stringify({
      schemaVersion: 1,
      version: v1.version,
      at: v1.at,
      actorSeat: v1.actorSeat,
      clientRequestId: v1.clientRequestId,
      events: v1.events,
      state: v1.state,
      scoreboard: v1.scoreboard,
    });
    expect(await readText(memory, commitKey(g, 1))).toBe(expected);
  });

  const v1 = makeCommitBody(makeInitial(), 1);
  const invalid: [string, CommitBody, string][] = [
    ['version 0 (a valid commit-0 body)', makeInitial(), 'commit-version'],
    ['state.version ≠ version', { ...v1, state: { ...v1.state, version: 2 } }, 'state-version'],
    [
      'the wrong state.gameId',
      { ...v1, state: { ...v1.state, gameId: OTHER_GAME_ID } },
      'state-game-id',
    ],
    ['actorSeat null at v1', { ...v1, actorSeat: null }, 'commit-schema:actorSeat'],
    [
      'clientRequestId null at v1',
      { ...v1, clientRequestId: null },
      'commit-schema:clientRequestId',
    ],
    ['an extra key', { ...v1, extra: true } as CommitBody, 'commit-schema:(root)'],
  ];
  for (const [name, body, reason] of invalid) {
    it(`${name} → InvalidCommitError '${reason}', 0 store calls`, async () => {
      const store = new RecordingStore(new MemoryObjectStore());
      const err = await rejectionOf(new GameStateManager(store).commit(g, body));
      expect(err).toBeInstanceOf(InvalidCommitError);
      expect((err as InvalidCommitError).reason).toBe(reason);
      expect(store.calls).toEqual([]);
    });
  }

  it('commit of v3 when the tip is 1 succeeds (no tip + 1 check)', async () => {
    const memory = new MemoryObjectStore();
    const { manager, v1 } = await createdGame(memory);
    await manager.commit(g, v1);
    const v3 = makeCommitBody(v1, 3);
    expect(await manager.commit(g, v3)).toEqual(toCommit(v3));
    expect(await manager.load(g, 3)).toEqual(toCommit(v3));
  });

  it('an orphan commit for a game never created resolves but never loads', async () => {
    const memory = new MemoryObjectStore();
    const manager = new GameStateManager(memory);
    const orphan = makeCommitBody(makeInitial(OTHER_GAME_ID), 1);
    expect(await manager.commit(OTHER_GAME_ID, orphan)).toEqual(toCommit(orphan));
    expect(await rejectionOf(manager.loadLatest(OTHER_GAME_ID))).toBeInstanceOf(GameNotFoundError);
    expect(await rejectionOf(manager.load(OTHER_GAME_ID, 1))).toBeInstanceOf(GameNotFoundError);
  });
});

describe('VC-616 — two racing commits: exactly one wins', () => {
  const ROUNDS = 20;

  async function race(store: ObjectStore): Promise<void> {
    const { manager, v1 } = await createdGame(store);
    const a: CommitBody = { ...v1, clientRequestId: 'req-a' };
    const b: CommitBody = { ...v1, clientRequestId: 'req-b' };
    const results = await Promise.allSettled([manager.commit(g, a), manager.commit(g, b)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as unknown;
    expect(reason).toBeInstanceOf(CommitConflictError);
    expect(reason).toMatchObject({ gameId: g, version: 1 });
    const winner = (fulfilled[0] as PromiseFulfilledResult<unknown>).value;
    expect(await manager.load(g, 1)).toEqual(winner);
  }

  it(`on MemoryObjectStore, ${ROUNDS} rounds`, async () => {
    for (let round = 0; round < ROUNDS; round++) await race(new MemoryObjectStore());
  });

  describe('on FileObjectStore (temp folder)', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lp-state-'));
    });
    afterEach(async () => {
      await fs.rm(dir, { recursive: true, force: true });
    });

    it(`${ROUNDS} rounds`, async () => {
      for (let round = 0; round < ROUNDS; round++) {
        await race(new FileObjectStore(path.join(dir, `round-${round}`)));
      }
    });
  });
});

describe('VC-617 — ObjectExistsError: byte compare of the stored commit', () => {
  it('a retried write that landed (stored, then ObjectExistsError) → resolves, head set', async () => {
    const memory = new MemoryObjectStore();
    const { v1 } = await createdGame(memory);
    let retried = false;
    const store = new RecordingStore(memory, {
      put: async ({ key, body, opts }, inner) => {
        await inner.put(key, body, opts);
        if (key === commitKey(g, 1) && !retried) {
          retried = true;
          throw new ObjectExistsError(key);
        }
      },
    });
    const manager = new GameStateManager(store);
    expect(await manager.commit(g, v1)).toEqual(toCommit(v1));
    expect(retried).toBe(true);
    expect(store.callsOf('get').map((c) => c.key)).toEqual([commitKey(g, 1)]);
    expect(JSON.parse((await readText(memory, headKey(g)))!)).toEqual({
      schemaVersion: 1,
      version: 1,
    });
    expect(await manager.loadLatest(g)).toEqual(toCommit(v1));
  });

  it('a stored v1 that differs only in clientRequestId → CommitConflictError', async () => {
    const memory = new MemoryObjectStore();
    const { manager, v1 } = await createdGame(memory);
    await putJson(memory, commitKey(g, 1), toCommit({ ...v1, clientRequestId: 'other' }));
    const err = await rejectionOf(manager.commit(g, v1));
    expect(err).toBeInstanceOf(CommitConflictError);
    expect(err).toMatchObject({ gameId: g, version: 1 });
    expect(JSON.parse((await readText(memory, headKey(g)))!)).toEqual({
      schemaVersion: 1,
      version: 0,
    });
  });

  it('ObjectExistsError while the re-read returns null → CommitConflictError', async () => {
    const memory = new MemoryObjectStore();
    const { v1 } = await createdGame(memory);
    const store = new RecordingStore(memory, {
      put: async ({ key, body, opts }, inner) => {
        if (key === commitKey(g, 1)) throw new ObjectExistsError(key);
        return inner.put(key, body, opts);
      },
      get: async ({ key }, inner) => (key === commitKey(g, 1) ? null : inner.get(key)),
    });
    const err = await rejectionOf(new GameStateManager(store).commit(g, v1));
    expect(err).toBeInstanceOf(CommitConflictError);
    expect(err).toMatchObject({ gameId: g, version: 1 });
    expect(store.callsOf('put')).toHaveLength(1);
  });
});

describe('VC-618 — storage errors', () => {
  it('a commit-write rejection propagates as the same object', async () => {
    const memory = new MemoryObjectStore();
    const { v1 } = await createdGame(memory);
    const net = new Error('net');
    const store = new RecordingStore(memory, {
      put: async ({ key, body, opts }, inner) => {
        if (key === commitKey(g, 1)) throw net;
        return inner.put(key, body, opts);
      },
    });
    expect(await rejectionOf(new GameStateManager(store).commit(g, v1))).toBe(net);
    expect(store.callsOf('put')).toHaveLength(1);
  });

  it('a re-read rejection propagates as the same object', async () => {
    const memory = new MemoryObjectStore();
    const { v1 } = await createdGame(memory);
    const net = new Error('net');
    const store = new RecordingStore(memory, {
      put: async ({ key }) => {
        throw new ObjectExistsError(key);
      },
      get: async () => {
        throw net;
      },
    });
    expect(await rejectionOf(new GameStateManager(store).commit(g, v1))).toBe(net);
  });

  it('a head.json put that rejects → commit resolves; loadLatest finds it by probing', async () => {
    const memory = new MemoryObjectStore();
    const { v1 } = await createdGame(memory);
    const store = new RecordingStore(memory, {
      put: async ({ key, body, opts }, inner) => {
        if (key === headKey(g)) throw new Error('head');
        return inner.put(key, body, opts);
      },
    });
    const manager = new GameStateManager(store);
    expect(await manager.commit(g, v1)).toEqual(toCommit(v1));
    expect(JSON.parse((await readText(memory, headKey(g)))!)).toEqual({
      schemaVersion: 1,
      version: 0,
    });
    expect(await manager.loadLatest(g)).toEqual(toCommit(v1));
  });
});
