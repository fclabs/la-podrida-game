// Legal plays (spec 02 FR-224, design §5.4; VC-220 at function level — the `play:<cardId>` ids are
// checked through legalMoves in Iteration 4).
//
// Every row is the spec's VC-220 row exactly: spades trump, the trick as listed (led by seat 0,
// then seat 1), and the acting seat's hand in the listed (sorted, FR-217) order. Each row fixes the
// flags the spec names and is run under every combination of the flags it leaves open, so every
// row is checked for every flag combination it covers.
import { describe, expect, it } from 'vitest';
import { cardId } from '@/src/domain/cards';
import { FRENCH_52 } from '@/src/domain/decks';
import type { RuleSet } from '@/src/domain/rules';
import type { HandState } from '@/src/domain/types';
import { legalPlays } from '@/src/engine/play';
import { cards, makeHand, rulesWith, trick } from './helpers';

type PlayFlags = Pick<
  RuleSet['play'],
  'mustBeatLedSuit' | 'beatNotRequiredAfterTrumped' | 'mustOvertrump' | 'whenCannotOvertrump'
>;

/** All 16 combinations of the four configurable play flags. */
const ALL_FLAGS: PlayFlags[] = [false, true].flatMap((mustBeatLedSuit) =>
  [false, true].flatMap((beatNotRequiredAfterTrumped) =>
    [false, true].flatMap((mustOvertrump) =>
      (['any-trump', 'any-card'] as const).map((whenCannotOvertrump) => ({
        mustBeatLedSuit,
        beatNotRequiredAfterTrumped,
        mustOvertrump,
        whenCannotOvertrump,
      })),
    ),
  ),
);

interface PlayRow {
  name: string;
  table: string; // card ids on the table, in play order (empty = empty trick)
  hold: string; // the acting seat's hand, in hand order
  fixed: Partial<PlayFlags>;
  expected: string;
}

const ROWS: PlayRow[] = [
  {
    name: 'empty trick → all cards',
    table: '',
    hold: 'KS 2S AH 3H 5D 5C',
    fixed: {},
    expected: 'KS 2S AH 3H 5D 5C',
  },
  {
    name: 'follow suit, mustBeatLedSuit false',
    table: '9H',
    hold: 'KS AH 3H',
    fixed: { mustBeatLedSuit: false },
    expected: 'AH 3H',
  },
  {
    name: 'montar, beatNotRequiredAfterTrumped false',
    table: '9H 2S',
    hold: 'AH 3H',
    fixed: { mustBeatLedSuit: true, beatNotRequiredAfterTrumped: false },
    expected: 'AH',
  },
  {
    name: 'montar, beatNotRequiredAfterTrumped true',
    table: '9H 2S',
    hold: 'AH 3H',
    fixed: { mustBeatLedSuit: true, beatNotRequiredAfterTrumped: true },
    expected: 'AH 3H',
  },
  {
    name: 'must beat but cannot',
    table: '9H',
    hold: '3H 2H',
    fixed: { mustBeatLedSuit: true },
    expected: '3H 2H',
  },
  {
    name: 'trump led, mustBeatLedSuit true',
    table: 'QS',
    hold: 'KS 2S AH',
    fixed: { mustBeatLedSuit: true },
    expected: 'KS',
  },
  {
    name: 'trump led, mustBeatLedSuit false',
    table: 'QS',
    hold: 'KS 2S AH',
    fixed: { mustBeatLedSuit: false },
    expected: 'KS 2S',
  },
  {
    name: 'trump led, beatNotRequiredAfterTrumped true does not waive beating',
    table: 'QS',
    hold: 'KS 2S AH',
    fixed: { mustBeatLedSuit: true, beatNotRequiredAfterTrumped: true },
    expected: 'KS',
  },
  {
    name: 'void in led suit, no trump on table → all trumps',
    table: '9H',
    hold: 'KS 2S 5D',
    fixed: {},
    expected: 'KS 2S',
  },
  {
    name: 'void, KS on table, mustOvertrump true → higher trumps',
    table: '9H KS',
    hold: 'AS 2S 5D',
    fixed: { mustOvertrump: true },
    expected: 'AS',
  },
  {
    name: 'void, AS on table, mustOvertrump true, any-trump',
    table: '9H AS',
    hold: '3S 2S 5D',
    fixed: { mustOvertrump: true, whenCannotOvertrump: 'any-trump' },
    expected: '3S 2S',
  },
  {
    name: 'void, AS on table, mustOvertrump true, any-card',
    table: '9H AS',
    hold: '3S 2S 5D',
    fixed: { mustOvertrump: true, whenCannotOvertrump: 'any-card' },
    expected: '3S 2S 5D',
  },
  {
    name: 'void, AS on table, mustOvertrump false',
    table: '9H AS',
    hold: '3S 2S 5D',
    fixed: { mustOvertrump: false },
    expected: '3S 2S',
  },
  {
    name: 'void in led suit and in trumps → all cards',
    table: '9H',
    hold: 'AD 5C',
    fixed: {},
    expected: 'AD 5C',
  },
];

/** The flag combinations a row covers: every combination agreeing with its fixed flags. */
function combosFor(fixed: Partial<PlayFlags>): PlayFlags[] {
  return ALL_FLAGS.filter((flags) =>
    (Object.keys(fixed) as (keyof PlayFlags)[]).every((key) => flags[key] === fixed[key]),
  );
}

function run(row: PlayRow, flags: PlayFlags): string[] {
  const plays = trick(0, row.table);
  const seat = plays.length; // the next seat after the plays on the table
  const hands: HandState['hands'] = [[], [], [], []];
  hands[seat] = cards(row.hold);
  const hand = makeHand({
    trumpSuit: 'S',
    hands,
    currentTrick: { leader: 0, plays },
    toAct: seat,
  });
  return legalPlays(hand, seat, rulesWith('argentina-fidepo', { play: flags }), FRENCH_52).map(
    cardId,
  );
}

describe('VC-220 legalPlays (function level)', () => {
  it.each(ROWS)('$name', (row) => {
    const combos = combosFor(row.fixed);
    expect(combos.length).toBe(16 / 2 ** Object.keys(row.fixed).length);
    for (const flags of combos) {
      expect({ flags, plays: run(row, flags) }).toEqual({
        flags,
        plays: row.expected.split(' '),
      });
    }
  });

  it('returns a new array of the hand’s own card objects and never mutates the hand', () => {
    const hand = makeHand({ hands: [cards('KS 2S AH'), [], [], []], toAct: 0 });
    const before = structuredClone(hand);
    const result = legalPlays(hand, 0, rulesWith('argentina-fidepo'), FRENCH_52);
    expect(result).not.toBe(hand.hands[0]);
    expect(result[0]).toBe(hand.hands[0][0]);
    expect(hand).toEqual(before);
  });
});
