# CONTEXT — Spec 12 data generation (state after Iteration 5)

## Current state
- Spec start commit (HEAD before any Phase 12 change): `af777e04fcf3d8b751444c48770134c470622a9b`.
- Iteration 1 done: `pnpm generate-data` exists with full argument validation; `validate` is still a
  **stub** that prints `generate-data: validate is not implemented yet` to stderr and exits 1.
- Iteration 2 done: `decisions` row schemas and the observing recorder exist.
- Iteration 3 done: outcome labels, `games`/`hands` rows, the FR-1212 checks 1-5 and the sampled
  replay (FR-1213) exist as `playRecordedGame`; it returns rows in memory, nothing is written to disk.
- Iteration 4 done: gzip JSONL sinks, the manifest schema/helpers and `processShard` exist; a shard
  can be written to disk in-process (no workers, no `run` command yet). Failed-shard cleanup of
  `.tmp` files is NOT done (Iteration 6); `processShard` leaves them in place.
- Iteration 5 done: `pnpm generate-data run` works end to end with a worker pool and prints the
  4-line summary; exit 0 when every shard is complete, else 1 (a `failed` shard is recorded in the
  manifest but its files are NOT cleaned up and unexpected errors/worker deaths just reject the run;
  Iteration 6). No resume yet: `run` into an existing run id overwrites the manifest (Iteration 8).
- A-2 proven: a `worker_threads` worker started with `execArgv: ['--import', 'tsx']` from a tsx
  process loads `.ts` and resolves `@/`.
- Baseline of `pnpm --silent simulate --games 200 --seed sim` is in `baseline-simulate.txt`
  (3 players, the preset minimum).

## File map
- `package.json` — only change: script `"generate-data": "tsx scripts/generate-data.ts"`.
- `scripts/generate-data.ts` — entry; dispatches on the first argument; UsageError -> stderr line; `run` -> `executeRun` (git info read once here via `git rev-parse HEAD` / `git status --porcelain`); `validate` stub.
- `scripts/datagen/constants.ts` — `SCHEMA_VERSION`, `GENERATOR_VERSION`, FR-1203 defaults, `DEFAULT_OUT`.
- `scripts/datagen/args.ts` — `parseRunArgs`, `parseValidateArgs`, `UsageError`, option types.
- `scripts/datagen/worker.ts` — worker entry: answers `selftest` and `shard` messages (never mentions the manifest, VC-1251).
- `scripts/datagen/worker-host.ts` — `startWorker` and the message types `ShardRequest`/`ShardResponse`/`ShardErrorResponse`.
- `scripts/datagen/run.ts` — `executeRun`, the pool, `formatSummary`, `oneDecimal`.
- `tests/unit/datagen/run.test.ts` — VC-1201/1203/1204/1205/1227/1228/1229/1232/1249 at CLI level, summary format.
- `scripts/datagen/schema.ts` — Zod schemas `PendingDecisionRowSchema`, `OutcomeColumnsSchema`, `DecisionRowSchema`, `GamesRowSchema`, `HandsRowSchema`, and the manifest: `ShardFileSchema`, `ManifestParamsSchema`, `ShardEntrySchema`, `ManifestSchema` (+ types).
- `scripts/datagen/sinks.ts` — `createJsonlGzipSink`.
- `scripts/datagen/manifest.ts` — `planShards`, `newManifest`, `writeManifestAtomic`, `readManifest`, shard naming helpers.
- `scripts/datagen/shard.ts` — `processShard`.
- `scripts/datagen/labels.ts` — `buildTables` (labels, `hands` rows, `games` row).
- `scripts/datagen/game.ts` — `gameSeed`, `GameFailure`, `playRecordedGame`.
- `scripts/datagen/cards.ts` — `cardIds`, `hiddenStockLeft`.
- `scripts/datagen/recorder.ts` — `createRecorder`.
- `tests/unit/datagen/recorder.test.ts`, `schema.test.ts` — VC-1207..1216, BR-1208.
- `tests/unit/datagen/labels.test.ts`, `game.test.ts` — VC-1204/1206/1213/1217..1220/1248/1250, per-game checks, replay.
- `tests/unit/datagen/manifest.test.ts`, `shard.test.ts` — VC-1205, VC-1249 naming, manifest atomicity; sink, VC-1204/1227/1232 at shard level.
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
// scripts/datagen/worker.ts message protocol:
//   in  { kind: 'selftest', seed }  ->  out { kind: 'selftest-result', totals: number[] }
//   in  ShardRequest { kind:'shard', params: ShardParams, shard, runDir, git_commit, git_dirty }
//       -> out ShardResponse { kind:'shard-result', shard, result: ShardResult }   (complete entry or {status:'failed',seed,message})
//       -> or ShardErrorResponse { kind:'shard-error', shard, message }  (any non-GameFailure error thrown by processShard)
//   A worker handles one shard message at a time and stays alive for the next (the pool reuses it).
//   The worker builds `stamp.now = () => new Date().toISOString()`; hooks are not passed yet (Iteration 6).
// scripts/datagen/run.ts
executeRun(options: RunOptions, deps: { now: () => string; gitInfo: {git_commit,git_dirty}; write?: (s)=>void }):
  Promise<{ manifest: Manifest; exitCode: 0|1 }>
