# CONTEXT — Players, Player View, AI Loop and Simulation (Phase 4)

Last updated by: Iteration 3 (simulation suite and CI step). Next: Iteration 4 (simulator CLI, `scripts/simulate.ts`).

**Protocol note (orchestrator):** the plan's parallel group A (Iterations 3–4) has been downgraded to sequential. **All iterations use the full artifact protocol** (each one rewrites this file, appends to `DECISIONS.md` and writes its own record); the plan's "reduced protocol" sections for Iterations 3 and 4 do not apply.

## Current state

- Phases 0–3 are complete (`specs/00-project-scaffold-frozen.md`, `specs/01-domain-model-frozen.md`, `specs/02-engine-frozen.md`, `specs/03-score-engine-frozen.md`). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`), pnpm 10.15.1, Node 24 declared, Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, `@noble/hashes` 2.4.0, project-local layer-boundary lint rule, GitHub Actions CI (install, typecheck, lint, test, **Simulation tests (`pnpm test:sim`)**, build).
- `dependencies` = `@noble/hashes, next, react, react-dom, zod` (NFR-402); unchanged.
- **Iteration 1 shipped `src/players`**: `player.ts` (types `Player`, `AIStrategy`), `human-player.ts`, `ai-player.ts`, `strategies/random.ts`, `registry.ts`. `src/players/.gitkeep` is deleted.
- **Iteration 2 shipped `src/service`**: `player-view.ts` (`buildPlayerView`), `ai-loop.ts` (`runAiLoop`, `AiLoopLimitError`, `AiLoopOptions`, `AiLoopResult`). `src/service/.gitkeep` is deleted.
- **Iteration 3 shipped `tests/sim`**: `harness.ts`, `ledger.ts`, `ledger.sim.test.ts` and one `<presetId>.sim.test.ts` per preset; `tests/sim/.gitkeep` is deleted; `.github/workflows/ci.yml` runs `pnpm test:sim` (step "Simulation tests") right after "Test".
- Not yet built: `scripts/simulate.ts` (still the scaffold stub; Iteration 4), docs (Iteration 5).
- Tests: `tests/unit/players/` 3 files / 13 tests; `tests/unit/service/` 2 files / 24 tests; full `pnpm test` 34 files / 606 tests green. `pnpm test:sim` 5 files / 3,605 tests (18 combinations × 200 seeds + 5 ledger tests) green.
- **Measured sim time**: default `pnpm test:sim` (S = 200) **45.9 s wall** (`/usr/bin/time -p`: real 45.94, user 172.09 s) on the dev machine; vitest "Duration 45.52s". `SIM_SEEDS=3` ≈ 2 s. The argentina-fidepo file dominates (3p games ≈ 60 ms of play + checks).
- **Measured speed**: one argentina-fidepo 3-player all-AI game (981 moves) through `runAiLoop(createGame(P-4 input).state, createPlayers(seats))` takes **~58–60 ms** warm (74 ms first run) on the dev machine (`pnpm exec tsx`, 6 seeds `sim-argentina-fidepo-3-<k>`); ~0.06 ms per move including `buildPlayerView` + `evaluate`. Other presets/counts take 7–40 ms per game in vitest.

## File map

| Path | Contents |
|---|---|
| `src/players/player.ts` | Types only: `Player`, `AIStrategy` (FR-400). |
| `src/players/human-player.ts` | `createHumanPlayer` (FR-401). |
| `src/players/ai-player.ts` | `createAiPlayer` (FR-402). |
| `src/players/strategies/random.ts` | `randomStrategy` (FR-403). |
| `src/players/registry.ts` | `STRATEGY_NAMES`, `UnknownStrategyError`, `getStrategy`, `createPlayers` (FR-404, FR-405); private `STRATEGIES: ReadonlyMap<string, AIStrategy>`. |
| `tests/unit/players/players.test.ts` | VC-401 (+ plain-object prototype check). |
| `tests/unit/players/random.test.ts` | VC-402 (20-seed formula, 6,000-call uniformity on one Rng, throwing `Proxy` view). |
| `tests/unit/players/registry.test.ts` | VC-403 (+ inherited names like `'constructor'` throw). |
| `src/service/player-view.ts` | `buildPlayerView` (FR-406, FR-407). Only caller of `evaluate(` in `src` outside `src/score/`. |
| `src/service/ai-loop.ts` | `runAiLoop`, `AiLoopLimitError`, types `AiLoopOptions`, `AiLoopResult` (FR-408 to FR-411); private `assertPlayersMatch` (FR-410). |
| `tests/unit/service/player-view.test.ts` | VC-404, VC-405 (P-3 game; local `collectCards`/`collectKeys`/`leakedCards` walk, copied from `tests/unit/engine/view.test.ts`). |
| `tests/unit/service/ai-loop.test.ts` | VC-406 to VC-410 (helpers `seatsFor` = P-4 seats, `startGame`, `countingStrategy`, `countingPlayers`, `appliedMoveId`). |
| `src/domain/types.ts` | `SeatInfo`, `PlayerView`, `TableView`, `LegalMove`, `Move`, `Rng`, `DecisionContext`, `Decision`, `Transition`, `GameState`, `GameEvent`, `ScoreBoard`. |
| `src/engine/engine.ts`, `view.ts`, `rng.ts`, `invariants.ts` | Engine API (`createGame`, `currentActor`, `legalMoves`, `applyMove`, `aiRng`, `tableViewFor`, `deriveRng`, `checkInvariants`). Never modify. |
| `src/score/score-engine.ts` | `evaluate(state): ScoreBoard`. Never modify. |
| `tests/sim/harness.ts` | Sim helpers (FR-413 to FR-417): `SIM_SEEDS`, `simSeeds`, `simSeed`, `simSeats`, `simInput`, `playSimGame`, `scoreboardProblems`, `replay`, `moveIdOf`, `expectDeepEqual`, `checkDeterminismAndReplay`, `defineSimTests`. Imports `vitest`. |
| `tests/sim/ledger.ts` | Card-conservation ledger (FR-415): `createLedger`, `Ledger`, `LedgerError`. No vitest import. |
| `tests/sim/ledger.sim.test.ts` | VC-412: unaltered game passes; corrupted `card-played` (other seat's card; never-dealt stock trump) and duplicated card in a `hand-dealt` state (hand 2) and in the hand-0 deal → `LedgerError` naming the hand. |
| `tests/sim/<presetId>.sim.test.ts` ×4 | `argentina-fidepo`, `spain-ludoteka`, `gamerules`, `mexico-bazas`: each is just `defineSimTests('<presetId>')` (VC-411). |
| `.github/workflows/ci.yml` | CI: checkout, pnpm, node, install, typecheck, lint, test, **Simulation tests** (`pnpm test:sim`), build. |
| `tests/unit/engine/helpers.ts` | `newGame`, `makeSeats`, `playGame`, `firstMove`, … — import only, **never modify**. |

## Public interfaces

```ts
// src/players/player.ts  (types only)
export interface Player {
  seat: number;
  name: string;
  kind: 'human' | 'ai';
  requestDecision(ctx: DecisionContext): Decision;
}
export interface AIStrategy {
  name: string;
  choose(view: PlayerView, moves: LegalMove[], rng: Rng): LegalMove;
}

// src/players/human-player.ts
export function createHumanPlayer(seat: number, name: string): Player; // requestDecision → { type: 'await' }

// src/players/ai-player.ts
export function createAiPlayer(seat: number, name: string, strategy: AIStrategy): Player;
// requestDecision(ctx) → { type: 'move', moveId: strategy.choose(ctx.view, ctx.legalMoves, ctx.rng).id }

// src/players/strategies/random.ts
export const randomStrategy: AIStrategy; // name 'random'; choose → moves[rng.int(0, moves.length - 1)]; never reads view

// src/players/registry.ts
export const STRATEGY_NAMES: readonly string[];          // frozen ['random']
export class UnknownStrategyError extends Error {}         // name 'UnknownStrategyError'; message contains the name
export function getStrategy(name: string | undefined): AIStrategy; // undefined | '' → randomStrategy
export function createPlayers(seats: readonly SeatInfo[]): Player[]; // one per seat, array order
```

```ts
// src/service/player-view.ts
export function buildPlayerView(state: GameState, seat: number | 'spectator'): PlayerView;
// = { ...tableViewFor(state, seat), scoreboard: evaluate(state) } plus finalRanking = scoreboard.ranking
//   only when phase === 'game-over' (otherwise the key is absent). RangeError for a bad seat (tableViewFor).

// src/service/ai-loop.ts
export interface AiLoopOptions {
  maxMoves?: number;                                                // default 1000
  onTransition?: (prev: GameState, transition: Transition) => void;
}
export interface AiLoopResult { state: GameState; events: GameEvent[]; moves: number }
export class AiLoopLimitError extends Error { readonly moves: number; readonly state: GameState } // name 'AiLoopLimitError'
export function runAiLoop(state: GameState, players: readonly Player[], options?: AiLoopOptions): AiLoopResult;
```

`runAiLoop` behaviour:
1. Validates first (FR-410): `players.length === state.seats.length` (`RangeError` "players length X does not match the game's Y seats"), then per index `i`: `players[i].seat === i`, `players[i].kind === state.seats[i].kind` (`RangeError` starting `seat <i>:`). No move or decision happens before this.
2. Loop: `seat = currentActor(state)`; `null` → return. If `moves >= maxMoves` and `state.seats[seat].kind === 'ai'` → throw `AiLoopLimitError(moves, state)` (a human at the cap is still asked; D-005). Otherwise `players[seat].requestDecision({ view: buildPlayerView(state, seat), legalMoves: legalMoves(state, seat), rng: aiRng(state, seat) })`; `await` → return; else `transition = applyMove(state, seat, moveId)`, `moves += 1`, `events.push(...transition.events)` (engine order: `bid-made|card-played`, `trick-won`, `hand-completed`, `hand-dealt|game-over`), `onTransition?.(prev, transition)`, `state = transition.state`.
3. `result.events` excludes `createGame`'s own events (`game-started`, initial `hand-dealt`); only applied moves' events. `result.moves` = number of `bid-made` + `card-played` events.
4. `IllegalMoveError` (from `@/src/engine/engine`) propagates unchanged; so does anything `onTransition` throws (the move it was called for is already applied and counted).
5. `prev` passed to `onTransition` is the loop's own state object (the input `state` for the first move), not a copy; the engine never mutates states, so it is safe to keep.

**All-AI game recipe (P-4)**: `seats[i] = { seat: i, playerId: 'ai-<i>', name: 'AI <i>', kind: 'ai' }` (no `strategy` → `random`); `const start = createGame({ gameId: 'sim', rules: getPreset(presetId), seats, seed })`; `runAiLoop(start.state, createPlayers(seats), { onTransition })`. Full event log = `[...start.events, ...result.events]`. argentina-fidepo 3 players with any seed = 981 moves.

### Simulation harness (`tests/sim/harness.ts`, `tests/sim/ledger.ts`)

```ts
export const DEFAULT_SIM_SEEDS = 200;
export const DEEP_CHECK_SEEDS = 10;
export function simSeeds(raw: string | undefined): number;   // '' | undefined → 200; /^[1-9][0-9]*$/ → Number; else Error naming "<raw>"
export const SIM_SEEDS: number;                               // simSeeds(process.env.SIM_SEEDS), evaluated at module load
export function simSeed(presetId: PresetId, players: number, i: number): string; // `sim-<presetId>-<players>-<i>`
export function simSeats(players: number): SeatInfo[];        // P-4 seats
export function simInput(presetId: PresetId, players: number, seed: string): CreateGameInput; // P-4 input, gameId 'sim'
export interface SimStep { prev: GameState; transition: Transition }
export interface SimGame { input: CreateGameInput; initial: GameState; steps: SimStep[]; final: GameState; events: GameEvent[] } // events include createGame's
export function scoreboardProblems(state: GameState): string[]; // evaluate + BR-302 + `'live' in board === (hand !== null)`
export function playSimGame(presetId: PresetId, players: number, seed: string, opts: { check: boolean }): SimGame;
export type MoveEvent = Extract<GameEvent, { type: 'bid-made' | 'card-played' }>;
export function moveIdOf(event: MoveEvent): string;           // 'bid:<tricks>' | 'play:<cardId>'
export function replay(input: CreateGameInput, events: readonly GameEvent[]): { initial: GameState; states: GameState[] };
export function expectDeepEqual(actual: unknown, expected: unknown, label: string): void; // P-6
export function checkDeterminismAndReplay(game: SimGame, presetId: PresetId): void;      // FR-416 + FR-417
export function defineSimTests(presetId: PresetId): void;     // registers `it('<presetId> <n>p seed <i>')` per player count × seed

// ledger.ts
export class LedgerError extends Error {}                     // message `ledger: hand <k>: <problem>`
export interface Ledger { openHand(state: GameState): void; onTransition(t: Transition): void; check(state: GameState): void }
export function createLedger(): Ledger;
```

- `playSimGame(..., { check: true })` opens hand 0 from `createGame`'s state, then in `onTransition` runs `checkInvariants` (must be `[]`), `scoreboardProblems` (must be `[]`) and `ledger.onTransition`; any failure throws `Error('move <k>: …')` out of `runAiLoop` (D-007). Every step (`prev`, `transition`) is kept for replay.
- Each sim test: play with checks, expect `phase 'game-over'` and last event `game-over`; for `i < min(S, 10)` also a second unchecked run whose full event log must deep-equal (FR-416), and a replay whose initial state, every state and every `evaluate` deep-equal the original (FR-417).
- Ledger (FR-415, D-008): `openHand` checks the deal (distinct, `N × cardsPerPlayer`, in `buildDeck`, trump in deck and dealt iff `trumpCardInDealerHand`) and records card → seat; events in order: `card-played` (dealt, dealt to that seat, not yet played), `hand-completed` (same hand index; every dealt card played), `hand-dealt` (no hand open; opens from `transition.state`), `game-over` (no hand open; stop checking). After a transition with no `hand-dealt` and a non-null hand: `check` = held ∪ played equals the dealt set, nothing twice.

Details:
- `UnknownStrategyError` message: `Unknown AI strategy "<name>" (known: random)`.
- `createPlayers` maps `seats` in array order (a `GameState`'s seats are in seat order); `player.seat` = `info.seat`. It does not re-validate seat numbers; `runAiLoop` checks `players[i].seat === i` and kinds (FR-410). Unknown strategy → `UnknownStrategyError` from `getStrategy`.
- Players are plain object literals (prototype `Object.prototype`), not frozen.

## Conventions & invariants

- **Players purity** (BR-401, spec 00 layer rule): `src/players` imports only `@/src/domain/*` and its own folder (`./`, `../`). No classes except `Error` subclasses; no `Math.random`, `Date`, `crypto`, `process`, `performance`, I/O, `@/src/config`; no barrel `index.ts`. Greps (must print nothing; keep these words out of comments):
  - `grep -rn "class " src/players | grep -v "extends Error"`
  - `grep -rnE "src/(engine|score|service)|GameState" src/players`
  - `grep -rnE "src/(storage|state)|@/src/config|Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\." src/players`
- **Error convention**: `class XError extends Error { constructor(message) { super(message); this.name = 'XError'; } }` (same as `UnknownPresetError`, `InvalidCardError`).
- **Lookup tables** keyed by user-supplied names use `Map` or null-prototype objects so `'constructor'`, `'__proto__'` etc. are never found (D-001).
- **Service layer purity** (BR-404): `src/service/player-view.ts` and `ai-loop.ts` import only `@/src/domain/*`, `@/src/engine/*`, `@/src/score/*`, `@/src/players/*` and `./*` (D-003: `ai-loop.ts` imports `./player-view`). The ESLint layer rule would also allow `state`/`storage`/`config` in `src/service`; BR-404 forbids them for these two files, enforced only by the grep. Greps (must print nothing except the first):
  - `grep -rln "evaluate(" src | grep -v "^src/score/"` → only `src/service/player-view.ts`
  - `grep -rnE "src/(storage|state)|@/src/config|Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\." src/service/player-view.ts src/service/ai-loop.ts src/players`
- Import players and service modules directly (`@/src/players/registry`, `@/src/service/ai-loop`, …); no barrel `index.ts`.
- **Tests**: `tests/unit/players/*.test.ts`, `tests/unit/service/*.test.ts` (collected by `pnpm test`); `tests/sim/*.sim.test.ts` (only `pnpm test:sim`; `tests/sim/*.ts` helpers without `.test.ts` are not collected). Sim test names are exactly `<presetId> <players>p seed <i>` (no `describe` wrapper); every sim file imports the harness, so an invalid `SIM_SEEDS` fails all of them at load (D-009). Header comment names the FRs/VCs; one `describe` per VC. Tests may use `deriveRng` from `@/src/engine/rng`. Stub views: `{ … } as unknown as PlayerView`. Stub strategies are wrapped with `createAiPlayer` and count their `choose` calls. Heavy deep-equality loops report via `if (bad) expect(detail).toBeNull()` to stay fast.
- **Formatting**: Prettier formats `src/`, `tests/`, `scripts/`, config files; `docs/` and `specs/` are in `.prettierignore`. Run `pnpm exec prettier --write <paths>` before linting.
- `docs/development.md` §1–§11 numbering is fixed until Iteration 5 (README links `#5-configuration`); Iteration 5 inserts "Players, views and simulation" as §12 and renumbers "Known limitations".
- **Commits**: one per iteration, staged by explicit path (never `git add -A`); message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge.

## Commands

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/players/` | Players tests only. |
| `pnpm vitest run tests/unit/service/` | Service helper tests only (~0.6 s). |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Required before every commit (lint = ESLint 0 warnings + `prettier --check .`). |
| `pnpm test:sim` | `vitest.sim.config.ts`, `tests/sim` only: 18 combinations × 200 seeds + ledger tests (~46 s locally). CI step "Simulation tests". |
| `SIM_SEEDS=<n> pnpm test:sim` | `n` seeds per combination (positive decimal integer; `2k`, `0` → load error naming the value). `SIM_SEEDS=2000` is the NFR-404 long run (orchestrator, before the PR). |
| `pnpm vitest run --config vitest.sim.config.ts tests/sim/ledger.sim.test.ts` | Ledger tests only (VC-412). |
| `SIM_SEEDS=3 pnpm exec vitest run --config vitest.sim.config.ts --reporter verbose tests/sim/<presetId>.sim.test.ts` | One preset, test names visible. |
| `pnpm simulate` | `tsx scripts/simulate.ts` (stub until Iteration 4). |
| `pnpm exec tsx <file.ts>` | Run a scratch TS script (resolves `@/`). |
| `pnpm build` | `next build` (CI runs it). |
| `node -e "const d=require('./package.json').dependencies;console.log(Object.keys(d).sort().join(','),d['@noble/hashes'])"` | NFR-402 check → `@noble/hashes,next,react,react-dom,zod 2.4.0`. |

pnpm prints an "Unsupported engine" WARN locally (Node 26 vs declared 24) and "Ignored build scripts: esbuild"; neither is fatal.

## Known gaps

- `createPlayers` trusts `seats` order and seat numbers; validation of players vs. state is `runAiLoop`'s job (FR-410, implemented).
- `runAiLoop` does not validate `maxMoves` (a negative/NaN value just means "throw at the first AI decision" / "never cap"); callers pass the default or a positive integer.
- `randomStrategy.choose` on an empty `moves` throws the engine Rng's `RangeError` (`int(0, -1): min must not exceed max`); the engine never offers an empty list to an actor, so there is no extra guard (FR-403 says "non-empty").
- No CLI yet (Iteration 4); docs not updated (Iteration 5).
- VC-411 / VC-416 CI parts (the branch CI run and its "Simulation tests" duration < 10 min) and VC-413's `SIM_SEEDS=2000` run are pending: the orchestrator does them before/at the PR.
- The sim keeps every step's state of a game in memory (≈ 1,000 states for argentina 3p) for replay; fine at current sizes.
