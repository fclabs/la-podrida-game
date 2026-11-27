// Retention cleanup core (spec 10: FR-1002–FR-1006, FR-1009 (error shape), FR-1010, FR-1011,
// BR-1001, BR-1002, BR-1005, BR-1006; plan iterations 1–2). Walks the `index/created/` markers in key order, deletes every
// expired game's `games/{id}/` keys page by page, then its marker. Reads no game document and
// imports only the storage contract and the key builders.
import type { ObjectStore } from '@/src/storage/object-store';
import { GAME_ID_PATTERN, gameKeyPrefix, indexCreatedPrefix } from '@/src/state/keys';

/** The list page size used when a caller does not choose one (the `ObjectStore` maximum). */
export const DEFAULT_PAGE_SIZE = 1000;

/** The batch cap used when a caller does not choose one (FR-1006). */
export const DEFAULT_BATCH_SIZE = 500;

/** The most `list` rounds one game may need before the run fails (FR-1004). */
export const MAX_LIST_ROUNDS_PER_GAME = 10_000;

const MS_PER_DAY = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface CleanupOptions {
  store: ObjectStore;
  now: Date;
  retentionDays: number;
  /** Integer ≥ 1: the run stops after deleting this many games (FR-1006). */
  batchSize: number;
  /** Integer 1–1000 (the `ObjectStore` limit). */
  pageSize: number;
}

export interface CleanupResult {
  gamesDeleted: number;
  capReached: boolean;
  skippedMarkers: number;
}

/**
 * Thrown by `runCleanup` for any store error or the round limit (FR-1009). `gamesDeleted` counts
 * the games fully deleted before the failure; `cause` is the original error.
 */
export class CleanupFailedError extends Error {
  readonly gamesDeleted: number;

  constructor(gamesDeleted: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'CleanupFailedError';
    this.gamesDeleted = gamesDeleted;
  }
}

/** True when `day` is a real UTC calendar date written `yyyy-mm-dd`. */
function isCalendarDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const parsed = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/**
 * Parses `index/created/{day}/{id}`: `{ day, id }` when the day is a real calendar date and the id
 * a valid game id, else `null` (FR-1011).
 */
function parseMarkerKey(key: string): { day: string; id: string } | null {
  if (!key.startsWith(indexCreatedPrefix)) return null;
  const parts = key.slice(indexCreatedPrefix.length).split('/');
  if (parts.length !== 2) return null;
  const [day, id] = parts;
  if (day === undefined || id === undefined) return null;
  if (!isCalendarDay(day) || !GAME_ID_PATTERN.test(id)) return null;
  return { day, id };
}

/**
 * Deletes every key of one game, page by page; never deletes with an empty list. Throws when the
 * listing is still not empty after `MAX_LIST_ROUNDS_PER_GAME` rounds (FR-1004).
 */
async function deleteGameKeys(store: ObjectStore, id: string, pageSize: number): Promise<void> {
  const prefix = gameKeyPrefix(id);
  for (let round = 0; round < MAX_LIST_ROUNDS_PER_GAME; round++) {
    const { keys } = await store.list(prefix, { limit: pageSize });
    if (keys.length === 0) return;
    await store.delete(keys);
  }
  throw new Error(`games/{id}/ listing not empty after ${MAX_LIST_ROUNDS_PER_GAME} rounds`);
}

/**
 * Deletes every game whose marker day is strictly earlier than the UTC day of
 * `now - retentionDays` days (FR-1002). The marker goes last (BR-1001).
 */
export async function runCleanup(opts: CleanupOptions): Promise<CleanupResult> {
  const { store, now, retentionDays, batchSize, pageSize } = opts;
  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new RangeError(`batchSize must be an integer >= 1, got ${batchSize}`);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000)
    throw new RangeError(`pageSize must be an integer from 1 to 1000, got ${pageSize}`);
  const cutoffDay = new Date(now.getTime() - retentionDays * MS_PER_DAY).toISOString().slice(0, 10);
  let gamesDeleted = 0;
  let skippedMarkers = 0;

  try {
    let cursor: string | undefined;
    for (;;) {
      const page = await store.list(indexCreatedPrefix, { cursor, limit: pageSize });
      for (const key of page.keys) {
        const marker = parseMarkerKey(key);
        if (marker === null) {
          skippedMarkers++;
          continue;
        }
        if (marker.day >= cutoffDay) return { gamesDeleted, capReached: false, skippedMarkers };
        await deleteGameKeys(store, marker.id, pageSize);
        await store.delete([key]);
        gamesDeleted++;
        if (gamesDeleted === batchSize) return { gamesDeleted, capReached: true, skippedMarkers };
      }
      if (page.cursor === undefined) return { gamesDeleted, capReached: false, skippedMarkers };
      cursor = page.cursor;
    }
  } catch (error) {
    throw new CleanupFailedError(gamesDeleted, error);
  }
}
