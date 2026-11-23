/*
 * Typed errors of the game state layer. Messages carry at most a gameId, a version and a fixed
 * reason token: never a seed, a hand, a seat-token hash or a document body (spec BR-604).
 */

/** A gameId does not match the game id format. */
export class InvalidGameIdError extends Error {
  readonly gameId: string;

  constructor(gameId: string) {
    super(`Invalid game id: "${gameId}"`);
    this.name = 'InvalidGameIdError';
    this.gameId = gameId;
  }
}

/** The game's `meta.json` or commit 0 is missing. */
export class GameNotFoundError extends Error {
  readonly gameId: string;

  constructor(gameId: string) {
    super(`Game not found: ${gameId}`);
    this.name = 'GameNotFoundError';
    this.gameId = gameId;
  }
}

/** `create` found a different game already stored under the same gameId. */
export class GameExistsError extends Error {
  readonly gameId: string;

  constructor(gameId: string) {
    super(`Game already exists: ${gameId}`);
    this.name = 'GameExistsError';
    this.gameId = gameId;
  }
}

/** A commit of an existing game is missing. */
export class CommitNotFoundError extends Error {
  readonly gameId: string;
  readonly version: number;

  constructor(gameId: string, version: number) {
    super(`Commit ${version} not found in game ${gameId}`);
    this.name = 'CommitNotFoundError';
    this.gameId = gameId;
    this.version = version;
  }
}

/** Another commit with the same version was stored first. */
export class CommitConflictError extends Error {
  readonly gameId: string;
  readonly version: number;

  constructor(gameId: string, version: number) {
    super(`Commit ${version} already exists in game ${gameId}`);
    this.name = 'CommitConflictError';
    this.gameId = gameId;
    this.version = version;
  }
}

/** A document to write failed validation. `reason` names the failed check, never a value. */
export class InvalidCommitError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Invalid document: ${reason}`);
    this.name = 'InvalidCommitError';
    this.reason = reason;
  }
}
