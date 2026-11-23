import { InvalidGameIdError } from './errors';

/*
 * Key builders for the game storage layout (architecture §6.2). Every key is lowercase, numbers
 * that must sort are zero-padded, and no built key is a path prefix of another, so every key fits
 * the storage key rule on every driver.
 *
 *   games/{id}/meta.json
 *   games/{id}/commits/{version:08d}.json
 *   games/{id}/head.json
 *   games/{id}/scores/final.json
 *   index/created/{yyyy-mm-dd}/{id}
 */

/** The highest commit version a key can hold (8 zero-padded digits). */
export const MAX_COMMIT_VERSION = 99_999_999;

/** A game id: 128 random bits in lowercase RFC 4648 base32, no padding (26 characters). */
export const GAME_ID_PATTERN = /^[a-z2-7]{26}$/;

const COMMIT_FILE = /^(\d{8})\.json$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Throws `InvalidGameIdError` (naming the id) unless `id` matches `GAME_ID_PATTERN`. */
export function assertValidGameId(id: string): void {
  if (typeof id !== 'string' || !GAME_ID_PATTERN.test(id)) throw new InvalidGameIdError(id);
}

/** `games/{id}/` — every object of one game lives under it. */
export function gameKeyPrefix(id: string): string {
  assertValidGameId(id);
  return `games/${id}/`;
}

/** `games/{id}/meta.json`. */
export function metaKey(id: string): string {
  return `${gameKeyPrefix(id)}meta.json`;
}

/** `games/{id}/commits/` — the list prefix of a game's commits. */
export function commitsPrefix(id: string): string {
  return `${gameKeyPrefix(id)}commits/`;
}

/**
 * `games/{id}/commits/{version as 8 zero-padded digits}.json`. Throws `RangeError` (naming
 * `version`) unless `version` is an integer from 0 to `MAX_COMMIT_VERSION`.
 */
export function commitKey(id: string, version: number): string {
  const prefix = commitsPrefix(id);
  if (!Number.isInteger(version) || version < 0 || version > MAX_COMMIT_VERSION) {
    throw new RangeError(
      `Invalid commit version ${String(version)}: version must be an integer from 0 to ${MAX_COMMIT_VERSION}`,
    );
  }
  return `${prefix}${String(version).padStart(8, '0')}.json`;
}

/** `games/{id}/head.json` — the latest-version hint. */
export function headKey(id: string): string {
  return `${gameKeyPrefix(id)}head.json`;
}

/** `games/{id}/scores/final.json` — the final-scores cache. */
export function finalScoresKey(id: string): string {
  return `${gameKeyPrefix(id)}scores/final.json`;
}

/** The list prefix of every creation-index marker. */
export const indexCreatedPrefix = 'index/created/';

/**
 * `index/created/{date}/{id}`. `date` is a UTC `yyyy-mm-dd` string naming a real calendar date,
 * else `RangeError` (naming `date`). The id is checked first.
 */
export function indexCreatedKey(date: string, id: string): string {
  assertValidGameId(id);
  if (
    typeof date !== 'string' ||
    !DATE_PATTERN.test(date) ||
    !isCalendarDate(`${date}T00:00:00.000Z`, date)
  ) {
    throw new RangeError(`Invalid index date "${String(date)}": date must be a UTC yyyy-mm-dd`);
  }
  return `${indexCreatedPrefix}${date}/${id}`;
}

function isCalendarDate(timestamp: string, date: string): boolean {
  const parsed = new Date(timestamp);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * The version of `key` when it is exactly `commitKey(gameId, v)` for some `v`, else `null`.
 * Throws `InvalidGameIdError` for an invalid `gameId`.
 */
export function parseCommitKey(gameId: string, key: string): number | null {
  const prefix = commitsPrefix(gameId);
  if (typeof key !== 'string' || !key.startsWith(prefix)) return null;
  const match = COMMIT_FILE.exec(key.slice(prefix.length));
  return match === null ? null : Number(match[1]);
}
