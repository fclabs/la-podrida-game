# Iteration 3: The HTTP handler

Commit: see `git log` (message `Phase 10 iter 3: cleanup handler with auth, summary and failure reporting`).

## Criteria (run from the project root)
- PASS `pnpm vitest run --project node tests/retention`: 3 files, 90 tests passed (both stores).
- PASS VC-1000 (200, zeros, `application/json`, `no-store`): same command.
- PASS VC-1001 (six bad headers + secret unset with `Bearer anything`: 401 `unauthorized` body, `getStoreCalls` 0, zero log lines, no secret; `ConfigError` with no header: 500 `internal`, one error line): same command.
- PASS VC-1008 (`failOnNthList(gameKeyPrefix(id), 2)`, page size 1: 500, `internal` body, one `error` line with exactly four fields, message `injected`, no secret or game id; next run deletes the game): same command.
- PASS VC-1012 (two concurrent calls, 3 expired games: both 200, each <= 3, sum >= 3, snapshot equals a single run): same command.
- PASS VC-1013 (log level `error`: one `info` line with exactly the six fields; durationMs from the injected clock): same command.
- PASS VC-1015 (`batchSize` 500, `pageSize` 1000, `getStore === createObjectStore`, `now()` within 1 s; injected 2026-01-01 clock keeps a 2025-11-28 game): same command.
- PASS extras: 500-char clipping and `gamesDeleted` 1 after a first game finished; `RangeError` (batchSize 0) answers 500.
- PASS `pnpm typecheck`; PASS `pnpm lint`; PASS `pnpm test` (102 files passed, 1 skipped; 1797 tests passed, 30 skipped).
- PASS Artifacts: CONTEXT.md matches the code; D-004..D-007 in DECISIONS.md.

## Files
Changed: `app/api/_lib/cleanup.ts`, `specs/10-retention-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.
Added: `tests/retention/handler.test.ts`, `specs/10-retention-plan-artifacts/iterations/03-handler.md`. Deleted: none. `src/` untouched.

## Hands off (final shapes)
- `interface CleanupDeps { getConfig: () => Config; getStore: (config: Config) => ObjectStore; now: () => Date; log: LogSink; batchSize: number; pageSize: number }`
- `cleanupHandler(req: Request, deps: CleanupDeps): Promise<Response>`; `defaultCleanupDeps: CleanupDeps` = `{ getConfig, getStore: createObjectStore, now: () => new Date(), log: consoleLog, batchSize: DEFAULT_BATCH_SIZE, pageSize: DEFAULT_PAGE_SIZE }`.
- Info line: `{ route: 'cron/cleanup', status: 200, gamesDeleted, capReached, skippedMarkers, durationMs }`. Error line: `{ route: 'cron/cleanup', gamesDeleted, errorName, errorMessage }` (cause's name/message, message <= 500).
- 401: `toErrorResponse(new RequestError(401, 'unauthorized'))` through `jsonResponse` (no `Unauthorized` import: it lives in `src/service`). 500: `toErrorResponse(new Error('internal'))`.
- `getStore` runs only after authentication succeeds; a failed auth writes no log.
- Test helpers in `handler.test.ts` (local, not exported): `configWith(over)`, `makeDeps(store, config?)` -> `{ deps, lines, getStoreCalls }`, `call(deps, auth?)`.

## Deviations
- None. The 401 uses `RequestError` rather than `Unauthorized` because of the layering rule (the plan allowed "the equivalent existing helper").

## Gotchas
- `new Date(ms)` truncates fractional milliseconds, so `durationMs` rounding is only observable if the clock returns different Dates.
- `deps.now()` is called three times in a successful run (start, `runCleanup`, end).
- A `ConfigError` message is not logged with the secret in tests, but the log does carry the ConfigError message as is (config messages list variable names, not values).

## For the next iteration
- Route: `export const GET = (req: Request) => cleanupHandler(req, defaultCleanupDeps);` in `app/api/cron/cleanup/route.ts`, exporting only `GET`.
- VC-1018 static test: cleanup.ts imports are `node:crypto`, `@/src/config`, `@/src/storage`, `@/src/storage/object-store`, `@/src/state/keys`, `./errors`, `./http`, `./log`. `./errors` itself imports `src/service`, but only transitively (the test checks cleanup.ts's own imports). The only operators on secret/header are `=== null`/`=== undefined` checks (allowed).
- Handler tests build deps by hand; the end-to-end test (VC-1017) can reuse the same pattern with the real `GameService` store.
