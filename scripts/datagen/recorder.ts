// The recorder (spec 12 FR-1206..1209, BR-1201): observes one game played by `runAiLoop` and
// buffers one pending `decisions` row per AI decision. It never changes a decision, never draws
// from an RNG and never touches the state.
import type { Card } from '@/src/domain/cards';
import type { GameState, LegalMove, PlayerView, Rng, Transition } from '@/src/domain/types';
import type { AIStrategy } from '@/src/players/player';
import { cardIds, hiddenStockLeft } from './cards';
import type { PendingDecisionRow } from './schema';

/** The view-derived part of a row, captured before the strategy is asked. */
type Captured = Omit<
  PendingDecisionRow,
  | 'step'
  | 'cards_played_this_hand'
  | 'trick_number'
  | 'chosen_move_id'
  | 'chosen_index'
  | 'hidden_hands'
  | 'hidden_stock_left'
>;

export interface Recorder {
  /** Wraps `strategy` for `seat`; build the player with `createAiPlayer(seat, name, wrapped)`. */
  wrapStrategy(seat: number, strategy: AIStrategy): AIStrategy;
  /** Pass as `runAiLoop`'s `onTransition`: completes the pending row, then tracks the events. */
  onTransition(prev: GameState, transition: Transition): void;
  /** The buffered pending rows in play order (`step` 0, 1, 2, …). */
  rows(): readonly PendingDecisionRow[];
}

/** Creates the recorder of one game; `state` is the initial state (hand 0 dealt, no plays yet). */
export function createRecorder(state: GameState): Recorder {
  const { rules } = state;
  const players = state.seats.length;
  const rows: PendingDecisionRow[] = [];
  let pending: { captured: Captured; chosen: LegalMove; moves: LegalMove[] } | null = null;
  // Public hand tracking, rebuilt from events: reset on `hand-dealt`.
  let playedIds: string[] = [];
  let trickNumber = 0;

  function capture(seat: number, view: PlayerView, moves: LegalMove[], strategy: string): Captured {
    return {
      game_id: view.gameId,
      hand_index: view.handIndex,
      seat,
      decision_type: view.phase === 'bidding' ? 'bid' : 'play',
      cards_dealt: view.handPlan[view.handIndex],
      dealer: view.dealer,
      trump_card: view.trumpCard === null ? null : cardIds([view.trumpCard])[0],
      trump_in_dealer_hand: view.trumpCardInDealerHand,
      your_hand: cardIds(view.yourHand),
      bids_so_far: view.seats.map((s) => s.bid),
      tricks_won_so_far: view.seats.map((s) => s.tricksWon),
      current_trick: view.currentTrick.map((p) => ({ seat: p.seat, card: cardIds([p.card])[0] })),
      score_totals: [...view.scoreboard.totals],
      legal_move_ids: moves.map((m) => m.id),
      strategy,
      policy_probs: null,
      explore: false,
    };
  }

  function track(events: Transition['events']): void {
    for (const event of events) {
      if (event.type === 'hand-dealt') {
        playedIds = [];
        trickNumber = 0;
      } else if (event.type === 'card-played') {
        playedIds.push(cardIds([event.card])[0]);
      } else if (event.type === 'trick-won') {
        trickNumber += 1;
      }
    }
  }

  return {
    wrapStrategy(seat, strategy) {
      return {
        name: strategy.name,
        choose(view: PlayerView, moves: LegalMove[], rng: Rng): LegalMove {
          const captured = capture(seat, view, moves, strategy.name);
          const chosen = strategy.choose(view, moves, rng);
          pending = { captured, chosen, moves };
          return chosen;
        },
      };
    },

    onTransition(prev, transition) {
      if (pending === null || prev.hand === null) {
        throw new Error('recorder: a move was applied without a recorded AI decision');
      }
      const { captured, chosen, moves } = pending;
      pending = null;
      const hand = prev.hand;
      const chosenIndex = moves.findIndex((m) => m.id === chosen.id);
      const row: PendingDecisionRow = {
        game_id: captured.game_id,
        hand_index: captured.hand_index,
        step: rows.length,
        seat: captured.seat,
        decision_type: captured.decision_type,
        cards_dealt: captured.cards_dealt,
        dealer: captured.dealer,
        trump_card: captured.trump_card,
        trump_in_dealer_hand: captured.trump_in_dealer_hand,
        your_hand: captured.your_hand,
        bids_so_far: captured.bids_so_far,
        tricks_won_so_far: captured.tricks_won_so_far,
        current_trick: captured.current_trick,
        cards_played_this_hand: [...playedIds],
        score_totals: captured.score_totals,
        trick_number: trickNumber,
        legal_move_ids: captured.legal_move_ids,
        chosen_move_id: chosen.id,
        chosen_index: chosenIndex,
        strategy: captured.strategy,
        policy_probs: null,
        explore: false,
        hidden_hands: hand.hands.map((cards: Card[]) => cardIds(cards)),
        hidden_stock_left: hiddenStockLeft(
          rules.deck,
          players,
          hand.hands,
          playedIds,
          hand.trumpCard,
        ),
      };
      rows.push(row);
      track(transition.events);
    },

    rows: () => rows,
  };
}
