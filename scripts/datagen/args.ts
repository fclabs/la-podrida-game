// Command-line parsing for `pnpm generate-data` (spec 12 FR-1202, FR-1203). Pure: no I/O.
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { DEFAULT_PRESET_ID, PRESET_IDS, getPreset } from '@/src/domain/presets';
import { STRATEGY_NAMES } from '@/src/players/registry';
import {
  DEFAULT_GAMES,
  DEFAULT_OUT,
  DEFAULT_REPLAY_EVERY,
  DEFAULT_SHARD_SIZE,
  DEFAULT_STRATEGY,
} from './constants';

/** Thrown for an invalid command line; the message is the single stderr line (without prefix). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export interface RunOptions {
  run_id: string;
  preset: string;
  players: number;
  games: number;
  shard_size: number;
  strategies: string[];
  workers: number;
  replay_every: number;
  out: string;
}

export interface ValidateOptions {
  run_id: string;
  out: string;
}

const POSITIVE_INT = /^[1-9][0-9]*$/;
const RUN_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_RUN_ID_LENGTH = 64;

/** Runs `parseArgs` (strict, string options); the first line of its message becomes the error. */
function parseValues<T extends string>(argv: readonly string[], names: readonly T[]) {
  const options: Record<string, { type: 'string' }> = {};
  for (const name of names) options[name] = { type: 'string' };
  try {
    return parseArgs({ args: [...argv], strict: true, allowPositionals: false, options })
      .values as {
      [K in T]?: string;
    };
  } catch (error) {
    // parseArgs messages can span several lines; the first one names the problem.
    throw new UsageError(String(error instanceof Error ? error.message : error).split('\n')[0]);
  }
}

function checkRunId(runId: string | undefined): string {
  if (runId === undefined) throw new UsageError('--run-id is required');
  if (runId.length > MAX_RUN_ID_LENGTH) {
    throw new UsageError(`--run-id must be at most ${MAX_RUN_ID_LENGTH} characters`);
  }
  if (!RUN_ID.test(runId)) {
    throw new UsageError(
      `--run-id must be lowercase letters and digits separated by single hyphens, got "${runId}"`,
    );
  }
  if (runId.startsWith('eval')) {
    throw new UsageError(`--run-id must not start with "eval" (reserved), got "${runId}"`);
  }
  return runId;
}

function positiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!POSITIVE_INT.test(value)) {
    throw new UsageError(`--${name} must be a positive integer, got "${value}"`);
  }
  return Number(value);
}

/**
 * Parses the arguments after `run`. When several things are wrong the first is reported, checking
 * in the order of the options in the spec's Command line block.
 */
export function parseRunArgs(argv: readonly string[]): RunOptions {
  const values = parseValues(argv, [
    'run-id',
    'preset',
    'players',
    'games',
    'shard-size',
    'strategies',
    'workers',
    'replay-every',
    'out',
  ] as const);

  const run_id = checkRunId(values['run-id']);

  const preset = values.preset ?? DEFAULT_PRESET_ID;
  if (!(PRESET_IDS as readonly string[]).includes(preset)) {
    throw new UsageError(`unknown preset "${preset}" (known: ${PRESET_IDS.join(', ')})`);
  }
  const { min, max } = getPreset(preset).players;

  let players = min;
  if (values.players !== undefined) {
    const n = POSITIVE_INT.test(values.players) ? Number(values.players) : NaN;
    if (!(n >= min && n <= max)) {
      throw new UsageError(
        `--players must be an integer from ${min} to ${max} for ${preset}, got "${values.players}"`,
      );
    }
    players = n;
  }

  const games = positiveInt('games', values.games, DEFAULT_GAMES);
  const shard_size = positiveInt('shard-size', values['shard-size'], DEFAULT_SHARD_SIZE);

  let strategies: string[];
  if (values.strategies === undefined) {
    strategies = Array.from({ length: players }, () => DEFAULT_STRATEGY);
  } else {
    strategies = values.strategies.split(',');
    if (strategies.length !== players) {
      throw new UsageError(
        `--strategies must list ${players} strategies (one per player), got ${strategies.length}`,
      );
    }
    if (strategies.some((name) => name === '')) {
      throw new UsageError('--strategies must not contain an empty item');
    }
    const unknown = strategies.find((name) => !STRATEGY_NAMES.includes(name));
    if (unknown !== undefined) {
      throw new UsageError(`unknown strategy "${unknown}" (known: ${STRATEGY_NAMES.join(', ')})`);
    }
  }

  const workers = positiveInt('workers', values.workers, availableParallelism());
  const replay_every = positiveInt('replay-every', values['replay-every'], DEFAULT_REPLAY_EVERY);
  const out = values.out ?? DEFAULT_OUT;

  return { run_id, preset, players, games, shard_size, strategies, workers, replay_every, out };
}

/** Parses the arguments after `validate`: `--run-id` and `--out` only. */
export function parseValidateArgs(argv: readonly string[]): ValidateOptions {
  const values = parseValues(argv, ['run-id', 'out'] as const);
  return { run_id: checkRunId(values['run-id']), out: values.out ?? DEFAULT_OUT };
}
