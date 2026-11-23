# DECISIONS — Players, Player View, AI Loop and Simulation (Phase 4)

Decisions locked in while building `specs/04-players.md` from `specs/04-players-plan.md`. Plan decisions P-1 to P-6 are recorded here by the iteration that applies them. Entries: `## D-NNN: <title>  (Iteration N)` with Context / Decision / Rejected / Consequences.

## D-001: Strategy registry is a `Map`  (Iteration 1)

- **Context**: `getStrategy(name)` receives names from `SeatInfo.strategy` (persisted, possibly user-supplied). A plain object lookup would find inherited names such as `'constructor'` or `'toString'`.
- **Decision**: `registry.ts` keeps a private `ReadonlyMap<string, AIStrategy>`; `STRATEGY_NAMES` is a frozen array built from its keys. Inherited names throw `UnknownStrategyError` (tested).
- **Rejected**: plain object literal (prototype names leak); null-prototype object (works, but a `Map` is simpler and needs no `Object.hasOwn`).
- **Consequences**: adding a strategy = add its `[name, strategy]` entry to `STRATEGIES`; `STRATEGY_NAMES` follows automatically.

## D-002: `createPlayers` maps seats in array order, no re-validation  (Iteration 1)

- **Context**: FR-405 says "one `Player` per seat in seat order". `GameState.seats` is already in seat order (engine invariant).
- **Decision**: `createPlayers` is `seats.map(...)` with `player.seat = info.seat`; it neither sorts nor checks seat numbers.
- **Rejected**: sorting by `seat` or throwing on gaps — duplicates FR-410's checks in `runAiLoop` and would hide a malformed state instead of reporting it there.
- **Consequences**: a malformed seat list is caught by `runAiLoop`'s `RangeError` (Iteration 2).

## D-003: `ai-loop.ts` imports `./player-view`  (Iteration 2, plan P-2)

- **Context**: BR-404 lists the layers the two service helpers may import (`domain`, `engine`, `score`, `players`); `runAiLoop` needs `buildPlayerView` for each `DecisionContext`.
- **Decision**: `ai-loop.ts` imports `buildPlayerView` from `./player-view` (a layer may always import its own folder — spec 00 lint rule). BR-404's list is about other layers.
- **Rejected**: duplicating the view composition inside the loop (FR-406 makes `buildPlayerView` the only builder of a `PlayerView`).
- **Consequences**: `buildPlayerView` stays the single caller of `evaluate(` in `src` outside `src/score/`.

## D-004: VC-405 game input keeps the seed out of `gameId`  (Iteration 2, plan P-3)

- **Context**: VC-405 asserts `JSON.stringify(view)` does not contain the seed, and the view carries `gameId`.
- **Decision**: the VC-405 game is `createGame({ gameId: 'view-game', rules: getPreset('argentina-fidepo'), seats: makeSeats(4), seed: 'secret-view-seed' })`, played with `playGame` (first legal move).
- **Rejected**: reusing `newGame` (`gameId 'game-1'`, seed `'seed-1'`) — a short seed could match unrelated text by accident.
- **Consequences**: none outside the test.

## D-005: Cap check happens before each decision, only for AI seats  (Iteration 2)

