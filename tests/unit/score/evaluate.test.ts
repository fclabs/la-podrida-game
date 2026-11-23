// Scoreboard from a hand-built state (spec 03 FR-307, FR-308, FR-309, BR-302; VC-308 to VC-310).
import { describe, expect, it } from 'vitest';
import { GameStateSchema } from '@/src/domain/schemas';
import type { GameState } from '@/src/domain/types';
import { evaluate } from '@/src/score/score-engine';
import { argentinaPlan, makeState, result } from './helpers';

describe('score test helpers', () => {
  it('makeState builds schema-valid states', () => {
    expect(GameStateSchema.safeParse(makeState()).success).toBe(true);
    expect(GameStateSchema.safeParse(makeState({ players: 4 })).success).toBe(true);
    expect(GameStateSchema.safeParse(makeState({ hand: null })).success).toBe(true);
  });

  it('argentinaPlan matches the spec 02 hand plans', () => {
    expect(argentinaPlan(3)).toHaveLength(29);
    expect(argentinaPlan(4)).toHaveLength(22);
    expect(argentinaPlan(3).slice(0, 2)).toEqual([17, 16]);
  });
});

describe('VC-308 evaluate builds the score sheet, totals, counts and ranking', () => {
  it('two completed hands, a tie on total decided by fewer misses', () => {
    const state = makeState({
      completedHands: [result(0, 17, [5, 1, 10], [5, 1, 11]), result(1, 16, [4, 3, 8], [4, 4, 8])],
    });
    expect(state.handIndex).toBe(2);
    expect(state.phase).toBe('bidding');
    const board = evaluate(state);
    expect(board.hands).toEqual([
      {
        handIndex: 0,
        perSeat: [
          { seat: 0, bid: 5, tricks: 5, made: true, points: 15 },
          { seat: 1, bid: 1, tricks: 1, made: true, points: 11 },
          { seat: 2, bid: 10, tricks: 11, made: false, points: 11 },
        ],
      },
      {
        handIndex: 1,
        perSeat: [
          { seat: 0, bid: 4, tricks: 4, made: true, points: 14 },
          { seat: 1, bid: 3, tricks: 4, made: false, points: 4 },
          { seat: 2, bid: 8, tricks: 8, made: true, points: 18 },
        ],
      },
    ]);
    expect(board.totals).toEqual([29, 15, 29]);
    expect(board.madeCount).toEqual([2, 1, 1]);
    expect(board.missedCount).toEqual([0, 1, 1]);
    expect(board.ranking).toEqual([
      { seat: 0, total: 29, place: 1 },
      { seat: 2, total: 29, place: 2 },
      { seat: 1, total: 15, place: 3 },
    ]);
  });

  it('no completed hands → empty sheet, zero totals, everyone in place 1', () => {
    const board = evaluate(makeState());
    expect(board.hands).toEqual([]);
    expect(board.totals).toEqual([0, 0, 0]);
    expect(board.madeCount).toEqual([0, 0, 0]);
    expect(board.missedCount).toEqual([0, 0, 0]);
    expect(board.ranking).toEqual([
      { seat: 0, total: 0, place: 1 },
      { seat: 1, total: 0, place: 1 },
      { seat: 2, total: 0, place: 1 },
    ]);
  });
});

describe('VC-309 evaluate live status of the hand in progress', () => {
  it('playing hand: made-so-far, busted (too few left), busted (too many), on-track', () => {
    const state = makeState({
      players: 4,
      phase: 'playing',
      hand: { cardsPerPlayer: 5, bids: [2, 3, 0, 1], tricksWon: [2, 0, 1, 0] },
    });
    expect(evaluate(state).live).toEqual([
      { seat: 0, bid: 2, tricksWon: 2, status: 'made-so-far' },
      { seat: 1, bid: 3, tricksWon: 0, status: 'busted' },
      { seat: 2, bid: 0, tricksWon: 1, status: 'busted' },
      { seat: 3, bid: 1, tricksWon: 0, status: 'on-track' },
    ]);
  });

  it('bidding hand: every seat on-track, null bids copied', () => {
    const state = makeState({
      players: 4,
      hand: { cardsPerPlayer: 5, bids: [1, null, null, null], tricksWon: [0, 0, 0, 0] },
    });
    expect(evaluate(state).live).toEqual([
      { seat: 0, bid: 1, tricksWon: 0, status: 'on-track' },
      { seat: 1, bid: null, tricksWon: 0, status: 'on-track' },
      { seat: 2, bid: null, tricksWon: 0, status: 'on-track' },
      { seat: 3, bid: null, tricksWon: 0, status: 'on-track' },
    ]);
  });

  it('game over (hand null) → no live key at all', () => {
    const board = evaluate(makeState({ hand: null }));
    expect(board.live).toBeUndefined();
    expect('live' in board).toBe(false);
  });
});

/** A valid first completed hand for a 3-seat game (hand 0 has 17 cards per player). */
const VALID_HAND_0 = result(0, 17, [5, 1, 10], [5, 1, 11]);

describe('VC-310 evaluate rejects malformed hand data with its location', () => {
  it.each<[string, GameState, string, RegExp]>([
    [
      'completedHands[0] with 2 bids',
      makeState({ completedHands: [result(0, 17, [5, 1], [5, 1, 11])] }),
      'state.completedHands[0]: ',
      /bids must have length 3, got 2/,
    ],
    [
      'completedHands[1] whose tricks sum ≠ cardsPerPlayer',
      makeState({ completedHands: [VALID_HAND_0, result(1, 16, [4, 3, 8], [4, 4, 7])] }),
      'state.completedHands[1]: ',
      /handIndex 1: sum\(tricks\) must equal cardsPerPlayer 16, got 15/,
    ],
    [
      'hand with tricksWon of length 2',
      makeState({ hand: { tricksWon: [0, 0] } }),
      'state.hand: ',
      /tricksWon must have length 3, got 2/,
    ],
    [
      'hand with a tricksWon entry of -1',
      makeState({ hand: { tricksWon: [0, -1, 0] } }),
      'state.hand: ',
      /tricksWon\[1\] must be a non-negative integer, got -1/,
    ],
    [
      'hand with cardsPerPlayer 0',
      makeState({ hand: { cardsPerPlayer: 0 } }),
      'state.hand: ',
      /cardsPerPlayer must be an integer >= 1, got 0/,
    ],
    [
      'hand with sum(tricksWon) = cardsPerPlayer + 1',
      makeState({ phase: 'playing', hand: { cardsPerPlayer: 3, tricksWon: [2, 1, 1] } }),
      'state.hand: ',
      /sum\(tricksWon\) must be <= cardsPerPlayer 3, got 4/,
    ],
    [
      'hand with a bid of cardsPerPlayer + 1',
      makeState({ hand: { cardsPerPlayer: 3, bids: [null, 4, null] } }),
      'state.hand: ',
      /bids\[1\] must be null or an integer in 0…3, got 4/,
    ],
  ])('%s → RangeError at the location', (_, state, prefix, check) => {
    let caught: unknown;
    try {
      evaluate(state);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RangeError);
    const { message } = caught as RangeError;
    expect(message.startsWith(prefix)).toBe(true);
    expect(message).toMatch(check);
  });
});
