# CONTEXT: Phase 10 retention (state after Iteration 3)

## Current state
Iterations 1-3 done: `runCleanup` (walk, delete, batch cap, round limit, option validation, `CleanupFailedError`) and `cleanupHandler` (auth, summary, failure reporting, logging) with `defaultCleanupDeps`. Not built yet: the route file and `vercel.json` (4); docs (5). Nothing under `src/` has changed.

## File map
- `app/api/_lib/cleanup.ts`: `runCleanup`, `CleanupFailedError`, constants, `CleanupDeps`, `cleanupHandler`, `defaultCleanupDeps`, plus private helpers `isCalendarDay`, `parseMarkerKey`, `deleteGameKeys`, `sha256`, `isAuthorized`, `describeError`.
- `tests/retention/handler.test.ts`: VC-1000, 1001, 1008, 1012, 1013, 1015 and extras; helpers `configWith(over)`, `makeDeps(store, config?)` (returns `{ deps, lines, getStoreCalls }`), `call(deps, authHeader?)`.
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
export interface CleanupDeps {
  getConfig: () => Config; getStore: (config: Config) => ObjectStore; now: () => Date;
  log: LogSink; batchSize: number; pageSize: number;
}
export function cleanupHandler(req: Request, deps: CleanupDeps): Promise<Response>;
export const defaultCleanupDeps: CleanupDeps; // getConfig, createObjectStore, () => new Date(), consoleLog, 500, 1000

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
- Handler order: `deps.getConfig()` -> auth -> `deps.getStore(config)` -> `runCleanup({ now: deps.now(), retentionDays: config.retentionDays, batchSize, pageSize })`. All inside one try/catch.
- Auth: `req.headers.get('authorization')` vs `Bearer ${config.cronSecret}`; both SHA-256 digested, `timingSafeEqual`. Null header or unset secret -> false. Failure: `jsonResponse(...toErrorResponse(new RequestError(401, 'unauthorized')))` (RequestError from `./errors`, since `Unauthorized` lives in `src/service`, which cleanup.ts must not import). No log line, `getStore` never called.
- Success: `deps.log('info', { route: 'cron/cleanup', status: 200, gamesDeleted, capReached, skippedMarkers, durationMs })` always (ignores `logLevel`); `durationMs = Math.round(deps.now() after - before)`; body `jsonResponse(200, result)`.
- Failure: `deps.log('error', { route: 'cron/cleanup', gamesDeleted, errorName, errorMessage })` (exactly these four); `gamesDeleted` from `CleanupFailedError`, else 0; `errorName`/`errorMessage` from `error.cause` for `CleanupFailedError` (name, or `typeof` for non-Errors; message sliced to 500), else from the error itself. Response: fixed 500 `internal` body (built from `toErrorResponse(new Error('internal'))`, never from the thrown value). `ConfigError` and `RangeError` take this path.
- Cutoff day = UTC `yyyy-mm-dd` of `now - retentionDays * 86_400_000`; expired iff marker day is strictly earlier (string compare).
- Walk: `store.list('index/created/', { cursor, limit: pageSize })` until no cursor. `parseMarkerKey` accepts only `index/created/{day}/{id}` (exactly two segments after the prefix), day `^\d{4}-\d{2}-\d{2}$` AND round-trips through `Date` toISOString, id matches `GAME_ID_PATTERN`; else `skippedMarkers++`, never deleted. The first valid non-expired marker ends the run (no further page).
- Per game: re-list `games/{id}/` from the start (no cursor), delete the page, repeat until empty; never `delete([])`; then `delete([marker])` once.
- Options: `batchSize` not an integer >= 1, or `pageSize` not an integer 1-1000 -> `RangeError`, thrown before any store call and never wrapped.
- Batch cap: right after `gamesDeleted++`, `gamesDeleted === batchSize` returns `capReached: true` (no look-ahead; exactly `batchSize` expired games still gives true).
- Round limit: `deleteGameKeys` lists at most `MAX_LIST_ROUNDS_PER_GAME` times; if the last list was still non-empty it throws a plain `Error` (marker not deleted). Stale test: exactly 10,000 list calls on the game prefix.
- Errors: every error thrown inside the walk (any store method, the round limit) leaves `runCleanup` as `CleanupFailedError` (D-003: one try/catch around the walk, closure-local `gamesDeleted`); only the two option `RangeError`s are unwrapped.
- Layering (BR-1005): cleanup.ts imports only `node:crypto`, `@/src/config`, `@/src/storage`, `@/src/storage/object-store` (type), `@/src/state/keys`, `./errors`, `./http`, `./log`.
- Tests: fixed `now`, explicit days, test names cite the VC; format with `pnpm format`.

## Commands
`pnpm vitest run --project node tests/retention` (add `--reporter=verbose` to see memory/file), `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format`.

## Known gaps
- No route file, `vercel.json` cron entry, docs yet (Iterations 4-5).
- The logged `errorMessage` is the original store error's message (<= 500 chars) and may contain store key paths, hence game ids (spec 05: messages carry the key). The spec asks for the original message, so it is logged as is; the response body never carries it.
- `cleanupHandler` does not catch a throw from `deps.log` inside the success path separately: it would be logged as an error and answer 500 (the run itself already completed).
- The walk assumes ascending list order (spec assumption; Blob unverified).
