// GameService.createGame (spec 07 FR-700–FR-705; VC-701, VC-702, VC-703 second half, VC-704–VC-707,
// VC-708 createGame order case).
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getPreset, PRESET_IDS } from '@/src/domain/presets';
import type { SeatInfo } from '@/src/domain/types';
import { createGame, currentActor, ENGINE_VERSION, legalMoves } from '@/src/engine/engine';
import { evaluate } from '@/src/score/score-engine';
import { InvalidRequest } from '@/src/service/errors';
import type { CreateGameRequest } from '@/src/service/game-service';
import { buildPlayerView } from '@/src/service/player-view';
import { byteRange, FIXED_NOW, makeService, scriptedBytes } from './support/service-fixtures';

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Rejects with `InvalidRequest` naming `reason`. */
async function expectInvalid(promise: Promise<unknown>, reason: string): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(InvalidRequest);
  expect((err as InvalidRequest).reason).toBe(reason);
}

describe('VC-701: construction and the default preset', () => {
  it('constructing with only { state } performs no store call', () => {
    const { store } = makeService();
    expect(store.calls).toHaveLength(0);
  });

  it('without rulesPreset the meta has the default preset argentina-fidepo', async () => {
    const { service, state } = makeService();
    const { gameId } = await service.createGame({ humanName: 'Ana', aiCount: 3 });
    expect((await state.loadMeta(gameId)).presetId).toBe('argentina-fidepo');
  });

  it('with defaultPresetId gamerules the meta has gamerules', async () => {
    const { service, state } = makeService(undefined, { defaultPresetId: 'gamerules' });
    const { gameId } = await service.createGame({ humanName: 'Ana', aiCount: 3 });
    expect((await state.loadMeta(gameId)).presetId).toBe('gamerules');
  });
});

describe('VC-702: invalid createGame input is rejected before any I/O', () => {
  const cases: [string, CreateGameRequest, string][] = [
    ["humanName ''", { humanName: '', aiCount: 3 }, 'humanName'],
    ["humanName '   '", { humanName: '   ', aiCount: 3 }, 'humanName'],
    ['humanName of 41 characters', { humanName: 'x'.repeat(41), aiCount: 3 }, 'humanName'],
    ['humanName 42', { humanName: 42 as unknown as string, aiCount: 3 }, 'humanName'],
    ['aiCount 1', { humanName: 'Ana', aiCount: 1 }, 'aiCount'],
    ['aiCount 6', { humanName: 'Ana', aiCount: 6 }, 'aiCount'],
    ['aiCount 2.5', { humanName: 'Ana', aiCount: 2.5 }, 'aiCount'],
    ["aiCount '3'", { humanName: 'Ana', aiCount: '3' as unknown as number }, 'aiCount'],
    ["rulesPreset 'nope'", { humanName: 'Ana', aiCount: 3, rulesPreset: 'nope' }, 'rulesPreset'],
  ];

  it.each(cases)('%s → InvalidRequest, 0 store calls', async (_label, req, reason) => {
    const { service, store } = makeService();
    await expectInvalid(service.createGame(req), reason);
    expect(store.calls).toHaveLength(0);
  });

  it.each([
    ['1 character', 'x', 'x'],
    ['40 characters', 'y'.repeat(40), 'y'.repeat(40)],
    ["'  x  ' trimmed to 'x'", '  x  ', 'x'],
  ])('humanName of %s succeeds', async (_label, humanName, stored) => {
    const { service, state } = makeService();
    const { gameId } = await service.createGame({ humanName, aiCount: 3 });
    expect((await state.loadMeta(gameId)).seats[0].name).toBe(stored);
  });

  it.each([2, 5])('aiCount %i succeeds', async (aiCount) => {
    const { service, state } = makeService();
    const { gameId } = await service.createGame({ humanName: 'Ana', aiCount });
    expect((await state.loadMeta(gameId)).seats).toHaveLength(aiCount + 1);
  });
});

describe('VC-703 (unmocked half): every preset × aiCount 2–5', () => {
  const combos = PRESET_IDS.flatMap((presetId) =>
    [2, 3, 4, 5].map((aiCount) => [presetId, aiCount] as const),
  );

  it('covers 16 combinations', () => {
    expect(combos).toHaveLength(16);
  });

  it.each(combos)('%s with aiCount %i succeeds iff aiCount + 1 is in range', async (p, aiCount) => {
    const { players } = getPreset(p);
    const expected = aiCount + 1 >= players.min && aiCount + 1 <= players.max;
    const { service, state } = makeService();
    const outcome = await service.createGame({ humanName: 'Ana', aiCount, rulesPreset: p }).then(
      async ({ gameId }) => (await state.loadMeta(gameId)).presetId,
      (err: unknown) => err,
    );
    if (expected) {
      expect(outcome).toBe(p);
    } else {
      expect(outcome).toBeInstanceOf(InvalidRequest);
      expect((outcome as InvalidRequest).reason).toBe('aiCount');
    }
    // With the current presets every combination is valid.
    expect(expected).toBe(true);
  });
});

