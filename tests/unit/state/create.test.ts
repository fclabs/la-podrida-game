// GameStateManager creation (spec 06 FR-600, FR-604–FR-606; VC-601 manager part, VC-605–VC-608).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GameExistsError,
  GameNotFoundError,
  InvalidCommitError,
  InvalidGameIdError,
} from '@/src/state/errors';
import { GameStateManager } from '@/src/state/game-state-manager';
import { commitKey, headKey, indexCreatedKey, metaKey } from '@/src/state/keys';
import type { CommitBody, GameMeta } from '@/src/state/schemas';
import { FileObjectStore } from '@/src/storage/file-store';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { ObjectExistsError, type ObjectStore } from '@/src/storage/object-store';
import {
  GAME_ID,
  HUMAN_HASH,
  makeInitial,
  makeMeta,
  OTHER_GAME_ID,
  toCommit,
} from './support/fixtures';
import { RecordingStore } from './support/store-wrappers';

const g = GAME_ID;
const decoder = new TextDecoder();

async function allKeys(store: ObjectStore): Promise<string[]> {
  return (await store.list('')).keys;
}

async function readText(store: ObjectStore, key: string): Promise<string | null> {
  const stored = await store.get(key);
  return stored === null ? null : decoder.decode(stored.body);
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

describe('VC-601 — invalid gameId rejects before any I/O', () => {
  const cases: [string, (m: GameStateManager) => Promise<unknown>][] = [
    [
      'create (meta.gameId BAD, invalid body too)',
      (m) => m.create(makeMeta({ gameId: 'BAD' }), { ...makeInitial(), version: -5 }),
    ],
    ['loadMeta', (m) => m.loadMeta('BAD')],
    ['load', (m) => m.load('BAD', 0)],
    ['load (invalid version too)', (m) => m.load('BAD', -1)],
    ['loadLatest', (m) => m.loadLatest('BAD')],
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

describe('VC-605 — create writes the documented keys in order', () => {
  const createdAt = '2026-11-23T23:59:59.999Z';

  it('writes exactly the four keys, an empty marker and head 0', async () => {
    const memory = new MemoryObjectStore();
    const manager = new GameStateManager(memory);
    await manager.create(makeMeta({ createdAt }), makeInitial());
    expect(await allKeys(memory)).toEqual(
      [
        `index/created/2026-11-23/${g}`,
        `games/${g}/meta.json`,
        `games/${g}/commits/00000000.json`,
        `games/${g}/head.json`,
      ].sort(),
    );
    const marker = await memory.get(`index/created/2026-11-23/${g}`);
    expect(marker?.body.length).toBe(0);
    expect(JSON.parse((await readText(memory, headKey(g))) ?? '')).toEqual({
      schemaVersion: 1,
      version: 0,
    });
  });

  it('returns a Commit equal to load(g, 0) and loadLatest(g)', async () => {
    const manager = new GameStateManager(new MemoryObjectStore());
    const initial = makeInitial();
    const created = await manager.create(makeMeta({ createdAt }), initial);
    expect(created).toEqual(toCommit(initial));
    expect(await manager.load(g, 0)).toEqual(created);
    expect(await manager.loadLatest(g)).toEqual(created);
  });

  it('puts in FR-604 order: create-only ×3, then overwrite', async () => {
    const store = new RecordingStore(new MemoryObjectStore());
    await new GameStateManager(store).create(makeMeta({ createdAt }), makeInitial());
    expect(store.callsOf('put')).toEqual([
      { method: 'put', key: indexCreatedKey('2026-11-23', g), mode: 'create-only' },
      { method: 'put', key: metaKey(g), mode: 'create-only' },
      { method: 'put', key: commitKey(g, 0), mode: 'create-only' },
      { method: 'put', key: headKey(g), mode: 'overwrite' },
    ]);
  });

  it('stores the documents with keys in the documented order', async () => {
    const memory = new MemoryObjectStore();
    const meta = makeMeta({ createdAt });
    const initial = makeInitial();
    await new GameStateManager(memory).create(meta, initial);
    expect(Object.keys(JSON.parse((await readText(memory, metaKey(g))) ?? ''))).toEqual([
      'schemaVersion',
      'gameId',
      'presetId',
      'engineVersion',
      'createdAt',
      'seats',
      'seatTokenHashes',
    ]);
    expect(Object.keys(JSON.parse((await readText(memory, commitKey(g, 0))) ?? ''))).toEqual([
      'schemaVersion',
      'version',
      'at',
      'actorSeat',
      'clientRequestId',
      'events',
      'state',
      'scoreboard',
    ]);
  });
});

describe('P-11 — create and load on FileObjectStore', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('create then loadMeta/loadLatest round-trip in a temp folder', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lp-state-'));
    const manager = new GameStateManager(new FileObjectStore(dir));
    const meta = makeMeta();
    const created = await manager.create(meta, makeInitial());
    expect(await manager.loadMeta(g)).toEqual(meta);
    expect(await manager.loadLatest(g)).toEqual(created);
  });
});

describe('VC-606 — create validation failures write nothing', () => {
  const human = makeMeta().seats;
  const cases: [string, () => [GameMeta, CommitBody], string][] = [
    [
      'meta schema: a hash on an AI seat',
      () => [makeMeta({ seatTokenHashes: [HUMAN_HASH, HUMAN_HASH, null] }), makeInitial()],
      'meta-schema:seatTokenHashes.1',
    ],
    [
      'commit schema: v0 with a clientRequestId',
      () => [makeMeta(), { ...makeInitial(), clientRequestId: 'req-0' }],
      'commit-schema:clientRequestId',
    ],
    [
      'initial.version is not 0',
      () => [makeMeta(), { ...makeInitial(), version: 1, actorSeat: 0, clientRequestId: 'r' }],
      'initial-version',
    ],
    [
      'initial.state.version is not 0',
      () => {
        const initial = makeInitial();
        return [makeMeta(), { ...initial, state: { ...initial.state, version: 1 } }];
      },
      'initial-state-version',
    ],
    [
      'initial.state.gameId differs from meta.gameId',
      () => [makeMeta(), makeInitial(OTHER_GAME_ID)],
      'state-game-id',
    ],
    [
      'meta.seats differ from initial.state.seats',
      () => [
        makeMeta({ seats: human.map((s) => (s.seat === 1 ? { ...s, name: 'Bot' } : s)) }),
        makeInitial(),
      ],
      'seats-mismatch',
    ],
  ];
  for (const [name, build, reason] of cases) {
    it(`${name} → InvalidCommitError '${reason}', store empty`, async () => {
      const store = new RecordingStore(new MemoryObjectStore());
      const [meta, initial] = build();
      const err = await rejectionOf(new GameStateManager(store).create(meta, initial));
      expect(err).toBeInstanceOf(InvalidCommitError);
      expect((err as InvalidCommitError).reason).toBe(reason);
      expect(store.calls).toEqual([]);
      expect(await allKeys(store.inner)).toEqual([]);
    });
  }
});

describe('VC-607 — create absorbs existing objects (FR-605)', () => {
  it('a second create with a different createdAt → GameExistsError; first call wins', async () => {
    const memory = new MemoryObjectStore();
    const manager = new GameStateManager(memory);
    const first = makeMeta();
    const initial = makeInitial();
    await manager.create(first, initial);
    const metaBytes = await readText(memory, metaKey(g));
    const commitBytes = await readText(memory, commitKey(g, 0));

    const err = await rejectionOf(
      manager.create(makeMeta({ createdAt: '2026-11-24T10:00:00.000Z' }), initial),
    );
    expect(err).toBeInstanceOf(GameExistsError);
    expect((err as GameExistsError).gameId).toBe(g);
    expect(await readText(memory, metaKey(g))).toBe(metaBytes);
    expect(await readText(memory, commitKey(g, 0))).toBe(commitBytes);
    expect(await manager.loadMeta(g)).toEqual(first);
  });

  it('create twice with identical arguments → both resolve, one copy of each key', async () => {
    const memory = new MemoryObjectStore();
    const manager = new GameStateManager(memory);
    const a = await manager.create(makeMeta(), makeInitial());
    const b = await manager.create(makeMeta(), makeInitial());
    expect(b).toEqual(a);
    expect(await allKeys(memory)).toHaveLength(4);
  });

  it('only the marker pre-exists → create resolves and writes the other three keys', async () => {
    const memory = new MemoryObjectStore();
    const marker = indexCreatedKey('2026-11-23', g);
    await memory.put(marker, new Uint8Array(0));
    const created = await new GameStateManager(memory).create(makeMeta(), makeInitial());
    expect(await allKeys(memory)).toEqual([marker, metaKey(g), commitKey(g, 0), headKey(g)].sort());
    expect(created.version).toBe(0);
  });

  for (const [name, key] of [
    ['meta.json', metaKey(g)],
    ['commit 0', commitKey(g, 0)],
  ] as const) {
    it(`a retried ${name} put that landed (stores, then ObjectExistsError) → resolves`, async () => {
      const memory = new MemoryObjectStore();
      let retried = false;
      const store = new RecordingStore(memory, {
        put: async ({ key: k, body, opts }, inner) => {
          await inner.put(k, body, opts);
          if (k === key && !retried && (opts?.mode ?? 'create-only') === 'create-only') {
            retried = true;
            throw new ObjectExistsError(k);
          }
        },
      });
      const manager = new GameStateManager(store);
      const created = await manager.create(makeMeta(), makeInitial());
      expect(retried).toBe(true);
      expect(await manager.loadLatest(g)).toEqual(created);
      expect(store.callsOf('get').map((c) => c.key)).toContain(key);
    });
  }

  it('meta put → ObjectExistsError while the re-read returns null → GameExistsError', async () => {
    const memory = new MemoryObjectStore();
    const store = new RecordingStore(memory, {
      put: async ({ key, body, opts }, inner) => {
        if (key === metaKey(g)) throw new ObjectExistsError(key);
        await inner.put(key, body, opts);
      },
      get: async ({ key }, inner) => (key === metaKey(g) ? null : inner.get(key)),
    });
    const err = await rejectionOf(new GameStateManager(store).create(makeMeta(), makeInitial()));
    expect(err).toBeInstanceOf(GameExistsError);
    expect(store.callsOf('put').map((c) => c.key)).toEqual([
      indexCreatedKey('2026-11-23', g),
      metaKey(g),
    ]);
  });
});

describe('VC-608 — partial creates (FR-604, FR-606)', () => {
  function failingNthPut(n: number, error: Error): RecordingStore {
    let puts = 0;
    return new RecordingStore(new MemoryObjectStore(), {
      put: async ({ key, body, opts }, inner) => {
        puts++;
        if (puts === n) throw error;
        await inner.put(key, body, opts);
      },
    });
  }

  for (const n of [1, 2, 3]) {
    it(`put #${n} fails → create rejects with it; loadLatest → GameNotFoundError`, async () => {
      const boom = new Error('boom');
      const store = failingNthPut(n, boom);
      const manager = new GameStateManager(store);
      const meta = makeMeta();
      expect(await rejectionOf(manager.create(meta, makeInitial()))).toBe(boom);
      expect(store.callsOf('put')).toHaveLength(n);

      const reader = new GameStateManager(store.inner);
      await expect(reader.loadLatest(g)).rejects.toBeInstanceOf(GameNotFoundError);
      if (n <= 2) {
        await expect(reader.loadMeta(g)).rejects.toBeInstanceOf(GameNotFoundError);
      } else {
        expect(await reader.loadMeta(g)).toEqual(meta);
      }
    });
  }

  it('put #4 (head.json) fails → create resolves; loadLatest returns commit 0', async () => {
    const store = failingNthPut(4, new Error('boom'));
    const manager = new GameStateManager(store);
    const created = await manager.create(makeMeta(), makeInitial());
    expect(await store.inner.exists(headKey(g))).toBe(false);
    expect(await manager.loadLatest(g)).toEqual(created);
  });
});
