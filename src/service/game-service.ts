// GameService: the orchestrator of engine, score, players and state (spec 07; plan P-2–P-8).
// All I/O goes through `deps.state`; time and randomness go through `deps.now` and
// `deps.randomBytes` (BR-705).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DEFAULT_PRESET_ID, getPreset, UnknownPresetError } from '@/src/domain/presets';
import type { PresetId, RuleSet } from '@/src/domain/rules';
import type { GameEvent, PlayerUpdate, SeatInfo, Transition } from '@/src/domain/types';
import {
  applyMove,
  createGame,
  ENGINE_VERSION,
  IllegalMoveError,
  legalMoves,
} from '@/src/engine/engine';
import { createPlayers } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import {
  CommitConflictError,
  CommitNotFoundError,
  GameNotFoundError,
  InvalidGameIdError,
} from '@/src/state/errors';
import type { GameStateManager } from '@/src/state/game-state-manager';
import { assertValidGameId, MAX_COMMIT_VERSION } from '@/src/state/keys';
import type { Commit, CommitBody, GameMeta } from '@/src/state/schemas';
import { runAiLoop } from './ai-loop';
import {
  GameNotFound,
  GameUnsupported,
  IllegalMove,
  InvalidRequest,
  NotYourTurn,
  Unauthorized,
  VersionConflict,
} from './errors';
import { buildPlayerView } from './player-view';

/** The collaborators of `GameService` (FR-700). Only `state` is required. */
export interface GameServiceDeps {
  state: GameStateManager;
  /** The preset used when a `createGame` request names none (default `DEFAULT_PRESET_ID`). */
  defaultPresetId?: PresetId;
  /** The clock (default: the system clock). */
  now?: () => Date;
  /** The source of secret bytes (default: `node:crypto`). */
  randomBytes?: (n: number) => Uint8Array;
}

/** The input of `createGame` (FR-701). */
export interface CreateGameRequest {
  rulesPreset?: string;
  humanName: string;
  aiCount: number;
}

/** The result of `createGame` (FR-705). `seatToken` is returned here and nowhere else. */
export interface CreateGameResult {
  gameId: string;
  seat: number;
  seatToken: string;
  update: PlayerUpdate;
}

/** The input of `submitMove` (FR-713). */
export interface SubmitMoveRequest {
  version: number;
  moveId: string;
  clientRequestId: string;
}

/** The longest trimmed `humanName` (FR-701). */
const MAX_HUMAN_NAME = 40;
/** The AI seat count range (FR-701). */
const MIN_AI_COUNT = 2;
const MAX_AI_COUNT = 5;
/** Byte lengths of the generated secrets, in the order they are drawn (FR-702, P-2). */
const GAME_ID_BYTES = 16;
const SEED_BYTES = 32;
const SEAT_TOKEN_BYTES = 32;
/** The longest `moveId` and `clientRequestId` (FR-713). */
const MAX_MOVE_ID = 32;
const MAX_CLIENT_REQUEST_ID = 128;
/** The most `state.load` calls `#missedEvents` keeps in flight at once (FR-716). */
const MISSED_EVENTS_CONCURRENCY = 8;

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

