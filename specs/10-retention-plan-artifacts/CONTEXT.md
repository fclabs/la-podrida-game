# CONTEXT: Phase 10 retention (state after Iteration 1)

## Current state
Iteration 1 done: the pure core `runCleanup` exists with its fixtures and tests. Not built yet: batch cap, round limit, failure wrapping (Iteration 2); handler, auth, logging (3); route and `vercel.json` (4); docs (5). Nothing under `src/` has changed.

## File map
- `app/api/_lib/cleanup.ts`: `runCleanup` plus private helpers `isCalendarDay`, `parseMarkerKey`, `deleteGameKeys`.
- `tests/retention/core.test.ts`: VC-1002, 1003, 1004, 1005, 1009, 1010, 1016, 1019, via `describe.each(storeMatrix)`.
- `tests/retention/support/fixtures.ts`: fixture helpers (below).
- `vitest.config.ts`: `node` project include is `tests/{unit,contract,api,retention}/**/*.test.ts` (D-001).
- Reused, unchanged: `tests/unit/state/support/store-wrappers.ts` (`RecordingStore`: `callsOf(method)`, `calls`, `hooks`).

## Public interfaces
```ts
// app/api/_lib/cleanup.ts
export const DEFAULT_PAGE_SIZE = 1000;
export interface CleanupOptions { store: ObjectStore; now: Date; retentionDays: number;
  batchSize: number; /* accepted, IGNORED until Iteration 2 */ pageSize: number }
export interface CleanupResult { gamesDeleted: number; capReached: boolean; skippedMarkers: number }
export function runCleanup(opts: CleanupOptions): Promise<CleanupResult>;

// tests/retention/support/fixtures.ts
export interface MadeStore { store: ObjectStore; cleanup: () => Promise<void> }
export const storeMatrix: { name: string; make: () => Promise<MadeStore> }[]; // memory, file (mkdtemp)
export function gameId(n: number): string;   // 20 x 'a' + 6 base32 digits of n, unique per n
export function makeGameKeys(store, { id, day, keys, final? }): Promise<string[]>;
export function snapshot(store): Promise<[string, string][]>;  // sorted [key, utf8 body]
export function wrap(store): RecordingStore;
```
Note `make()` is async (returns a Promise of `MadeStore`).

## Conventions & invariants
- Cutoff day = UTC `yyyy-mm-dd` of `now - retentionDays * 86_400_000`; expired iff marker day is strictly earlier (string compare).
- Walk: `store.list('index/created/', { cursor, limit: pageSize })` until no cursor. `parseMarkerKey` accepts only `index/created/{day}/{id}` (exactly two segments after the prefix), day `^\d{4}-\d{2}-\d{2}$` AND round-trips through `Date` toISOString, id matches `GAME_ID_PATTERN`; else `skippedMarkers++`, never deleted. The first valid non-expired marker ends the run (no further page).
- Per game: re-list `games/{id}/` from the start (no cursor), delete the page, repeat until empty; never `delete([])`; then `delete([marker])` once.
- The `// Iteration 2` marker is inside the walk loop, right after `gamesDeleted++` (batch cap goes there).
- Layering (BR-1005): cleanup.ts imports only `@/src/storage/object-store` (type) and `@/src/state/keys`.
- Tests: fixed `now`, explicit days, test names cite the VC; format with `pnpm format`.

## Commands
`pnpm vitest run --project node tests/retention` (add `--reporter=verbose` to see memory/file), `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format`.

## Known gaps
- `batchSize` unused; no cap, no 10,000-round guard, no error wrapping (Iteration 2).
- No handler/auth/log, route, `vercel.json`, docs yet.
- The walk assumes ascending list order (spec assumption; Blob unverified).
