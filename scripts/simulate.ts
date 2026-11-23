// CLI simulator (`pnpm simulate`, spec 04 FR-418, FR-419). Plays all-AI games through `runAiLoop`
// and prints a four-line summary. Usage:
//
//   pnpm simulate [--preset <id>] [--players <n>] [--games <n>] [--seed <prefix>]
//
// Defaults: argentina-fidepo, the preset's minimum player count, 100 games, seed prefix `sim`.
// Game i uses seed `<prefix>-<i>`. Invalid arguments or a failing game print one line to stderr
// and exit 1; stdout is written only after every game has been played.
import { parseArgs } from 'node:util';
import { DEFAULT_PRESET_ID, PRESET_IDS, getPreset } from '@/src/domain/presets';
import type { RuleSet } from '@/src/domain/rules';
import type { SeatInfo } from '@/src/domain/types';
import { createGame } from '@/src/engine/engine';
import { createPlayers } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { runAiLoop } from '@/src/service/ai-loop';

const DEFAULT_GAMES = 100;
const DEFAULT_SEED_PREFIX = 'sim';
const POSITIVE_INT = /^[1-9][0-9]*$/;

interface SimulateOptions {
  rules: RuleSet;
  players: number;
  games: number;
  seedPrefix: string;
}

/** Thrown for an invalid command line; the message is the single stderr line (without prefix). */
class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Parses and validates the command line (plan P-5: `parseArgs`, strict, string options). */
function parseOptions(args: string[]): SimulateOptions {
  let values: { preset?: string; players?: string; games?: string; seed?: string };
  try {
    ({ values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        preset: { type: 'string' },
        players: { type: 'string' },
        games: { type: 'string' },
        seed: { type: 'string' },
      },
    }));
  } catch (error) {
    // parseArgs messages can span several lines; the first one names the problem.
    throw new UsageError(String(error instanceof Error ? error.message : error).split('\n')[0]);
  }

  const presetId = values.preset ?? DEFAULT_PRESET_ID;
  if (!(PRESET_IDS as readonly string[]).includes(presetId)) {
    throw new UsageError(`unknown preset "${presetId}" (known: ${PRESET_IDS.join(', ')})`);
  }
  const rules = getPreset(presetId);
  const { min, max } = rules.players;

  let players = min;
  if (values.players !== undefined) {
    const n = POSITIVE_INT.test(values.players) ? Number(values.players) : NaN;
    if (!(n >= min && n <= max)) {
      throw new UsageError(
        `--players must be an integer from ${min} to ${max} for ${presetId}, got "${values.players}"`,
      );
    }
    players = n;
  }

  let games = DEFAULT_GAMES;
  if (values.games !== undefined) {
    if (!POSITIVE_INT.test(values.games)) {
      throw new UsageError(`--games must be a positive integer, got "${values.games}"`);
    }
    games = Number(values.games);
  }

  const seedPrefix = values.seed ?? DEFAULT_SEED_PREFIX;
  if (seedPrefix === '') {
    throw new UsageError('--seed must not be empty');
  }

  return { rules, players, games, seedPrefix };
}

/** All-AI seats per plan P-4 (no `strategy`, so `random`). */
function aiSeats(players: number): SeatInfo[] {
  return Array.from({ length: players }, (_, i) => ({
    seat: i,
    playerId: `ai-${i}`,
    name: `AI ${i}`,
    kind: 'ai' as const,
  }));
}

/** One decimal, never `-0.0`. */
function oneDecimal(value: number): string {
  const text = value.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
}

function main(args: string[]): number {
  let options: SimulateOptions;
  try {
    options = parseOptions(args);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`simulate: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const { rules, players, games, seedPrefix } = options;
  const seats = aiSeats(players);

  const totals = new Array<number>(players).fill(0);
  let made = 0;
  let hands = 0;
  let handsPerGame = 0;

  const started = performance.now();
  for (let i = 0; i < games; i += 1) {
    const seed = `${seedPrefix}-${i}`;
    try {
      const start = createGame({ gameId: 'sim', rules, seats, seed });
      const { state } = runAiLoop(start.state, createPlayers(seats));
      if (state.phase !== 'game-over') {
        throw new Error(`game stopped in phase "${state.phase}" before game over`);
      }
      const board = evaluate(state);
      handsPerGame = state.handPlan.length;
      hands += board.hands.length;
      for (let seat = 0; seat < players; seat += 1) {
        totals[seat] += board.totals[seat];
        made += board.madeCount[seat];
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`simulate: game ${seed} failed: ${message}\n`);
      return 1;
    }
  }
  const seconds = (performance.now() - started) / 1000;

  const averages = totals.map((total, seat) => `${seat}: ${oneDecimal(total / games)}`);
  const madeRate = (made / (hands * players)) * 100; // plan P-1
  process.stdout.write(
    [
      `preset: ${rules.id}  players: ${players}  games: ${games}  hands/game: ${handsPerGame}`,
      `average total per seat: ${averages.join('  ')}`,
      `made-bid rate: ${oneDecimal(madeRate)}%`,
      `duration: ${oneDecimal(seconds)} s`,
    ].join('\n') + '\n',
  );
  return 0;
}

process.exitCode = main(process.argv.slice(2));
