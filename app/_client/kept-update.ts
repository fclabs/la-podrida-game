import type { PlayerUpdate } from '@/src/domain/types';

// The 201 update of a new game, handed from `/` to the game page in memory (FR-902, plan P-4).
let kept: { gameId: string; update: PlayerUpdate } | null = null;

/** Keeps `update` for `gameId`, replacing any earlier one. */
export function keepUpdate(gameId: string, update: PlayerUpdate): void {
  kept = { gameId, update };
}

/** The kept update when it belongs to `gameId`, else `null`. Clears the slot in both cases. */
export function takeKeptUpdate(gameId: string): PlayerUpdate | null {
  const current = kept;
  kept = null;
  return current !== null && current.gameId === gameId ? current.update : null;
}
