# CONTEXT — Spec 12 data generation (state after Iteration 1)

## Current state
- Spec start commit (HEAD before any Phase 12 change): `af777e04fcf3d8b751444c48770134c470622a9b`.
- Iteration 1 done: `pnpm generate-data` exists with full argument validation; `run` and `validate`
  are still **stubs** that print `generate-data: <subcommand> is not implemented yet` to stderr and
  exit 1 (later iterations replace them).
- A-2 proven: a `worker_threads` worker started with `execArgv: ['--import', 'tsx']` from a tsx
  process loads `.ts` and resolves `@/`.
- Baseline of `pnpm --silent simulate --games 200 --seed sim` is in `baseline-simulate.txt`
  (3 players, the preset minimum).

## File map
- `package.json` — only change: script `"generate-data": "tsx scripts/generate-data.ts"`.
- `scripts/generate-data.ts` — entry; dispatches on the first argument; UsageError -> stderr line.
- `scripts/datagen/constants.ts` — `SCHEMA_VERSION`, `GENERATOR_VERSION`, FR-1203 defaults, `DEFAULT_OUT`.
- `scripts/datagen/args.ts` — `parseRunArgs`, `parseValidateArgs`, `UsageError`, option types.
- `scripts/datagen/worker.ts` — worker entry; only answers `{kind:'selftest', seed}` so far.
- `scripts/datagen/worker-host.ts` — `startWorker`.
- `tests/unit/datagen/helpers.ts` — `runCli`, `makeTempDir`, `REPO_ROOT`.
- `tests/unit/datagen/args.test.ts` — invalid-case matrix, defaults, CLI sample (VC-1202, VC-1203 first half).
- `tests/unit/datagen/worker-bootstrap.test.ts` + `fixtures/spawn-selftest.ts` — A-2 proof.
- `specs/12-data-generation{,-plan,.review}.md` — committed in iteration 1.

## Public interfaces
```ts
// scripts/datagen/args.ts
class UsageError extends Error {}          // message = stderr line WITHOUT the "generate-data: " prefix
interface RunOptions { run_id: string; preset: string; players: number; games: number;
  shard_size: number; strategies: string[]; workers: number; replay_every: number; out: string }
interface ValidateOptions { run_id: string; out: string }
parseRunArgs(argv: readonly string[]): RunOptions      // argv = args AFTER "run"
parseValidateArgs(argv: readonly string[]): ValidateOptions // argv = args AFTER "validate"
// scripts/datagen/constants.ts
SCHEMA_VERSION = 1; GENERATOR_VERSION = 1; DEFAULT_OUT = '.data/datasets'; DEFAULT_GAMES = 1000;
DEFAULT_SHARD_SIZE = 1000; DEFAULT_REPLAY_EVERY = 100; DEFAULT_STRATEGY = 'random'
// scripts/datagen/worker-host.ts
startWorker(entryFile: string | URL, workerData?: unknown): Worker
  // = new Worker(entryFile, { execArgv: ['--import', 'tsx'], workerData })
// scripts/datagen/worker.ts message protocol (iteration 1):
//   in  { kind: 'selftest', seed }  ->  out { kind: 'selftest-result', totals: number[] }
// tests/unit/datagen/helpers.ts
runCli(args: string[], opts?: { env?: Record<string,string>; cwd?: string }): Promise<{ code: number|null; stdout: string; stderr: string }>
makeTempDir(): string        // fresh empty dir under os.tmpdir(), prefix "datagen-"
REPO_ROOT: string
```
`runCli` spawns `process.execPath --import tsx scripts/generate-data.ts <args>` from the repo root.

## Conventions & invariants
- Imports of `src/` only from domain, engine, score, players, service/ai-loop, service/player-view.
- Option names in the manifest/params use snake_case (`shard_size`, `replay_every`); CLI flags use hyphens.
- Several problems in one command line: first one reported, in the order of the spec's Command line block (I-7); `--run-id` is checked first.
- Messages in `UsageError` are single-line; `parseArgs` errors are cut at the first newline.
- `--out` is not validated or touched by the parser (relative paths are relative to cwd).
- Tests spawning the CLI/workers set a 120 s timeout and write only under `makeTempDir()`.

## Commands
- Typecheck: `pnpm typecheck` (= `next typegen && tsc --noEmit`; tsconfig includes `scripts/**/*.ts`, `tests/**/*.ts`).
- Lint: `pnpm lint` (= `eslint . --max-warnings 0 && prettier --check .`). `scripts/**` and `tests/**` ARE linted by ESLint (TS rules, no layer rules) and checked by Prettier (singleQuote, printWidth 100); `docs/` and `specs/` are prettier-ignored.
- Tests: `pnpm vitest run tests/unit/datagen` (node project picks up `tests/unit/**`).
- VC-1243 greps: see plan "Conventions".
- Node here is v26 (engines says 24); pnpm prints a harmless warning.

## Known gaps
- `run` / `validate` are stubs; worker only has the selftest message; no schemas, recorder, sinks, manifest.
- `--out` default for `validate` is `.data/datasets` (I-1).
