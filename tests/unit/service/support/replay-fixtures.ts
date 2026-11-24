// A stored human-plus-AI commit chain built without GameService (plan Iteration 1, P-9).
// Tests may import any layer.
import { DEFAULT_PRESET_ID, getPreset } from '@/src/domain/presets';
import type { PresetId } from '@/src/domain/rules';
import type { GameEvent, GameState, SeatInfo } from '@/src/domain/types';
import { applyMove, createGame, ENGINE_VERSION, legalMoves } from '@/src/engine/engine';
import { createPlayers } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { runAiLoop } from '@/src/service/ai-loop';
import { CommitSchema, GameMetaSchema, type Commit, type GameMeta } from '@/src/state/schemas';
import { CREATED_AT, GAME_ID, HUMAN_HASH } from '../../state/support/fixtures';

/** Options of `buildStoredChain`. */
export interface StoredChainOptions {
  /** Stop after this many commits even before `game-over` (default: play to `game-over`). */
  maxCommits?: number;
  /** The game's seed (default `'replay-seed'`). */
  seed?: string;
  /** The game's id (default `GAME_ID`). */
  gameId?: string;
  /** The rules preset (default `DEFAULT_PRESET_ID`). */
  presetId?: PresetId;
}

/** Seat 0 human `'human-0'`, seats 1–3 AI `'ai-<i>'` with strategy `random` (spec 07 FR-703). */
export function chainSeats(): SeatInfo[] {
  return [
    { seat: 0, playerId: 'human-0', name: 'Ana', kind: 'human' },
    ...[1, 2, 3].map((i) => ({
      seat: i,
      playerId: `ai-${i}`,
      name: `AI ${i}`,
      kind: 'ai' as const,
      strategy: 'random',
    })),
  ];
}

/** `at` of commit `n`: `CREATED_AT` + `n` minutes. */
function atOf(n: number): string {
  return new Date(Date.parse(CREATED_AT) + n * 60_000).toISOString();
}

/** The stored document of version `n`, validated with `CommitSchema` (returns the parsed copy). */
function storedCommit(
  n: number,
  state: GameState,
  events: GameEvent[],
  clientRequestId: string | null,
): Commit {
  const versioned: GameState = { ...state, version: n };
  return CommitSchema.parse({
    schemaVersion: 1,
    version: n,
    at: atOf(n),
    actorSeat: clientRequestId === null ? null : 0,
    clientRequestId,
    events,
    state: versioned,
    scoreboard: evaluate(versioned),
  });
}

/**
 * A stored game as `GameService` would write it, built directly with the engine and the AI loop:
 * commit 0 = engine `createGame` (1 human at seat 0, 3 `random` AIs) + `runAiLoop`; each later
 * commit = the human's first legal move + `runAiLoop`, with `actorSeat 0` and
 * `clientRequestId 'req-<n>'`. Stops at `game-over` or after `opts.maxCommits` commits. Every
 * commit and the meta are validated with their schemas.
 */
export function buildStoredChain(opts: StoredChainOptions = {}): {
  meta: GameMeta;
  commits: Commit[];
} {
  const gameId = opts.gameId ?? GAME_ID;
  const presetId = opts.presetId ?? DEFAULT_PRESET_ID;
  const seats = chainSeats();
  const meta = GameMetaSchema.parse({
    schemaVersion: 1,
    gameId,
    presetId,
    engineVersion: ENGINE_VERSION,
    createdAt: CREATED_AT,
    seats,
    seatTokenHashes: [HUMAN_HASH, null, null, null],
  });

  const start = createGame({
    gameId,
    rules: getPreset(presetId),
    seats,
    seed: opts.seed ?? 'replay-seed',
  });
  const loop0 = runAiLoop(start.state, createPlayers(seats));
  const commits = [storedCommit(0, loop0.state, [...start.events, ...loop0.events], null)];
  const max = opts.maxCommits ?? Number.POSITIVE_INFINITY;

  while (commits.length < max) {
    const tip = commits[commits.length - 1];
    if (tip.state.phase === 'game-over') break;
    const [first] = legalMoves(tip.state, 0);
    if (first === undefined) throw new Error(`seat 0 has no legal move at version ${tip.version}`);
    const n = tip.version + 1;
    const human = applyMove(tip.state, 0, first.id);
    const loop = runAiLoop(human.state, createPlayers(human.state.seats));
    commits.push(storedCommit(n, loop.state, [...human.events, ...loop.events], `req-${n}`));
  }
  return { meta, commits };
}
