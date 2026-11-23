# Spec 04 — Players, Player View, AI Loop and Simulation

> Version: 0.2 · Last updated: 2026-11-23 · Status: Draft · Owner: Federico Castañeda
> Source: [`docs/implementation.md`](../docs/implementation.md) §3 Phase 4 (Milestone M1). Context: [`docs/design.md`](../docs/design.md) §4.5, §5.5, §7, §8, §9; [`docs/architecture.md`](../docs/architecture.md) §3, §4.1.
> Builds on: [`specs/00-project-scaffold-frozen.md`](./00-project-scaffold-frozen.md) (layer rule: `src/players` → `src/domain` only; `src/service` → core + `state`; `tests/sim` run by `pnpm test:sim`), [`specs/01-domain-model-frozen.md`](./01-domain-model-frozen.md) (`SeatInfo`, `PlayerView`, `DecisionContext`, `Decision`, `LegalMove`, `Rng`), [`specs/02-engine-frozen.md`](./02-engine-frozen.md) (`createGame`, `currentActor`, `legalMoves`, `applyMove`, `aiRng`, `tableViewFor`, `checkInvariants`; replay from events) and [`specs/03-score-engine-frozen.md`](./03-score-engine-frozen.md) (`evaluate`; BR-302 consistency; `PlayerView` hand-off).
> Requirement IDs use the 4xx range. Domain types are used exactly as frozen in spec 01.

## Purpose

The engine plays and the score engine scores, but nothing yet decides moves for computer players, and nothing has ever played thousands of whole games to prove the rules hold together. This spec delivers the player model and the first AI (`random`), the one function that builds a seat's `PlayerView`, the AI loop that plays AI turns until a human must act or the game ends, a CLI simulator, and a simulation test suite that plays seeded all-AI games for every preset and player count, checking invariants, card conservation, determinism and replay after every move. It closes Milestone M1 (a complete, verified game core) and benefits the developers of Phases 5–9, who build storage, the service, the API and the UI on a core proven by simulation.

## Scope

**In**
- `src/players/player.ts`, `human-player.ts`, `ai-player.ts`: the `Player` and `AIStrategy` types and their factories (plain objects, no classes).
- `src/players/strategies/random.ts`: `randomStrategy`.
- `src/players/registry.ts`: strategy lookup by name and building the players of a game from its seats.
- `src/service/player-view.ts`: `buildPlayerView`.
- `src/service/ai-loop.ts`: `runAiLoop`, `AiLoopLimitError`.
- `scripts/simulate.ts`: the `pnpm simulate` CLI.
- `tests/sim/`: seeded all-AI simulation (one file per preset) with per-move checks, the card-conservation ledger (`tests/sim/ledger.ts`), determinism and replay; a `SIM_SEEDS` override for long runs.
- Adding a `pnpm test:sim` step to `.github/workflows/ci.yml`.
- Deleting `src/players/.gitkeep`, `src/service/.gitkeep`, `tests/sim/.gitkeep`.
- Updating `docs/design.md` §8 and `docs/development.md` (a new section) to match this spec.
- Unit tests in `tests/unit/players/` and `tests/unit/service/`.

**Out**
- `GameService`, seat tokens, seed generation, persistence, `PlayerUpdate` assembly, version handling, `final.json` (Phases 5–7).
- Any strategy other than `random` (heuristic, Monte Carlo); per-seat strategy configuration in the API or UI.
- A nightly or scheduled CI workflow for the long simulation run (the ≥ 2,000-seed run is local and recorded in the PR).
- Any change to the engine, the score engine or the domain types.

## Actors

| Actor | Description | Permissions |
|---|---|---|
| GameService (Phase 7) | Builds views for every response and runs the AI loop after each human move and at game creation | Calls `buildPlayerView`, `runAiLoop`, `createPlayers` |
| AI strategy | Chooses a move for an AI seat | Sees only its `DecisionContext` (`PlayerView`, legal moves, AI RNG); never the state |
| Simulator CLI user (developer) | Runs batches of all-AI games and reads the summary | Runs `pnpm simulate` |
| Simulation tests | Play seeded all-AI games with per-move checks | Call every exported function of `src/players`, `src/service`, the engine and the score engine |

## Functional Requirements

### Players and strategies

