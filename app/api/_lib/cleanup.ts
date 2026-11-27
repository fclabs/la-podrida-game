// Retention cleanup core (spec 10: FR-1002–FR-1005, FR-1010, FR-1011, BR-1001, BR-1002, BR-1005,
// BR-1006; plan iteration 1). Walks the `index/created/` markers in key order, deletes every
// expired game's `games/{id}/` keys page by page, then its marker. Reads no game document and
// imports only the storage contract and the key builders.
import type { ObjectStore } from '@/src/storage/object-store';
import { GAME_ID_PATTERN, gameKeyPrefix, indexCreatedPrefix } from '@/src/state/keys';

/** The list page size used when a caller does not choose one (the `ObjectStore` maximum). */
export const DEFAULT_PAGE_SIZE = 1000;

const MS_PER_DAY = 86_400_000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface CleanupOptions {
  store: ObjectStore;
  now: Date;
  retentionDays: number;
  /** ≥ 1. Accepted but not enforced yet (Iteration 2). */
  batchSize: number;
  /** 1–1000 (the `ObjectStore` limit). */
  pageSize: number;
}

export interface CleanupResult {
  gamesDeleted: number;
  capReached: boolean;
  skippedMarkers: number;
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

/** Deletes every key of one game, page by page; never deletes with an empty list. */
async function deleteGameKeys(store: ObjectStore, id: string, pageSize: number): Promise<void> {
  const prefix = gameKeyPrefix(id);
  for (;;) {
    const { keys } = await store.list(prefix, { limit: pageSize });
    if (keys.length === 0) return;
    await store.delete(keys);
  }
}

/**
 * Deletes every game whose marker day is strictly earlier than the UTC day of
 * `now - retentionDays` days (FR-1002). The marker goes last (BR-1001).
 */
export async function runCleanup(opts: CleanupOptions): Promise<CleanupResult> {
  const { store, now, retentionDays, pageSize } = opts;
  const cutoffDay = new Date(now.getTime() - retentionDays * MS_PER_DAY).toISOString().slice(0, 10);
  let gamesDeleted = 0;
  let skippedMarkers = 0;
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
      // Iteration 2: batch cap (stop once gamesDeleted === batchSize) goes here.
    }
    if (page.cursor === undefined) return { gamesDeleted, capReached: false, skippedMarkers };
    cursor = page.cursor;
  }
}
