# Frozen: Spec 04 — Players, Player View, AI Loop and Simulation

Source: specs/04-players.md (plan + build record: specs/04-players-plan.md, specs/04-players-plan-artifacts/; review: specs/04-players.review.md)
Status: SHIPPED
Frozen: 2026-11-23
PR / commit: https://github.com/fclabs/la-podrida-game/pull/5 — squash commit b27fb92

## Purpose
The engine plays and the score engine scores, but nothing yet decides moves for computer players, and nothing has ever played thousands of whole games to prove the rules hold together. This spec delivers the player model and the first AI (`random`), the one function that builds a seat's `PlayerView`, the AI loop that plays AI turns until a human must act or the game ends, a CLI simulator, and a simulation test suite that plays seeded all-AI games for every preset and player count, checking invariants, card conservation, determinism and replay after every move. It closes Milestone M1 (a complete, verified game core) and benefits the developers of Phases 5–9, who build storage, the service, the API and the UI on a core proven by simulation.

## What it does
- Players and strategies are plain objects (no classes in `src/players` except `Error` subclasses). A human player's `requestDecision` always returns `{ type: 'await' }`. An AI player returns `{ type: 'move', moveId: strategy.choose(ctx.view, ctx.legalMoves, ctx.rng).id }`.
- `randomStrategy` (`name 'random'`) returns `moves[rng.int(0, moves.length − 1)]`: one draw, and it never reads the view.
- `getStrategy(name)` maps `'random'`, `undefined` and `''` to `randomStrategy`, and throws `UnknownStrategyError` (message names the strategy) for any other name. `STRATEGY_NAMES` is `['random']`.
- `createPlayers(seats)` builds one player per seat, in seat order.
- `buildPlayerView(state, seat | 'spectator')` returns `{ ...tableViewFor(state, seat), scoreboard: evaluate(state) }`. It adds `finalRanking = scoreboard.ranking` only at `game-over`; otherwise the key is absent. It is the only builder of `PlayerView` in `src`.
- The view never exposes cards in another seat's hand (except the shown trump card), the seed, the rules or `aiDecisionCount`.
- `runAiLoop(state, players, options?)` repeats `currentActor` → `buildPlayerView` + `legalMoves` + `aiRng` → `requestDecision` → `applyMove`. It stops when the current actor is `null` or a player returns `'await'`, and returns `{ state, events, moves }`.
  - `onTransition(prev, transition)` runs after each move; anything it throws propagates.
  - If players and seats disagree (length, seat or kind), it throws `RangeError` before any move.
  - After `maxMoves` moves (default 1000), it throws `AiLoopLimitError` with `moves` and `state` when the actor is still an AI. An illegal strategy move propagates as `IllegalMoveError`.
  - An all-AI game finishes in one call for every preset and player count; the longest, argentina-fidepo with 3 players, takes 981 moves.
- `pnpm test:sim` plays 18 preset × player-count combinations × `S` seeds, using seeds `sim-<presetId>-<players>-<i>`.
  - `S` is 200 by default. A `SIM_SEEDS` value must be a positive decimal integer, or the suite fails at load.
  - The tests are one file per preset in `tests/sim/`.
  - After every move they check `checkInvariants`, the scoreboard's consistency and a card-conservation ledger. The ledger also checks that each played card was dealt to the seat that played it.
  - The first `min(S, 10)` seeds per combination also check determinism and replay. Replay rebuilds the game from the seed and its events, with no players, and must match the full state and the scoreboard after every step.
- `pnpm simulate [--preset] [--players] [--games] [--seed]` prints a 4-line summary: averages, made-bid rate and duration.
  - Invalid arguments print one stderr line and exit 1 with nothing on stdout.
  - A runtime error prints the seed of the failing game.
- CI runs `pnpm test:sim` after `pnpm test`. The docs are `docs/design.md` §8 and `docs/development.md` §12 "Players, views and simulation"; Known limitations is now §13.
- **Business rules.**
  - AIs see only the `DecisionContext`, and `src/players` never imports the engine, score or service (BR-401).
  - AI choices draw only from `aiRng`, so a strategy never changes a deal (BR-402).
  - Every AI move takes the same `legalMoves` → `requestDecision` → `applyMove` path as a human move (BR-403).
  - `player-view.ts` and `ai-loop.ts` are pure: no storage, state, config, I/O, time or ambient randomness (BR-404).

## Public interfaces / data

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

## Key decisions
- **Plain objects, not classes.** Players are cheap to rebuild from `state.seats` on every request and are never persisted. The `Error` subclasses exist so callers can use `instanceof`.
- **`AiLoopLimitError` at the cap instead of returning quietly.** Reaching the cap means a bug, so the service must not commit and should return a server error. The cap is checked only when an AI is about to act (D-005).
- **Missing strategy defaults to `random`; an unknown one throws.** Old or minimal seat configs still play, and typos fail loudly.
- **Events per commit.** `runAiLoop` never includes `createGame`'s events or the human move's events. The service concatenates them: the human transition's events (or `createGame`'s events at creation), then `result.events`.
- **The service validates the human move.** It applies the human's move with `applyMove` before the loop; that `IllegalMoveError` is a client error (4xx). `IllegalMoveError` or `RangeError` from inside the loop is a server bug.
- **Seeds come from the service** (`crypto.randomBytes(32)`, design §9). The core never generates a seed. Stored games replay from seed + `bid-made`/`card-played` events; `tests/sim/harness.ts` `replay` is the reference.
- **The long sweep is a local run.** The ≥ 2,000-seed run is done locally and recorded in each PR; there is no nightly workflow. Run `pnpm simulate` as `pnpm --silent simulate` when stdout must be clean (D-012).

## Known limits (still true at freeze)
- The CI step "Simulation tests" must finish in < 10 minutes. At freeze it took 1 m 51 s in CI and ~45 s locally. `SIM_SEEDS=2000` takes ~7 min locally (36,005 tests).
- The `random` AI is only a baseline: made-bid rate ≈ 11 % (argentina-fidepo 3p).
- `PlayerUpdate` assembly, versions and seat tokens are not built yet; they come in Phase 7.
- The ESLint layer rule allows `src/service` to import state, storage and config, but `player-view.ts` and `ai-loop.ts` must stay pure (BR-404 grep). `GameService` goes in its own files.
- `package.json` dependencies are unchanged (`@noble/hashes,next,react,react-dom,zod`, noble `2.4.0`).
- `docs/implementation.md` still names `RandomStrategy`; the shipped name is `randomStrategy`.

## Deliberately excluded
- `GameService`, persistence, seed generation, `final.json` and API/UI concerns.
- Any strategy except `random`, and per-seat strategy configuration in the API or UI.
- Changes to the engine, score engine or domain types.
