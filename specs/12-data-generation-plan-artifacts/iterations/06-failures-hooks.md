# Iteration 6: Failure handling and test hooks

Commit: "Phase 12: shard failure handling and test-hook seam" (`git log -1 --format=%H`).

## Criteria
Test command: `pnpm vitest run tests/unit/datagen` -> 10 files, 156 tests passed (failures.test.ts: 19). Each VC below is a test in `tests/unit/datagen/failures.test.ts` spawning the CLI (`runCli`) with `GENERATE_DATA_TEST_HOOKS=fixtures/hooks-configurable.ts` and `--out <makeTempDir()>`; games are played by the real pool.
- PASS VC-1221: `HOOK_MODE=not-game-over`, seed `f-0-2`: shard failed, `error.seed == f-0-2`, message `check 1`, `shards/` empty, exit 1, summary `0 complete (0 skipped, 1 failed)`.
- PASS VC-1222: `drop-decision`: `check 3`, same outcome.
- PASS VC-1223: `points` -> `check 5`, `tricks` -> `check 4`, `drop-hand` -> `check 2`, same outcome.
- PASS VC-1224: `replay-differ` (replayed step 1 changed) -> `replay: step 1 differs`; with `--games 201 --shard-size 201` the replay log is exactly `r-0-0, r-0-100, r-0-200`; with `--replay-every 1 --games 12 --shard-size 6` all 12 seeds.
- PASS VC-1225: 3 shards (`--games 6 --shard-size 2 --workers 2`), shard 1 fails: statuses `complete, failed, complete`, shards 0/2 files present, no `shard-00001.*`, exit 1, `2 complete (0 skipped, 1 failed)`.
- PASS VC-1226: `HOOK_EXIT_SHARD=1`, `--workers 1`: shard 1 `failed`, `error.seed == null`, message `worker exited unexpectedly (code 1)`, shards 0 and 2 complete (replacement worker ran shard 2), exit 1.
- PASS VC-1247: `limit` (AiLoopLimitError) and `illegal` (IllegalMoveError) in game 3: `error.seed == f-0-3`, message contains the thrown text, calls log == `f-0-0..f-0-3` only.
- PASS VC-1229 (second half): `--workers 2 --games 12 --shard-size 2`, `HOOK_TIMES_LOG`: every shard has exactly `start, end`; max concurrently open shards <= 2.
- PASS VC-1251: `grep -n "manifest" scripts/datagen/worker.ts` prints nothing (also a test); with `HOOK_MANIFEST_PATH` deleted at shard 0 start, the run exits 0 and the manifest has both shards complete.
- PASS VC-1253: unset variable vs `hooks-empty.ts` on `--games 20 --shard-size 10`: decompressed shard files equal (6 files).
- PASS `pnpm typecheck`, `pnpm lint`.
- PASS VC-1243: `grep -rE "from '(@/)?(\.\./)*src/(storage|state)|game-service" scripts/datagen scripts/generate-data.ts` and `grep -rn "scripts/" src app` print nothing; `git diff --stat af777e04fcf3d8b751444c48770134c470622a9b..HEAD -- src app` empty.
- PASS artifacts: this record, CONTEXT.md, DECISIONS.md (D-018..D-021).

## Files
Added: `scripts/datagen/hooks.ts`, `tests/unit/datagen/failures.test.ts`, `tests/unit/datagen/fixtures/hooks-configurable.ts`, `tests/unit/datagen/fixtures/hooks-empty.ts`, this record.
Changed: `scripts/datagen/run.ts` (pool rewrite, `cleanupShardFiles`), `scripts/datagen/shard.ts` (any game error -> failure with `gameSeed`), `scripts/datagen/worker.ts` (hooks, `onShard`), `tests/unit/datagen/shard.test.ts` (the "other errors propagate" test replaced), `CONTEXT.md`, `DECISIONS.md`. Deleted: none.

## Deviations
- `onShard('end')` is not called for a failed shard (D-020); the spec only says "after the renames".
- Every failure, including a plain game failure, restarts the worker (D-018), to honour I-6's wait-for-exit uniformly.
- `cleanupShardFiles` lives in `run.ts` (main-thread code), not `shard.ts`.

## Gotchas
- Interval ties: a worker logs `end` before its next shard's `start` in the same millisecond; the overlap test sorts ends before starts at equal times (the first version did the opposite and flaked).
- `process.exit(1)` inside a worker only ends that thread; the main thread sees `exit` code 1.
- Passing `{}`-typed env to `loadHooks` needs the `Readonly<Record<string, string|undefined>>` parameter type (not `NodeJS.ProcessEnv`).
- `.data/datasets/` exists empty (created before this iteration); tests never write there.

## For the next iteration
- `validate` (7): failed shards leave no files, so `validate` sees them only as manifest entries; use `hooks-configurable.ts` (`HOOK_FAIL_SEED`, `HOOK_MODE`) to build a run with one failed and two complete shards (VC-1235).
- Resume (8): `run` still rewrites the manifest and does not delete `*.tmp` at start (I-5); `exchange`/`slot` in run.ts are where to skip complete shards (`skipped` is hard-coded 0 in `executeRun`).
- Tests pass env vars via `runCli(args, { env })`; hook env vars are documented in CONTEXT.md.
