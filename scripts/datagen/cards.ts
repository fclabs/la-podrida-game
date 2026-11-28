// Card helpers for the recorder: engine cards to ids, and the oracle `hidden_stock_left`.
import { type Card, cardId } from '@/src/domain/cards';
import { type DeckDefinition, buildDeck } from '@/src/domain/decks';

/** The ids of `cards`, in order. */
export function cardIds(cards: readonly Card[]): string[] {
  return cards.map(cardId);
}

/**
 * `hidden_stock_left`: the ids of the deck cards (`buildDeck(deck, players)` order) that are in no
 * seat's dealt hand for the hand and are not the trump card. A seat's dealt hand is what it still
 * holds (`remainingHands`) plus what was played this hand (`playedIds`). When the trump card is in
 * the dealer's hand it is already one of those cards, so the stock is just the undealt rest.
 */
export function hiddenStockLeft(
  deck: DeckDefinition,
  players: number,
  remainingHands: readonly (readonly Card[])[],
  playedIds: readonly string[],
  trumpCard: Card,
): string[] {
  const dealt = new Set<string>(playedIds);
  for (const hand of remainingHands) for (const card of hand) dealt.add(cardId(card));
  dealt.add(cardId(trumpCard));
  return cardIds(buildDeck(deck, players)).filter((id) => !dealt.has(id));
}
