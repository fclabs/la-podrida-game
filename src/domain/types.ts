import type { z } from 'zod';
import type { Card } from './cards';
import type {
  GameEventSchema,
  GameStateSchema,
  HandResultSchema,
  HandStateSchema,
  SeatInfoSchema,
  TrickPlaySchema,
} from './schemas';

/*
 * Shared domain types (spec 01, Data & Interfaces). The persisted shapes (`SeatInfo` …
 * `GameEvent`) are `z.infer` of their schemas in `schemas.ts`; the rest are written by hand and
 * have no schema because they are never persisted.
 */

// ---------------------------------------------------------------------------------------------
// Game state, moves, events (persisted shapes inferred from their schemas)
// ---------------------------------------------------------------------------------------------

/** A seat at the table; `strategy` names the AI strategy of an `ai` seat. */
export type SeatInfo = z.infer<typeof SeatInfoSchema>;

/** One card played into a trick by a seat. */
export type TrickPlay = z.infer<typeof TrickPlaySchema>;

/** The hand in progress: cards, bids, tricks won, the current and last trick, the seat to act. */
export type HandState = z.infer<typeof HandStateSchema>;

/** The outcome of a completed hand. */
export type HandResult = z.infer<typeof HandResultSchema>;

/** A game's full persisted state. */
export type GameState = z.infer<typeof GameStateSchema>;

/** The game phase: `'bidding' | 'playing' | 'game-over'`. Defined from `GameState` so they can't drift. */
export type Phase = GameState['phase'];

/** A game event, discriminated by `type`. */
export type GameEvent = z.infer<typeof GameEventSchema>;

/** A move a seat can make: a bid of `tricks`, or playing `card`. */
export type Move =
  { type: 'bid'; seat: number; tricks: number } | { type: 'play'; seat: number; card: Card };

/** A legal move with its stable id (`"bid:3"`, `"play:QH"`). */
export interface LegalMove {
  id: string;
  move: Move;
}

/** The result of applying a move: the new state and the events it produced. */
export interface Transition {
  state: GameState;
  events: GameEvent[];
}

/** A random source. `int` is inclusive of both ends; `shuffle` returns a new array. */
export interface Rng {
  int(min: number, max: number): number;
  shuffle<T>(items: readonly T[]): T[];
}

// ---------------------------------------------------------------------------------------------
// Score, view and player types (types only; behavior in Phases 2–4)
// ---------------------------------------------------------------------------------------------

/** The score of one completed hand, per seat. */
export interface HandScore {
  handIndex: number;
  perSeat: { seat: number; bid: number; tricks: number; made: boolean; points: number }[];
}

/** The running scoreboard. `live[].bid` is `null` for seats that have not bid yet. */
export interface ScoreBoard {
  hands: HandScore[];
  totals: number[];
  madeCount: number[];
  missedCount: number[];
  live?: {
    seat: number;
    bid: number | null;
    tricksWon: number;
    status: 'on-track' | 'made-so-far' | 'busted';
  }[];
  ranking: { seat: number; total: number; place: number }[];
}

/** What any seat (or a spectator, `you: null`) can see of the table. */
export interface TableView {
  gameId: string;
  version: number;
  phase: Phase;
  you: number | null;
  seats: {
    seat: number;
    name: string;
    kind: 'human' | 'ai';
    cardCount: number;
    bid: number | null;
    tricksWon: number;
  }[];
  handIndex: number;
  handPlan: number[];
  dealer: number;
  toAct: number | null;
  trumpCard: Card | null;
  trumpCardInDealerHand: boolean;
  yourHand: Card[];
  currentTrick: TrickPlay[];
  lastTrick: { winner: number; plays: TrickPlay[] } | null;
}

/** A seat's view: the table view plus the scoreboard and, at game over, the final ranking. */
export interface PlayerView extends TableView {
  scoreboard: ScoreBoard;
  finalRanking?: { seat: number; total: number; place: number }[];
}

/** What a player receives after a change: new events, its view and its legal moves. */
export interface PlayerUpdate {
  version: number;
  events: GameEvent[];
  view: PlayerView;
  legalMoves: LegalMove[];
}

/** Everything a player strategy gets to decide on. */
export interface DecisionContext {
  view: PlayerView;
  legalMoves: LegalMove[];
  rng: Rng;
}

/** A strategy's answer: make the move with `moveId`, or wait (e.g. for a human). */
export type Decision = { type: 'move'; moveId: string } | { type: 'await' };