formatSummary(manifest, skipped: number, durationSeconds: number): string   // the 4 lines + trailing "\n"; reused by resume
oneDecimal(n): string                                                       // never "-0.0"
// generate-data.ts: `process.exitCode = (await executeRun(parseRunArgs(rest), { now: () => new Date().toISOString(), gitInfo: readGitInfo() })).exitCode`
// tests/unit/datagen/helpers.ts
runCli(args: string[], opts?: { env?: Record<string,string>; cwd?: string }): Promise<{ code: number|null; stdout: string; stderr: string }>
makeTempDir(): string        // fresh empty dir under os.tmpdir(), prefix "datagen-"
REPO_ROOT: string
```
`runCli` spawns `process.execPath --import tsx scripts/generate-data.ts <args>` from the repo root.

```ts
// scripts/datagen/schema.ts (strict objects, keys in the spec's column order)
PendingDecisionRow  // 24 columns: Keys, Player view, Action, Policy, Oracle (no outcome columns)
OutcomeColumns      // hand_bid, hand_tricks_won, hand_made, hand_points, won_this_trick (bool|null),
                    // final_place, final_total  -> exactly what Iteration 3 must fill
DecisionRow         // = PendingDecisionRow + OutcomeColumns (DecisionRowSchema = Pending.extend(Outcome.shape))
// policy_probs: null literal; explore: false literal
// scripts/datagen/cards.ts
cardIds(cards: readonly Card[]): string[]
hiddenStockLeft(deck, players, remainingHands, playedIds, trumpCard): string[]
  // deck cards in buildDeck(deck, players) order, minus remaining hands, minus playedIds, minus trump
// scripts/datagen/recorder.ts
createRecorder(state: GameState): Recorder   // state = INITIAL state of the game (hand 0 dealt)
Recorder { wrapStrategy(seat, strategy): AIStrategy;      // same name, same args, no extra draw
           onTransition(prev, transition): void;          // pass as runAiLoop's onTransition
           rows(): readonly PendingDecisionRow[] }        // the live buffer, step 0..m-1
// usage: players = seats.map(s => createAiPlayer(s.seat, s.name, rec.wrapStrategy(s.seat, getStrategy(s.strategy))))
//        runAiLoop(state, players, { onTransition: rec.onTransition })
```

```ts
// scripts/datagen/schema.ts (strict, spec column order; per-seat arrays have n_players entries)
GamesRow { game_id, run_id, shard, seed, preset, n_players, n_hands, strategy_by_seat: string[],
           final_total_by_seat: int[], final_place_by_seat: int[], generator_version }   // no git/created_at
HandsRow { game_id, hand_index, cards_dealt, dealer, trump_card: string, trump_in_dealer_hand: bool,
           bid_by_seat, tricks_won_by_seat, made_by_seat: bool[], points_by_seat }
DecisionRow  // see above; GamesRowSchema / HandsRowSchema exported next to DecisionRowSchema
// scripts/datagen/labels.ts
interface GameTables { games: GamesRow; hands: HandsRow[]; decisions: DecisionRow[] }
buildTables({ run_id, shard, preset, strategies, initial, final, events, pending }): GameTables
  // initial = state from createGame (hand 0 dealt); final = game-over state; events = runAiLoop's events
  // hands rows from evaluate(final).hands; deal columns from hand-dealt events (hand 0 from initial);
  // won_this_trick = winner of the next trick-won event after the card-played; throws Error if inconsistent
