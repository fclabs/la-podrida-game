# Iteration 4: Sinks, manifest and the shard processor

Commit: the Phase 12 commit "Phase 12: gzip JSONL sinks, manifest and shard processor" (`git log -1 --format=%H`).

## Criteria
Test command: `pnpm vitest run tests/unit/datagen` -> 8 files, 131 tests passed.
- PASS VC-1205: manifest.test.ts "planShards (VC-1205)": (20,20) -> 1; (21,20) -> 2 with 1 in the second; (1, 1|7|1000) -> 1 shard of 1; (25,10) -> 10,10,5.
- PASS VC-1204 (shard level): shard.test.ts "shard 2 of 25 games..." seeds `sh-2-0..4`, game_id == seed, no duplicates.
- PASS VC-1227 (shard level): "files, sizes, hashes, row counts..." bytes == stat size, sha256 == hash of the file, rows == gunzipped line count, no `.tmp` (directory holds exactly the 3 files); also every row of the first 50 lines per table parses with its schema and its key order equals the schema's.
- PASS VC-1249 (naming): manifest.test.ts names for shards 0..11 and the shard-11 directory in shard.test.ts (games=120, shard 11) holds only the three correctly named files.
- PASS VC-1232 (shard level): "the same shard twice..." identical decompressed bytes for all three files.
- PASS manifest: "polling reader never sees an unparsable file" (300 writes, concurrent async reader, no `manifest.json.tmp` left); `readManifest` rejects `{}` with `ZodError`.
- PASS `pnpm typecheck`; PASS `pnpm lint`.
- PASS VC-1243: `grep -rE "from '(@/)?(\.\./)*src/(storage|state)|game-service" scripts/datagen scripts/generate-data.ts` and `grep -rn "scripts/" src app` print nothing; `git diff --stat af777e04fcf3d8b751444c48770134c470622a9b..HEAD -- src app` is empty.
- PASS artifacts: this record, CONTEXT.md, DECISIONS.md (D-010..D-013).

## Files
Added: `scripts/datagen/{sinks,manifest,shard}.ts`, `tests/unit/datagen/{manifest,shard}.test.ts`, this record.
Changed: `scripts/datagen/schema.ts` (manifest schemas appended), `CONTEXT.md`, `DECISIONS.md`. Deleted: none.

## Deviations
- `processShard` has two additions to the plan's signature: `params` also carries `run_id` and `stamp` supplies `git_commit`/`git_dirty`/`now` (D-012). Reason: the run id is not in the manifest params and the stamp is how the caller supplies git fields.
- Only `GameFailure` is turned into a failure result; other loop errors propagate (D-013), as the scope says.

## Gotchas
- Failed shards: the `.tmp` files remain in `<runDir>/shards/` (cleanup is Iteration 6; start-up `*.tmp` cleanup is Iteration 8).
- `writeManifestAtomic` does not create `runDir`; `processShard` creates `<runDir>/shards` itself (recursive, safe for concurrent workers).
- Manifest functions are async (fs/promises); `playRecordedGame` is still sync.
- `files.*.path` is relative to `runDir`.

## For the next iteration
- Per shard call `processShard({ params: runOptions, shard, runDir, hooks, stamp })` inside the worker; `stamp.now` is a function, so the worker message carries `git_commit`/`git_dirty` and the worker builds `now = () => new Date().toISOString()`. Return value is structured-cloneable (plain data).
- Main thread: `newManifest({ run_id, params: {preset, players, games, shard_size, strategies, replay_every}, created_at })`, `mkdir` the run dir, `writeManifestAtomic` before any shard, replace `shards[i]` with the returned complete entry (or `{shard, games, status:'failed', error:{seed,message}}`) and rewrite after each shard.
- Naming helpers: `shardFilePaths(runDir, shard)`, `shardsDir(runDir)`.
- Workers must not mention "manifest" in `worker.ts` (VC-1251); import only `processShard`, not `manifest.ts`, there (`shard.ts` imports `manifest.ts` for `planShards` and paths, which is fine: the grep targets `worker.ts` text only).
