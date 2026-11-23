// Live status of a seat in the hand in progress (spec 03 FR-304; VC-306).
import { describe, expect, it } from 'vitest';
import { liveStatus, type LiveStatus } from '@/src/score/score-engine';

describe('VC-306 liveStatus', () => {
  it.each([
    [null, 0, 5, 'on-track'],
    [2, 2, 1, 'made-so-far'],
    [0, 0, 3, 'made-so-far'],
    [1, 2, 1, 'busted'],
    [3, 0, 2, 'busted'],
    [3, 1, 2, 'on-track'],
    [3, 1, 1, 'busted'],
    [2, 2, 0, 'made-so-far'],
  ] as [number | null, number, number, LiveStatus][])(
    'bid %s, tricksWon %i, tricksLeft %i → %s',
    (bid, tricksWon, tricksLeft, expected) => {
      expect(liveStatus(bid, tricksWon, tricksLeft)).toBe(expected);
    },
  );

  it.each([
    [1, -1, 0, 'tricksWon', '-1'],
    [1.5, 0, 0, 'bid', '1.5'],
  ])(
    'bid %s, tricksWon %s, tricksLeft %s → RangeError',
    (bid, tricksWon, tricksLeft, name, shown) => {
      expect(() => liveStatus(bid, tricksWon, tricksLeft)).toThrow(RangeError);
      expect(() => liveStatus(bid, tricksWon, tricksLeft)).toThrow(name);
      expect(() => liveStatus(bid, tricksWon, tricksLeft)).toThrow(shown);
    },
  );
});
