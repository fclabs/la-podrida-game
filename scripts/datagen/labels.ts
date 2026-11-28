// Outcome labels and the `games` / `hands` rows (spec 12 FR-1210, FR-1211). Pure: reads the
// finished game and returns new rows; nothing is written anywhere.
import { cardId } from '@/src/domain/cards';
import type { GameEvent, GameState } from '@/src/domain/types';
import { evaluate } from '@/src/score/score-engine';
import { GENERATOR_VERSION } from './constants';
import type { DecisionRow, GamesRow, HandsRow, PendingDecisionRow } from './schema';

/** The three tables of one game. */
export interface GameTables {
  games: GamesRow;
  hands: HandsRow[];
  decisions: DecisionRow[];
}

export interface BuildTablesInput {
  run_id: string;
  shard: number;
  preset: string;
  /** The strategy name of every seat, in seat order. */
  strategies: readonly string[];
  /** The game's initial state (hand 0 dealt); its events are not part of `events`. */
  initial: GameState;
  /** The state `runAiLoop` ended in (must be `game-over`). */
  final: GameState;
  /** Every applied move's events, in order (`runAiLoop`'s `events`). */
  events: readonly GameEvent[];
  /** The recorder's rows, in play order. */
  pending: readonly PendingDecisionRow[];
}

/** For each `card-played` event, in order, the seat of the next `trick-won` event. */
function trickWinners(events: readonly GameEvent[]): number[] {
  const winners: number[] = [];
  let open: number[] = [];
  for (const event of events) {
    if (event.type === 'card-played') {
      open.push(winners.length);
      winners.push(-1);
    } else if (event.type === 'trick-won') {
      for (const k of open) winners[k] = event.seat;
      open = [];
    }
  }
  if (open.length > 0) throw new Error('a card was played with no following trick-won event');
  return winners;
}

/**
 * Builds the `games` row, one `hands` row per scored hand and the labeled `decisions` rows of a
 * finished game. `hands` rows come from `evaluate(final).hands`; their deal columns (`dealer`,
 * `trump_card`, `trump_in_dealer_hand`, `cards_dealt`) come from the `hand-dealt` events (hand 0
 * from `initial`). Throws `Error` when the events and rows are inconsistent.
 */
export function buildTables(input: BuildTablesInput): GameTables {
  const { initial, final, events, pending, strategies } = input;
  const board = evaluate(final);
  const nPlayers = final.seats.length;

  // Deal columns of every hand, by hand index.
  const deals = new Map<
    number,
    { cards: number; dealer: number; trump: string; inHand: boolean }
  >();
  if (initial.hand !== null) {
    const h = initial.hand;
    deals.set(initial.handIndex, {
      cards: h.cardsPerPlayer,
      dealer: h.dealer,
      trump: cardId(h.trumpCard),
      inHand: h.trumpCardInDealerHand,
    });
  }
  for (const e of events) {
    if (e.type === 'hand-dealt') {
      deals.set(e.handIndex, {
        cards: e.cardsPerPlayer,
        dealer: e.dealer,
        trump: cardId(e.trumpCard),
        inHand: e.trumpCardInDealerHand,
      });
    }
  }

  const gameId = final.gameId;
  const hands: HandsRow[] = board.hands.map((hand) => {
    const deal = deals.get(hand.handIndex);
    if (deal === undefined) throw new Error(`no hand-dealt data for hand ${hand.handIndex}`);
    return {
      game_id: gameId,
      hand_index: hand.handIndex,
      cards_dealt: deal.cards,
      dealer: deal.dealer,
      trump_card: deal.trump,
      trump_in_dealer_hand: deal.inHand,
      bid_by_seat: hand.perSeat.map((p) => p.bid),
      tricks_won_by_seat: hand.perSeat.map((p) => p.tricks),
      made_by_seat: hand.perSeat.map((p) => p.made),
      points_by_seat: hand.perSeat.map((p) => p.points),
    };
  });

  const finalPlace = new Array<number>(nPlayers).fill(0);
  for (const entry of board.ranking) finalPlace[entry.seat] = entry.place;

  const games: GamesRow = {
    game_id: gameId,
    run_id: input.run_id,
    shard: input.shard,
    seed: final.seed,
    preset: input.preset,
    n_players: nPlayers,
    n_hands: final.handPlan.length,
    strategy_by_seat: [...strategies],
    final_total_by_seat: [...board.totals],
    final_place_by_seat: finalPlace,
    generator_version: GENERATOR_VERSION,
  };

  const winners = trickWinners(events);
  let playIndex = 0;
  const decisions: DecisionRow[] = pending.map((row) => {
    const hand = board.hands[row.hand_index];
    if (hand === undefined) throw new Error(`row ${row.step}: no scored hand ${row.hand_index}`);
    const seatScore = hand.perSeat[row.seat];
    let won: boolean | null = null;
    if (row.decision_type === 'play') {
      const winner = winners[playIndex++];
      if (winner === undefined) throw new Error(`row ${row.step}: no card-played event`);
      won = winner === row.seat;
    }
    return {
      ...row,
      hand_bid: seatScore.bid,
      hand_tricks_won: seatScore.tricks,
      hand_made: seatScore.made,
      hand_points: seatScore.points,
      won_this_trick: won,
      final_place: finalPlace[row.seat],
      final_total: board.totals[row.seat],
    };
  });
  if (playIndex !== winners.length) {
    throw new Error(`${playIndex} play rows but ${winners.length} card-played events`);
  }

  return { games, hands, decisions };
}
