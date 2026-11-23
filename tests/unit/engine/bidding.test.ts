// Legal bids (spec 02 FR-222; VC-219 at function level — the `bid:<n>` ids are checked through
// legalMoves in Iteration 4).
import { describe, expect, it } from 'vitest';
import type { PresetId } from '@/src/domain/rules';
import { legalBids } from '@/src/engine/bidding';
import { makeHand, rulesWith } from './helpers';

interface BidRow {
  name: string;
  preset: PresetId;
  dealerRestriction?: boolean;
  cardsPerPlayer: number;
  dealer: number;
  seat: number;
  bids: (number | null)[];
  expected: number[];
}

// 4 seats; the dealer (seat 3) bids last, so the other seats' bids are already set.
const ROWS: BidRow[] = [
  {
    name: 'dealer, 4 cards, others sum to 1 → 3 removed',
    preset: 'argentina-fidepo',
    cardsPerPlayer: 4,
    dealer: 3,
    seat: 3,
    bids: [0, 1, 0, null],
    expected: [0, 1, 2, 4],
  },
  {
    name: 'dealer, 4 cards, others sum to 5 → forbidden −1 is out of range',
    preset: 'argentina-fidepo',
    cardsPerPlayer: 4,
    dealer: 3,
    seat: 3,
    bids: [2, 2, 1, null],
    expected: [0, 1, 2, 3, 4],
  },
  {
    name: 'non-dealer gets the full range',
    preset: 'argentina-fidepo',
    cardsPerPlayer: 4,
    dealer: 3,
    seat: 1,
    bids: [0, null, null, null],
    expected: [0, 1, 2, 3, 4],
  },
  {
    name: 'dealerRestriction false → dealer gets the full range',
    preset: 'argentina-fidepo',
    dealerRestriction: false,
    cardsPerPlayer: 4,
    dealer: 3,
    seat: 3,
    bids: [0, 1, 0, null],
    expected: [0, 1, 2, 3, 4],
  },
  {
    name: 'spain-ludoteka, 1 card (exempt), others sum to 0 → [0, 1]',
    preset: 'spain-ludoteka',
    cardsPerPlayer: 1,
    dealer: 3,
    seat: 3,
    bids: [0, 0, 0, null],
    expected: [0, 1],
  },
  {
    name: 'spain-ludoteka, 2 cards, others sum to 1 → restriction applies (1 removed)',
    preset: 'spain-ludoteka',
    cardsPerPlayer: 2,
    dealer: 3,
    seat: 3,
    bids: [1, 0, 0, null],
    expected: [0, 2],
  },
];

describe('VC-219 legalBids (function level)', () => {
  it.each(ROWS)('$name', (row) => {
    const rules =
      row.dealerRestriction === undefined
        ? rulesWith(row.preset)
        : rulesWith(row.preset, { bidding: { dealerRestriction: row.dealerRestriction } });
    const hand = makeHand({
      cardsPerPlayer: row.cardsPerPlayer,
      dealer: row.dealer,
      bids: row.bids,
    });
    expect(legalBids(hand, row.seat, rules)).toEqual(row.expected);
  });

  it('spain-ludoteka really restricts 1-card hands only through the exemption', () => {
    // Same 1-card row with the exemption list emptied: forbidden 1 is removed.
    const rules = rulesWith('spain-ludoteka', {
      bidding: { dealerRestrictionExemptCardCounts: [] },
    });
    const hand = makeHand({ cardsPerPlayer: 1, dealer: 3, bids: [0, 0, 0, null] });
    expect(legalBids(hand, 3, rules)).toEqual([0]);
  });

  it('a dealer who is not the last seat still sums every other seat', () => {
    // Dealer seat 0; others (1, 2, 3) bid 1, 1, 0 → forbidden 4 − 2 = 2.
    const hand = makeHand({ cardsPerPlayer: 4, dealer: 0, bids: [null, 1, 1, 0] });
    expect(legalBids(hand, 0, rulesWith('argentina-fidepo'))).toEqual([0, 1, 3, 4]);
  });
});
