// GameStateManager events and final scores (spec 06 FR-610, FR-615–FR-617; VC-614 eventsSince
// part, VC-619, VC-620).
import { describe, expect, it } from 'vitest';
import type { GameEvent, ScoreBoard } from '@/src/domain/types';
import { CommitNotFoundError, GameNotFoundError, InvalidCommitError } from '@/src/state/errors';
import { GameStateManager } from '@/src/state/game-state-manager';
import { commitKey, finalScoresKey, headKey, metaKey } from '@/src/state/keys';
import type { Commit, CommitBody } from '@/src/state/schemas';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { CorruptObjectError, putJson, type ObjectStore } from '@/src/storage/object-store';
import {
  GAME_ID,
  makeChain,
  makeCommitBody,
  makeInitial,
  makeMeta,
  OTHER_GAME_ID,
  storeGame,
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

function bid(seat: number, tricks: number): GameEvent {
  return { type: 'bid-made', seat, tricks };
}

/**
 * Stores meta and commits 0…n of `g` directly, commit `v` holding `eventsOf(v)`, plus `head.json`
 * at `head`. Returns the stored commits.
 */
async function storeWithEvents(
  store: ObjectStore,
  upTo: number,
  eventsOf: (v: number) => GameEvent[],
  head: number,
): Promise<Commit[]> {
  const initial: CommitBody = { ...makeInitial(), events: eventsOf(0) };
  const bodies = [initial];
  for (let n = 1; n <= upTo; n++) bodies.push(makeCommitBody(bodies[n - 1], n, eventsOf(n)));
  const commits = bodies.map(toCommit);
  await putJson(store, metaKey(g), makeMeta());
  for (const commit of commits) await putJson(store, commitKey(g, commit.version), commit);
  await putJson(store, headKey(g), { schemaVersion: 1, version: head });
  return commits;
}

describe('VC-619 — eventsSince', () => {
  const e0a = bid(0, 0);
  const e0b = bid(1, 1);
  const e1 = bid(2, 2);
  const e3a = bid(0, 3);
  const e3b = bid(1, 4);
  const e4 = bid(2, 5);
  const byVersion: GameEvent[][] = [[e0a, e0b], [e1], [], [e3a, e3b], [e4]];

  async function fiveCommits(): Promise<{ memory: MemoryObjectStore; manager: GameStateManager }> {
    const memory = new MemoryObjectStore();
    await storeWithEvents(memory, 4, (v) => byVersion[v], 4);
    return { memory, manager: new GameStateManager(memory) };
  }

  it('eventsSince(g, 0) → [e1, e3a, e3b, e4]', async () => {
    const { manager } = await fiveCommits();
    expect(await manager.eventsSince(g, 0)).toEqual([e1, e3a, e3b, e4]);
  });

  it('eventsSince(g, 3) → [e4]', async () => {
    const { manager } = await fiveCommits();
    expect(await manager.eventsSince(g, 3)).toEqual([e4]);
  });

  it('eventsSince(g, 4) → [] (at the tip)', async () => {
    const { manager } = await fiveCommits();
    expect(await manager.eventsSince(g, 4)).toEqual([]);
  });

  it('eventsSince(g, 9) → [] (past the tip)', async () => {
    const { manager } = await fiveCommits();
    expect(await manager.eventsSince(g, 9)).toEqual([]);
  });

  for (const version of [-1, 1.5]) {
    it(`eventsSince(g, ${version}) → RangeError naming version, 0 store calls`, async () => {
      const memory = new MemoryObjectStore();
      await storeWithEvents(memory, 4, (v) => byVersion[v], 4);
      const store = new RecordingStore(memory);
      const err = await rejectionOf(new GameStateManager(store).eventsSince(g, version));
      expect(err).toBeInstanceOf(RangeError);
      expect((err as RangeError).message).toContain('version');
      expect(store.calls).toEqual([]);
    });
  }

  it('commit 2 deleted afterwards (head 4) → CommitNotFoundError { version: 2 }', async () => {
    const { memory, manager } = await fiveCommits();
    await memory.delete([commitKey(g, 2)]);
    const err = await rejectionOf(manager.eventsSince(g, 0));
    expect(err).toBeInstanceOf(CommitNotFoundError);
    expect(err).toMatchObject({ gameId: g, version: 2 });
  });

  it('an unknown game → GameNotFoundError', async () => {
    const manager = new GameStateManager(new MemoryObjectStore());
    expect(await rejectionOf(manager.eventsSince(g, 0))).toBeInstanceOf(GameNotFoundError);
  });

  it('commits 0…40: the 40 commits’ events in order, at most 8 commit reads in flight', async () => {
    const memory = new MemoryObjectStore();
    const eventsOf = (v: number): GameEvent[] => [bid(v % 3, v)];
    await storeWithEvents(memory, 40, eventsOf, 40);
    let inFlight = 0;
    let maxCommitReads = 0;
    const store = new RecordingStore(memory, {
      get: async ({ key }, inner) => {
        const isCommit = key.includes('/commits/');
        if (isCommit) maxCommitReads = Math.max(maxCommitReads, ++inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return await inner.get(key);
        } finally {
          if (isCommit) inFlight--;
        }
      },
    });
    const events = await new GameStateManager(store).eventsSince(g, 0);
    expect(events).toEqual(Array.from({ length: 40 }, (_, i) => eventsOf(i + 1)[0]));
    expect(maxCommitReads).toBeLessThanOrEqual(8);
    expect(store.maxConcurrentGets).toBeLessThanOrEqual(8);
    // The bound is reached: reads really run in parallel.
    expect(maxCommitReads).toBe(8);
    // Commits 1…39 read once each, plus the tip read by the probe.
    const commitGets = store.callsOf('get').filter((c) => c.key!.includes('/commits/'));
    expect(commitGets).toHaveLength(40);
  });
});

describe('VC-614 — commit identity checks (eventsSince)', () => {
  async function gameWithBadCommit3(
    mutate: 'version' | 'state.gameId',
  ): Promise<MemoryObjectStore> {
    const memory = new MemoryObjectStore();
    await storeGame(memory, { upTo: 3, head: 3, skip: [3] });
    const chain = makeChain(4);
    const bad =
      mutate === 'version'
        ? toCommit(chain[4])
        : toCommit({ ...chain[3], state: { ...chain[3].state, gameId: OTHER_GAME_ID } });
    await putJson(memory, commitKey(g, 3), bad);
    return memory;
  }

  for (const issuePath of ['version', 'state.gameId'] as const) {
    it(`eventsSince(g, 2) with a mismatched ${issuePath} at the tip → issuePath '${issuePath}'`, async () => {
      const memory = await gameWithBadCommit3(issuePath);
      const err = await rejectionOf(new GameStateManager(memory).eventsSince(g, 2));
      expect(err).toBeInstanceOf(CorruptObjectError);
      expect(err).toMatchObject({ key: commitKey(g, 3), reason: 'schema', issuePath });
    });
  }

  it('a mismatched commit inside the range (not the tip) also rejects', async () => {
    const memory = new MemoryObjectStore();
    await storeGame(memory, { upTo: 4, head: 4, skip: [2] });
    const chain = makeChain(3);
    await putJson(memory, commitKey(g, 2), toCommit(chain[3]));
    const err = await rejectionOf(new GameStateManager(memory).eventsSince(g, 0));
    expect(err).toBeInstanceOf(CorruptObjectError);
    expect(err).toMatchObject({ key: commitKey(g, 2), reason: 'schema', issuePath: 'version' });
  });
});

describe('VC-620 — writeFinalScores / readFinalScores', () => {
  const board: ScoreBoard = makeInitial().scoreboard;

  it('writes exactly the documented document; readFinalScores returns it', async () => {
    const memory = new MemoryObjectStore();
    const manager = new GameStateManager(memory);
    await manager.writeFinalScores(g, 7, board);
    const read = await manager.readFinalScores(g);
    expect(read).toStrictEqual({
      schemaVersion: 1,
      gameId: g,
      version: 7,
      ranking: board.ranking,
      totals: board.totals,
      madeCount: board.madeCount,
      missedCount: board.missedCount,
    });
    const stored = await memory.get(finalScoresKey(g));
    expect(Object.keys(JSON.parse(decoder.decode(stored!.body)) as object)).toEqual([
      'schemaVersion',
      'gameId',
      'version',
      'ranking',
      'totals',
      'madeCount',
      'missedCount',
    ]);
  });

  it('a second call with a different board resolves and leaves the file unchanged', async () => {
    const memory = new MemoryObjectStore();
    const manager = new GameStateManager(memory);
    await manager.writeFinalScores(g, 7, board);
    const before = (await memory.get(finalScoresKey(g)))!.body;
    const other: ScoreBoard = { ...board, totals: board.totals.map((t) => t + 5) };
    await expect(manager.writeFinalScores(g, 8, other)).resolves.toBeUndefined();
    expect((await memory.get(finalScoresKey(g)))!.body).toEqual(before);
  });

  it('a store that rejects every put → resolves', async () => {
    const store = new RecordingStore(new MemoryObjectStore(), {
      put: async () => {
        throw new Error('boom');
      },
    });
    await expect(
      new GameStateManager(store).writeFinalScores(g, 7, board),
    ).resolves.toBeUndefined();
    expect(store.callsOf('put')).toEqual([
      { method: 'put', key: finalScoresKey(g), mode: 'create-only' },
    ]);
  });

  const invalid: [string, number, unknown, string][] = [
    ["an invalid board (totals: 'x')", 7, { ...board, totals: 'x' }, 'board-schema:totals'],
    ['version -1', -1, board, 'final-version'],
    ['version 1.5', 1.5, board, 'final-version'],
  ];
  for (const [name, version, value, reason] of invalid) {
    it(`${name} → InvalidCommitError '${reason}', 0 store calls`, async () => {
      const store = new RecordingStore(new MemoryObjectStore());
      const err = await rejectionOf(
        new GameStateManager(store).writeFinalScores(g, version, value as ScoreBoard),
      );
      expect(err).toBeInstanceOf(InvalidCommitError);
      expect((err as InvalidCommitError).reason).toBe(reason);
      expect(store.calls).toEqual([]);
    });
  }

  it('readFinalScores on a missing file → null', async () => {
    expect(await new GameStateManager(new MemoryObjectStore()).readFinalScores(g)).toBeNull();
  });

  it('readFinalScores on `not json` → CorruptObjectError', async () => {
    const memory = new MemoryObjectStore();
    await memory.put(finalScoresKey(g), 'not json');
    const err = await rejectionOf(new GameStateManager(memory).readFinalScores(g));
    expect(err).toBeInstanceOf(CorruptObjectError);
    expect(err).toMatchObject({ key: finalScoresKey(g), reason: 'invalid-json' });
  });

  it('readFinalScores of a file naming another game → CorruptObjectError gameId', async () => {
    const memory = new MemoryObjectStore();
    await new GameStateManager(memory).writeFinalScores(OTHER_GAME_ID, 7, board);
    const stored = await memory.get(finalScoresKey(OTHER_GAME_ID));
    await memory.put(finalScoresKey(g), stored!.body);
    const err = await rejectionOf(new GameStateManager(memory).readFinalScores(g));
    expect(err).toBeInstanceOf(CorruptObjectError);
    expect(err).toMatchObject({ key: finalScoresKey(g), reason: 'schema', issuePath: 'gameId' });
  });
});
