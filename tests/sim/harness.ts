// Shared helpers for the seeded all-AI simulation (spec 04 FR-413 to FR-417). Not collected: no
// `.test.ts` suffix. Simulated games use plan decision P-4's input; deep equality uses
// `isDeepStrictEqual` and calls `expect` only to report a mismatch (P-6).
import { isDeepStrictEqual } from 'node:util';
import { expect, it } from 'vitest';
import { cardId } from '@/src/domain/cards';
import { getPreset } from '@/src/domain/presets';
import type { PresetId } from '@/src/domain/rules';
import type { GameEvent, GameState, SeatInfo, Transition } from '@/src/domain/types';
import { applyMove, createGame, type CreateGameInput } from '@/src/engine/engine';
import { checkInvariants } from '@/src/engine/invariants';
import { createPlayers } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { runAiLoop } from '@/src/service/ai-loop';
import { createLedger } from './ledger';

/** Seeds per combination when `SIM_SEEDS` is unset or empty. */
export const DEFAULT_SIM_SEEDS = 200;

/** Seeds per combination for which determinism (FR-416) and replay (FR-417) are also checked. */
export const DEEP_CHECK_SEEDS = 10;

/**
 * The number of seeds per combination from a `SIM_SEEDS` value (FR-413): `200` when unset or
 * empty, the number when it is a positive integer in decimal digits, otherwise an `Error` naming
 * the value.
 */
export function simSeeds(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_SIM_SEEDS;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`SIM_SEEDS must be a positive integer in decimal digits, got "${raw}"`);
  }
  return Number(raw);
}

/** Seeds per combination for this run. Throws at module load for an invalid `SIM_SEEDS`. */
export const SIM_SEEDS = simSeeds(process.env.SIM_SEEDS);

/** The seed of game `i` of a combination: `sim-<presetId>-<players>-<i>`. */
export function simSeed(presetId: PresetId, players: number, i: number): string {
  return `sim-${presetId}-${players}-${i}`;
}

/** P-4 seats: seat `i` is `{ seat: i, playerId: 'ai-<i>', name: 'AI <i>', kind: 'ai' }`. */
export function simSeats(players: number): SeatInfo[] {
  return Array.from({ length: players }, (_, i) => ({
    seat: i,
    playerId: `ai-${i}`,
    name: `AI ${i}`,
    kind: 'ai' as const,
  }));
}

/** The P-4 `createGame` input of a simulated game. */
export function simInput(presetId: PresetId, players: number, seed: string): CreateGameInput {
  return { gameId: 'sim', rules: getPreset(presetId), seats: simSeats(players), seed };
}

/** One applied move: the state before it and the transition it produced. */
export interface SimStep {
  prev: GameState;
  transition: Transition;
}

/** A played simulated game. `events` is the full log, `createGame`'s events included. */
export interface SimGame {
  input: CreateGameInput;
  initial: GameState;
  steps: SimStep[];
  final: GameState;
  events: GameEvent[];
}

/**
 * The FR-414 scoreboard checks on `state`: `evaluate` does not throw, BR-302 (`totals[s]` = Σ
 * points, `madeCount[s] + missedCount[s]` = hands scored) and `'live' in board === (hand !== null)`.
 * Returns one message per violation.
 */
export function scoreboardProblems(state: GameState): string[] {
  const board = evaluate(state);
  const problems: string[] = [];
  if (board.hands.length !== state.completedHands.length) {
    problems.push(`${board.hands.length} hands scored, ${state.completedHands.length} completed`);
  }
  for (let s = 0; s < state.seats.length; s++) {
    const sum = board.hands.reduce((total, hand) => total + hand.perSeat[s].points, 0);
    if (board.totals[s] !== sum) problems.push(`seat ${s} total ${board.totals[s]} ≠ Σ ${sum}`);
    if (board.madeCount[s] + board.missedCount[s] !== board.hands.length) {
      problems.push(`seat ${s} made + missed ≠ ${board.hands.length} hands`);
    }
  }
  if ('live' in board !== (state.hand !== null)) {
    problems.push(
      `'live' in board is ${'live' in board}, hand is ${state.hand === null ? '' : 'not '}null`,
    );
  }
  return problems;
}

/**
 * Plays a seeded all-AI game through `runAiLoop`. With `check`, after every move it asserts
 * FR-414: no invariant violation, the scoreboard checks and the card-conservation ledger (hand 0
 * opened from the `createGame` state). Any failure throws an `Error` naming the move number.
 */
