import type { z } from 'zod';
import type { Card } from './cards';
import type { DeckDefinitionSchema } from './schemas';

/** A deck: its suits, its ranks from highest to lowest, and ranks removed for some player counts. */
export type DeckDefinition = z.infer<typeof DeckDefinitionSchema>;

/** Recursively freezes plain objects and arrays so shared constants cannot be mutated. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** The French 52-card deck: spades, hearts, diamonds, clubs; ace high. Deeply frozen. */
export const FRENCH_52: DeckDefinition = deepFreeze({
  id: 'french-52',
  suits: ['S', 'H', 'D', 'C'],
  ranksHighToLow: ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'],
  removeRanksForPlayers: {},
});

/**
 * The Spanish 40-card deck: oros, copas, espadas, bastos; A 3 R C S 7 6 5 4 2. The 2s are removed
 * for 3 and 6 players (36 cards). Deeply frozen.
 */
export const SPANISH_40: DeckDefinition = deepFreeze({
  id: 'spanish-40',
  suits: ['O', 'C', 'E', 'B'],
  ranksHighToLow: ['A', '3', 'R', 'C', 'S', '7', '6', '5', '4', '2'],
  removeRanksForPlayers: { '3': ['2'], '6': ['2'] },
});

/**
 * Returns a new array of new cards: every suit × rank of `deck`, minus the ranks removed for
 * `players`, ordered by suit (deck order) then rank (high→low). Throws `RangeError` unless
 * `players` is an integer ≥ 1.
 */
export function buildDeck(deck: DeckDefinition, players: number): Card[] {
  if (!Number.isInteger(players) || players < 1) {
    throw new RangeError(`players must be an integer >= 1, got ${players}`);
  }
  const key = String(players);
  const removed = Object.hasOwn(deck.removeRanksForPlayers, key)
    ? deck.removeRanksForPlayers[key]
    : [];
  const cards: Card[] = [];
  for (const suit of deck.suits) {
    for (const rank of deck.ranksHighToLow) {
      if (!removed.includes(rank)) cards.push({ suit, rank });
    }
  }
  return cards;
}
