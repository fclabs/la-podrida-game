# CONTEXT — Spec 12 data generation (state after Iteration 3)

## Current state
- Spec start commit (HEAD before any Phase 12 change): `af777e04fcf3d8b751444c48770134c470622a9b`.
- Iteration 1 done: `pnpm generate-data` exists with full argument validation; `run` and `validate`
  are still **stubs** that print `generate-data: <subcommand> is not implemented yet` to stderr and
  exit 1 (later iterations replace them).
- Iteration 2 done: `decisions` row schemas and the observing recorder exist.
- Iteration 3 done: outcome labels, `games`/`hands` rows, the FR-1212 checks 1-5 and the sampled
  replay (FR-1213) exist as `playRecordedGame`; it returns rows in memory, nothing is written to disk.
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
- `scripts/datagen/schema.ts` — Zod schemas `PendingDecisionRowSchema`, `OutcomeColumnsSchema`, `DecisionRowSchema`, `GamesRowSchema`, `HandsRowSchema` and their types.
- `scripts/datagen/labels.ts` — `buildTables` (labels, `hands` rows, `games` row).
- `scripts/datagen/game.ts` — `gameSeed`, `GameFailure`, `playRecordedGame`.
- `scripts/datagen/cards.ts` — `cardIds`, `hiddenStockLeft`.
- `scripts/datagen/recorder.ts` — `createRecorder`.
- `tests/unit/datagen/recorder.test.ts`, `schema.test.ts` — VC-1207..1216, BR-1208.
- `tests/unit/datagen/labels.test.ts`, `game.test.ts` — VC-1204/1206/1213/1217..1220/1248/1250, per-game checks, replay.
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
- `run` / `validate` are stubs; worker only has the selftest message; no sinks, manifest, shard processor.
- `rec.rows()` returns the live array; `buildTables` copies into new `DecisionRow` objects.
- Rows are not schema-parsed inside `playRecordedGame` (perf); the sinks/validate iterations parse where needed.
- Hook modules from the environment (`GENERATE_DATA_TEST_HOOKS`) are not loaded yet (Iteration 6).
- Replay compares move ids rebuilt from `bid-made`/`card-played` events of the replay result.
- `--out` default for `validate` is `.data/datasets` (I-1).
