// Performance (spec 03 NFR-303, VC-314 timing part): `evaluate` on the final state of an
// argentina-fidepo 3-player game (29 completed hands), median of 101 timed calls after 10 untimed
// warm-up calls, must be < 1 ms.
import { describe, expect, it } from 'vitest';
import { evaluate } from '@/src/score/score-engine';
import { firstMove, newGame, playGame } from '../engine/helpers';

describe('NFR-303 evaluate performance', () => {
  it('median of 101 timed evaluate calls on a 29-hand final state < 1 ms', () => {
    const { final } = playGame(newGame('argentina-fidepo', 3, 'perf-seed'), firstMove);
    expect(final.completedHands).toHaveLength(29);
    for (let i = 0; i < 10; i++) evaluate(final); // untimed warm-up
    const times: number[] = [];
    for (let i = 0; i < 101; i++) {
      const t0 = performance.now();
      evaluate(final);
      times.push(performance.now() - t0);
    }
    const median = [...times].sort((a, b) => a - b)[50];
    console.log(`NFR-303: median ${(median * 1000).toFixed(1)} µs over 101 calls`);
    expect(median).toBeLessThan(1);
  });
});