- **FR-400 (Must)** — `Player` is a plain object `{ seat: number; name: string; kind: 'human' | 'ai'; requestDecision(ctx: DecisionContext): Decision }`, and `AIStrategy` is a plain object `{ name: string; choose(view: PlayerView, moves: LegalMove[], rng: Rng): LegalMove }`. No classes are used in `src/players` except `Error` subclasses (`UnknownStrategyError`), which follow the codebase's error convention so callers can use `instanceof`.
- **FR-401 (Must)** — Given a seat and a name, when `createHumanPlayer(seat, name)` is called, then it returns a `Player` with `kind: 'human'` whose `requestDecision` returns `{ type: 'await' }` for any context.
- **FR-402 (Must)** — Given a seat, a name and an `AIStrategy`, when `createAiPlayer(seat, name, strategy)` is called, then it returns a `Player` with `kind: 'ai'` whose `requestDecision(ctx)` returns `{ type: 'move', moveId: strategy.choose(ctx.view, ctx.legalMoves, ctx.rng).id }`.
- **FR-403 (Must)** — Given a view, a non-empty list of legal moves and an `Rng`, when `randomStrategy.choose(view, moves, rng)` is called, then it returns `moves[rng.int(0, moves.length − 1)]` (one draw, uniform over all moves, bids and plays alike); `randomStrategy.name === 'random'`. It reads nothing from `view`.
- **FR-404 (Must)** — Given a strategy name, when `getStrategy(name)` is called, then it returns the registered strategy (`'random'` → `randomStrategy`); `undefined` or `''` returns `randomStrategy`; any other name throws `UnknownStrategyError` whose message contains the name. `STRATEGY_NAMES` lists the registered names (`['random']`).
- **FR-405 (Must)** — Given a game's `seats: SeatInfo[]`, when `createPlayers(seats)` is called, then it returns one `Player` per seat in seat order: `createHumanPlayer(seat, name)` for `kind: 'human'`, `createAiPlayer(seat, name, getStrategy(strategy))` for `kind: 'ai'`.

### Player view

- **FR-406 (Must)** — Given a state and a seat (or `'spectator'`), when `buildPlayerView(state, seat)` is called, then it returns `{ ...tableViewFor(state, seat), scoreboard: evaluate(state) }`, plus `finalRanking = scoreboard.ranking` only when `phase === 'game-over'`; otherwise the result has no `finalRanking` property (`'finalRanking' in view === false`). It is the only function in `src` that builds a `PlayerView`.
- **FR-407 (Must)** — Given any state and viewer, then the `PlayerView` contains no card currently held in another seat's hand except the publicly shown trump card (cards already played, in `currentTrick` and `lastTrick`, are public), and no seed, rules or `aiDecisionCount` (spec 02 BR-205 extended to the composed view).

### AI loop

- **FR-408 (Must)** — Given a state and `players` with `players.length === state.seats.length`, `players[i].seat === i` and `players[i].kind === state.seats[i].kind` for every `i`, when `runAiLoop(state, players, options?)` is called, then it repeats: `seat = currentActor(state)`; stop if `null`; build `ctx = { view: buildPlayerView(state, seat), legalMoves: legalMoves(state, seat), rng: aiRng(state, seat) }`; call `players[seat].requestDecision(ctx)`; stop on `{ type: 'await' }`; otherwise `applyMove(state, seat, moveId)`. It returns `{ state, events, moves }`: the final state, every event of every applied transition in order, and the number of moves applied.
- **FR-409 (Must)** — Given `options.onTransition`, when each move is applied, then `onTransition(prev, transition)` is called with the state before the move and the returned `Transition`, before the next decision is requested. An exception it throws propagates out of `runAiLoop`.
- **FR-410 (Must)** — Given `players` that violate FR-408's length, seat or kind conditions, when `runAiLoop` is called, then it throws `RangeError` naming the offending seat (or the length mismatch) before any move is applied.
- **FR-411 (Must)** — Given the loop has applied `maxMoves` moves (`options.maxMoves`, default `1000`) and the current actor is still an AI seat, when the next decision would be requested, then `runAiLoop` throws `AiLoopLimitError` with `moves` (the count applied) and `state` (the state reached). A strategy that returns a `moveId` not in `legalMoves` makes `applyMove` throw `IllegalMoveError`, which propagates unchanged.
- **FR-412 (Must)** — Given an all-AI game, then `runAiLoop(createGame(...).state, createPlayers(seats))` plays it to `game-over` in one call for every preset and valid player count (the longest game, argentina-fidepo with 3 players, is 981 moves, under the default cap).

