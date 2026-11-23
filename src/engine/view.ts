import type { Card } from '@/src/domain/cards';
import type { GameState, TableView, TrickPlay } from '@/src/domain/types';
import { currentActor } from './engine';

/** Throws `RangeError` unless `seat` is an integer in `0 … N − 1` (spec FR-219). */
function assertSeatInRange(state: GameState, seat: number): void {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats.length) {
    throw new RangeError(`seat ${seat} is outside 0–${state.seats.length - 1}`);
  }
}

const copyCard = (card: Card): Card => ({ suit: card.suit, rank: card.rank });

const copyPlays = (plays: readonly TrickPlay[]): TrickPlay[] =>
  plays.map((play) => ({ seat: play.seat, card: copyCard(play.card) }));

/**
 * The table as `seat` (or a spectator) sees it (spec FR-236 to FR-238, BR-205). It holds only the
 * viewer's own hand, the cards on the table, the last trick and the public trump card; never
 * another seat's cards, undealt cards, the seed, the rules or `aiDecisionCount`. Every array and
 * card is a fresh copy, so mutating the view never changes `state`. A numeric seat outside
 * `0 … N − 1` throws `RangeError` (FR-219). At game over (`hand` is `null`) the hand fields are
 * empty and `dealer` is the dealer of the last completed hand (FR-237).
 */
export function tableViewFor(state: GameState, seat: number | 'spectator'): TableView {
  if (seat !== 'spectator') assertSeatInRange(state, seat);
  const you = seat === 'spectator' ? null : seat;
  const hand = state.phase === 'game-over' ? null : state.hand;

  const base = {
    gameId: state.gameId,
    version: state.version,
    phase: state.phase,
    you,
    handIndex: state.handIndex,
    handPlan: [...state.handPlan],
  };

  if (hand === null) {
    return {
      ...base,
      seats: state.seats.map((info, i) => ({
        seat: i,
        name: info.name,
        kind: info.kind,
        cardCount: 0,
        bid: null,
        tricksWon: 0,
      })),
      dealer: state.completedHands.at(-1)?.dealer ?? 0,
      toAct: null,
      trumpCard: null,
      trumpCardInDealerHand: false,
      yourHand: [],
      currentTrick: [],
      lastTrick: null,
    };
  }

  return {
    ...base,
    seats: state.seats.map((info, i) => ({
      seat: i,
      name: info.name,
      kind: info.kind,
      cardCount: hand.hands[i].length,
      bid: hand.bids[i],
      tricksWon: hand.tricksWon[i],
    })),
    dealer: hand.dealer,
    toAct: currentActor(state),
    trumpCard: copyCard(hand.trumpCard),
    trumpCardInDealerHand: hand.trumpCardInDealerHand,
    yourHand: you === null ? [] : hand.hands[you].map(copyCard),
    currentTrick: copyPlays(hand.currentTrick.plays),
    lastTrick:
      hand.lastTrick === undefined
        ? null
        : { winner: hand.lastTrick.winner, plays: copyPlays(hand.lastTrick.plays) },
  };
}
