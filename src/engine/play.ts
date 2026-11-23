import { compareRanks, type Card } from '@/src/domain/cards';
import type { DeckDefinition } from '@/src/domain/decks';
import type { RuleSet } from '@/src/domain/rules';
import type { HandState } from '@/src/domain/types';

/** The highest card of `suit` among `cards` by `deck` rank order, or `null` if there is none. */
function highestOfSuit(cards: readonly Card[], suit: string, deck: DeckDefinition): Card | null {
  let best: Card | null = null;
  for (const card of cards) {
    if (card.suit === suit && (best === null || compareRanks(deck, card.rank, best.rank) > 0)) {
      best = card;
    }
  }
  return best;
}

/**
 * The cards `seat` may play in `hand`, as a new array of the seat's own card objects in hand
 * order (spec FR-224). Implements design §5.4 exactly:
 *
 * - empty trick → every card;
 * - holding the led suit → the led-suit cards that beat the highest led-suit card on the table
 *   when `mustBeatLedSuit` applies and any exist, else every led-suit card. The beat requirement
 *   is waived when `beatNotRequiredAfterTrumped` is on, a trump is on the table and the led suit
 *   is not trump;
 * - void in the led suit, holding trumps → with a trump on the table and `mustOvertrump`, the
 *   trumps higher than it if any, else every trump (`whenCannotOvertrump: 'any-trump'`) or every
 *   card (`'any-card'`); otherwise every trump;
 * - void in the led suit and in trumps → every card.
 *
 * "Beat" and "higher" mean `compareRanks(deck, a, b) > 0`.
 */
export function legalPlays(
  hand: HandState,
  seat: number,
  rules: RuleSet,
  deck: DeckDefinition,
): Card[] {
  const cards = hand.hands[seat];
  const table = hand.currentTrick.plays.map((play) => play.card);
  if (table.length === 0) return [...cards];

  const play = rules.play;
  const trump = hand.trumpSuit;
  const led = table[0].suit;
  const highestLed = highestOfSuit(table, led, deck) as Card; // the lead itself is of suit `led`
  const highestTrump = highestOfSuit(table, trump, deck);

  const inLed = cards.filter((card) => card.suit === led);
  if (inLed.length > 0) {
    const waived = play.beatNotRequiredAfterTrumped && highestTrump !== null && led !== trump;
    if (play.mustBeatLedSuit && !waived) {
      const beaters = inLed.filter((card) => compareRanks(deck, card.rank, highestLed.rank) > 0);
      if (beaters.length > 0) return beaters;
    }
    return inLed;
  }

  const trumps = cards.filter((card) => card.suit === trump);
  if (trumps.length > 0) {
    if (highestTrump !== null && play.mustOvertrump) {
      const over = trumps.filter((card) => compareRanks(deck, card.rank, highestTrump.rank) > 0);
      if (over.length > 0) return over;
      return play.whenCannotOvertrump === 'any-trump' ? trumps : [...cards];
    }
    return trumps;
  }

  return [...cards];
}
