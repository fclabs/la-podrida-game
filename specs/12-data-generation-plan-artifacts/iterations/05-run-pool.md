# Iteration 5: The `run` command and the worker pool

Commit: the Phase 12 commit "Phase 12: generate-data run command with worker pool" (`git log -1 --format=%H`).

## Criteria
Test command: `pnpm vitest run tests/unit/datagen` -> 9 files, 137 tests passed (run.test.ts: 7).
- PASS VC-1201: run.test.ts "VC-1201 / VC-1203 / VC-1227": `run --run-id t1 --games 20 --shard-size 10 --out <tmp>` exit 0, manifest + 6 shard files, 4 summary lines, `games: 20  shards: 2`, `rows: games 20 ...` (also checked by hand: `node --import tsx scripts/generate-data.ts run ...`).
- PASS VC-1203 (second half): "VC-1203 second half": params = defaults (players 3, shard_size 1000, strategies random x3, replay_every 100), 1 shard.
- PASS VC-1204 / VC-1205 (CLI): "VC-1204 / VC-1205": `--games 25 --shard-size 10` -> 10,10,5, seeds `sd-<s>-<i>`, game_id == seed, 25 distinct; `--games 21 --shard-size 20` -> 20, 1.
- PASS VC-1227 (CLI): bytes == stat size, sha256 == hash of file bytes, rows == gunzipped line count for all 6 files; no `.tmp` under the run dir; summary `rows` line equals manifest sums.
- PASS VC-1228: "VC-1228": 10-shard run with 2 workers, polling every 2 ms, every read parses with `ManifestSchema`, statuses never go back; more than 1 read.
- PASS VC-1229 (no hooks): "VC-1229 (no hooks) / VC-1232": `--workers 1` vs `--workers 2` give equal decompressed contents for all 12 files. The overlap half is Iteration 6.
- PASS VC-1232: same test, a third run in another directory is identical.
- PASS VC-1249 (CLI): 12 shards (`--games 12 --shard-size 1`) -> exactly the 36 expected names, nothing else in `shards/`.
- PASS `pnpm typecheck`; PASS `pnpm lint`.
- PASS VC-1243: `grep -rE "from '(@/)?(\.\./)*src/(storage|state)|game-service" scripts/datagen scripts/generate-data.ts` and `grep -rn "scripts/" src app` print nothing; `git diff --stat af777e04fcf3d8b751444c48770134c470622a9b..HEAD -- src app` empty; `grep -n "manifest" scripts/datagen/worker.ts` prints nothing.
- PASS artifacts: this record, CONTEXT.md, DECISIONS.md (D-014..D-017).

## Files
Added: `scripts/datagen/run.ts`, `tests/unit/datagen/run.test.ts`, this record.
Changed: `scripts/datagen/worker.ts` (shard handler, selftest kept), `scripts/datagen/worker-host.ts` (message types added), `scripts/generate-data.ts` (`run` wired, `readGitInfo`), `tests/unit/datagen/args.test.ts` (removed the "run hits the stub" test, D-017), `CONTEXT.md`, `DECISIONS.md`. Deleted: none.

## Deviations
- The plan's scope says exit 0 when every shard is complete and leaves failures to Iteration 6; I record a GameFailure result as a `failed` entry and exit 1 (D-016), the minimal sane behaviour. No cleanup, no tests for it.
- Message types are in worker-host.ts (listed in Touches), not worker.ts, so the worker file stays free of manifest-related words and `run.ts` can import types without loading the worker.

## Gotchas
- Never run `run` in a test without `--out <temp>`: the default writes 1000 games to `.data/datasets`. (An old stub test did exactly that once and was removed; its `.data/datasets/r1` was deleted.)
- `generate-data.ts` uses top-level await (`process.exitCode = await main(...)`); the package is ESM.
- A 20-game default-size run takes ~1 s; each worker start-up costs the tsx load (~0.3 s).
- `executeRun` resolves `--out` against cwd and overwrites an existing manifest (no resume yet).

## For the next iteration
- Hooks: extend `ShardRequest` handling in worker.ts (load hooks once at worker start; pass to `processShard({hooks})`; call `onShard` around the shard) and widen `processShard` to turn any thrown error into `{status:'failed', seed: gameSeed(...)}`.
- Failure handling lives in run.ts `slot()`: `shard-error` currently rejects the whole run; an unexpected worker `exit` rejects too. Replace by: wait for worker exit, delete the shard's files (final and `.tmp`, `shardFilePaths` + `.tmp`), record `failed` (seed null for a dead worker), start a replacement worker if shards remain, keep the pool size.
- `formatSummary(manifest, skipped, seconds)` already counts failed shards; the exit code is `allComplete ? 0 : 1`.
- Tests pass env vars to `runCli(args, { env })`.
