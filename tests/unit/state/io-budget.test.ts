// Store-call budgets (spec 06 NFR-602; VC-625 in full), measured with a counting wrapper over
// MemoryObjectStore with commits 0…5 and head.json at 5.
import { describe, expect, it } from 'vitest';
import { GameStateManager } from '@/src/state/game-state-manager';
import { commitKey, headKey, metaKey } from '@/src/state/keys';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { makeCommitBody, GAME_ID, storeGame, toCommit } from './support/fixtures';
import { RecordingStore } from './support/store-wrappers';

const g = GAME_ID;

async function sixCommits(): Promise<{
  store: RecordingStore;
  manager: GameStateManager;
  commits: Awaited<ReturnType<typeof storeGame>>;
}> {
  const memory = new MemoryObjectStore();
  const commits = await storeGame(memory, { upTo: 5, head: 5 });
  const store = new RecordingStore(memory);
  return { store, manager: new GameStateManager(store), commits };
}

describe('VC-625 — store-call budgets', () => {
  it('loadLatest = 5 calls (3 then 2), 0 list', async () => {
    const { store, manager, commits } = await sixCommits();
    expect(await manager.loadLatest(g)).toEqual(commits[5]);
    expect(store.calls).toHaveLength(5);
    expect(store.calls.slice(0, 3)).toEqual(
      expect.arrayContaining([
        { method: 'exists', key: metaKey(g) },
        { method: 'exists', key: commitKey(g, 0) },
        { method: 'get', key: headKey(g) },
      ]),
    );
    expect(store.calls.slice(3)).toEqual(
      expect.arrayContaining([
        { method: 'get', key: commitKey(g, 5) },
        { method: 'exists', key: commitKey(g, 6) },
      ]),
    );
    expect(store.callsOf('list')).toEqual([]);
  });

  it('eventsSince(g, 2) = 7 calls (5 + t − v − 1), 0 list', async () => {
    const { store, manager } = await sixCommits();
    expect(await manager.eventsSince(g, 2)).toEqual([]);
    expect(store.calls).toHaveLength(7);
    expect(store.calls.slice(5).map((c) => c.key)).toEqual(
      expect.arrayContaining([commitKey(g, 3), commitKey(g, 4)]),
    );
    expect(store.callsOf('get')).toHaveLength(4);
    expect(store.callsOf('list')).toEqual([]);
  });

  it('commit of v6 without a conflict = 2 put calls (create-only, then overwrite)', async () => {
    const { store, manager, commits } = await sixCommits();
    const v6 = makeCommitBody(commits[5], 6);
    expect(await manager.commit(g, v6)).toEqual(toCommit(v6));
    expect(store.calls).toEqual([
      { method: 'put', key: commitKey(g, 6), mode: 'create-only' },
      { method: 'put', key: headKey(g), mode: 'overwrite' },
    ]);
  });
});
