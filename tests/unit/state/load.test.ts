// GameStateManager loading (spec 06 FR-602, FR-606–FR-610, BR-601; VC-603 loadMeta part,
// VC-609–VC-613, VC-614 load/loadLatest parts, VC-625 loadLatest part).
import { describe, expect, it } from 'vitest';
import { CommitNotFoundError, GameNotFoundError } from '@/src/state/errors';
import { GameStateManager } from '@/src/state/game-state-manager';
import { commitKey, commitsPrefix, headKey, metaKey } from '@/src/state/keys';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { CorruptObjectError, putJson } from '@/src/storage/object-store';
import {
  GAME_ID,
  makeChain,
  makeMeta,
  OTHER_GAME_ID,
  storeGame,
  toCommit,
} from './support/fixtures';
import { RecordingStore } from './support/store-wrappers';

const g = GAME_ID;

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

function expectCorrupt(err: unknown, key: string, issuePath: string): void {
  expect(err).toBeInstanceOf(CorruptObjectError);
  expect((err as CorruptObjectError).key).toBe(key);
  expect((err as CorruptObjectError).reason).toBe('schema');
  expect((err as CorruptObjectError).issuePath).toBe(issuePath);
}

describe('VC-603 / VC-609 — loadMeta', () => {
  it('returns the stored meta', async () => {
    const memory = new MemoryObjectStore();
    await storeGame(memory, { upTo: 0 });
    expect(await new GameStateManager(memory).loadMeta(g)).toEqual(makeMeta());
  });

  it('a missing meta → GameNotFoundError', async () => {
    const err = await rejectionOf(new GameStateManager(new MemoryObjectStore()).loadMeta(g));
    expect(err).toBeInstanceOf(GameNotFoundError);
    expect((err as GameNotFoundError).gameId).toBe(g);
  });

  it('a stored meta with schemaVersion 2 → CorruptObjectError reason schema', async () => {
    const memory = new MemoryObjectStore();
    await putJson(memory, metaKey(g), { ...makeMeta(), schemaVersion: 2 });
    const err = await rejectionOf(new GameStateManager(memory).loadMeta(g));
    expectCorrupt(err, metaKey(g), 'schemaVersion');
  });

  it('a meta stored under g whose gameId is another valid id → CorruptObjectError', async () => {
    const memory = new MemoryObjectStore();
    await putJson(memory, metaKey(g), makeMeta({ gameId: OTHER_GAME_ID }));
    const err = await rejectionOf(new GameStateManager(memory).loadMeta(g));
    expectCorrupt(err, metaKey(g), 'gameId');
  });
});

describe('VC-610 — tip discovery from every kind of hint, never writing', () => {
  const heads: [string, (store: MemoryObjectStore) => Promise<void>][] = [
    ['(a) exact {version: 5}', (s) => putJson(s, headKey(g), { schemaVersion: 1, version: 5 })],
    ['(b) behind {version: 2}', (s) => putJson(s, headKey(g), { schemaVersion: 1, version: 2 })],
    ['(c) ahead {version: 9}', (s) => putJson(s, headKey(g), { schemaVersion: 1, version: 9 })],
    ['(d) missing', async () => {}],
    ['(e) not json', (s) => s.put(headKey(g), 'not json')],
    ['(f) schemaVersion 2', (s) => putJson(s, headKey(g), { schemaVersion: 2, version: 5 })],
    [
      '(g) version 100000000',
      (s) => putJson(s, headKey(g), { schemaVersion: 1, version: 100_000_000 }),
    ],
  ];
  for (const [name, writeHead] of heads) {
    it(`${name} → commit 5, 0 puts`, async () => {
      const memory = new MemoryObjectStore();
      const commits = await storeGame(memory, { upTo: 5 });
      await writeHead(memory);
      const store = new RecordingStore(memory);
      expect(await new GameStateManager(store).loadLatest(g)).toEqual(commits[5]);
      expect(store.callsOf('put')).toEqual([]);
      expect(store.callsOf('delete')).toEqual([]);
    });
  }

  it('a head.json get rejecting Error(net) → loadLatest rejects with that object', async () => {
    const memory = new MemoryObjectStore();
    await storeGame(memory, { upTo: 5, head: 5 });
    const net = new Error('net');
    const store = new RecordingStore(memory, {
      get: async ({ key }, inner) => {
        if (key === headKey(g)) throw net;
        return inner.get(key);
      },
    });
    expect(await rejectionOf(new GameStateManager(store).loadLatest(g))).toBe(net);
  });

  it('head 2 with commit 2 holding not json → CorruptObjectError', async () => {
    const memory = new MemoryObjectStore();
    await storeGame(memory, { upTo: 5, head: 2, skip: [2] });
    await memory.put(commitKey(g, 2), 'not json');
    const err = await rejectionOf(new GameStateManager(memory).loadLatest(g));
    expect(err).toBeInstanceOf(CorruptObjectError);
    expect((err as CorruptObjectError).reason).toBe('invalid-json');
    expect((err as CorruptObjectError).key).toBe(commitKey(g, 2));
  });
});

