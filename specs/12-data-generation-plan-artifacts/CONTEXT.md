# CONTEXT — Spec 12 data generation (state after Iteration 7)

## Current state
- Spec start commit (HEAD before any Phase 12 change): `af777e04fcf3d8b751444c48770134c470622a9b`.
- Iteration 1 done: `pnpm generate-data` exists with full argument validation.
- Iteration 2 done: `decisions` row schemas and the observing recorder exist.
- Iteration 3 done: outcome labels, `games`/`hands` rows, the FR-1212 checks 1-5 and the sampled
  replay (FR-1213) exist as `playRecordedGame`; it returns rows in memory, nothing is written to disk.
- Iteration 4 done: gzip JSONL sinks, the manifest schema/helpers and `processShard` exist; a shard
  can be written to disk in-process. `processShard` leaves a failed shard's `.tmp` files in place; the
  main thread deletes them (Iteration 6, `cleanupShardFiles`).
- Iteration 5 done: `pnpm generate-data run` works end to end with a worker pool and prints the
  4-line summary; exit 0 when every shard is complete, else 1. No resume yet: `run` into an existing
  run id overwrites the manifest (Iteration 8).
- Iteration 6 done: failure handling (FR-1217) and the test-hook seam. Any error thrown while a game is
  played fails the shard with `gameSeed(run, shard, index)`; a failing/dying worker is terminated, the
  shard's files (final and `.tmp`) are deleted by the main thread, the shard is recorded `failed`, a
  replacement worker is started if shards remain; the run prints the summary and exits 1. Hook modules
  from `GENERATE_DATA_TEST_HOOKS` are loaded by the worker. No resume yet (Iteration 8).
- Iteration 7 done: `pnpm generate-data validate` runs the seven checks of FR-1221 (streaming), prints
  the distribution report (status `OK`, or `INCOMPLETE` + exit 1 for runs with non-complete shards) and
  exits 1 on the first failing check. Resume and the parameter guard are still missing (Iteration 8).
- A-2 proven: a `worker_threads` worker started with `execArgv: ['--import', 'tsx']` from a tsx
  process loads `.ts` and resolves `@/`.
- Baseline of `pnpm --silent simulate --games 200 --seed sim` is in `baseline-simulate.txt`
  (3 players, the preset minimum).

## File map
- `package.json` — only change: script `"generate-data": "tsx scripts/generate-data.ts"`.
- `scripts/generate-data.ts` — entry; dispatches on the first argument; UsageError -> stderr line; `run` -> `executeRun` (git info read once here via `git rev-parse HEAD` / `git status --porcelain`); `validate` -> `executeValidate`.
- `scripts/datagen/constants.ts` — `SCHEMA_VERSION`, `GENERATOR_VERSION`, FR-1203 defaults, `DEFAULT_OUT`.
- `scripts/datagen/args.ts` — `parseRunArgs`, `parseValidateArgs`, `UsageError`, option types.
- `scripts/datagen/worker.ts` — worker entry: answers `selftest` and `shard` messages; loads hooks once at start; calls `onShard` around a shard (never mentions the manifest, VC-1251).
- `scripts/datagen/hooks.ts` — `loadHooks`, `HookModule`, `LoadedHooks`, `HOOKS_ENV`.
- `tests/unit/datagen/failures.test.ts` — VC-1221..1226/1229b/1247/1251/1253, `loadHooks`, `cleanupShardFiles`.
- `tests/unit/datagen/fixtures/hooks-configurable.ts`, `hooks-empty.ts` — hook modules (see Public interfaces).
- `scripts/datagen/worker-host.ts` — `startWorker` and the message types `ShardRequest`/`ShardResponse`/`ShardErrorResponse`.
- `scripts/datagen/run.ts` — `executeRun`, the pool, `cleanupShardFiles`, `formatSummary`, `oneDecimal`.
- `tests/unit/datagen/run.test.ts` — VC-1201/1203/1204/1205/1227/1228/1229/1232/1249 at CLI level, summary format.
- `scripts/datagen/schema.ts` — Zod schemas `PendingDecisionRowSchema`, `OutcomeColumnsSchema`, `DecisionRowSchema`, `GamesRowSchema`, `HandsRowSchema`, and the manifest: `ShardFileSchema`, `ManifestParamsSchema`, `ShardEntrySchema`, `ManifestSchema` (+ types).
- `scripts/datagen/sinks.ts` — `createJsonlGzipSink`.
- `scripts/datagen/manifest.ts` — `planShards`, `newManifest`, `writeManifestAtomic`, `readManifest`, shard naming helpers.
- `scripts/datagen/shard.ts` — `processShard`.
- `scripts/datagen/labels.ts` — `buildTables` (labels, `hands` rows, `games` row).
- `scripts/datagen/game.ts` — `gameSeed`, `GameFailure`, `playRecordedGame`, `replayAgainst` (shared replay code).
- `scripts/datagen/validate.ts` — `executeValidate`, `ValidationError`, `CHECK_NAMES`.
- `scripts/datagen/report.ts` — `createReportAccumulator`, `formatReport`, `oneDecimal`, `ReportStats`.
- `tests/unit/datagen/validate.test.ts` — VC-1233..1237 at CLI level, report formatting.
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
//       -> or ShardErrorResponse { kind:'shard-error', shard, message }  (thrown outside a game: hook load, onShard, sinks, disk)
//   A worker handles one shard message at a time and stays alive for the next while shards succeed.
//   The worker builds `stamp.now = () => new Date().toISOString()` and passes the loaded hooks to processShard.
//   Failure message of a game: result {status:'failed', seed: <that game's seed>, message}. The main thread
//   treats {failed result, shard-error, worker 'error' event, worker exit} alike (see run.ts below).
// scripts/datagen/run.ts
executeRun(options: RunOptions, deps: { now: () => string; gitInfo: {git_commit,git_dirty}; write?: (s)=>void }):
  Promise<{ manifest: Manifest; exitCode: 0|1 }>
