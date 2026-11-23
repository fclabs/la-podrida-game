import type { GameEvent, GameState, Transition } from '@/src/domain/types';
import { aiRng, applyMove, currentActor, legalMoves } from '@/src/engine/engine';
import type { Player } from '@/src/players/player';
import { buildPlayerView } from './player-view';

/** Options of `runAiLoop`. */
export interface AiLoopOptions {
  /** The most moves one call may apply while an AI seat is still to act (default `1000`). */
  maxMoves?: number;
  /**
   * Called after every applied move, before the next decision, with the state before the move and
   * the returned transition. An exception it throws propagates out of `runAiLoop`.
   */
  onTransition?: (prev: GameState, transition: Transition) => void;
}

/** The outcome of `runAiLoop`: the final state, every applied move's events in order, the count. */
export interface AiLoopResult {
  state: GameState;
  events: GameEvent[];
  moves: number;
}

/** Thrown by `runAiLoop` when `maxMoves` moves were applied and an AI seat is still to act. */
export class AiLoopLimitError extends Error {
  readonly moves: number;
  readonly state: GameState;

  constructor(moves: number, state: GameState) {
    super(`AI loop limit reached: ${moves} moves applied and an AI seat is still to act`);
    this.name = 'AiLoopLimitError';
    this.moves = moves;
    this.state = state;
  }
}

/** Throws `RangeError` unless `players` match `state.seats` in length, seat number and kind (FR-410). */
function assertPlayersMatch(state: GameState, players: readonly Player[]): void {
  if (players.length !== state.seats.length) {
    throw new RangeError(
      `players length ${players.length} does not match the game's ${state.seats.length} seats`,
    );
  }
  players.forEach((player, i) => {
    if (player.seat !== i) {
      throw new RangeError(`seat ${i}: player has seat ${player.seat}, expected ${i}`);
    }
    if (player.kind !== state.seats[i].kind) {
      throw new RangeError(
        `seat ${i}: player kind '${player.kind}' does not match seat kind '${state.seats[i].kind}'`,
      );
    }
  });
}

/**
 * Plays turns until a player answers `await` or the game ends (FR-408 to FR-411). Each turn:
 * `seat = currentActor(state)` (stop at `null`); build the seat's `DecisionContext` (its view, its
 * legal moves, `aiRng(state, seat)`); ask `players[seat].requestDecision`; stop on `await`,
 * otherwise `applyMove` and call `onTransition`. Validates `players` first (`RangeError`). Throws
 * `AiLoopLimitError` when `maxMoves` moves were applied and an AI seat is still to act; an
 * `IllegalMoveError` from `applyMove` propagates unchanged. Pure: never mutates `state`.
 */
export function runAiLoop(
  state: GameState,
  players: readonly Player[],
  options: AiLoopOptions = {},
): AiLoopResult {
  assertPlayersMatch(state, players);
  const { maxMoves = 1000, onTransition } = options;
  const events: GameEvent[] = [];
  let current = state;
  let moves = 0;
  for (let seat = currentActor(current); seat !== null; seat = currentActor(current)) {
    if (moves >= maxMoves && current.seats[seat].kind === 'ai') {
      throw new AiLoopLimitError(moves, current);
    }
    const decision = players[seat].requestDecision({
      view: buildPlayerView(current, seat),
      legalMoves: legalMoves(current, seat),
      rng: aiRng(current, seat),
    });
    if (decision.type === 'await') break;
    const transition = applyMove(current, seat, decision.moveId);
    moves += 1;
    events.push(...transition.events);
    onTransition?.(current, transition);
    current = transition.state;
  }
  return { state: current, events, moves };
}
