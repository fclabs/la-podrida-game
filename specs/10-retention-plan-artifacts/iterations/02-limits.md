# Iteration 2: Batch cap, round limit and failure reporting

Commit: see `git log` (message `Phase 10 iter 2: batch cap, round limit and failure reporting`).

## Criteria (run from the project root)
- PASS `pnpm vitest run --project node tests/retention --reporter=verbose`: 2 files, 55 tests passed, both stores.
- PASS VC-1006 (5 expired, batch 2: 2/true, 2/true, 1/false, 0/false; earliest markers first; untouched stay; exactly 2 expired: 2/true then 0/false): same command.
- PASS VC-1007 store part (page size 1, fail 2nd list of the game prefix: `CleanupFailedError`, `gamesDeleted` 0, 3 keys + marker remain, next run 1 and only the non-expired game left): same command.
- PASS VC-1011 (memory only; stale listing: exactly 10,000 list calls on the game prefix, marker kept, 34 ms): same command.
- PASS `batchSize` 0/-1/1.5/NaN and `pageSize` 0/1001/2.5/NaN reject with `RangeError`, not `CleanupFailedError`: same command.
- PASS `pnpm typecheck`; PASS `pnpm lint`; PASS `pnpm test` (101 files passed, 1 skipped; 1762 tests passed, 30 skipped).
- PASS Artifacts: CONTEXT.md matches the code; D-003 in DECISIONS.md.

## Files
Changed: `app/api/_lib/cleanup.ts`, `tests/retention/support/fixtures.ts` (additions only), `specs/10-retention-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.
Added: `tests/retention/limits.test.ts`, `specs/10-retention-plan-artifacts/iterations/02-limits.md`. Deleted: none. `src/` untouched.

## Hands off (final shapes)
- `class CleanupFailedError extends Error`: `name 'CleanupFailedError'`, `readonly gamesDeleted: number`, `cause` = original error, `message` = cause's message.
- Carries `CleanupFailedError`: any error from any store method inside the walk, and the round-limit error (a plain `Error` as `cause`).
- `RangeError` (bad `batchSize` or `pageSize`) is thrown unwrapped, before any store call.
- Exports: `DEFAULT_PAGE_SIZE = 1000`, `DEFAULT_BATCH_SIZE = 500`, `MAX_LIST_ROUNDS_PER_GAME = 10_000`.
- Fixture helpers added: `failOnNthList(prefix, n)`, `staleListing(prefix)` (both return `Partial<StoreHooks>` for `new RecordingStore(store, hooks)`).

## Deviations
- None. Extra tests beyond the criteria: wrapped failure of the marker-walk list, `gamesDeleted` 1 when the second game fails, RangeError cases (NaN, non-integers), valid bounds accepted.

## Gotchas
- `staleListing` hands out the first key seen even for later pages; it ignores `opts`, fine for `limit` >= 1.
- The round limit means the loop lists exactly 10,000 times then throws; it never makes a 10,001st list call.
- The CleanupFailedError message is the cause's message, which may include store key paths (Iteration 3 must log only `errorName`/`errorMessage` of the 500-char-capped value and must not leak game ids per VC-1008: use the cause or build the log from `gamesDeleted` and the error's name, and check the message for ids).

## For the next iteration
- The handler catches `CleanupFailedError`: log `gamesDeleted` from it; `errorName`/`errorMessage` come from `error.cause` (original) or the wrapper; VC-1008 forbids game ids in the log, and the injected test error has no ids.
- Call `runCleanup` with `batchSize: DEFAULT_BATCH_SIZE`, `pageSize: DEFAULT_PAGE_SIZE`; `RangeError` cannot occur with those.
- Reuse `failOnNthList` for VC-1007/VC-1008 handler tests.