cleanupShardFiles(runDir: string, shard: number): Promise<string | null>
  // deletes the 3 final files and their `.tmp` of the shard (rm force: missing is fine); null when all gone,
  // else the other errors' messages joined with ", ". Call only after the shard's worker has stopped (I-6).
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
```ts
// scripts/datagen/game.ts (added in Iteration 7; playRecordedGame's replay now calls it)
replayAgainst({ preset, strategies, seed, recordedMoveIds, recordedTotals, replayLoop?, fail }): void
  // rebuilds seats `ai-<k>` (playerId = name = `ai-<k>`) with strategy names `strategy_by_seat[k]`, gameId = seed =
  // the games row's seed, plays the real runAiLoop WITHOUT recording, compares every chosen move id in order and the
  // final totals; `fail(message)` must throw (generator: GameFailure; validate: wrapped as check 7).
// scripts/datagen/validate.ts
executeValidate(options: ValidateOptions, io?: { out?, err? }): Promise<{ exitCode: 0 | 1 }>
  // writes to process.stdout/stderr by default. Run dir = path.join(options.out, options.run_id).
class ValidationError extends Error { check: number /* 1..7 */ }   // message: `validate: check N (<name>): <detail>`
CHECK_NAMES = ['manifest','files','rows','join','decisions per game','labels','replay']
// scripts/datagen/report.ts
createReportAccumulator(): { addGame(game: GamesRow, decisionCount), addHand(hand: HandsRow), stats(): ReportStats }
formatReport(runId: string, status: 'OK' | 'INCOMPLETE', stats: ReportStats): string   // 6+ lines, trailing "\n"
oneDecimal(n): string          // never "-0.0" (run.ts has its own identical copy)
```
Validate flow: `<out>/<id>/manifest.json` missing (dir or file) -> stderr `generate-data: no run "<id>" in <out>`
(out as given), exit 1, stdout empty. Else check 1 (readManifest; any error), check 2 over every complete shard
(stat, SHA-256 streamed, rows = gunzip line count), then per complete shard in order: streams games -> hands ->
decisions through `createReadStream -> createGunzip -> readline`, parsing each line (check 3), joining (4),
counting decisions (5), labels (6), and keeps only that shard's games/hands rows plus the move ids of replay-sampled
games (index = last seed segment, `index % manifest.params.replay_every === 0`); the lowest failing check of a shard
is reported after its streaming, then the replays (7). stderr is ONE line `generate-data: validate: check N (<name>): <detail>`:
- 1 `manifest.json: <first zod/JSON problem>`; 2 `shard S <table>: file <path> is missing | N bytes, manifest says M |
  SHA-256 <hex> differs from the manifest | N rows, manifest says M | cannot be read (<reason>)`;
- 3 `shard S <table> line L: <problem>`; 4 `shard S: duplicate game <id> | hands row for unknown game <id> | decisions row for
  unknown game <id>` or `shard S game <id>: N hands rows, n_hands is M`;
- 5 `shard S game <id>: N decisions rows, expected E` (also `n_hands is M, the hand plan has K`, `no hand plan for <preset>`);
- 6 `shard S game <id> hand H seat K: differs from the score engine` (`scoreHand(getPreset(preset), {handIndex, cardsPerPlayer,
  dealer, trumpSuit: trump_card's last char, bids, tricks})` vs bid/tricks/made/points) or `hand H: cannot be scored (<RangeError>)`;
  also `shard S game <id> step N: hand_* labels differ from the hands row (hand H) | final_total/final_place differ from the
  games row | no hands row for hand H`, or `... hand H: T tricks won, C cards dealt`, `... seat K: hands points sum to X, final total is Y`;
- 7 `shard S game <id>: replay: step N differs (recorded a, replayed b)` / `replay: final totals differ (...)`.
Report accumulator: seat/strategy averages in order of first appearance; histogram line per distinct cards_dealt.

