import type { Decision, DecisionContext, LegalMove, PlayerView, Rng } from '@/src/domain/types';

/*
 * The player model (spec 04 FR-400). Players and strategies are plain objects built by factories;
 * no classes. A player sees only its `DecisionContext`, never the game state (BR-401).
 */

/** A seat's decision maker: a human (always waits) or an AI (asks its strategy). */
export interface Player {
  seat: number;
  name: string;
  kind: 'human' | 'ai';
  requestDecision(ctx: DecisionContext): Decision;
}

/** An AI strategy: picks one of the legal moves from the seat's view and the seat's AI RNG. */
export interface AIStrategy {
  name: string;
  choose(view: PlayerView, moves: LegalMove[], rng: Rng): LegalMove;
}
