import type { RuleSet } from '@/src/domain/rules';
import type { HandState } from '@/src/domain/types';

/**
 * The bids `seat` may make in `hand`: `0 … hand.cardsPerPlayer` ascending (spec FR-222, design
 * §5.3). When `seat` is the dealer, `rules.bidding.dealerRestriction` is on and `cardsPerPlayer`
 * is not in `dealerRestrictionExemptCardCounts`, the value `cardsPerPlayer − (sum of the other
 * seats' bids)` is removed if it lies in that range. Other seats' bids still `null` count as 0
 * (by the time the dealer bids, every other seat has bid). Returns a new array.
 */
export function legalBids(hand: HandState, seat: number, rules: RuleSet): number[] {
  const range = Array.from({ length: hand.cardsPerPlayer + 1 }, (_, n) => n);
  const { dealerRestriction, dealerRestrictionExemptCardCounts } = rules.bidding;
  if (
    seat !== hand.dealer ||
    !dealerRestriction ||
    dealerRestrictionExemptCardCounts.includes(hand.cardsPerPlayer)
  ) {
    return range;
  }
  const othersSum = hand.bids.reduce<number>(
    (sum, bid, other) => (other === seat ? sum : sum + (bid ?? 0)),
    0,
  );
  const forbidden = hand.cardsPerPlayer - othersSum;
  return range.filter((n) => n !== forbidden);
}