describe('VC-611 — listing fallback without a hint', () => {
  it('list returns no keys → probes from 0 → commit 3', async () => {
    const memory = new MemoryObjectStore();
    const commits = await storeGame(memory, { upTo: 3 });
    const store = new RecordingStore(memory, { list: async () => ({ keys: [] }) });
    expect(await new GameStateManager(store).loadLatest(g)).toEqual(commits[3]);
    expect(store.callsOf('list')).toEqual([{ method: 'list', prefix: commitsPrefix(g) }]);
  });

  it('list returns commit 1 and a non-commit key → commit 3', async () => {
    const memory = new MemoryObjectStore();
    const commits = await storeGame(memory, { upTo: 3 });
    const store = new RecordingStore(memory, {
      list: async () => ({ keys: [commitKey(g, 1), `${commitsPrefix(g)}x`] }),
    });
    expect(await new GameStateManager(store).loadLatest(g)).toEqual(commits[3]);
    expect(store.callsOf('get').map((c) => c.key)).toContain(commitKey(g, 1));
    expect(store.callsOf('get').map((c) => c.key)).not.toContain(commitKey(g, 0));
  });

  it('every list page is read, and the highest listed commit is tried first', async () => {
    const memory = new MemoryObjectStore();
    const commits = await storeGame(memory, { upTo: 3 });
    const store = new RecordingStore(memory, {
      list: async ({ prefix, opts }) =>
        opts?.cursor === undefined
          ? { keys: [commitKey(g, 0), commitKey(g, 1)], cursor: commitKey(g, 1) }
          : { keys: [`${prefix}00000002.json`] },
    });
    expect(await new GameStateManager(store).loadLatest(g)).toEqual(commits[3]);
    expect(store.callsOf('list')).toHaveLength(2);
    const reads = store.callsOf('get').map((c) => c.key);
    expect(reads).toEqual([headKey(g), commitKey(g, 2), commitKey(g, 3)]);
  });
});

describe('VC-612 — partially created games', () => {
  it('meta missing with commits 0…2 → GameNotFoundError', async () => {
    const memory = new MemoryObjectStore();
    await storeGame(memory, { upTo: 2, meta: false });
    const manager = new GameStateManager(memory);
    await expect(manager.loadLatest(g)).rejects.toBeInstanceOf(GameNotFoundError);
  });

  it('commit 0 missing with meta and commits 1…2 → GameNotFoundError', async () => {
    const memory = new MemoryObjectStore();
    await storeGame(memory, { upTo: 2, skip: [0], head: 2 });
    const manager = new GameStateManager(memory);
    await expect(manager.loadLatest(g)).rejects.toBeInstanceOf(GameNotFoundError);
  });

  it('meta and commit 0 only → commit 0', async () => {
    const memory = new MemoryObjectStore();
    const commits = await storeGame(memory, { upTo: 0 });
    expect(await new GameStateManager(memory).loadLatest(g)).toEqual(commits[0]);
  });
});

describe('VC-613 — load a version', () => {
  it('load(g, 3) with commits 0…3 → commit 3', async () => {
    const memory = new MemoryObjectStore();
    const commits = await storeGame(memory, { upTo: 3 });
    expect(await new GameStateManager(memory).load(g, 3)).toEqual(commits[3]);
  });

  it('load(g, 0) → commit 0 with a single read', async () => {
    const memory = new MemoryObjectStore();
    const commits = await storeGame(memory, { upTo: 3 });
    const store = new RecordingStore(memory);
    expect(await new GameStateManager(store).load(g, 0)).toEqual(commits[0]);
    expect(store.calls).toEqual([{ method: 'get', key: commitKey(g, 0) }]);
  });

  it('load(g, 4) → CommitNotFoundError { version: 4 }', async () => {
    const memory = new MemoryObjectStore();
    await storeGame(memory, { upTo: 3 });
    const err = await rejectionOf(new GameStateManager(memory).load(g, 4));
    expect(err).toBeInstanceOf(CommitNotFoundError);
    expect(err).toMatchObject({ gameId: g, version: 4 });
  });

  it('load(g, -1) → RangeError, 0 store calls', async () => {
    const store = new RecordingStore(new MemoryObjectStore());
    await expect(new GameStateManager(store).load(g, -1)).rejects.toBeInstanceOf(RangeError);
    expect(store.calls).toEqual([]);
  });

  it('load on an unknown game → GameNotFoundError', async () => {
    const manager = new GameStateManager(new MemoryObjectStore());
    await expect(manager.load(g, 0)).rejects.toBeInstanceOf(GameNotFoundError);
    await expect(manager.load(g, 2)).rejects.toBeInstanceOf(GameNotFoundError);
  });

  it('an orphan commit without commit 0 is never returned → GameNotFoundError', async () => {
    const memory = new MemoryObjectStore();
    await storeGame(memory, { upTo: 2, skip: [0] });
    await expect(new GameStateManager(memory).load(g, 2)).rejects.toBeInstanceOf(GameNotFoundError);
  });
});

describe('VC-614 — commit identity checks (load, loadLatest)', () => {
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
    it(`load(g, 3) of a commit with a mismatched ${issuePath} → issuePath '${issuePath}'`, async () => {
      const memory = await gameWithBadCommit3(issuePath);
      const err = await rejectionOf(new GameStateManager(memory).load(g, 3));
      expectCorrupt(err, commitKey(g, 3), issuePath);
    });

    it(`loadLatest with that commit as the tip → issuePath '${issuePath}'`, async () => {
      const memory = await gameWithBadCommit3(issuePath);
      const err = await rejectionOf(new GameStateManager(memory).loadLatest(g));
      expectCorrupt(err, commitKey(g, 3), issuePath);
    });
  }
});

describe('VC-625 — loadLatest I/O budget with an exact hint', () => {
  it('commits 0…5, head 5 → 5 calls (3 then 2), 0 list', async () => {
    const memory = new MemoryObjectStore();
    await storeGame(memory, { upTo: 5, head: 5 });
    const store = new RecordingStore(memory);
    await new GameStateManager(store).loadLatest(g);
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
});