### Simulation

- **FR-413 (Must)** — Given `pnpm test:sim`, then for every preset × valid player count (18 combinations) it plays `S` seeded all-AI games through `runAiLoop` with seeds `sim-<presetId>-<players>-<i>` for `i = 0 … S − 1`, where `S` is `200` when `SIM_SEEDS` is unset or empty, `Number(SIM_SEEDS)` when it is a positive integer written in decimal digits, and otherwise the suite fails at load with an error naming the value (so a typo never silently runs 200 seeds); every game reaches `game-over`. Layout: one test file per preset (`tests/sim/<presetId>.sim.test.ts`, so vitest runs presets in parallel workers), one `it` per player count × seed named `<presetId> <players>p seed <i>` (each test is one game plus its checks, well inside vitest's default 5 s timeout, so `vitest.sim.config.ts` is unchanged). The ledger and shared sim helpers live in `tests/sim/` (e.g. `tests/sim/ledger.ts`, `tests/sim/harness.ts`), never in `src`.
- **FR-414 (Must)** — Given each simulated game, then in `onTransition` after every move it asserts: `checkInvariants(transition.state)` returns `[]`; `evaluate(transition.state)` does not throw and satisfies spec 03 BR-302 and `'live' in board === (state.hand !== null)`; and the card-conservation ledger (FR-415) holds.
- **FR-415 (Must)** — The card-conservation ledger tracks each hand from its deal (hand 0 from the `createGame` state; hand k+1 from the state of the transition whose events contain `hand-dealt`): the *dealt set* is the union of every seat's hand right after the deal; it has `N × cardsPerPlayer` distinct cards, all in `buildDeck(rules.deck, N)`; the trump card is in the deck and is in the dealt set iff `trumpCardInDealerHand`. Each transition's events are processed in order: a `card-played` is credited to the open hand (the played card must be in the dealt set and not yet played); `hand-completed` closes the open hand and asserts every dealt card was played exactly once; `hand-dealt` opens the next hand from `transition.state`; after `game-over` nothing is checked. After every transition whose state has a non-null `hand` and no `hand-dealt` event, (cards still in hands) ∪ (cards played in the open hand) equals the dealt set with no card counted twice.
- **FR-416 (Must)** — Given the same seed and seats, two simulated runs produce identical event lists (deep-equal). For each combination this is checked on the first `min(S, 10)` seeds.
- **FR-417 (Must)** — Given a simulated game's events, replay rebuilds it with `createGame` (same input) and `applyMove(state, event.seat, 'bid:<tricks>' | 'play:<cardId>')` for each `bid-made` / `card-played` event in order, without any player or strategy; after each replayed move the full state (including `aiDecisionCount`) and `evaluate(state)` deep-equal those of the original run at the same step. For each combination this is checked on the first `min(S, 10)` seeds.

### Simulator CLI

- **FR-418 (Must)** — Given `pnpm simulate [--preset <id>] [--players <n>] [--games <n>] [--seed <prefix>]` (defaults `argentina-fidepo`, the preset's `players.min`, `100`, `sim`), when it runs, then it plays the games all-AI through `runAiLoop` with seeds `<prefix>-<i>` and prints: preset, players, games, hands per game, average final total per seat, made-bid rate (`Σ madeCount / Σ hands × players`) and wall-clock duration; it exits `0`.
- **FR-419 (Must)** — Given invalid arguments — an unknown flag, a flag without a value, an unknown preset, a `--players` that is not an integer in the preset's range, a `--games` that is not a positive integer, or an empty `--seed` — when `pnpm simulate` runs, then it prints one error line naming the problem to stderr, prints nothing to stdout and exits `1` without playing. An error thrown while playing (e.g. `AiLoopLimitError`) is printed to stderr with the seed of the failing game and exits `1`.

### CI and docs

- **FR-420 (Must)** — `.github/workflows/ci.yml` runs `pnpm test:sim` (default `S = 200`) as a step after `pnpm test`.
- **FR-421 (Must)** — `docs/design.md` §8 describes the plain-object player model of FR-400 to FR-405 (replacing the class diagram), the loop of FR-408 to FR-411 and the `PlayerView` composition of FR-406; `docs/development.md` gains a section "Players, views and simulation" numbered after "Score" (later sections and cross-references renumbered) with the module map, how to run the AI loop, how to add a strategy, `pnpm simulate` usage, `pnpm test:sim` and `SIM_SEEDS`, and how the ledger and replay checks work.

## Business Rules

- **BR-401 — AIs see only the view.** A strategy receives only `DecisionContext`; nothing in `src/players` imports `src/engine`, `src/score` or `src/service`, or reads `GameState`. *Rationale:* design §8.1 (AIs and humans see the same restricted view). *Exceptions:* none.
- **BR-402 — AI randomness never touches the deal.** AI choices use only `aiRng(state, seat)`; changing a strategy never changes any deal (spec 02 BR-202). *Rationale:* replay and fair comparisons of strategies. *Exceptions:* none.
- **BR-403 — One path for every move.** Every AI move goes through `legalMoves` → `requestDecision` → `applyMove`, the same path a human move takes. *Rationale:* design §8.1. *Exceptions:* none.
- **BR-404 — Service helpers are pure.** `src/service/player-view.ts` and `src/service/ai-loop.ts` import only `src/domain`, `src/engine`, `src/score` and `src/players`; no storage, state, `config`, I/O, time or ambient randomness. *Rationale:* the simulator, tests and Phase 7 share them (implementation.md Phase 4). *Exceptions:* none.

## Non-Functional Requirements

- **NFR-401** — `pnpm typecheck`, `pnpm lint` (0 warnings), `pnpm test` and `pnpm test:sim` pass, locally and in CI.
- **NFR-402** — `package.json` `dependencies` are unchanged: exactly `next, react, react-dom, zod, @noble/hashes` (`@noble/hashes` at `2.4.0`).
- **NFR-403** — The CI step `pnpm test:sim` (S = 200, all 18 combinations) completes in < 10 minutes as reported by the GitHub Actions step duration. *Why:* the sweep runs on every PR; 10 minutes keeps the PR loop usable while covering 3,600 games.
- **NFR-404** — A local run with `SIM_SEEDS=2000 pnpm test:sim` passes; its command, duration and result are recorded in the PR description, together with the duration of a local default `pnpm test:sim` run (S = 200). *Why:* implementation.md Phase 4 "Done when"; the local S = 200 time is the early warning for NFR-403 (if it exceeds 5 minutes locally, the CI budget is at risk and the implementer stops and reports before pushing).

## Data & Interfaces

### Module exports

| Module | Exports |
|---|---|
| `src/players/player.ts` | types `Player`, `AIStrategy` |
| `src/players/human-player.ts` | `createHumanPlayer(seat: number, name: string): Player` |
| `src/players/ai-player.ts` | `createAiPlayer(seat: number, name: string, strategy: AIStrategy): Player` |
| `src/players/strategies/random.ts` | `randomStrategy: AIStrategy` |
| `src/players/registry.ts` | `STRATEGY_NAMES: readonly string[]`; `UnknownStrategyError`; `getStrategy(name: string \| undefined): AIStrategy`; `createPlayers(seats: readonly SeatInfo[]): Player[]` |
| `src/service/player-view.ts` | `buildPlayerView(state: GameState, seat: number \| 'spectator'): PlayerView` |
| `src/service/ai-loop.ts` | `runAiLoop(state: GameState, players: readonly Player[], options?: AiLoopOptions): AiLoopResult`; `AiLoopLimitError`; types `AiLoopOptions`, `AiLoopResult` |

No barrel `index.ts`. Domain types come from their spec-01 modules, engine functions from `@/src/engine/engine` and `@/src/engine/view`, `evaluate` from `@/src/score/score-engine`.

### `ai-loop.ts`

```ts
export interface AiLoopOptions {
  maxMoves?: number;                                              // default 1000
  onTransition?: (prev: GameState, transition: Transition) => void;
}
export interface AiLoopResult { state: GameState; events: GameEvent[]; moves: number }
export class AiLoopLimitError extends Error {
  readonly moves: number;
  readonly state: GameState;
}
```

### Simulator output (FR-418)

```
preset: argentina-fidepo  players: 3  games: 100  hands/game: 29
average total per seat: 0: 123.4  1: 120.9  2: 125.1
made-bid rate: 31.2%
duration: 4.8 s
```

Values illustrative; the labels and order are fixed, numbers have one decimal.

## Verification Criteria

### Players and strategies
- **VC-401** (FR-400, FR-401, FR-402): `createHumanPlayer(1, 'Ana')` → `{ seat 1, name 'Ana', kind 'human' }` and `requestDecision(anyCtx)` → `{ type: 'await' }`; `createAiPlayer(2, 'Bot', stub)` with a stub strategy returning `moves[1]` → `requestDecision(ctx)` → `{ type: 'move', moveId: ctx.legalMoves[1].id }` and the stub receives exactly `ctx.view`, `ctx.legalMoves`, `ctx.rng`; `grep -rn "class " src/players | grep -v "extends Error"` finds nothing.
- **VC-402** (FR-403, BR-402): for 20 seeds, `randomStrategy.choose(view, moves, deriveRng(seed, 'ai', 0, 0))` over 3 moves returns `moves[deriveRng(seed, 'ai', 0, 0).int(0, 2)]` (a second, fresh Rng with the same labels); over 6,000 calls with `deriveRng('s', 'ai', 0, 0)` on 3 moves each index is chosen 1,800–2,200 times; `choose` with a `view` whose every property throws on access (a `Proxy`) still works.
- **VC-403** (FR-404, FR-405): `getStrategy('random')`, `getStrategy(undefined)`, `getStrategy('')` → `randomStrategy`; `getStrategy('genius')` → `UnknownStrategyError` whose message contains `genius`; `STRATEGY_NAMES` deep-equals `['random']`; `createPlayers` for seats `[human 'Ana', ai (no strategy), ai 'random']` → kinds `human, ai, ai`, seats `0, 1, 2`, names as given; seats with strategy `'genius'` → `UnknownStrategyError`.

### Player view
- **VC-404** (FR-406): for a bidding state (seat 1) the view deep-equals `{ ...tableViewFor(state, 1), scoreboard: evaluate(state) }` and `'finalRanking' in view === false`; for a game-over state `view.finalRanking` deep-equals `view.scoreboard.ranking`; for `'spectator'` `view.you === null`; `grep -rln "evaluate(" src` lists only `src/service/player-view.ts` (besides `src/score/` itself).
- **VC-405** (FR-407, BR-401): for every state of one seeded 4-player argentina-fidepo game (covering a stock-trump and a whole-deck hand) and every viewer, cards collected from `buildPlayerView` by a recursive walk (compared by `cardId`) include no card of another seat's hand except `trumpCard`; `JSON.stringify(view)` does not contain the seed; no `rules`, `seed` or `aiDecisionCount` key; `grep -rnE "src/(engine|score|service)|GameState" src/players` finds nothing.

### AI loop
- **VC-406** (FR-408, BR-403): a 4-seat game `[human, ai, ai, ai]` created by `createGame`: `runAiLoop` stops exactly when seat 0 must act (or at game over) — `currentActor(result.state) === 0`; `result.moves` equals the number of `bid-made` + `card-played` events in `result.events`; every applied move's id was in `legalMoves(prev, seat)` (checked in `onTransition`); applying the human's first legal move and calling `runAiLoop` again continues; the human's `requestDecision` was called once per stop.
- **VC-407** (FR-409): `onTransition` is called once per move with `prev` deep-equal to the state before that move and `transition.state` deep-equal to the next `prev`; an `onTransition` that throws on the 5th call makes `runAiLoop` throw that error with exactly 5 moves applied (observed via a counter).
- **VC-408** (FR-410): players of length 3 for a 4-seat game; `players[2].seat = 3`; `players[1].kind = 'human'` for an AI seat → each `RangeError` naming the seat or the length, and the stub strategies record zero `choose` calls.
- **VC-409** (FR-411): an all-AI argentina-fidepo 3-player game with `maxMoves: 50` → `AiLoopLimitError` with `moves === 50` and `state` = the state after 50 moves (`currentActor(state)` is an AI seat); a strategy returning `{ id: 'bid:99', … }` → `IllegalMoveError` with `reason 'unknown-move'`.
- **VC-410** (FR-412): for each preset at its minimum and maximum player count, `runAiLoop` on a fresh all-AI game reaches `phase 'game-over'` in one call; argentina-fidepo 3 players takes exactly 981 moves.

### Simulation
- **VC-411** (FR-413, FR-414, FR-415, FR-416, FR-417, NFR-401, NFR-403): `pnpm test:sim` with no `SIM_SEEDS` runs 18 combinations × 200 seeds, every game ends at `game-over`, and the per-move invariant, scoreboard, ledger, determinism (first 10 seeds) and replay (first 10 seeds) checks all pass; locally and as the CI step, whose duration is < 10 minutes.
- **VC-412** (FR-415): the ledger fails loudly on corruption — a test in `tests/sim/ledger.sim.test.ts` feeds the ledger (`tests/sim/ledger.ts`) a recorded game whose one `card-played` event is altered to a card not in that seat's hand, or a `hand-dealt` state with a duplicated card, and each is reported as a failure naming the hand.
- **VC-413** (FR-413, NFR-404): `SIM_SEEDS=2000 pnpm test:sim` passes locally; command, duration and result are in the PR description. `SIM_SEEDS=3 pnpm test:sim` runs 3 seeds per combination (observed in the test names or count); `SIM_SEEDS=2k pnpm test:sim` and `SIM_SEEDS=0 pnpm test:sim` fail with an error naming the value; the local S = 200 duration is recorded in the PR and is < 5 minutes.

### Simulator CLI
- **VC-414** (FR-418): `pnpm simulate --preset gamerules --players 4 --games 5 --seed t` exits 0 and prints the four labelled lines of the Simulator output sample in order, with `hands/game: 19`, `games: 5`, four seat averages, a made-bid rate between 0 and 100; running it twice prints identical lines except `duration`.
- **VC-415** (FR-419): `--preset nope`, `--players 9` (argentina-fidepo), `--players abc`, `--games 0`, `--games 2.5`, `--games` (no value), `--seed ''`, `--bogus` → exit code 1, one stderr line naming the problem, nothing on stdout.

### CI, docs, purity, NFRs
- **VC-416** (FR-420): `.github/workflows/ci.yml` contains a `pnpm test:sim` step after the `pnpm test` step; the branch CI run shows it passing.
- **VC-417** (FR-421): `docs/design.md` §8 contains no `classDiagram` and describes `createHumanPlayer`, `createAiPlayer`, `getStrategy`, `runAiLoop`, `AiLoopLimitError` and `buildPlayerView`; `docs/development.md` has a "Players, views and simulation" section numbered right after "Score", mentioning `pnpm simulate`, `pnpm test:sim`, `SIM_SEEDS`, the ledger and replay, with no stale section cross-reference.
- **VC-418** (BR-404, NFR-402): `grep -rnE "src/(storage|state)|@/src/config|Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\." src/service/player-view.ts src/service/ai-loop.ts src/players` finds nothing; `package.json` `dependencies` are exactly `@noble/hashes,next,react,react-dom,zod` with `@noble/hashes` `2.4.0`; `src/players/.gitkeep`, `src/service/.gitkeep`, `tests/sim/.gitkeep` no longer exist.

## Open Questions

None.

## Assumptions

- `scripts/` and `tests/` are outside the layer rule, so `scripts/simulate.ts` and the sim tests may read `process.env`, `process.argv` and use `performance.now()`; `scripts/simulate.ts` runs via `tsx` (`pnpm simulate`, already in `package.json`).
- The engine's `aiRng` and `applyMove` behave as frozen in spec 02 (`applyMove` increments `aiDecisionCount` for AI seats), so replay reproduces `aiDecisionCount` without any player.

## Changelog

- 0.2 (2026-11-23): review pass 1 — `Error` subclasses allowed in `src/players` (FR-400, VC-401); VC-414 four output lines; FR-407 counts only cards held in other hands; FR-413 strict `SIM_SEEDS`, one file per preset and one test per seed, ledger and harness in `tests/sim/`; FR-415 event-order rules at hand boundaries; FR-419 full invalid-argument list and runtime errors; NFR-404 records the local S = 200 duration as the NFR-403 early warning.
- 0.1 (2026-11-23): initial draft from implementation.md Phase 4 and discovery answers (plain-object players and strategies, not classes; `AiLoopLimitError` thrown at the cap; missing strategy name → `random`, unknown name throws; the ≥ 2,000-seed run is local and recorded in the PR, no nightly workflow).
