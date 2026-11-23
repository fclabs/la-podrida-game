// Seat ranking with tie-break and competition places (spec 03 FR-305, FR-306, BR-303; VC-307).
import { describe, expect, it } from 'vitest';
import { rankSeats } from '@/src/score/score-engine';

describe('VC-307 rankSeats', () => {
  it('fewest-misses breaks a tie on total', () => {
    expect(rankSeats([30, 25, 30], [2, 1, 1], 'fewest-misses')).toEqual([
      { seat: 2, total: 30, place: 1 },
      { seat: 0, total: 30, place: 2 },
      { seat: 1, total: 25, place: 3 },
    ]);
  });

  it('seats still tied after fewest-misses share a place (1, 1, 3, 4)', () => {
    expect(rankSeats([30, 30, 10, 30], [1, 1, 0, 2], 'fewest-misses')).toEqual([
      { seat: 0, total: 30, place: 1 },
      { seat: 1, total: 30, place: 1 },
      { seat: 3, total: 30, place: 3 },
      { seat: 2, total: 10, place: 4 },
    ]);
  });

  it('shared ignores misses (1, 1, 3)', () => {
    expect(rankSeats([30, 30, 10], [3, 0, 0], 'shared')).toEqual([
      { seat: 0, total: 30, place: 1 },
      { seat: 1, total: 30, place: 1 },
      { seat: 2, total: 10, place: 3 },
    ]);
  });

  it('all seats tied share place 1, listed by seat', () => {
    expect(rankSeats([0, 0, 0, 0], [0, 0, 0, 0], 'fewest-misses')).toEqual([
      { seat: 0, total: 0, place: 1 },
      { seat: 1, total: 0, place: 1 },
      { seat: 2, total: 0, place: 1 },
      { seat: 3, total: 0, place: 1 },
    ]);
  });

  it('arrays of unequal length → RangeError', () => {
    expect(() => rankSeats([1], [0, 0], 'shared')).toThrow(RangeError);
  });
});