// scripts/datagen/game.ts
gameSeed(runId, shard, index): string                      // `${runId}-${shard}-${index}`
class GameFailure extends Error { readonly seed: string }  // message names the check; nothing else
type RunAiLoopFn = typeof runAiLoop
interface PlayRecordedGameOptions { run_id; shard; index; preset; strategies: readonly string[];
  replay_every: number;
  runAiLoop?: RunAiLoopFn;                 // the game's own play only
  replayRunAiLoop?: RunAiLoopFn;           // replay only (default: real runAiLoop)
  transformRows?: (rows: GameTables) => GameTables }   // after labels, before checks; default identity
playRecordedGame(options): GameTables     // sync; throws GameFailure; loop errors propagate unchanged
```
`playRecordedGame`: seats `ai-<k>` (playerId and name), `gameId` = seed = `R-s-i`, `strategy` set per seat.
Order: play -> check 1 -> labels -> `transformRows` -> checks 2,3,4,5 -> replay if `index % replay_every === 0`.
Messages: `check N: ...`, `labels: ...`, `replay: step <n> differs (...)`, `replay: final totals differ (...)`.
The hooks are plain function arguments (NOT factories `(real) => fn` as in the spec's env hook module;
Iteration 6 adapts the loaded hook module). The caller must write the rows itself (Iteration 4+).

```ts
// scripts/datagen/schema.ts (manifest; strict objects, spec table order)
ShardFile { path (relative to the run dir), bytes, sha256, rows }
ManifestParams { preset, players, games, shard_size, strategies: string[], replay_every }
ShardEntry = discriminated union on `status`:
  pending  { shard, games, status }
  complete { shard, games, status, git_commit, git_dirty, completed_at (ISO UTC), files: {games,hands,decisions}: ShardFile }
  failed   { shard, games, status, error: { seed: string|null, message } }
CompleteShardEntry = the 'complete' member
Manifest { schema_version, generator_version, run_id, params: ManifestParams, created_at (ISO UTC), shards: ShardEntry[] }
// scripts/datagen/sinks.ts
createJsonlGzipSink(finalPath): JsonlGzipSink
  append(rows: readonly unknown[]): Promise<void>   // JSON.stringify per row, "\n"-terminated, backpressure handled
  finish(): Promise<SinkResult>   // end, wait, sha256 over stored bytes, rename <path>.tmp -> <path>
  abort(): Promise<void>          // close; leaves <path>.tmp in place