- **Context**: FR-411 says the loop throws when `maxMoves` moves were applied "and the current actor is still an AI seat, when the next decision would be requested".
- **Decision**: at the top of each iteration, after `currentActor`, `if (moves >= maxMoves && state.seats[seat].kind === 'ai') throw new AiLoopLimitError(moves, state)`. A human actor at the cap is still asked (and answers `await`); game over at the cap returns normally. The kind is read from `state.seats` (already proven equal to `players[seat].kind` by FR-410's check).
- **Rejected**: throwing right after the `maxMoves`-th move (would reject a game that ends or reaches a human on exactly that move).
- **Consequences**: `error.state` is the state after `maxMoves` moves with an AI to act; `error.moves === maxMoves` (VC-409).

## D-006: Simulated games use the P-4 input  (Iteration 3, plan P-4)

- **Context**: the sim suite (and later the CLI) needs one fixed `createGame` input per seed so determinism and replay compare like with like.
- **Decision**: `tests/sim/harness.ts` `simInput(presetId, players, seed)` = `{ gameId: 'sim', rules: getPreset(presetId), seats: simSeats(players), seed }` with `seats[i] = { seat: i, playerId: 'ai-<i>', name: 'AI <i>', kind: 'ai' }` (no `strategy` → `random`). Test seeds are `sim-<presetId>-<players>-<i>`.
- **Rejected**: reusing `tests/unit/engine/helpers.ts` `makeSeats` (human seats, other ids).
- **Consequences**: Iteration 4's CLI should build the same input (seeds `<prefix>-<i>`).

## D-007: Sim deep equality via `isDeepStrictEqual`, `expect` only on mismatch  (Iteration 3, plan P-6)

- **Context**: replay compares ~1,000 states and scoreboards per game; `expect(...).toEqual` per step is slow.
- **Decision**: `expectDeepEqual(actual, expected, label)` in the harness calls `node:util` `isDeepStrictEqual` and only on a mismatch calls `expect({ label, actual }).toEqual({ label, actual: expected })` to get vitest's diff. Per-move FR-414 checks throw a plain `Error` (`move <k>: …`) from `onTransition` instead of calling `expect`.
- **Rejected**: `expect().toEqual` per step; custom JSON-string comparison (hides `undefined` vs absent keys).
- **Consequences**: a failure message names the move (`move <k>` / `replayed state after move <k>`); the seed is in the test name.

## D-008: Ledger also checks the card was dealt to the seat that plays it  (Iteration 3)

- **Context**: FR-415 requires a played card to be in the dealt set and not yet played; VC-412 corrupts a `card-played` to "a card not in that seat's hand", which may still be in the dealt set (another seat's card).
- **Decision**: the ledger records, per hand, card id → seat dealt to; a `card-played` whose card was dealt to another seat fails at that event (`card X played by seat s was dealt to seat t`). Everything FR-415 lists is checked too.
- **Rejected**: only the FR-415 minimum (such a corruption would still fail, but later, at the after-transition conservation check, with a less direct message).
- **Consequences**: stricter than the spec, never looser. Ledger errors are `LedgerError` with messages `ledger: hand <k>: …`.

## D-009: `SIM_SEEDS` is validated when the harness module loads; determinism re-runs without checks  (Iteration 3)

- **Context**: FR-413 says an invalid `SIM_SEEDS` fails "at load"; FR-416 needs a second run of the first 10 seeds.
- **Decision**: `harness.ts` exports `SIM_SEEDS = simSeeds(process.env.SIM_SEEDS)` at module scope (`^[1-9][0-9]*$`, unset/empty → 200, else `Error` containing `"<value>"`). Every sim file imports the harness (the ledger test too), so all 5 files fail to load and `pnpm test:sim` exits 1. The FR-416 second run uses `playSimGame(..., { check: false })` and compares the full event log (`createGame`'s events included).
- **Rejected**: checking `SIM_SEEDS` inside a test (a typo would still register 0 or 200 tests); repeating the per-move checks on the second run (same moves, same states — pure cost).
- **Consequences**: `pnpm test:sim` has 18 × S + 5 tests (3,605 at S = 200; 59 at S = 3).

## D-010: CLI parsing with strict `parseArgs`, positionals rejected, first problem wins  (Iteration 4, plan P-5)

- **Context**: FR-419 lists the invalid arguments; P-5 fixes `node:util` `parseArgs` (`strict: true`, string options) with no new dependency.
- **Decision**: `scripts/simulate.ts` calls `parseArgs({ strict: true, allowPositionals: false, options: { preset, players, games, seed: { type: 'string' } } })`. A parseArgs error (unknown flag, missing value, positional) is reported with the first line of its message (some span several lines). Values are then validated in the order preset → players → games → seed; the first problem is the one stderr line. `--players`/`--games` must match `/^[1-9][0-9]*$/` (so `2.5`, `abc`, `0`, `+3`, `1e2` are rejected); a repeated flag keeps its last value (parseArgs default).
- **Rejected**: reporting every problem (FR-419 wants one line); `Number()`/`parseInt` checks (accept `1e2`, `2abc`); accepting positionals (P-5 strict).
- **Consequences**: error lines are `simulate: <problem>`; exit code via `process.exitCode = 1`, no game played.

## D-011: CLI summary math and formatting  (Iteration 4, plan P-1)

- **Context**: FR-418 lists the summary values; P-1 fixes the made-bid rate; the spec sample fixes labels, order, two-space separators and one decimal.
- **Decision**: per game, `evaluate(finalState)`; average total per seat = Σ `totals[seat]` / games; made-bid rate = Σ `madeCount` over all games and seats / (Σ `board.hands.length` × players) × 100; `hands/game` = `state.handPlan.length` (same for every game of a preset × player count); duration = `performance.now()` around the game loop only (not parsing or module load), in seconds. All numbers `toFixed(1)`, `-0.0` normalised to `0.0`. A game that does not end at `game-over` is treated as a failure (`simulate: game <seed> failed: …`).
- **Rejected**: averaging per-game rates (P-1 says sums); timing the whole process (includes tsx start-up).
- **Consequences**: two runs with the same flags print identical lines except `duration` (VC-414).

## D-012: pnpm's banner is not the program's stdout; verify with `pnpm --silent`  (Iteration 4)

- **Context**: FR-419/VC-415 say "nothing on stdout". `pnpm simulate …` itself prints `> la-podrida-game@0.0.0 simulate …`, an "Unsupported engine" WARN and `ELIFECYCLE …` to stdout, independent of the script.
- **Decision**: the script never writes to stdout on error; VC-414/VC-415 are verified with `pnpm --silent simulate …` (identical script invocation, pnpm's banner suppressed). No `package.json`/`.npmrc` change (out of scope).
- **Rejected**: changing the `simulate` script or adding `.npmrc` `loglevel` (touches files outside this iteration; changes every script).
- **Consequences**: docs (Iteration 5) should show `pnpm simulate …` and mention `--silent` for clean, pipeable output.
