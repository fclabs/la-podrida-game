// Shared fixtures for the GameService tests (plan P-10). Tests may import any layer.
import { createHash } from 'node:crypto';
import { DEFAULT_PRESET_ID, getPreset } from '@/src/domain/presets';
import type { PlayerUpdate, SeatInfo } from '@/src/domain/types';
import { createGame, ENGINE_VERSION } from '@/src/engine/engine';
import { createPlayers } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { runAiLoop } from '@/src/service/ai-loop';
import {
  GameService,
  type CreateGameResult,
  type GameServiceDeps,
} from '@/src/service/game-service';
import { GameStateManager } from '@/src/state/game-state-manager';
import type { Commit, GameMeta } from '@/src/state/schemas';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import type { ObjectStore } from '@/src/storage/object-store';
import { RecordingStore } from '../../state/support/store-wrappers';

/** The fixed clock of every service test. */
export const FIXED_NOW = new Date('2026-11-23T14:05:00.000Z');

/** The deps a test may override (everything except `state`). */
export type ServiceOverrides = Partial<Omit<GameServiceDeps, 'state'>>;

/**
 * A `GameService` over `store` (default: a `RecordingStore` around a fresh `MemoryObjectStore`),
 * with `now` fixed at `FIXED_NOW` and real randomness unless `overrides` say otherwise. Returns
 * the service, its `GameStateManager` and the store.
 */
export function makeService<S extends ObjectStore = RecordingStore>(
  store?: S,
  overrides: ServiceOverrides = {},
): { service: GameService; state: GameStateManager; store: S } {
  const actual = (store ?? new RecordingStore(new MemoryObjectStore())) as S;
  const state = new GameStateManager(actual);
  const service = new GameService({ state, now: () => FIXED_NOW, ...overrides });
  return { service, state, store: actual };
}

/**
 * A scripted `randomBytes`: the k-th call returns a copy of `seq[k]`. Throws when the script is
 * exhausted or when the requested length differs from the scripted entry's length.
 */
export function scriptedBytes(
  seq: ReadonlyArray<Uint8Array | readonly number[]>,
): (n: number) => Uint8Array {
  let call = 0;
  return (n: number) => {
    if (call >= seq.length) throw new Error(`scriptedBytes: no entry for call ${call}`);
    const bytes = Uint8Array.from(seq[call]);
    if (bytes.length !== n) {
      throw new Error(
        `scriptedBytes: call ${call} asked for ${n} bytes, script has ${bytes.length}`,
      );
    }
    call++;
    return bytes;
  };
}

/** `n` bytes with values `start, start + 1, …` (mod 256). */
export function byteRange(start: number, n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);
}

/** The id of the first legal move in `update`. Throws when there is none. */
export function firstLegalMoveId(update: PlayerUpdate): string {
  const [first] = update.legalMoves;
  if (first === undefined) throw new Error(`no legal move at version ${update.version}`);
  return first.id;
}

/**
 * Plays `created`'s game to `game-over` through `submitMove`: the human always plays its first
 * legal move at the latest version, with a fresh `clientRequestId` per call (`play-<n>`). Returns
 * every response, in order (the last one is the game-over update).
 */
export async function playToEnd(
  service: GameService,
  created: CreateGameResult,
): Promise<PlayerUpdate[]> {
  const responses: PlayerUpdate[] = [];
  let update = created.update;
  while (update.view.phase !== 'game-over') {
    update = await service.submitMove(created.gameId, created.seatToken, {
      version: update.version,
      moveId: firstLegalMoveId(update),
      clientRequestId: `play-${responses.length + 1}`,
    });
    responses.push(update);
  }
  return responses;
}

/** The 64-character lowercase hex SHA-256 of a seat token (FR-702). */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Options of `storeHandmadeGame`. */
export interface HandmadeGameOptions {
  gameId: string;
  seats: SeatInfo[];
  /** One entry per seat: the seat token of a human seat, `null` for an AI seat. */
  tokens: (string | null)[];
  seed: string;
  /** Run the AI loop before commit 0, as `createGame` does (default `true`). */
  runLoop?: boolean;
}

/**
 * Writes a game built without the service (engine `createGame`, optionally the AI loop) with
 * `GameStateManager.create`: default preset, `FIXED_NOW`, the given seats and seat tokens. Used
 * for states `createGame` cannot produce (an AI to act at the tip; several human seats).
 */
export async function storeHandmadeGame(
  state: GameStateManager,
  opts: HandmadeGameOptions,
): Promise<{ meta: GameMeta; commit0: Commit }> {
  const start = createGame({
    gameId: opts.gameId,
    rules: getPreset(DEFAULT_PRESET_ID),
    seats: opts.seats,
    seed: opts.seed,
  });
  const loop =
    opts.runLoop === false
      ? { state: start.state, events: [] }
      : runAiLoop(start.state, createPlayers(opts.seats));
  const at = FIXED_NOW.toISOString();
  const meta: GameMeta = {
    schemaVersion: 1,
    gameId: opts.gameId,
    presetId: DEFAULT_PRESET_ID,
    engineVersion: ENGINE_VERSION,
    createdAt: at,
    seats: opts.seats,
    seatTokenHashes: opts.tokens.map((t) => (t === null ? null : sha256Hex(t))),
  };
  const commit0 = await state.create(meta, {
    version: 0,
    at,
    actorSeat: null,
    clientRequestId: null,
    events: [...start.events, ...loop.events],
    state: loop.state,
    scoreboard: evaluate(loop.state),
  });
  return { meta, commit0 };
}
