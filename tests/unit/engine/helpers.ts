// Shared builders for engine tests (not collected: no `.test.ts` suffix).
import { parseCard, type Card } from '@/src/domain/cards';
import { FRENCH_52, type DeckDefinition } from '@/src/domain/decks';
import { getPreset } from '@/src/domain/presets';
import type { PresetId, RuleSet } from '@/src/domain/rules';
import type { HandState, TrickPlay } from '@/src/domain/types';

/** Parses one card id (`'9H'`, `'10S'`, `'3O'`) for `deck` (default french-52). */
export function card(id: string, deck: DeckDefinition = FRENCH_52): Card {
  return parseCard(id, deck);
}

/** Parses a whitespace-separated list of card ids (`'KS AH 3H'`), keeping the order given. */
export function cards(ids: string, deck: DeckDefinition = FRENCH_52): Card[] {
  return ids
    .split(/\s+/)
    .filter((id) => id !== '')
    .map((id) => card(id, deck));
}

/**
 * Trick plays for `ids` (as in `cards`), the first by `leader` and each next one by the next seat
 * clockwise, wrapping at `seatCount`.
 */
export function trick(
  leader: number,
  ids: string,
  seatCount = 4,
  deck: DeckDefinition = FRENCH_52,
): TrickPlay[] {
  return cards(ids, deck).map((c, i) => ({ seat: (leader + i) % seatCount, card: c }));
}

/** A mutable copy of preset `id` with `play` and `bidding` fields overridden. */
export function rulesWith(
  id: PresetId,
  overrides: { play?: Partial<RuleSet['play']>; bidding?: Partial<RuleSet['bidding']> } = {},
): RuleSet {
  const rules = getPreset(id);
  rules.play = { ...rules.play, ...overrides.play };
  rules.bidding = { ...rules.bidding, ...overrides.bidding };
  return rules;
}

/**
 * A full `HandState` with defaults for a 4-seat french-52 hand: 4 cards each, dealer 0, trump
 * card 2S (spades trump, not in the dealer's hand), empty hands, no bids, no tricks won, an empty
 * current trick led by seat 1, seat 1 to act. Any field can be overridden; `hands`, `bids` and
 * `tricksWon` default to one entry per seat of `seatCount`.
 */
export function makeHand(overrides: Partial<HandState> = {}, seatCount = 4): HandState {
  return {
    cardsPerPlayer: 4,
    dealer: 0,
    trumpCard: card('2S'),
    trumpCardInDealerHand: false,
    trumpSuit: 'S',
    hands: Array.from({ length: seatCount }, () => []),
    bids: Array.from({ length: seatCount }, () => null),
    tricksWon: Array.from({ length: seatCount }, () => 0),
    currentTrick: { leader: 1 % seatCount, plays: [] },
    toAct: 1 % seatCount,
    ...overrides,
  };
}