describe('VC-704: generated ids, seeds and tokens', () => {
  it('100 games with real randomness have well-formed, distinct secrets', async () => {
    const { service, state } = makeService();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const { gameId, seatToken } = await service.createGame({ humanName: 'Ana', aiCount: 2 });
      ids.add(gameId);
      expect(gameId).toMatch(/^[a-z2-7]{26}$/);
      expect(seatToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const [meta, commit0] = await Promise.all([state.loadMeta(gameId), state.load(gameId, 0)]);
      expect(commit0.state.seed).toMatch(/^[0-9a-f]{64}$/);
      expect(meta.seatTokenHashes[0]).toBe(sha256Hex(seatToken));
      expect(meta.seatTokenHashes.slice(1)).toEqual([null, null]);
    }
    expect(ids.size).toBe(100);
  });

  it('id bytes 0x00…0x0f encode to the known base32 literal; bytes are drawn 16, 32, 32', async () => {
    const seedBytes = byteRange(0x40, 32);
    const tokenBytes = byteRange(0x80, 32);
    const { service, state } = makeService(undefined, {
      randomBytes: scriptedBytes([byteRange(0, 16), seedBytes, tokenBytes]),
    });
    const { gameId, seatToken } = await service.createGame({ humanName: 'Ana', aiCount: 3 });
    expect(gameId).toBe('aaaqeayeaudaocajbifqydiob4');
    expect(seatToken).toBe(Buffer.from(tokenBytes).toString('base64url'));
    const commit0 = await state.load(gameId, 0);
    expect(commit0.state.seed).toBe(Buffer.from(seedBytes).toString('hex'));
  });
});

describe('VC-705: meta and commit 0 of a 4-player game', () => {
  it('match the expected seats, version, timestamps, events and scoreboard', async () => {
    const { service, state } = makeService();
    const { gameId } = await service.createGame({ humanName: '  Ana  ', aiCount: 3 });
    const [meta, commit0] = await Promise.all([state.loadMeta(gameId), state.load(gameId, 0)]);

    const seats: SeatInfo[] = [
      { seat: 0, playerId: 'human-0', name: 'Ana', kind: 'human' },
      { seat: 1, playerId: 'ai-1', name: 'AI 1', kind: 'ai', strategy: 'random' },
      { seat: 2, playerId: 'ai-2', name: 'AI 2', kind: 'ai', strategy: 'random' },
      { seat: 3, playerId: 'ai-3', name: 'AI 3', kind: 'ai', strategy: 'random' },
    ];
    expect(meta.gameId).toBe(gameId);
    expect(meta.seats).toEqual(seats);
    expect(meta.engineVersion).toBe(ENGINE_VERSION);
    expect(meta.presetId).toBe('argentina-fidepo');
    expect(meta.seatTokenHashes).toHaveLength(4);
    expect(meta.seatTokenHashes.slice(1)).toEqual([null, null, null]);
    expect(meta.createdAt).toBe(FIXED_NOW.toISOString());
    expect(commit0.at).toBe(FIXED_NOW.toISOString());
    expect(commit0.version).toBe(0);
    expect(commit0.actorSeat).toBeNull();
    expect(commit0.clientRequestId).toBeNull();
    expect(commit0.events.slice(0, 2).map((e) => e.type)).toEqual(['game-started', 'hand-dealt']);
    expect(commit0.state.version).toBe(0);
    expect(commit0.state.seats).toEqual(seats);
    expect(commit0.state.rules).toEqual(getPreset('argentina-fidepo'));
    expect(commit0.scoreboard).toEqual(evaluate(commit0.state));
  });
});

describe('VC-706: AIs that must bid first do so in commit 0', () => {
  it('over 50 seeds, commit 0 holds their bids and the human is to act', async () => {
    let aiFirst = 0;
    for (let i = 0; i < 50; i++) {
      const { service, state } = makeService(undefined, {
        randomBytes: scriptedBytes([byteRange(i, 16), byteRange(i * 7 + 1, 32), byteRange(9, 32)]),
      });
      const { gameId } = await service.createGame({ humanName: 'Ana', aiCount: 3 });
      const [meta, commit0] = await Promise.all([state.loadMeta(gameId), state.load(gameId, 0)]);
      const start = createGame({
        gameId,
        rules: getPreset('argentina-fidepo'),
        seats: meta.seats,
        seed: commit0.state.seed,
      });
      const first = currentActor(start.state);
      expect(first).not.toBeNull();
      if (first !== 0) {
        aiFirst++;
        const bids = commit0.events.filter((e) => e.type === 'bid-made');
        expect(bids.length).toBeGreaterThan(0);
        expect(bids[0]).toMatchObject({ seat: first });
        expect(bids.every((e) => e.type === 'bid-made' && e.seat !== 0)).toBe(true);
      }
      expect(currentActor(commit0.state)).toBe(0);
    }
    expect(aiFirst).toBeGreaterThan(0);
  });
});

describe('VC-707: the returned update is commit 0 for seat 0', () => {
  it('has version 0, commit 0 events, the seat-0 view and legal moves', async () => {
    const { service, state } = makeService();
    const created = await service.createGame({ humanName: 'Ana', aiCount: 3 });
    const commit0 = await state.load(created.gameId, 0);
    expect(created.seat).toBe(0);
    expect(created.update.version).toBe(0);
    expect(created.update.events).toEqual(commit0.events);
    expect(created.update.view).toEqual(buildPlayerView(commit0.state, 0));
    expect(created.update.legalMoves).toEqual(legalMoves(commit0.state, 0));
    expect(created.update.legalMoves.length).toBeGreaterThan(0);
  });
});

describe('VC-708 (createGame order): the first failing check wins', () => {
  it.each([
    ['bad humanName + bad aiCount', { humanName: '', aiCount: 1 }, 'humanName'],
    [
      'bad aiCount + bad rulesPreset',
      { humanName: 'Ana', aiCount: 9, rulesPreset: 'x' },
      'aiCount',
    ],
    [
      'bad rulesPreset (non-string)',
      { humanName: 'Ana', aiCount: 3, rulesPreset: 7 },
      'rulesPreset',
    ],
  ])('%s → reason %s', async (_label, req, reason) => {
    const { service, store } = makeService();
    await expectInvalid(service.createGame(req as unknown as CreateGameRequest), reason);
    expect(store.calls).toHaveLength(0);
  });
});
