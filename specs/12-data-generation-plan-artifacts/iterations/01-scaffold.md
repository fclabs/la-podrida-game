# Iteration 1: Scaffold, argument parsing, worker bootstrap proof

Commit: see "Commit SHA" at the end (filled after commit; `git log -1` on the Phase 12 scaffold commit).

## Criteria
- PASS VC-1202: `pnpm vitest run tests/unit/datagen` -> args.test.ts, 2 files / 78 tests passed; every FR-1202 case through the CLI exits 1, one `generate-data: ` stderr line, empty stdout, empty temp dir (`--out` temp passed for `run`).
- PASS VC-1203 (first half): `args.test.ts` "returns every default for --run-id only" (players 3, 3x random, workers `os.availableParallelism()`, replay_every 100, shard_size 1000, games 1000, out `.data/datasets`).
- PASS A-2: `pnpm vitest run tests/unit/datagen/worker-bootstrap.test.ts` -> 2 passed (two seeds); worker totals equal the in-process game's.
- PASS `pnpm typecheck`, PASS `pnpm lint` (eslint + prettier), PASS `pnpm vitest run tests/unit/datagen`; also `pnpm test` 1883 passed.
- PASS VC-1243 greps print nothing: `grep -rE "from '(@/)?(\.\./)*src/(storage|state)|game-service" scripts/datagen scripts/generate-data.ts`; `grep -rn "scripts/" src app`; `git diff --stat HEAD -- src app` empty.
- PASS baseline: `specs/12-data-generation-plan-artifacts/baseline-simulate.txt` holds the four lines (captured before any change).
- PASS artifacts: this record, CONTEXT.md, DECISIONS.md (D-001..D-003).

## Files
Added: `scripts/generate-data.ts`, `scripts/datagen/{constants,args,worker,worker-host}.ts`, `tests/unit/datagen/{helpers,args.test,worker-bootstrap.test}.ts`, `tests/unit/datagen/fixtures/spawn-selftest.ts`, artifact directory, `specs/12-data-generation.md`, `specs/12-data-generation.review.md`, `specs/12-data-generation-plan.md`.
Changed: `package.json` (one script). Deleted: none.

## Deviations
None. One interpretation: the spec's "players outside the preset's range" also covers non-numeric `--players`; both give the same `--players must be an integer from min to max` message.

## Gotchas
- `worker.ts` imports through `@/src/...`; the fixture imports `worker-host` by relative path (a `@/scripts` import would also work, but relative keeps it independent of alias use).
- The spec start commit is `af777e04fcf3d8b751444c48770134c470622a9b`.
- `scripts/**` is linted by ESLint (TS rules only, no layer rules) and Prettier; `specs/` and `docs/` are prettier-ignored.
- Each CLI-spawning test costs ~1-2 s (tsx startup); the invalid matrix runs ~50 spawns.

## For the next iteration
- `parseRunArgs(argv)` expects argv AFTER `run`; options are snake_case (`shard_size`, `replay_every`, `run_id`).
- `generate-data.ts` still has two "not implemented" stubs (`run`, `validate`); iteration 5 / 7 replace them. They call the parsers first, so keep that order.
- `startWorker(entryFile, workerData?)` uses `execArgv ['--import','tsx']`. `worker.ts` is a plain `parentPort.on('message')` entry; extend its protocol, keep `selftest`.
- Helpers: `runCli(args, {env?, cwd?})`, `makeTempDir()`, `REPO_ROOT` in `tests/unit/datagen/helpers.ts`.
- Typecheck `pnpm typecheck`, lint `pnpm lint`; scripts and tests are both covered.
