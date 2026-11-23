// Random strategy (spec 04 FR-403, BR-402; VC-402).
import { describe, expect, it } from 'vitest';
import type { LegalMove, PlayerView } from '@/src/domain/types';
import { deriveRng } from '@/src/engine/rng';
import { randomStrategy } from '@/src/players/strategies/random';

const MOVES: LegalMove[] = [
  { id: 'play:AS', move: { type: 'play', seat: 0, card: { suit: 'S', rank: 'A' } } },
  { id: 'play:KH', move: { type: 'play', seat: 0, card: { suit: 'H', rank: 'K' } } },
  { id: 'play:2D', move: { type: 'play', seat: 0, card: { suit: 'D', rank: '2' } } },
];

const VIEW = { gameId: 'g', phase: 'playing' } as unknown as PlayerView;

describe('VC-402 randomStrategy', () => {
  it('is named random', () => {
    expect(randomStrategy.name).toBe('random');
  });

  it('returns moves[rng.int(0, n - 1)] for 20 seeds', () => {
    for (let i = 0; i < 20; i++) {
      const seed = `random-seed-${i}`;
      const chosen = randomStrategy.choose(VIEW, MOVES, deriveRng(seed, 'ai', 0, 0));
      expect(chosen).toBe(MOVES[deriveRng(seed, 'ai', 0, 0).int(0, 2)]);
    }
  });

  it('is uniform: 6,000 calls on one Rng choose each of 3 moves 1,800–2,200 times', () => {
    const rng = deriveRng('s', 'ai', 0, 0);
    const counts = [0, 0, 0];
    for (let i = 0; i < 6000; i++) {
      counts[MOVES.indexOf(randomStrategy.choose(VIEW, MOVES, rng))]++;
    }
    for (const count of counts) {
      expect(count).toBeGreaterThanOrEqual(1800);
      expect(count).toBeLessThanOrEqual(2200);
    }
  });

  it('never reads the view', () => {
    const throwing = new Proxy(
      {},
      {
        get: (_target, key) => {
          throw new Error(`view.${String(key)} was read`);
        },
        has: (_target, key) => {
          throw new Error(`'${String(key)}' in view was checked`);
        },
        ownKeys: () => {
          throw new Error('view keys were listed');
        },
      },
    ) as PlayerView;
    const chosen = randomStrategy.choose(throwing, MOVES, deriveRng('proxy', 'ai', 0, 0));
    expect(MOVES).toContain(chosen);
  });
});
