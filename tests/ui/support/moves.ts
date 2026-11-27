// Helpers for the move tests: hand-built legal moves, a stored slot for a fixture game, and a way
// to arm the in-process API with a fixed load response.
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { LegalMove, PlayerUpdate } from '@/src/domain/types';
import { type GameSlot, writeSlot } from '@/app/_client/slot';
import type { InProcessApi } from './in-process-api';

export const bid = (tricks: number): LegalMove => ({
  id: `bid:${tricks}`,
  move: { type: 'bid', seat: 0, tricks },
});

export const play = (rank: string, suit: string): LegalMove => ({
  id: `play:${rank}${suit}`,
  move: { type: 'play', seat: 0, card: { rank, suit } },
});

export const errorBody = (code: string) => ({ error: { code, message: 'x' } });

/** Stores a slot for fixture game `gameId` (token `tok`) and arms the next GET with `update`. */
export function armLoad(api: InProcessApi, update: PlayerUpdate, gameId = 'game-1'): GameSlot {
  const slot: GameSlot = { gameId, seatToken: 'tok', deck: 'french-52', finished: false };
  writeSlot(window.localStorage, slot);
  api.failNext({ status: 200, body: update }, { method: 'GET' });
  return slot;
}

/** Arms the next POST (move) with a fixed response. */
export function armMove(api: InProcessApi, status: number, body: unknown): void {
  api.failNext({ status, body }, { method: 'POST' });
}

/** Advances fake timers and flushes the promises that settle meanwhile. */
export async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

export const moveCalls = (api: InProcessApi) =>
  api.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/moves'));
