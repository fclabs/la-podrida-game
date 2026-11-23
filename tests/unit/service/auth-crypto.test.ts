// Constant-time authentication over every hash (spec 07 FR-708; VC-710 call counts). One mocked
// module per file (plan P-11): `node:crypto`, with `timingSafeEqual` delegating to the original.
import * as crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PRESET_ID, getPreset } from '@/src/domain/presets';
import type { SeatInfo } from '@/src/domain/types';
import { createGame, ENGINE_VERSION, legalMoves } from '@/src/engine/engine';
import { evaluate } from '@/src/score/score-engine';
import { Unauthorized } from '@/src/service/errors';
import type { GameMeta } from '@/src/state/schemas';
import { CREATED_AT, GAME_ID } from '../state/support/fixtures';
import { makeService } from './support/service-fixtures';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const timingSafeEqualMock = vi.mocked(crypto.timingSafeEqual);

const TOKEN_0 = 'first-human-token';
const TOKEN_1 = 'second-human-token';

function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Seats 0 and 1 human, seat 2 AI. */
function twoHumanSeats(): SeatInfo[] {
  return [
    { seat: 0, playerId: 'human-0', name: 'Ana', kind: 'human' },
    { seat: 1, playerId: 'human-1', name: 'Bea', kind: 'human' },
    { seat: 2, playerId: 'ai-2', name: 'AI 2', kind: 'ai', strategy: 'random' },
  ];
}

/** A 3-seat, 2-human game written with `GameStateManager.create` directly. */
async function twoHumanGame() {
  const ctx = makeService();
  const seats = twoHumanSeats();
  const { state, events } = createGame({
    gameId: GAME_ID,
    rules: getPreset(DEFAULT_PRESET_ID),
    seats,
    seed: 'auth-crypto-seed',
  });
  const meta: GameMeta = {
    schemaVersion: 1,
    gameId: GAME_ID,
    presetId: DEFAULT_PRESET_ID,
    engineVersion: ENGINE_VERSION,
    createdAt: CREATED_AT,
    seats,
    seatTokenHashes: [sha256Hex(TOKEN_0), sha256Hex(TOKEN_1), null],
  };
  await ctx.state.create(meta, {
    version: 0,
    at: CREATED_AT,
    actorSeat: null,
    clientRequestId: null,
    events,
    state,
    scoreboard: evaluate(state),
  });
  return { ...ctx, initial: state };
}

beforeEach(() => {
  timingSafeEqualMock.mockClear();
});

describe('VC-710: timingSafeEqual runs once per non-null hash, whatever the outcome', () => {
  it('a token matching the first human hash: 2 calls, seat 0', async () => {
    const { service, initial } = await twoHumanGame();
    timingSafeEqualMock.mockClear();
    const update = await service.getUpdate(GAME_ID, TOKEN_0);
    expect(timingSafeEqualMock).toHaveBeenCalledTimes(2);
    expect(update.view.you).toBe(0);
    expect(update.legalMoves).toEqual(legalMoves(initial, 0));
  });

  it('a mismatching token: 2 calls, Unauthorized', async () => {
    const { service } = await twoHumanGame();
    timingSafeEqualMock.mockClear();
    const err = await service.getUpdate(GAME_ID, 'nobody').then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(Unauthorized);
    expect(timingSafeEqualMock).toHaveBeenCalledTimes(2);
  });

  it('a token matching the second human hash authenticates seat 1 (2 calls)', async () => {
    const { service, initial } = await twoHumanGame();
    timingSafeEqualMock.mockClear();
    const update = await service.getUpdate(GAME_ID, TOKEN_1);
    expect(timingSafeEqualMock).toHaveBeenCalledTimes(2);
    expect(update.view.you).toBe(1);
    expect(update.legalMoves).toEqual(legalMoves(initial, 1));
  });

  it('compares 32-byte digests', async () => {
    const { service } = await twoHumanGame();
    timingSafeEqualMock.mockClear();
    await service.getUpdate(GAME_ID, TOKEN_0);
    for (const [a, b] of timingSafeEqualMock.mock.calls) {
      expect((a as Uint8Array).length).toBe(32);
      expect((b as Uint8Array).length).toBe(32);
    }
  });
});
