import type { AIStrategy } from '../player';

/**
 * The random strategy (FR-403): one draw `rng.int(0, moves.length - 1)`, uniform over all legal
 * moves (bids and plays alike). It never reads the view.
 */
export const randomStrategy: AIStrategy = {
  name: 'random',
  choose: (_view, moves, rng) => moves[rng.int(0, moves.length - 1)],
};