SinkResult { path (as given), bytes, sha256 (hex), rows }
// scripts/datagen/manifest.ts
planShards(games, shardSize): { shard, games }[]     // throws RangeError on non-positive ints
newManifest({ run_id, params, created_at }): Manifest // all shards pending; versions from constants
writeManifestAtomic(runDir, manifest): Promise<void>  // manifest.json.tmp then rename; runDir must exist
readManifest(runDir): Promise<Manifest>               // throws ZodError / SyntaxError / ENOENT
MANIFEST_FILE = 'manifest.json'; SHARD_TABLES = ['games','hands','decisions']; type ShardTable
shardsDir(runDir) -> <runDir>/shards
shardFileName(shard, table) -> `shard-<NNNNN>.<table>.jsonl.gz`   (padStart 5)
shardFilePaths(runDir, shard): Record<ShardTable, string>        (runDir-joined final paths)
// scripts/datagen/shard.ts
ShardParams = Pick<RunOptions, 'run_id'|'preset'|'games'|'shard_size'|'strategies'|'replay_every'>  (a RunOptions fits)
ShardHooks = Pick<PlayRecordedGameOptions, 'runAiLoop'|'replayRunAiLoop'|'transformRows'>   (plain functions)
ShardStamp { git_commit: string; git_dirty: boolean; now: () => string }   // supplied by the caller
processShard({ params, shard, runDir, hooks?, stamp }): Promise<ShardResult>
ShardResult = CompleteShardEntry | { status: 'failed', seed: string, message: string }
```
`processShard`: mkdir `<runDir>/shards` (recursive); plays games `0..n-1` of the shard (n from `planShards`;
RangeError if the shard is not in the plan); after each game appends its rows to the three sinks; on success
calls `finish()` on games, hands, decisions in that order (each renames) and returns the manifest `complete`
entry (`files.*.path` relative to `runDir`, e.g. `shards/shard-00000.games.jsonl.gz`; `completed_at = stamp.now()`
called after the renames). On `GameFailure`: aborts the sinks (`.tmp` files STAY), returns the failure
(first failing game only). Any other error: aborts the sinks and rethrows unchanged (the seed is then
`gameSeed(run_id, shard, index)`, which the caller/Iteration 6 must derive; `processShard` does not).
Keys of every row are the schema's order (tests check this against the schemas' shapes).

## Conventions & invariants
- Imports of `src/` only from domain, engine, score, players, service/ai-loop, service/player-view.
- Option names in the manifest/params use snake_case (`shard_size`, `replay_every`); CLI flags use hyphens.
- Several problems in one command line: first one reported, in the order of the spec's Command line block (I-7); `--run-id` is checked first.
- Messages in `UsageError` are single-line; `parseArgs` errors are cut at the first newline.
- `--out` is not validated or touched by the parser (relative paths are relative to cwd).
- Tests spawning the CLI/workers set a 120 s timeout and write only under `makeTempDir()`.

- Recorder: the view-derived columns are captured in `choose` BEFORE the inner strategy runs; the row is
  finished in `onTransition` (oracle columns from `prev`, `step` = rows so far). Hand boundaries: the
  recorder resets `cards_played_this_hand`/`trick_number` on `hand-dealt` events and counts `card-played`
  and `trick-won` events; it starts at hand 0 empty (so `createRecorder` needs the initial state). The
  row is built BEFORE the transition's events are applied to the tracking, so a row shows what preceded it.
- `onTransition` throws if no AI decision was captured (human seats are not supported by the recorder).
- `cards_dealt` comes from `view.handPlan[view.handIndex]`.

## Commands
- Typecheck: `pnpm typecheck` (= `next typegen && tsc --noEmit`; tsconfig includes `scripts/**/*.ts`, `tests/**/*.ts`).
- Lint: `pnpm lint` (= `eslint . --max-warnings 0 && prettier --check .`). `scripts/**` and `tests/**` ARE linted by ESLint (TS rules, no layer rules) and checked by Prettier (singleQuote, printWidth 100); `docs/` and `specs/` are prettier-ignored.
- Tests: `pnpm vitest run tests/unit/datagen` (node project picks up `tests/unit/**`).
- VC-1243 greps: see plan "Conventions".
- Node here is v26 (engines says 24); pnpm prints a harmless warning.

## Known gaps
- `validate` is a stub.
- Pool (D-014): `min(workers, shards)` workers started with `startWorker(worker.ts)`; one shared queue (`shift()` in
  shard order); a worker that answers gets the next shard; the main thread writes the manifest in `record()`
  (serialised promise chain) right after each result; the first `shard-error`, worker `error` or unexpected
  `exit` rejects `executeRun` (workers are terminated in `finally`). `skipped` is always 0 (resume: Iteration 8).
  `executeRun` does mkdir -p of `<out>/<run_id>` (resolved against cwd) and rewrites any existing manifest.
- Failed-shard cleanup (deleting `.tmp`/final files) and start-up `*.tmp` cleanup are not implemented (Iterations 6, 8).
- `processShard` rethrows non-`GameFailure` errors (no seed attached); Iteration 6 converts them to failures.
- The manifest `ShardEntry` 'failed' shape is `error: {seed, message}`; `ShardFailure` (processShard) is flat; the caller maps.
- `rec.rows()` returns the live array; `buildTables` copies into new `DecisionRow` objects.
- Rows are not schema-parsed inside `playRecordedGame` (perf); the sinks/validate iterations parse where needed.
- The manifest `failed` entry is built from the worker's `{seed,message}` in `run.ts` (error.seed string; `null` only after Iteration 6).
- Hook modules from the environment (`GENERATE_DATA_TEST_HOOKS`) are not loaded yet (Iteration 6).
- Replay compares move ids rebuilt from `bid-made`/`card-played` events of the replay result.
- `--out` default for `validate` is `.data/datasets` (I-1).
