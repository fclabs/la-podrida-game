# Iteration 8 — Resume and the parameter guard

Commit: see `git log -1` (message `Phase 12: resume with parameter guard`).

## Criteria (all in `tests/unit/datagen/resume.test.ts`; `pnpm vitest run tests/unit/datagen/resume.test.ts`)
- PASS VC-1238: 200 games, shard size 10 (20 shards), child `run --workers 2` SIGKILLed once the manifest shows >=3 complete
  shards; second `run --workers 3` exits 0; 20 complete shards, `created_at` kept, no `*.tmp` anywhere under the run dir,
  `validate` exit 0. The kill test ran 3 times in a row alone (each 1 passed) and in the full suite.
- PASS VC-1239: same test: inode, size, mtimeMs of every file of the shards complete before the kill are equal afterwards;
  the summary line says `(<n> skipped, 0 failed)` with n = complete shards in the post-kill manifest.
- PASS VC-1240: 4-shard run; shard 0 file deleted, shard 1 truncated to half, shard 2 one byte flipped (same size), shard 3
  untouched. Resume: exit 0, `1 skipped`, shard 3 inode/size/mtime unchanged, all complete, the re-run shards' `files`
  (bytes, sha256, rows) equal the originals, `validate` exit 0.
- PASS VC-1241: base run `--preset gamerules --players 4 --games 4 --shard-size 2 --replay-every 7`. Changed preset, players, games,
  shard-size, replay-every, each of those five omitted, and two multi-difference lines: exit 1, empty stdout, stderr exactly
  `generate-data: run "g" has a different <name>` (first in I-7 order), directory snapshot (every file's bytes) identical.
  `strategies`, `schema_version`, `generator_version` via an edited manifest: same line with that name (and `schema_version`
  wins over `generator_version`). `--workers 1` then `--workers 4`: exit 0, 2 skipped.
- PASS VC-1242: dir with `notes.txt` and no manifest: exit 1, stderr exactly `generate-data: run directory "<path>" exists without a manifest`,
  snapshot unchanged; empty existing dir: exit 0, new run.
- PASS failed-run resume: `HOOK_FAIL_SEED=fr-1-0 HOOK_MODE=not-game-over` -> shards `complete, failed, complete`; resumed without
  the hook, `--workers 3`: exit 0, `2 skipped`, all complete, `validate` 0.
- PASS extra: planted `manifest.json.tmp`, `shards/*.tmp`, `deep/er/x.tmp` are deleted at start-up, `deep/keep.txt` stays; resuming a
  finished run skips every shard and `manifest.json` bytes do not change.
- PASS `pnpm typecheck`, `pnpm lint`, `pnpm vitest run tests/unit/datagen` (12 files, 182 tests).
- PASS VC-1243: both greps print nothing; `git diff --stat af777e04..HEAD -- src app` empty; `grep -n manifest scripts/datagen/worker.ts` empty.
- PASS artifacts: this record, `CONTEXT.md` (about 300 lines, older text tightened), `DECISIONS.md` (D-027..D-029). `.data/datasets` empty.

## Files
Added: `tests/unit/datagen/resume.test.ts`, this record. Changed: `scripts/datagen/run.ts`, `tests/unit/datagen/helpers.ts`, `CONTEXT.md`,
`DECISIONS.md`. Deleted: none.

## Deviations
- `scripts/datagen/manifest.ts` and `scripts/generate-data.ts` unchanged: the guard throws `UsageError`, which `main` already prints (D-027).
- The `strategies` guard difference is tested through an edited manifest (only `random` exists).

- Gate fix (test-only, same commit): the default 5 s vitest timeout failed `game.test.ts` VC-1248 and `shard.test.ts` VC-1232 when two
  `pnpm vitest run tests/unit/datagen` ran at once. Every test that plays games or spawns processes now has an explicit `120_000`
  (last argument of `it`) in `game`, `labels`, `recorder`, `shard` and `manifest` tests (earlier iterations' files; assertions untouched;
  two old `60_000` became `120_000`); `args`, `failures`, `run`, `validate`, `resume`, `worker-bootstrap` already had it where needed. One line added to CONTEXT.md.
  Evidence: three rounds of two concurrent full runs: 6/6 runs `182 passed`.

## Gotchas
- `readdir(dir, { recursive: true, withFileTypes: true })` entries carry `parentPath`; used for the `*.tmp` sweep.
- An unparsable existing `manifest.json` is not handled (crash with stack trace); outside the scope.
- The path in the FR-1220 line is `join(--out, run-id)` exactly as given.

## For the next iteration
- Final shape of `executeRun`: guard (`openRun`) -> new manifest or resume plan (tmp sweep, size+SHA check, reset to pending) -> atomic
  manifest write -> unchanged pool over the queue -> summary with `skipped`. See CONTEXT.md "Public interfaces".
- Kill/observe helpers for Iterations 9-10: `spawnCli`, `waitForManifest`, `tryReadManifest` in `tests/unit/datagen/helpers.ts`.
- Resume of a 100k-game run costs one SHA-256 pass over every complete shard before work starts.
