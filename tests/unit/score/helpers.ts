// Shared builders for score tests (not collected: no `.test.ts` suffix).
import { getPreset } from '@/src/domain/presets';
import type { GameState, HandResult, HandState } from '@/src/domain/types';
import { makeSeats } from '../engine/helpers';

/** Largest card count per player of argentina-fidepo (french-52) by player count. */
const ARGENTINA_MAX: Record<number, number> = { 3: 17, 4: 13, 5: 10, 6: 8 };

/** The argentina-fidepo hand plan for `players` (spec 02 Hand plans): max→5, 4×players, 5→max. */
export function argentinaPlan(players: number): number[] {
  const max = ARGENTINA_MAX[players];
  const down = Array.from({ length: max - 4 }, (_, i) => max - i);
  return [...down, ...Array.from({ length: players }, () => 4), ...[...down].reverse()];
}

/** A `HandResult` with dealer `handIndex mod bids.length` and spades trump. */
export function result(
  handIndex: number,
  cardsPerPlayer: number,
  bids: number[],
  tricks: number[],
): HandResult {
  return {
    handIndex,
    cardsPerPlayer,
    dealer: handIndex % Math.max(bids.length, 1),
    trumpSuit: 'S',
    bids,
    tricks,
  };
}

export interface MakeStateOptions {
  /** Seat count (default 3). */
  players?: number;
  /** Completed hands (default none). `handIndex` defaults to their count. */
  completedHands?: HandResult[];
  handIndex?: number;
  /** Fields overriding the default fresh bidding hand, or `null` for a game-over state. */
  hand?: Partial<HandState> | null;
  /** Default `'bidding'`, or `'game-over'` when `hand` is `null`. */
  phase?: GameState['phase'];
}

/**
 * A hand-built argentina-fidepo `GameState` (shape-valid for `GameStateSchema`, not necessarily
 * engine-consistent). The default hand is a fresh bidding hand at `handIndex` with
 * `cardsPerPlayer = handPlan[handIndex]`, dealer `handIndex mod N`, trump 2S, all bids `null`, no
 * tricks won and an empty hand per seat (`hands` cards are irrelevant to scoring).
 */
export function makeState(options: MakeStateOptions = {}): GameState {
  const players = options.players ?? 3;
  const completedHands = options.completedHands ?? [];
  const handIndex = options.handIndex ?? completedHands.length;
  const handPlan = argentinaPlan(players);
  const dealer = handIndex % players;
  const mano = (dealer + 1) % players;
  const hand: HandState | null =
    options.hand === null
      ? null
      : {
          cardsPerPlayer: handPlan[handIndex] ?? 1,
          dealer,
          trumpCard: { suit: 'S', rank: '2' },
          trumpCardInDealerHand: false,
          trumpSuit: 'S',
          hands: Array.from({ length: players }, () => []),
          bids: Array.from({ length: players }, () => null),
          tricksWon: Array.from({ length: players }, () => 0),
          currentTrick: { leader: mano, plays: [] },
          toAct: mano,
          ...options.hand,
        };
  return {
    schemaVersion: 1,
    gameId: 'score-game',
    rules: getPreset('argentina-fidepo'),
    handPlan,
    seats: makeSeats(players),
    seed: 'score-seed',
    aiDecisionCount: 0,
    phase: options.phase ?? (hand === null ? 'game-over' : 'bidding'),
    handIndex,
    hand,
    completedHands,
    version: 0,
  };
}
