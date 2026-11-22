import type { z } from 'zod';
import type { DeckDefinition } from './decks';
import type { CardSchema } from './schemas';

/** A suit letter, e.g. `'S'` (french-52) or `'O'` (spanish-40). Decks are data, so this is `string`. */
export type Suit = string;

/** A rank token, e.g. `'10'`, `'Q'` (french-52) or `'R'`, `'C'`, `'S'` (spanish-40). */
export type Rank = string;

/** A playing card, `{ suit, rank }`. Two cards are the same card iff their `cardId`s are equal. */
export type Card = z.infer<typeof CardSchema>;

/** Thrown when a card id or rank does not belong to the given deck. */
export class InvalidCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCardError';
  }
}

/** The card's id: its rank token followed by its suit letter (`"10S"`, `"QH"`, `"CC"`). */
export function cardId(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/**
 * Parses a card id for `deck`: the last character is the suit, the rest is the rank. Throws
 * `InvalidCardError` (message contains the input) if either part is missing or not in the deck.
 */
export function parseCard(id: string, deck: DeckDefinition): Card {
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  if (rank === '' || !deck.suits.includes(suit) || !deck.ranksHighToLow.includes(rank)) {
    throw new InvalidCardError(`Invalid card id "${id}" for deck ${deck.id}`);
  }
  return { suit, rank };
}

/**
 * Compares two ranks of `deck` by `deck.ranksHighToLow`: positive if `a` ranks higher, negative if
 * lower, `0` if equal. Throws `InvalidCardError` if either rank is not in the deck.
 */
export function compareRanks(deck: DeckDefinition, a: Rank, b: Rank): number {
  return rankIndex(deck, b) - rankIndex(deck, a);
}

function rankIndex(deck: DeckDefinition, rank: Rank): number {
  const index = deck.ranksHighToLow.indexOf(rank);
  if (index === -1) {
    throw new InvalidCardError(`Invalid rank "${rank}" for deck ${deck.id}`);
  }
  return index;
}