export function playSimGame(
  presetId: PresetId,
  players: number,
  seed: string,
  { check }: { check: boolean },
): SimGame {
  const input = simInput(presetId, players, seed);
  const start = createGame(input);
  const steps: SimStep[] = [];
  const ledger = createLedger();
  if (check) ledger.openHand(start.state);

  const result = runAiLoop(start.state, createPlayers(input.seats), {
    onTransition: (prev, transition) => {
      steps.push({ prev, transition });
      if (!check) return;
      const where = `move ${steps.length}`;
      const invariants = checkInvariants(transition.state);
      if (invariants.length > 0) throw new Error(`${where}: invariants: ${invariants.join('; ')}`);
      const score = scoreboardProblems(transition.state);
      if (score.length > 0) throw new Error(`${where}: scoreboard: ${score.join('; ')}`);
      try {
        ledger.onTransition(transition);
      } catch (error) {
        throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    },
  });
  return {
    input,
    initial: start.state,
    steps,
    final: result.state,
    events: [...start.events, ...result.events],
  };
}

/** An event produced by a move: `bid-made` or `card-played`. */
export type MoveEvent = Extract<GameEvent, { type: 'bid-made' | 'card-played' }>;

/** The move id that produced a move event: `bid:<tricks>` or `play:<cardId>`. */
export function moveIdOf(event: MoveEvent): string {
  return event.type === 'bid-made' ? `bid:${event.tricks}` : `play:${cardId(event.card)}`;
}

/**
 * Replays a game from its events (FR-417) with `createGame(input)` and `applyMove` only (no
 * player or strategy). Returns the initial state and the state after each replayed move.
 */
export function replay(
  input: CreateGameInput,
  events: readonly GameEvent[],
): { initial: GameState; states: GameState[] } {
  const initial = createGame(input).state;
  const states: GameState[] = [];
  let state = initial;
  for (const event of events) {
    if (event.type !== 'bid-made' && event.type !== 'card-played') continue;
    state = applyMove(state, event.seat, moveIdOf(event)).state;
    states.push(state);
  }
  return { initial, states };
}

/** Asserts `actual` deep-equals `expected`, calling `expect` only on a mismatch (P-6). */
export function expectDeepEqual(actual: unknown, expected: unknown, label: string): void {
  if (!isDeepStrictEqual(actual, expected))
    expect({ label, actual }).toEqual({ label, actual: expected });
}

/** FR-416 and FR-417 for `game`: a second run's events and a replay match it step by step. */
export function checkDeterminismAndReplay(game: SimGame, presetId: PresetId): void {
  const players = game.input.seats.length;
  const again = playSimGame(presetId, players, game.input.seed, { check: false });
  expectDeepEqual(again.events, game.events, 'events of a second run');

  const replayed = replay(game.input, game.events);
  expectDeepEqual(replayed.initial, game.initial, 'replayed initial state');
  expect(replayed.states).toHaveLength(game.steps.length);
  replayed.states.forEach((state, k) => {
    const original = game.steps[k].transition.state;
    expectDeepEqual(state, original, `replayed state after move ${k + 1}`);
    expectDeepEqual(evaluate(state), evaluate(original), `replayed evaluate after move ${k + 1}`);
  });
}

/**
 * Registers the simulation tests of one preset (FR-413): for every valid player count and seed
 * `i < SIM_SEEDS`, one test `<presetId> <players>p seed <i>` that plays the game with every
 * per-move check and expects `game-over`; for `i < min(SIM_SEEDS, 10)` the same test also checks
 * determinism and replay.
 */
export function defineSimTests(presetId: PresetId): void {
  const { min, max } = getPreset(presetId).players;
  for (let players = min; players <= max; players++) {
    for (let i = 0; i < SIM_SEEDS; i++) {
      it(`${presetId} ${players}p seed ${i}`, () => {
        const game = playSimGame(presetId, players, simSeed(presetId, players, i), {
          check: true,
        });
        expect(game.final.phase).toBe('game-over');
        expect(game.events.at(-1)).toEqual({ type: 'game-over' });
        if (i < Math.min(SIM_SEEDS, DEEP_CHECK_SEEDS)) checkDeterminismAndReplay(game, presetId);
      });
    }
  }
}
