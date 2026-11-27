# Iteration 1: Test infrastructure and the core cleanup walk

Commit: see `git log` (message `Phase 10 iter 1: retention test infra and core cleanup walk`).

## Criteria (run from the project root)
- PASS `pnpm vitest run --project node tests/retention --reporter=verbose`: 1 file, 24 tests passed; every core test appears under `runCleanup on the memory store` and `runCleanup on the file store`.
- PASS VC-1002 (cutoff table 365 days, leap-year 1 day, 23:59:59.999Z vs 00:00:00.000Z): same command.
- PASS VC-1003 (7 list calls on `index/created/`, ascending order): same command.
- PASS VC-1004 (two expired games gone, others byte-identical, `other/x` kept): same command.
- PASS VC-1005 (marker last, inner store empty at marker delete, empty listing seen): same command.
- PASS VC-1009 (non-expired only; empty store; no delete): same command.
- PASS VC-1010 (gamesDeleted 2, skippedMarkers 3, malformed and `not-a-date` kept): same command.
- PASS VC-1016 (4 lists, deletes of 10/10/5 keys + 1 marker, no get/exists/put): same command.
- PASS VC-1019 (one delete, not empty): same command.
- PASS `pnpm typecheck`; PASS `pnpm lint` (eslint + prettier); PASS `pnpm test` (100 files passed, 1 skipped; 1731 tests passed, 30 skipped).
- PASS Artifacts: CONTEXT.md file map and interfaces match the code; D-001 in DECISIONS.md.

## Files
Added: `app/api/_lib/cleanup.ts`, `tests/retention/core.test.ts`, `tests/retention/support/fixtures.ts`, `specs/10-retention-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-core.md}`, and the previously uncommitted `specs/10-retention.md`, `specs/10-retention.review.md`, `specs/10-retention-plan.md`.
Changed: `vitest.config.ts` (include + comment). Deleted: none. `src/` untouched.

## Deviations
- `storeMatrix[].make` is async (returns `Promise<MadeStore>`) because the file store needs `fs.mkdtemp`.
- `makeGameKeys` has an optional `final` flag (D-002).
- `gameId(n)`: 20 `a` + 6 base32 digits (valid for n < 2^30).

## Gotchas
- Local Node is v26 (repo wants 24): pnpm prints an engine warning; harmless.
- `RecordingStore.calls` records `list` with `prefix` only (not cursor/limit); `callsOf('delete')` has `keys`.
- The walk uses the list cursor, which is key-based on memory/file, so deleting markers mid-walk is safe.

## For the next iteration
- Add the cap at the `// Iteration 2` marker in `runCleanup` (after `gamesDeleted++`): `if (gamesDeleted === opts.batchSize) return { ..., capReached: true }`. `batchSize` is currently not destructured.
- `deleteGameKeys` is the place for the round counter and `MAX_LIST_ROUNDS_PER_GAME`; wrap store errors in `CleanupFailedError` around the whole walk using a running `gamesDeleted`.
- Add `failOnNthList` and `staleListing` to `tests/retention/support/fixtures.ts` as `RecordingStore` hooks (see `core.test.ts` VC-1005 for a hook example).
- Option validation (`RangeError`) goes at the top of `runCleanup`.
