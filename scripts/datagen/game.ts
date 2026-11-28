// Plays one recorded game and turns it into rows (spec 12 FR-1204, FR-1210..1213). Nothing is
// written to disk here: the caller receives the three tables of the game.
import { getPreset } from '@/src/domain/presets';
import { cardId } from '@/src/domain/cards';
import type { SeatInfo } from '@/src/domain/types';
import { createGame } from '@/src/engine/engine';
import { createAiPlayer } from '@/src/players/ai-player';
import { getStrategy } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { type AiLoopResult, runAiLoop } from '@/src/service/ai-loop';
import { type GameTables, buildTables } from './labels';
import { createRecorder } from './recorder';

/** The signature of `runAiLoop`, for the injectable hook parameters. */
export type RunAiLoopFn = typeof runAiLoop;

/** A failed per-game check (FR-1212) or replay (FR-1213): the game's seed and a message. */
export class GameFailure extends Error {
  readonly seed: string;

  constructor(seed: string, message: string) {
    super(message);
    this.name = 'GameFailure';
    this.seed = seed;
  }
}

/** The engine seed and `game_id` of game `index` of shard `shard` of run `runId`: `R-s-i`. */
export function gameSeed(runId: string, shard: number, index: number): string {
  return `${runId}-${shard}-${index}`;
}

export interface PlayRecordedGameOptions {
  run_id: string;
  shard: number;
  /** Game index within the shard (0-based). */
  index: number;
  preset: string;
  /** One strategy name per seat; its length is the player count. */
  strategies: readonly string[];
  replay_every: number;
  /** Replaces `runAiLoop` for the game's own play only (default: the real one). */
  runAiLoop?: RunAiLoopFn;
  /** Replaces `runAiLoop` in the replay check only (default: the real one). */
  replayRunAiLoop?: RunAiLoopFn;
  /** Called after the labels are filled and before the checks; may change or drop rows. */
  transformRows?: (rows: GameTables) => GameTables;
}

function seatsOf(strategies: readonly string[]): SeatInfo[] {
  return strategies.map((strategy, k) => ({
    seat: k,
    playerId: `ai-${k}`,
    name: `ai-${k}`,
    kind: 'ai' as const,
    strategy,
  }));
}

/** The move ids a game applied, in order, rebuilt from its events. */
function moveIds(events: AiLoopResult['events']): string[] {
  const ids: string[] = [];
  for (const e of events) {
    if (e.type === 'bid-made') ids.push(`bid:${e.tricks}`);
    else if (e.type === 'card-played') ids.push(`play:${cardId(e.card)}`);
  }
  return ids;
}

/**
 * Plays game `index` of shard `shard` with the recorder, labels its rows, applies `transformRows`
 * and the FR-1212 checks 1-5, and (when `index mod replay_every === 0`) replays the game from its
 * seed without recording and compares the chosen moves and final totals (FR-1213). Returns the
 * game's rows. Any failed check or replay throws `GameFailure`; errors of the loop itself
 * (`AiLoopLimitError`, `IllegalMoveError`, …) propagate unchanged.
 */
export function playRecordedGame(options: PlayRecordedGameOptions): GameTables {
  const { run_id, shard, index, preset, strategies } = options;
  const loop = options.runAiLoop ?? runAiLoop;
  const replayLoop = options.replayRunAiLoop ?? runAiLoop;
  const seed = gameSeed(run_id, shard, index);
  const fail: (message: string) => never = (message) => {
    throw new GameFailure(seed, message);
  };

  const input = {
    gameId: seed,
    rules: getPreset(preset),
    seats: seatsOf(strategies),
    seed,
  };
  const initial = createGame(input).state;
  const recorder = createRecorder(initial);
  const players = initial.seats.map((s) =>
    createAiPlayer(s.seat, s.name, recorder.wrapStrategy(s.seat, getStrategy(s.strategy))),
  );
  const result = loop(initial, players, { onTransition: recorder.onTransition });

  // Check 1.
  if (result.state.phase !== 'game-over') {
    fail(`check 1: the game ended in phase ${result.state.phase}, not game-over`);
  }

  let tables: GameTables;
  try {
    tables = buildTables({
      run_id,
      shard,
      preset,
      strategies,
      initial,
      final: result.state,
      events: result.events,
      pending: recorder.rows(),
    });
  } catch (error) {
    return fail(`labels: ${error instanceof Error ? error.message : String(error)}`);
  }
  tables = options.transformRows?.(tables) ?? tables;

  const board = evaluate(result.state);
  // Check 2.
  if (tables.hands.length !== result.state.handPlan.length) {
    fail(
      `check 2: ${tables.hands.length} hands rows, handPlan has ${result.state.handPlan.length}`,
    );
  }
  // Check 3.
  if (tables.decisions.length !== result.moves) {
    fail(`check 3: ${tables.decisions.length} decisions rows, ${result.moves} moves applied`);
  }
  // Check 4.
  for (const hand of tables.hands) {
    const total = hand.tricks_won_by_seat.reduce((a, b) => a + b, 0);
    if (total !== hand.cards_dealt) {
      fail(
        `check 4: hand ${hand.hand_index}: ${total} tricks won, ${hand.cards_dealt} cards dealt`,
      );
    }
  }
  // Check 5.
  for (const hand of tables.hands) {
    const scored = board.hands[hand.hand_index];
    if (scored === undefined) fail(`check 5: hand ${hand.hand_index} is not in the score board`);
    for (const p of scored.perSeat) {
      const s = p.seat;
      if (
        hand.bid_by_seat[s] !== p.bid ||
        hand.tricks_won_by_seat[s] !== p.tricks ||
        hand.made_by_seat[s] !== p.made ||
        hand.points_by_seat[s] !== p.points
      ) {
        fail(`check 5: hand ${hand.hand_index} seat ${s} differs from the score board`);
      }
    }
  }

  if (index % options.replay_every === 0) replayCheck(options, seed, tables, replayLoop, fail);
  return tables;
}

/** FR-1213: replays the game without recording; every chosen move and the final totals must match. */
function replayCheck(
  options: PlayRecordedGameOptions,
  seed: string,
  tables: GameTables,
  replayLoop: RunAiLoopFn,
  fail: (message: string) => never,
): void {
  const initial = createGame({
    gameId: seed,
    rules: getPreset(options.preset),
    seats: seatsOf(options.strategies),
    seed,
  }).state;
  const players = initial.seats.map((s) => createAiPlayer(s.seat, s.name, getStrategy(s.strategy)));
  const replay = replayLoop(initial, players);
  const replayed = moveIds(replay.events);
  const recorded = tables.decisions.map((r) => r.chosen_move_id);
  const n = Math.max(replayed.length, recorded.length);
  for (let step = 0; step < n; step++) {
    if (replayed[step] !== recorded[step]) {
      fail(
        `replay: step ${step} differs (recorded ${recorded[step] ?? 'none'}, ` +
          `replayed ${replayed[step] ?? 'none'})`,
      );
    }
  }
  const totals = evaluate(replay.state).totals;
  const expected = tables.games.final_total_by_seat;
  if (totals.length !== expected.length || totals.some((t, k) => t !== expected[k])) {
    fail(
      `replay: final totals differ (recorded ${expected.join(',')}, replayed ${totals.join(',')})`,
    );
  }
}
