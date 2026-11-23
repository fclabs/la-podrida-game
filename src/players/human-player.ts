import type { Player } from './player';

/** A human player (FR-401): `requestDecision` always returns `{ type: 'await' }`. */
export function createHumanPlayer(seat: number, name: string): Player {
  return {
    seat,
    name,
    kind: 'human',
    requestDecision: () => ({ type: 'await' }),
  };
}
