# CONTEXT: Phase 10 retention (state after Iteration 2)

## Current state
Iterations 1-2 done: `runCleanup` walks, deletes, stops at the batch cap, enforces the per-game round limit, validates options and wraps failures in `CleanupFailedError`. Not built yet: handler, auth, logging (Iteration 3); route and `vercel.json` (4); docs (5). Nothing under `src/` has changed.

## File map
- `app/api/_lib/cleanup.ts`: `runCleanup`, `CleanupFailedError`, constants, plus private helpers `isCalendarDay`, `parseMarkerKey`, `deleteGameKeys`.
- `tests/retention/limits.test.ts`: VC-1006, VC-1007 (store part), RangeError and wrapping tests on both stores; VC-1011 on memory only.
- `tests/retention/core.test.ts`: VC-1002, 1003, 1004, 1005, 1009, 1010, 1016, 1019, via `describe.each(storeMatrix)`.
- `tests/retention/support/fixtures.ts`: fixture helpers (below).
- `vitest.config.ts`: `node` project include is `tests/{unit,contract,api,retention}/**/*.test.ts` (D-001).
- Reused, unchanged: `tests/unit/state/support/store-wrappers.ts` (`RecordingStore`: `callsOf(method)`, `calls`, `hooks`).

## Public interfaces
```ts
// app/api/_lib/cleanup.ts
export const DEFAULT_PAGE_SIZE = 1000;
export const DEFAULT_BATCH_SIZE = 500;
export const MAX_LIST_ROUNDS_PER_GAME = 10_000;
export interface CleanupOptions { store: ObjectStore; now: Date; retentionDays: number;
  batchSize: number /* integer >= 1 */; pageSize: number /* integer 1-1000 */ }
export class CleanupFailedError extends Error {  // name 'CleanupFailedError'
  readonly gamesDeleted: number;  // games fully deleted before the failure
  // cause: the original error (store error, or the round-limit Error)
  constructor(gamesDeleted: number, cause: unknown);  // message = cause's message
}
export interface CleanupResult { gamesDeleted: number; capReached: boolean; skippedMarkers: number }
export function runCleanup(opts: CleanupOptions): Promise<CleanupResult>;

// tests/retention/support/fixtures.ts
export interface MadeStore { store: ObjectStore; cleanup: () => Promise<void> }
export const storeMatrix: { name: string; make: () => Promise<MadeStore> }[]; // memory, file (mkdtemp)
export function gameId(n: number): string;   // 20 x 'a' + 6 base32 digits of n, unique per n
export function makeGameKeys(store, { id, day, keys, final? }): Promise<string[]>;
export function snapshot(store): Promise<[string, string][]>;  // sorted [key, utf8 body]
export function wrap(store): RecordingStore;
export function failOnNthList(prefix, n): Partial<StoreHooks>;  // Error('injected') on n-th list of prefix
export function staleListing(prefix): Partial<StoreHooks>;      // list(prefix) always returns the first key seen
// use: new RecordingStore(store, failOnNthList(gameKeyPrefix(id), 2))
```
Note `make()` is async (returns a Promise of `MadeStore`).

## Conventions & invariants
- Cutoff day = UTC `yyyy-mm-dd` of `now - retentionDays * 86_400_000`; expired iff marker day is strictly earlier (string compare).
- Walk: `store.list('index/created/', { cursor, limit: pageSize })` until no cursor. `parseMarkerKey` accepts only `index/created/{day}/{id}` (exactly two segments after the prefix), day `^\d{4}-\d{2}-\d{2}$` AND round-trips through `Date` toISOString, id matches `GAME_ID_PATTERN`; else `skippedMarkers++`, never deleted. The first valid non-expired marker ends the run (no further page).
- Per game: re-list `games/{id}/` from the start (no cursor), delete the page, repeat until empty; never `delete([])`; then `delete([marker])` once.
- Options: `batchSize` not an integer >= 1, or `pageSize` not an integer 1-1000 -> `RangeError`, thrown before any store call and never wrapped.
- Batch cap: right after `gamesDeleted++`, `gamesDeleted === batchSize` returns `capReached: true` (no look-ahead; exactly `batchSize` expired games still gives true).
- Round limit: `deleteGameKeys` lists at most `MAX_LIST_ROUNDS_PER_GAME` times; if the last list was still non-empty it throws a plain `Error` (marker not deleted). Stale test: exactly 10,000 list calls on the game prefix.
- Errors: every error thrown inside the walk (any store method, the round limit) leaves `runCleanup` as `CleanupFailedError` (D-003: one try/catch around the walk, closure-local `gamesDeleted`); only the two option `RangeError`s are unwrapped.
- Layering (BR-1005): cleanup.ts imports only `@/src/storage/object-store` (type) and `@/src/state/keys`.
- Tests: fixed `now`, explicit days, test names cite the VC; format with `pnpm format`.

## Commands
`pnpm vitest run --project node tests/retention` (add `--reporter=verbose` to see memory/file), `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format`.

## Known gaps
- `CleanupFailedError` is not yet translated to a 500 or logged (Iteration 3).
- `DEFAULT_BATCH_SIZE` is exported but only the handler (Iteration 3) uses it.
- No handler/auth/log, route, `vercel.json`, docs yet.
- The walk assumes ascending list order (spec assumption; Blob unverified).
