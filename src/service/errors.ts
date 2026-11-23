// The seven typed errors of GameService (spec 07 Data & Interfaces, BR-701; plan P-1). Messages
// carry only the values named below, never a seed, a seat token, a hash or a hand.
import type { PlayerUpdate } from '@/src/domain/types';

/** The longest prefix of a caller's `gameId` that `GameNotFound` keeps (plan P-1). */
const MAX_ECHOED_GAME_ID = 64;

/** `req.version` is not the tip and the request is not a retry (FR-714, FR-719). → 409 */
export class VersionConflict extends Error {
  readonly update: PlayerUpdate;

  constructor(update: PlayerUpdate) {
    super(`Version conflict: the game is at version ${update.version}`);
    this.name = 'VersionConflict';
    this.update = update;
  }
}

/** The engine rejected the human's move as `game-over` or `unknown-move` (FR-715). → 422 */
export class IllegalMove extends Error {
  readonly moveId: string;
  readonly reason: 'game-over' | 'unknown-move';

  constructor(moveId: string, reason: 'game-over' | 'unknown-move') {
    super(`Illegal move "${moveId}": ${reason}`);
    this.name = 'IllegalMove';
    this.moveId = moveId;
    this.reason = reason;
  }
}

/** The authenticated seat is not the one to act (FR-715). → 403 */
export class NotYourTurn extends Error {
  readonly seat: number;

  constructor(seat: number) {
    super(`Not your turn (seat ${seat})`);
    this.name = 'NotYourTurn';
    this.seat = seat;
  }
}

/** The seat token is missing or matches no seat of the game (FR-706, FR-708). → 401 */
export class Unauthorized extends Error {
  constructor() {
    super('Unauthorized');
    this.name = 'Unauthorized';
  }
}

/**
 * The game id is malformed or names no stored game (FR-706, FR-707). → 404. The id is the caller's
 * raw input, clipped to its first 64 characters in both the field and the message.
 */
export class GameNotFound extends Error {
  readonly gameId: string;

  constructor(gameId: string) {
    const clipped = gameId.slice(0, MAX_ECHOED_GAME_ID);
    super(`Game not found: ${clipped}`);
    this.name = 'GameNotFound';
    this.gameId = clipped;
  }
}

/**
 * An argument failed validation before any I/O (FR-701, FR-711, FR-713). → 400. `reason` names
 * the field: `humanName`, `aiCount`, `rulesPreset`, `sinceVersion`, `version`, `moveId` or
 * `clientRequestId`.
 */
export class InvalidRequest extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Invalid request: ${reason}`);
    this.name = 'InvalidRequest';
    this.reason = reason;
  }
}

/** The game was stored by another `ENGINE_VERSION` (FR-709, FR-723). → Phase 8 decides. */
export class GameUnsupported extends Error {
  readonly gameId: string;
  readonly engineVersion: number;

  constructor(gameId: string, engineVersion: number) {
    super(
      `Game ${gameId} was created with engine version ${engineVersion}, which this server does not support`,
    );
    this.name = 'GameUnsupported';
    this.gameId = gameId;
    this.engineVersion = engineVersion;
  }
}
