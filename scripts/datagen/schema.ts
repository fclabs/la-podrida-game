// Row schemas of the generated dataset (spec 12, Data & Interfaces). Keys are in the spec's column
// order. The `games`, `hands` and manifest schemas come in later iterations.
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
