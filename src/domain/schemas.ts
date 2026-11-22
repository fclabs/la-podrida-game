import { z } from 'zod';

/**
 * Zod schemas for the domain's persisted shapes (spec 01, FR-115 to FR-118).
 *
 * These schemas are the single source of truth: the matching TypeScript types are
 * `z.infer<typeof …Schema>` in the type modules (`cards.ts`, `decks.ts`, …). This module imports
 * only `zod`.
 */

/** Every suit letter used by any supported deck (french-52: S H D C; spanish-40: O C E B). */
export const KNOWN_SUITS: readonly string[] = Object.freeze(['S', 'H', 'D', 'C', 'O', 'E', 'B']);

/** Every rank token used by any supported deck (french-52 and spanish-40 combined). */
export const KNOWN_RANKS: readonly string[] = Object.freeze([
  'A',
  'K',
  'Q',
  'J',
  '10',
  '9',
  '8',
  '7',
  '6',
  '5',
  '4',
  '3',
  '2',
  'R',
  'C',
  'S',
]);

/**
 * A card. `suit` and `rank` are strings refined to membership in `KNOWN_SUITS` / `KNOWN_RANKS`
 * (not `z.enum`), so `Suit` and `Rank` infer as `string`: decks are data, not types. The schema
 * checks shape only; membership in a specific game's deck is the engine's concern.
 */
export const CardSchema = z.strictObject({
  suit: z.string().refine((suit) => KNOWN_SUITS.includes(suit), { message: 'Unknown suit' }),
  rank: z.string().refine((rank) => KNOWN_RANKS.includes(rank), { message: 'Unknown rank' }),
});

/** A non-empty list of distinct strings. */
const distinctNonEmptyStrings = z
  .array(z.string())
  .min(1)
  .refine((items) => new Set(items).size === items.length, { message: 'Duplicate entries' });

/**
 * A deck definition. `removeRanksForPlayers` keys are player counts as canonical decimal strings
 * (`^[1-9][0-9]*$`, never coerced to numbers), and every listed rank must belong to the deck.
 */
export const DeckDefinitionSchema = z
  .strictObject({
    id: z.enum(['french-52', 'spanish-40']),
    suits: distinctNonEmptyStrings,
    ranksHighToLow: distinctNonEmptyStrings,
    removeRanksForPlayers: z.record(z.string().regex(/^[1-9][0-9]*$/), z.array(z.string())),
  })
  .superRefine((deck, ctx) => {
    for (const [players, ranks] of Object.entries(deck.removeRanksForPlayers)) {
      ranks.forEach((rank, index) => {
        if (!deck.ranksHighToLow.includes(rank)) {
          ctx.addIssue({
            code: 'custom',
            message: `Rank "${rank}" is not in this deck`,
            path: ['removeRanksForPlayers', players, index],
          });
        }
      });
    }
  });
