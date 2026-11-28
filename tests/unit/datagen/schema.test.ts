// Schema tests: key order, strictness, pending vs complete rows.
import { describe, expect, it } from 'vitest';
import {
  DecisionRowSchema,
  OutcomeColumnsSchema,
  PendingDecisionRowSchema,
} from '../../../scripts/datagen/schema';

const PENDING_KEYS = [
  'game_id',
  'hand_index',
  'step',
  'seat',
  'decision_type',
  'cards_dealt',
  'dealer',
  'trump_card',
  'trump_in_dealer_hand',
  'your_hand',
  'bids_so_far',
  'tricks_won_so_far',
  'current_trick',
  'cards_played_this_hand',
  'score_totals',
  'trick_number',
  'legal_move_ids',
  'chosen_move_id',
  'chosen_index',
  'strategy',
  'policy_probs',
  'explore',
  'hidden_hands',
  'hidden_stock_left',
];
const OUTCOME_KEYS = [
  'hand_bid',
  'hand_tricks_won',
  'hand_made',
  'hand_points',
  'won_this_trick',
  'final_place',
  'final_total',
];

const pending = {
  game_id: 'r-0-0',
  hand_index: 0,
  step: 0,
  seat: 1,
  decision_type: 'bid',
  cards_dealt: 2,
  dealer: 0,
  trump_card: 'QH',
  trump_in_dealer_hand: false,
  your_hand: ['AS', 'KD'],
  bids_so_far: [null, null, null],
  tricks_won_so_far: [0, 0, 0],
  current_trick: [],
  cards_played_this_hand: [],
  score_totals: [0, 0, 0],
  trick_number: 0,
  legal_move_ids: ['bid:0', 'bid:1'],
  chosen_move_id: 'bid:1',
  chosen_index: 1,
  strategy: 'random',
  policy_probs: null,
  explore: false,
  hidden_hands: [[], ['AS', 'KD'], []],
  hidden_stock_left: ['2C'],
};
const outcome = {
  hand_bid: 1,
  hand_tricks_won: 1,
  hand_made: true,
  hand_points: 11,
  won_this_trick: null,
  final_place: 1,
  final_total: 40,
};

describe('decision row schemas', () => {
  it('keeps the spec column order', () => {
    expect(Object.keys(PendingDecisionRowSchema.shape)).toEqual(PENDING_KEYS);
    expect(Object.keys(OutcomeColumnsSchema.shape)).toEqual(OUTCOME_KEYS);
    expect(Object.keys(DecisionRowSchema.shape)).toEqual([...PENDING_KEYS, ...OUTCOME_KEYS]);
  });

  it('a pending row is not a complete row', () => {
    expect(PendingDecisionRowSchema.safeParse(pending).success).toBe(true);
    expect(DecisionRowSchema.safeParse(pending).success).toBe(false);
    expect(DecisionRowSchema.safeParse({ ...pending, ...outcome }).success).toBe(true);
  });

  it('is strict: unknown keys and outcome keys on a pending row are rejected', () => {
    expect(PendingDecisionRowSchema.safeParse({ ...pending, extra: 1 }).success).toBe(false);
    expect(PendingDecisionRowSchema.safeParse({ ...pending, ...outcome }).success).toBe(false);
  });

  it('policy_probs must be null and explore false', () => {
    expect(PendingDecisionRowSchema.safeParse({ ...pending, policy_probs: [1] }).success).toBe(
      false,
    );
    expect(PendingDecisionRowSchema.safeParse({ ...pending, explore: true }).success).toBe(false);
  });
});
