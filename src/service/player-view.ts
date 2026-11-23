import type { GameState, PlayerView } from '@/src/domain/types';
import { tableViewFor } from '@/src/engine/view';
import { evaluate } from '@/src/score/score-engine';

/**
 * The view of `seat` (or a spectator) (FR-406, FR-407): the engine's table view plus the
 * scoreboard, and `finalRanking` (the scoreboard's ranking) only at game over — before that the
 * property is absent, never `undefined`. The only place in `src` that builds a `PlayerView`.
 * Throws `RangeError` for a seat outside `0 … N − 1` (from `tableViewFor`).
 */
export function buildPlayerView(state: GameState, seat: number | 'spectator'): PlayerView {
  const scoreboard = evaluate(state);
  const view: PlayerView = { ...tableViewFor(state, seat), scoreboard };
  if (state.phase === 'game-over') view.finalRanking = scoreboard.ranking;
  return view;
}