```ts
// scripts/datagen/hooks.ts  (worker side only; the main thread never reads the variable)
HOOKS_ENV = 'GENERATE_DATA_TEST_HOOKS'
interface HookModule { runAiLoop?(real) => fn; replayRunAiLoop?(real) => fn;
                       transformRows?(rows: GameTables) => GameTables; onShard?({shard, phase:'start'|'end'}) => void }
interface LoadedHooks { hooks: ShardHooks /* plain functions, factories applied once */; onShard? }
loadHooks(env = process.env): Promise<LoadedHooks>   // unset or '' -> { hooks: {} }; else import(default export, missing = no hook)
```
Hook module contract: the module's DEFAULT export holds the optional functions; the worker imports it once at
start (file path, absolute or relative to cwd). `onShard('start')` runs before `processShard`, `'end'` after it
returned a complete entry (after the renames); NOT called for a failed shard. A hook that throws (or a throwing
`onShard`) fails the shard with `seed: null` for `onShard`/load errors; a throw inside a game hook (`runAiLoop`,
`transformRows`, `replayRunAiLoop`) fails the shard with that game's seed.
Fixtures (tests/unit/datagen/fixtures/): `hooks-empty.ts` (`export default {}`); `hooks-configurable.ts`, inert
unless env vars are set by the test (via `runCli(args, { env })`): `HOOK_FAIL_SEED` (the game, matched on
`state.seed` / `rows.games.seed`), `HOOK_MODE` (`not-game-over|limit|illegal` for runAiLoop;
`drop-decision|points|tricks|drop-hand` for transformRows; `replay-differ` for replayRunAiLoop, changes step 1),
`HOOK_CALLS_LOG` (one seed per runAiLoop-hook call), `HOOK_REPLAY_LOG` (one seed per replay), `HOOK_TIMES_LOG`
(`<shard> <phase> <ms>`), `HOOK_EXIT_SHARD` (process.exit(1) at that shard's start), `HOOK_MANIFEST_PATH`
(deleted at start of shard 0). Hook modules may read any env var (I-4).

`processShard`: mkdir `<runDir>/shards` (recursive); plays games `0..n-1` of the shard (n from `planShards`;
RangeError if the shard is not in the plan); after each game appends its rows to the three sinks; on success
calls `finish()` on games, hands, decisions in that order (each renames) and returns the manifest `complete`
entry (`files.*.path` relative to `runDir`, e.g. `shards/shard-00000.games.jsonl.gz`; `completed_at = stamp.now()`
called after the renames). On `GameFailure`: aborts the sinks (`.tmp` files STAY), returns the failure
(first failing game only). ANY error thrown by `playRecordedGame` (check failures, `AiLoopLimitError`,
`IllegalMoveError`, hooks) becomes `{status:'failed', seed: gameSeed(run_id, shard, index), message: error.message}`
(sinks aborted, `.tmp` stay). Errors outside the game call (sink/disk errors) abort the sinks and rethrow.
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
- Validate (D-022): checks 3-7 run per shard, not each over the whole dataset, so a check-3 failure in shard 5 is not
  reported before a check-4 failure in shard 0 (shard 0's is). Check 5 of FR-1212 is re-scored with `scoreHand` (D-026).
  Validate does not compare manifest `run_id` with `--run-id`.
- Pool (D-014, D-018): `min(workers, shards)` slots, each owning at most one live worker (`startWorker(worker.ts)`);
  one shared queue (`shift()` in shard order); the main thread writes the manifest in `record()` (serialised
  promise chain). Per shard `exchange()` resolves on the first of: shard-result (complete or failed), `shard-error`,
  worker `error`, worker `exit` (message `worker exited unexpectedly (code N)`, seed null). On any failure the slot
  `terminate()`s the worker (waits for exit), runs `cleanupShardFiles`, records `failed` (`error: {seed, message}`,
  message gets `; cleanup failed: <reason>` when cleanup reports a problem), and spawns a replacement lazily.
  Only a manifest write failure (disk) rejects `executeRun`. `skipped` is always 0 (resume: Iteration 8).
  Exit code: 0 iff every shard is `complete`, else 1 (summary is always printed first).
  `executeRun` does mkdir -p of `<out>/<run_id>` (resolved against cwd) and rewrites any existing manifest.
- Start-up `*.tmp` cleanup is not implemented (Iteration 8).
- The manifest `ShardEntry` 'failed' shape is `error: {seed, message}`; `ShardFailure` (processShard) is flat; the caller maps.
- `rec.rows()` returns the live array; `buildTables` copies into new `DecisionRow` objects.
- Rows are not schema-parsed inside `playRecordedGame` (perf); the sinks/validate iterations parse where needed.
- The manifest `failed` entry is `{shard, games, status:'failed', error:{seed: string|null, message}}`, built in `run.ts`;
  `seed` is null for a dead worker, `shard-error`, `onShard`/hook-load errors.
- Replay compares move ids rebuilt from `bid-made`/`card-played` events of the replay result.
- `--out` default for `validate` is `.data/datasets` (I-1).
