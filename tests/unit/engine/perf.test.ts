// Performance (spec 02 NFR-203, VC-236 timing part): one full argentina-fidepo 3-player game
// (29 hands) by first legal move, `legalMoves` before every move, median of 5 timed runs of the
// move loop only (after `createGame`), after one untimed warm-up game, must be < 250 ms.
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/src/domain/types';
import { applyMove, currentActor, legalMoves } from '@/src/engine/engine';
import { newGame } from './helpers';

/** Plays `state` to game over by first legal move; returns the number of moves. */
function moveLoop(start: GameState): number {
  let state = start;
  let moves = 0;
  for (let seat = currentActor(state); seat !== null; seat = currentActor(state)) {
    state = applyMove(state, seat, legalMoves(state, seat)[0].id).state;
    moves++;
  }
  return moves;
}

describe('NFR-203 full-game performance', () => {
  it('median of 5 timed argentina-fidepo 3-player games < 250 ms', () => {
    moveLoop(newGame('argentina-fidepo', 3, 'perf-seed').state); // untimed warm-up
    const times: number[] = [];
    let moves = 0;
    for (let run = 0; run < 5; run++) {
      const { state } = newGame('argentina-fidepo', 3, 'perf-seed');
      const t0 = performance.now();
      moves = moveLoop(state);
      times.push(performance.now() - t0);
    }
    const median = [...times].sort((a, b) => a - b)[2];
    console.log(
      `NFR-203: ${moves} moves; runs ${times.map((t) => t.toFixed(1)).join(', ')} ms; median ${median.toFixed(1)} ms`,
    );
    // 29 hands × 3 bids + every card dealt (3 × sum(handPlan)) is played once.
    const { handPlan } = newGame('argentina-fidepo', 3, 'perf-seed').state;
    expect(handPlan).toHaveLength(29);
    expect(moves).toBe(29 * 3 + 3 * handPlan.reduce((a, b) => a + b, 0));
    expect(median).toBeLessThan(250);
  });
});
