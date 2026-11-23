// Hand score and its shape checks (spec 03 FR-302, FR-303, FR-310; VC-304, VC-305).
import { describe, expect, it } from 'vitest';
import { getPreset } from '@/src/domain/presets';
import type { HandResult } from '@/src/domain/types';
import { scoreHand } from '@/src/score/score-engine';
import { result } from './helpers';

const ARGENTINA = getPreset('argentina-fidepo');

describe('VC-304 scoreHand', () => {
  it('scores every seat of an argentina-fidepo hand in seat order', () => {
    expect(
      scoreHand(ARGENTINA, {
        handIndex: 4,
        cardsPerPlayer: 3,
        dealer: 2,
        trumpSuit: 'S',
        bids: [1, 0, 1],
        tricks: [1, 1, 1],
      }),
    ).toEqual({
      handIndex: 4,
      perSeat: [
        { seat: 0, bid: 1, tricks: 1, made: true, points: 11 },
        { seat: 1, bid: 0, tricks: 1, made: false, points: 1 },
        { seat: 2, bid: 1, tricks: 1, made: true, points: 11 },
      ],
    });
  });
});

describe('VC-305 scoreHand rejects malformed hand results', () => {
  it.each<[string, HandResult, RegExp]>([
    ['bids length 3, tricks length 2', result(7, 3, [1, 1, 1], [2, 1]), /equal length/],
    ['empty bids and tricks', result(7, 3, [], []), /must not be empty/],
    ['cardsPerPlayer 0', result(7, 0, [0, 0, 0], [0, 0, 0]), /cardsPerPlayer/],
    ['a bid of 4 with cardsPerPlayer 3', result(7, 3, [4, 0, 0], [1, 1, 1]), /bids\[0\].*got 4/],
    [
      'a null bid',
      result(7, 3, [1, null as unknown as number, 1], [1, 1, 1]),
      /bids\[1\].*got null/,
    ],
    ['a trick of -1', result(7, 3, [1, 1, 1], [2, 2, -1]), /tricks\[2\].*got -1/],
    ['tricks summing to cardsPerPlayer - 1', result(7, 3, [1, 1, 1], [1, 1, 0]), /sum\(tricks\)/],
  ])('%s → RangeError naming handIndex 7', (_, bad, check) => {
    expect(() => scoreHand(ARGENTINA, bad)).toThrow(RangeError);
    expect(() => scoreHand(ARGENTINA, bad)).toThrow(/^scoreHand: handIndex 7: /);
    expect(() => scoreHand(ARGENTINA, bad)).toThrow(check);
  });
});

describe('FR-310 scoreHand purity', () => {
  it('does not mutate its input and returns fresh objects', () => {
    const rules = getPreset('spain-ludoteka');
    const input = result(2, 3, [1, 2, 0], [1, 1, 1]);
    const [rulesBefore, inputBefore] = [structuredClone(rules), structuredClone(input)];
    const score = scoreHand(rules, input);
    expect(input).toEqual(inputBefore);
    expect(rules).toEqual(rulesBefore);
    score.perSeat[0].bid = 99;
    score.perSeat.pop();
    expect(input).toEqual(inputBefore);
  });
});
