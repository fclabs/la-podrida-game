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

/** A positive integer (≥ 1): a card count, a repeat count or a player count. */
const positiveInt = z.int().min(1);

/**
 * A card-count bound in a hand sequence: a fixed count (integer ≥ 1); `'max'`, the largest count
 * the deck allows for this table; `{ min: [n, 'max'] }`, i.e. `min(n, max)` with n ≥ 1; or
 * `{ offset: ['max', n] }`, i.e. `max + n` with n an integer ≤ 0.
 */
export const BoundSchema = z.union([
  positiveInt,
  z.literal('max'),
  z.strictObject({ min: z.tuple([positiveInt, z.literal('max')]) }),
  z.strictObject({ offset: z.tuple([z.literal('max'), z.int().max(0)]) }),
]);

/**
 * One segment of a hand sequence: an inclusive `range` stepping ±1 from `from` to `to`, or a
 * `repeat` of `cards` cards `times` times (an integer ≥ 1, or `'players'` for one per player).
 */
export const SegmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('range'), from: BoundSchema, to: BoundSchema }),
  z.strictObject({
    kind: z.literal('repeat'),
    cards: BoundSchema,
    times: z.union([positiveInt, z.literal('players')]),
  }),
]);

/** The hand sequence of a rule set: a non-empty list of segments, played in order. */
export const HandSequenceSpecSchema = z.array(SegmentSchema).min(1);

/** How hands are scored. The numeric values are fixed per kind (literal types). */
export const ScoringSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('bonus-plus-tricks'),
    bonus: z.literal(10),
    perTrick: z.literal(1),
    missedPerTrick: z.literal(1),
  }),
  z.strictObject({ kind: z.literal('bonus-plus-bid'), bonus: z.literal(10) }),
  z.strictObject({
    kind: z.literal('spanish'),
    bonus: z.literal(10),
    perTrick: z.literal(5),
    missPenaltyPerTrick: z.literal(5),
  }),
]);

/** The rule preset ids, in their canonical order. */
export const PresetIdSchema = z.enum([
  'argentina-fidepo',
  'spain-ludoteka',
  'gamerules',
  'mexico-bazas',
]);

/**
 * A complete rule set. Every field is required (no defaults, spec BR-101), unknown keys are
 * rejected at every level, and the value is plain JSON data (BR-103).
 */
export const RuleSetSchema = z.strictObject({
  id: PresetIdSchema,
  deck: DeckDefinitionSchema,
  players: z
    .strictObject({ min: z.int().min(2), max: z.int().min(2) })
    .refine((players) => players.min <= players.max, {
      message: 'players.min must be <= players.max',
      path: ['max'],
    }),
  handSequence: HandSequenceSpecSchema,
  trump: z.strictObject({ source: z.literal('next-stock-card-or-dealer-last') }),
  bidding: z.strictObject({
    dealerRestriction: z.boolean(),
    dealerRestrictionExemptCardCounts: z.array(positiveInt),
  }),
  play: z.strictObject({
    mustFollowSuit: z.literal(true),
    mustTrumpWhenVoid: z.literal(true),
    mustBeatLedSuit: z.boolean(),
    beatNotRequiredAfterTrumped: z.boolean(),
    mustOvertrump: z.boolean(),
    whenCannotOvertrump: z.enum(['any-trump', 'any-card']),
  }),
  scoring: ScoringSpecSchema,
  tieBreak: z.enum(['fewest-misses', 'shared']),
});

/** A non-negative integer (≥ 0): a seat index, a hand index, a bid, a trick count, a version. */
const nonNegativeInt = z.int().min(0);

/** A suit letter from `KNOWN_SUITS`, typed as `string` (like `CardSchema.suit`). */
const knownSuit = z
  .string()
  .refine((suit) => KNOWN_SUITS.includes(suit), { message: 'Unknown suit' });

/** A game's hand plan: the card count of each hand, in order (integers ≥ 1). */
const handPlan = z.array(positiveInt);

/** A seat at the table. `strategy` (optional) names the AI strategy of an `ai` seat. */
export const SeatInfoSchema = z.strictObject({
  seat: nonNegativeInt,
  playerId: z.string(),
  name: z.string(),
  kind: z.enum(['human', 'ai']),
  strategy: z.string().optional(),
});

/** One card played into a trick by a seat. */
export const TrickPlaySchema = z.strictObject({
  seat: nonNegativeInt,
  card: CardSchema,
});

/** The hand in progress. `bids[i]` is `null` until seat `i` bids; `lastTrick` is optional. */
export const HandStateSchema = z.strictObject({
  cardsPerPlayer: positiveInt,
  dealer: nonNegativeInt,
  trumpCard: CardSchema,
  trumpCardInDealerHand: z.boolean(),
  trumpSuit: knownSuit,
  hands: z.array(z.array(CardSchema)),
  bids: z.array(nonNegativeInt.nullable()),
  tricksWon: z.array(nonNegativeInt),
  currentTrick: z.strictObject({ leader: nonNegativeInt, plays: z.array(TrickPlaySchema) }),
  lastTrick: z.strictObject({ winner: nonNegativeInt, plays: z.array(TrickPlaySchema) }).optional(),
  toAct: nonNegativeInt,
});

/** The outcome of a completed hand: every seat's bid and tricks taken. */
export const HandResultSchema = z.strictObject({
  handIndex: nonNegativeInt,
  cardsPerPlayer: positiveInt,
  dealer: nonNegativeInt,
  trumpSuit: knownSuit,
  bids: z.array(nonNegativeInt),
  tricks: z.array(nonNegativeInt),
});

/**
 * A game's full persisted state. `hand` is required and is `null` when no hand is in progress
 * (e.g. at game over). Shape only: per-game consistency (deck membership, seat counts) is checked
 * by the engine's invariants.
 */
export const GameStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  gameId: z.string().min(1),
  rules: RuleSetSchema,
  handPlan,
  seats: z.array(SeatInfoSchema),
  seed: z.string().min(1),
  aiDecisionCount: nonNegativeInt,
  phase: z.enum(['bidding', 'playing', 'game-over']),
  handIndex: nonNegativeInt,
  hand: HandStateSchema.nullable(),
  completedHands: z.array(HandResultSchema),
  version: nonNegativeInt,
});

/** A game event, discriminated by `type`. Every variant is strict (no missing or extra fields). */
export const GameEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('game-started'),
    seats: z.array(SeatInfoSchema),
    handPlan,
  }),
  z.strictObject({
    type: z.literal('hand-dealt'),
    handIndex: nonNegativeInt,
    dealer: nonNegativeInt,
    cardsPerPlayer: positiveInt,
    trumpCard: CardSchema,
    trumpCardInDealerHand: z.boolean(),
  }),
  z.strictObject({ type: z.literal('bid-made'), seat: nonNegativeInt, tricks: nonNegativeInt }),
  z.strictObject({ type: z.literal('card-played'), seat: nonNegativeInt, card: CardSchema }),
  z.strictObject({ type: z.literal('trick-won'), seat: nonNegativeInt, trickNumber: positiveInt }),
  z.strictObject({
    type: z.literal('hand-completed'),
    handIndex: nonNegativeInt,
    result: HandResultSchema,
  }),
  z.strictObject({ type: z.literal('game-over') }),
]);
