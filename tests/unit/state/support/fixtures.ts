// Shared fixtures for the state tests (plan P-10). Tests may import any layer.
import { DEFAULT_PRESET_ID, getPreset } from '@/src/domain/presets';
import type { GameEvent, GameState, SeatInfo } from '@/src/domain/types';
import { createGame, ENGINE_VERSION } from '@/src/engine/engine';
import { evaluate } from '@/src/score/score-engine';
import { commitKey, headKey, metaKey } from '@/src/state/keys';
import type { Commit, CommitBody, GameMeta } from '@/src/state/schemas';
import { putJson, type ObjectStore } from '@/src/storage/object-store';

export const GAME_ID = 'abcdefghijklmnopqrstuvwxyz';
export const OTHER_GAME_ID = '234567234567234567234567ab';
export const HUMAN_HASH = 'ab'.repeat(32);
export const CREATED_AT = '2026-11-23T14:05:00.000Z';
export const SEED = 'test-seed';

/** Seat 0 human, seats 1–2 AI. */
export function makeSeats(): SeatInfo[] {
  return [
    { seat: 0, playerId: 'p0', name: 'Ana', kind: 'human' },
    { seat: 1, playerId: 'ai-1', name: 'AI 1', kind: 'ai' },
    { seat: 2, playerId: 'ai-2', name: 'AI 2', kind: 'ai' },
  ];
}

/** A valid `GameMeta` for `GAME_ID` (default preset, `CREATED_AT`), with `overrides` applied. */
export function makeMeta(overrides: Partial<GameMeta> = {}): GameMeta {
  return {
    schemaVersion: 1,
    gameId: GAME_ID,
    presetId: DEFAULT_PRESET_ID,
    engineVersion: ENGINE_VERSION,
    createdAt: CREATED_AT,
    seats: makeSeats(),
    seatTokenHashes: [HUMAN_HASH, null, null],
    ...overrides,
  };
}

/** A valid commit-0 body: `createGame` on the default preset, seed `SEED`, at `CREATED_AT`. */
export function makeInitial(gameId: string = GAME_ID): CommitBody {
  const { state, events } = createGame({
    gameId,
    rules: getPreset(DEFAULT_PRESET_ID),
    seats: makeSeats(),
    seed: SEED,
  });
  return {
    version: 0,
    at: CREATED_AT,
    actorSeat: null,
    clientRequestId: null,
    events,
    state,
    scoreboard: evaluate(state),
  };
}

/**
 * A valid body for version `n` following `prev`: `actorSeat 0`, `clientRequestId 'req-<n>'`,
 * `state = { ...prev.state, version: n }`, `at` = `CREATED_AT` + `n` minutes.
 */
export function makeCommitBody(
  prev: CommitBody | Commit,
  n: number,
  events: GameEvent[] = [],
): CommitBody {
  const state: GameState = { ...structuredClone(prev.state), version: n };
  return {
    version: n,
    at: new Date(Date.parse(CREATED_AT) + n * 60_000).toISOString(),
    actorSeat: 0,
    clientRequestId: `req-${n}`,
    events: structuredClone(events),
    state,
    scoreboard: evaluate(state),
  };
}

/** The stored document of a body. */
export function toCommit(body: CommitBody): Commit {
  return { schemaVersion: 1, ...body };
}

/** Bodies 0…`upTo` of one game, each built from the previous one. */
export function makeChain(upTo: number, gameId: string = GAME_ID): CommitBody[] {
  const chain = [makeInitial(gameId)];
  for (let n = 1; n <= upTo; n++) chain.push(makeCommitBody(chain[n - 1], n));
  return chain;
}

/**
 * Stores a game directly with `putJson` (no manager): `meta.json` (unless `meta: false`),
 * commits 0…`upTo` except those in `skip`, and `head.json` at `head` (omitted when `undefined`).
 * Returns the stored commits by version.
 */
export async function storeGame(
  store: ObjectStore,
  opts: { upTo: number; head?: number; meta?: boolean; skip?: number[]; gameId?: string },
): Promise<Commit[]> {
  const gameId = opts.gameId ?? GAME_ID;
  const commits = makeChain(opts.upTo, gameId).map(toCommit);
  if (opts.meta !== false) await putJson(store, metaKey(gameId), makeMeta({ gameId }));
  for (const commit of commits) {
    if (opts.skip?.includes(commit.version)) continue;
    await putJson(store, commitKey(gameId, commit.version), commit);
  }
  if (opts.head !== undefined) {
    await putJson(store, headKey(gameId), { schemaVersion: 1, version: opts.head });
  }
  return commits;
}
