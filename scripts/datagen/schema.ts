// Row schemas of the generated dataset (spec 12, Data & Interfaces). Keys are in the spec's column
// order. The manifest schema is at the end.
import { z } from 'zod';

const cardIds = z.array(z.string());
const perSeatInts = z.array(z.int());

/**
 * A `decisions` row as the recorder builds it: every column except the outcome labels. A pending
 * row cannot be flushed; only a `DecisionRow` (labels filled) can.
 */
export const PendingDecisionRowSchema = z.strictObject({
  // Keys
  game_id: z.string(),
  hand_index: z.int(),
  step: z.int(),
  seat: z.int(),
  decision_type: z.enum(['bid', 'play']),
  // Player view
  cards_dealt: z.int(),
  dealer: z.int(),
  trump_card: z.string().nullable(),
  trump_in_dealer_hand: z.boolean(),
  your_hand: cardIds,
  bids_so_far: z.array(z.int().nullable()),
  tricks_won_so_far: perSeatInts,
  current_trick: z.array(z.strictObject({ seat: z.int(), card: z.string() })),
  cards_played_this_hand: cardIds,
  score_totals: perSeatInts,
  trick_number: z.int(),
  // Action
  legal_move_ids: z.array(z.string()),
  chosen_move_id: z.string(),
  chosen_index: z.int(),
  // Policy
  strategy: z.string(),
  policy_probs: z.null(),
  explore: z.literal(false),
  // Oracle
  hidden_hands: z.array(cardIds),
  hidden_stock_left: cardIds,
});

/** The outcome label columns, filled after the game ends (Iteration 3). */
export const OutcomeColumnsSchema = z.strictObject({
  hand_bid: z.int(),
  hand_tricks_won: z.int(),
  hand_made: z.boolean(),
  hand_points: z.int(),
  won_this_trick: z.boolean().nullable(),
  final_place: z.int(),
  final_total: z.int(),
});

/** A complete `decisions` row: the pending columns followed by the outcome labels. */
export const DecisionRowSchema = PendingDecisionRowSchema.extend(OutcomeColumnsSchema.shape);

export type PendingDecisionRow = z.infer<typeof PendingDecisionRowSchema>;
export type OutcomeColumns = z.infer<typeof OutcomeColumnsSchema>;
export type DecisionRow = z.infer<typeof DecisionRowSchema>;

/** A `games` row (spec 12 FR-1211): one per game. No git or wall-clock columns (spec A-8). */
export const GamesRowSchema = z.strictObject({
  game_id: z.string(),
  run_id: z.string(),
  shard: z.int(),
  seed: z.string(),
  preset: z.string(),
  n_players: z.int(),
  n_hands: z.int(),
  strategy_by_seat: z.array(z.string()),
  final_total_by_seat: perSeatInts,
  final_place_by_seat: perSeatInts,
  generator_version: z.int(),
});

/** A `hands` row (spec 12 FR-1211): one per hand of a game; all per-seat arrays have `n_players`. */
export const HandsRowSchema = z.strictObject({
  game_id: z.string(),
  hand_index: z.int(),
  cards_dealt: z.int(),
  dealer: z.int(),
  trump_card: z.string(),
  trump_in_dealer_hand: z.boolean(),
  bid_by_seat: perSeatInts,
  tricks_won_by_seat: perSeatInts,
  made_by_seat: z.array(z.boolean()),
  points_by_seat: perSeatInts,
});

export type GamesRow = z.infer<typeof GamesRowSchema>;
export type HandsRow = z.infer<typeof HandsRowSchema>;

const isoUtc = z.iso.datetime();

/** One output file of a shard as the manifest records it (`path` is relative to the run directory). */
export const ShardFileSchema = z.strictObject({
  path: z.string(),
  bytes: z.int(),
  sha256: z.string(),
  rows: z.int(),
});

/** The run parameters a manifest records (spec 12 `manifest.json`, `params`). */
export const ManifestParamsSchema = z.strictObject({
  preset: z.string(),
  players: z.int(),
  games: z.int(),
  shard_size: z.int(),
  strategies: z.array(z.string()),
  replay_every: z.int(),
});

const shardBase = { shard: z.int(), games: z.int() };

/** A manifest shard entry, by status: pending, complete (files and git info) or failed (error). */
export const ShardEntrySchema = z.discriminatedUnion('status', [
  z.strictObject({ ...shardBase, status: z.literal('pending') }),
  z.strictObject({
    ...shardBase,
    status: z.literal('complete'),
    git_commit: z.string(),
    git_dirty: z.boolean(),
    completed_at: isoUtc,
    files: z.strictObject({
      games: ShardFileSchema,
      hands: ShardFileSchema,
      decisions: ShardFileSchema,
    }),
  }),
  z.strictObject({
    ...shardBase,
    status: z.literal('failed'),
    error: z.strictObject({ seed: z.string().nullable(), message: z.string() }),
  }),
]);

/** `manifest.json` (spec 12 Data & Interfaces). */
export const ManifestSchema = z.strictObject({
  schema_version: z.int(),
  generator_version: z.int(),
  run_id: z.string(),
  params: ManifestParamsSchema,
  created_at: isoUtc,
  shards: z.array(ShardEntrySchema),
});

export type ShardFile = z.infer<typeof ShardFileSchema>;
export type ManifestParams = z.infer<typeof ManifestParamsSchema>;
export type ShardEntry = z.infer<typeof ShardEntrySchema>;
export type CompleteShardEntry = Extract<ShardEntry, { status: 'complete' }>;
export type Manifest = z.infer<typeof ManifestSchema>;