/** Lowercase RFC 4648 base32 without padding; trailing bits are zero-filled (P-2). */
function base32Lower(bytes: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** The 64-character lowercase hex SHA-256 of the UTF-8 seat token (FR-702). */
function seatTokenHash(seatToken: string): string {
  return createHash('sha256').update(seatToken, 'utf8').digest('hex');
}

/** True iff `value` is an integer from `min` to `max`. */
function isIntInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/** True iff `value` is a string of `min` to `max` UTF-16 code units. */
function isStringOfLength(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

/** True iff `commit` was made by `seat` for the request `clientRequestId` (FR-714 match test). */
function isSameRequest(commit: Commit, seat: number, clientRequestId: string): boolean {
  return commit.clientRequestId === clientRequestId && commit.actorSeat === seat;
}

/**
 * Maps `items` through `fn` with at most `limit` calls pending at once. Results keep the order of
 * `items`. Rejects with the first rejection and starts no further calls after it. (A copy of the
 * state layer's private helper, P-5.)
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** A loaded, authenticated game: its meta, its tip commit and the caller's seat. */
interface AuthenticatedGame {
  meta: GameMeta;
  tip: Commit;
  seat: number;
}

export class GameService {
  readonly #state: GameStateManager;
  readonly #defaultPresetId: PresetId;
  readonly #now: () => Date;
  readonly #randomBytes: (n: number) => Uint8Array;

  /** Stores `deps`; does no I/O and does not read the app config (FR-700). */
  constructor(deps: GameServiceDeps) {
    this.#state = deps.state;
    this.#defaultPresetId = deps.defaultPresetId ?? DEFAULT_PRESET_ID;
    this.#now = deps.now ?? (() => new Date());
    this.#randomBytes = deps.randomBytes ?? ((n: number) => randomBytes(n));
  }

  /**
   * Creates a game with one human at seat 0 and `aiCount` random AIs (FR-701–FR-705): validates
   * `req` before any I/O, generates the id, seed and seat token, lets the AIs play until the human
   * must act, and writes meta + commit 0 with `state.create`.
   */
  async createGame(req: CreateGameRequest): Promise<CreateGameResult> {
    const { humanName, aiCount, presetId, rules } = this.#validateCreate(req);

    const gameId = base32Lower(this.#randomBytes(GAME_ID_BYTES));
    const seed = Buffer.from(this.#randomBytes(SEED_BYTES)).toString('hex');
    const seatToken = Buffer.from(this.#randomBytes(SEAT_TOKEN_BYTES)).toString('base64url');

    const seats: SeatInfo[] = [{ seat: 0, playerId: 'human-0', name: humanName, kind: 'human' }];
    for (let i = 1; i <= aiCount; i++) {
      seats.push({ seat: i, playerId: `ai-${i}`, name: `AI ${i}`, kind: 'ai', strategy: 'random' });
    }

    const start = createGame({ gameId, rules, seats, seed });
    const loop = runAiLoop(start.state, createPlayers(seats));
    const at = this.#now().toISOString();
    const meta: GameMeta = {
      schemaVersion: 1,
      gameId,
      presetId,
      engineVersion: ENGINE_VERSION,
      createdAt: at,
      seats,
      seatTokenHashes: [seatTokenHash(seatToken), ...seats.slice(1).map(() => null)],
    };
    const initial: CommitBody = {
      version: 0,
      at,
      actorSeat: null,
      clientRequestId: null,
      events: [...start.events, ...loop.events],
      state: loop.state,
      scoreboard: evaluate(loop.state),
    };
    const commit0 = await this.#state.create(meta, initial);
    return { gameId, seat: 0, seatToken, update: this.#update(commit0, 0, commit0.events) };
  }

  /**
   * The tip's PlayerUpdate for the authenticated seat (FR-706–FR-711). `events` is `[]` without
   * `sinceVersion`, else the missed events from `sinceVersion` to the tip.
   */
  async getUpdate(gameId: string, seatToken: string, sinceVersion?: number): Promise<PlayerUpdate> {
    this.#validateIdAndToken(gameId, seatToken);
    if (sinceVersion !== undefined && !isIntInRange(sinceVersion, 0, MAX_COMMIT_VERSION)) {
      throw new InvalidRequest('sinceVersion');
    }
    const { tip, seat } = await this.#loadAndAuthenticate(gameId, seatToken);
    const events =
      sinceVersion === undefined ? [] : await this.#missedEvents(gameId, sinceVersion, tip);
    return this.#update(tip, seat, events);
  }

  /**
   * Applies the human's move and the AIs' replies as one commit (FR-712–FR-722): validates, loads
   * and authenticates; answers a stale `req.version` with the original result of the same request
   * or a `VersionConflict`; otherwise applies the move, runs the AI loop and commits `version + 1`
   * with a create-only write, turning a lost race into the winner's result or a `VersionConflict`.
   */
  async submitMove(
    gameId: string,
    seatToken: string,
    req: SubmitMoveRequest,
  ): Promise<PlayerUpdate> {
    this.#validateIdAndToken(gameId, seatToken);
    this.#validateSubmit(req);
    const { tip, seat } = await this.#loadAndAuthenticate(gameId, seatToken);

    if (req.version !== tip.version) {
      if (req.version < tip.version) {
        const next = await this.#state.load(gameId, req.version + 1);
        if (isSameRequest(next, seat, req.clientRequestId)) {
          return this.#update(next, seat, next.events);
        }
      }
      const missed = await this.#missedEvents(gameId, req.version, tip);
      throw new VersionConflict(this.#update(tip, seat, missed));
    }

    const human = this.#applyHumanMove(tip, seat, req.moveId);
    const loop = runAiLoop(human.state, createPlayers(human.state.seats));
    const version = req.version + 1;
    const state = { ...loop.state, version };
    const body: CommitBody = {
      version,
      at: this.#now().toISOString(),
      actorSeat: seat,
      clientRequestId: req.clientRequestId,
      events: [...human.events, ...loop.events],
      state,
      scoreboard: evaluate(state),
    };

    let committed: Commit;
    try {
      committed = await this.#state.commit(gameId, body);
    } catch (err) {
      if (err instanceof CommitConflictError) return this.#resolveRace(gameId, seat, req);
      throw err;
    }
    if (committed.state.phase === 'game-over') {
      await this.#state.writeFinalScores(gameId, committed.version, committed.scoreboard);
    }
    return this.#update(committed, seat, committed.events);
  }

  /**
   * FR-701 checks, in order, first failure wins: `humanName`, `aiCount`, `rulesPreset`, then
   * `aiCount + 1` within the preset's player range. Resolves the preset (P-4).
   */
  #validateCreate(req: CreateGameRequest): {
    humanName: string;
    aiCount: number;
    presetId: PresetId;
    rules: RuleSet;
  } {
    const { humanName, aiCount, rulesPreset } = req;
    if (typeof humanName !== 'string') throw new InvalidRequest('humanName');
    const name = humanName.trim();
    if (name.length < 1 || name.length > MAX_HUMAN_NAME) throw new InvalidRequest('humanName');
    if (!isIntInRange(aiCount, MIN_AI_COUNT, MAX_AI_COUNT)) throw new InvalidRequest('aiCount');

    let presetId: string = this.#defaultPresetId;
    let rules: RuleSet;
    if (rulesPreset === undefined) {
      rules = getPreset(presetId);
    } else {
      if (typeof rulesPreset !== 'string') throw new InvalidRequest('rulesPreset');
      presetId = rulesPreset;
      try {
        rules = getPreset(presetId);
      } catch (err) {
        if (err instanceof UnknownPresetError) throw new InvalidRequest('rulesPreset');
        throw err;
      }
    }
    const players = aiCount + 1;
    if (players < rules.players.min || players > rules.players.max) {
      throw new InvalidRequest('aiCount');
    }
    // getPreset accepted the id, so it is a PresetId.
    return { humanName: name, aiCount, presetId: presetId as PresetId, rules };
  }

  /** FR-706 steps 1–2: a malformed `gameId` → `GameNotFound`; an empty token → `Unauthorized`. */
  #validateIdAndToken(gameId: string, seatToken: string): void {
    try {
      assertValidGameId(gameId);
    } catch (err) {
      if (err instanceof InvalidGameIdError) {
        throw new GameNotFound(typeof gameId === 'string' ? gameId : String(gameId));
      }
      throw err;
    }
    if (typeof seatToken !== 'string' || seatToken.length === 0) throw new Unauthorized();
  }

  /** FR-713 checks, in order, first failure wins: `version`, `moveId`, `clientRequestId`. */
  #validateSubmit(req: SubmitMoveRequest): void {
    const { version, moveId, clientRequestId } = req;
    if (!isIntInRange(version, 0, MAX_COMMIT_VERSION - 1)) throw new InvalidRequest('version');
    if (!isStringOfLength(moveId, 1, MAX_MOVE_ID)) throw new InvalidRequest('moveId');
    if (!isStringOfLength(clientRequestId, 1, MAX_CLIENT_REQUEST_ID)) {
      throw new InvalidRequest('clientRequestId');
    }
  }

  /**
   * Applies the human's move to the tip (FR-715). The engine's `not-your-turn` → `NotYourTurn`;
   * `game-over` and `unknown-move` → `IllegalMove`. Other errors propagate.
   */
  #applyHumanMove(tip: Commit, seat: number, moveId: string): Transition {
    try {
      return applyMove(tip.state, seat, moveId);
    } catch (err) {
      if (!(err instanceof IllegalMoveError)) throw err;
      if (err.reason === 'not-your-turn') throw new NotYourTurn(seat);
      throw new IllegalMove(moveId, err.reason);
    }
  }

  /**
   * After a `CommitConflictError` on commit `req.version + 1` (FR-719): resolves to that commit's
   * update when it holds the same request from the same seat (no `final.json` write, FR-721).
   * Otherwise (including a missing commit) rejects with `VersionConflict` from a fresh tip, with
   * the missed events from `req.version`.
   */
  async #resolveRace(gameId: string, seat: number, req: SubmitMoveRequest): Promise<PlayerUpdate> {
    let winner: Commit | null = null;
    try {
      winner = await this.#state.load(gameId, req.version + 1);
    } catch (err) {
      if (!(err instanceof CommitNotFoundError)) throw err;
    }
    if (winner !== null && isSameRequest(winner, seat, req.clientRequestId)) {
      return this.#update(winner, seat, winner.events);
    }
    let latest: Commit;
    try {
      latest = await this.#state.loadLatest(gameId);
    } catch (err) {
      if (err instanceof GameNotFoundError) throw new GameNotFound(gameId);
      throw err;
    }
    const missed = await this.#missedEvents(gameId, req.version, latest);
    throw new VersionConflict(this.#update(latest, seat, missed));
  }

  /**
   * Loads meta and tip in parallel (FR-707), authenticates the seat (FR-708) and refuses another
   * engine version (FR-709). A state `GameNotFoundError` → `GameNotFound`; other errors propagate.
   */
  async #loadAndAuthenticate(gameId: string, seatToken: string): Promise<AuthenticatedGame> {
    let meta: GameMeta;
    let tip: Commit;
    try {
      [meta, tip] = await Promise.all([
        this.#state.loadMeta(gameId),
        this.#state.loadLatest(gameId),
      ]);
    } catch (err) {
      if (err instanceof GameNotFoundError) throw new GameNotFound(gameId);
      throw err;
    }
    const seat = this.#authenticate(meta, seatToken);
    if (meta.engineVersion !== ENGINE_VERSION) {
      throw new GameUnsupported(gameId, meta.engineVersion);
    }
    return { meta, tip, seat };
  }

  /**
   * The seat whose stored hash equals the token's SHA-256, compared in constant time against every
   * non-null hash whatever the outcome (FR-708, P-3). No match → `Unauthorized`.
   */
  #authenticate(meta: GameMeta, seatToken: string): number {
    const digest = createHash('sha256').update(seatToken, 'utf8').digest();
    let seat = -1;
    for (let i = 0; i < meta.seatTokenHashes.length; i++) {
      const hash = meta.seatTokenHashes[i];
      if (hash === null) continue;
      const match = timingSafeEqual(digest, Buffer.from(hash, 'hex'));
      if (match && seat === -1) seat = i;
    }
    if (seat === -1) throw new Unauthorized();
    return seat;
  }

  /**
   * The events of commits `from + 1 … tip.version` in version order (FR-716, P-5): `[]` when
   * `from ≥ tip.version`; commits before the tip are read with `state.load`, at most 8 in flight,
   * and the tip's own events are reused, so the events end exactly at `tip.version`.
   */
  async #missedEvents(gameId: string, from: number, tip: Commit): Promise<GameEvent[]> {
    if (from >= tip.version) return [];
    const versions: number[] = [];
    for (let v = from + 1; v < tip.version; v++) versions.push(v);
    const commits = await mapLimit(versions, MISSED_EVENTS_CONCURRENCY, (v) =>
      this.#state.load(gameId, v),
    );
    return [...commits.flatMap((commit) => commit.events), ...tip.events];
  }

  /** The PlayerUpdate of `commit` for `seat` with the given `events` (FR-716, P-6). */
  #update(commit: Commit, seat: number, events: GameEvent[]): PlayerUpdate {
    return {
      version: commit.version,
      events,
      view: buildPlayerView(commit.state, seat),
      legalMoves: legalMoves(commit.state, seat),
    };
  }
}
