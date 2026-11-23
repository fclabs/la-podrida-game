# CONTEXT — Players, Player View, AI Loop and Simulation (Phase 4)

Last updated by: Iteration 1 (players). Next: Iteration 2 (player view and AI loop).

**Protocol note (orchestrator):** the plan's parallel group A (Iterations 3–4) has been downgraded to sequential. **All iterations use the full artifact protocol** (each one rewrites this file, appends to `DECISIONS.md` and writes its own record); the plan's "reduced protocol" sections for Iterations 3 and 4 do not apply.

## Current state

- Phases 0–3 are complete (`specs/00-project-scaffold-frozen.md`, `specs/01-domain-model-frozen.md`, `specs/02-engine-frozen.md`, `specs/03-score-engine-frozen.md`). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`), pnpm 10.15.1, Node 24 declared, Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, `@noble/hashes` 2.4.0, project-local layer-boundary lint rule, GitHub Actions CI (typecheck, lint, test, build; no `test:sim` step yet).
- `dependencies` = `@noble/hashes, next, react, react-dom, zod` (NFR-402); unchanged.
- **Iteration 1 shipped `src/players`**: `player.ts` (types `Player`, `AIStrategy`), `human-player.ts`, `ai-player.ts`, `strategies/random.ts`, `registry.ts`. `src/players/.gitkeep` is deleted.
- Not yet built: `src/service/player-view.ts`, `src/service/ai-loop.ts` (Iteration 2; `src/service/.gitkeep` still present), `tests/sim/**` (still `.gitkeep`) and the CI `test:sim` step (Iteration 3), `scripts/simulate.ts` (still the scaffold stub; Iteration 4), docs (Iteration 5).
- Tests: `tests/unit/players/` 3 files / 13 tests; full `pnpm test` 32 files / 582 tests green.

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
| `src/domain/types.ts` | `SeatInfo`, `PlayerView`, `TableView`, `LegalMove`, `Move`, `Rng`, `DecisionContext`, `Decision`, `Transition`, `GameState`, `GameEvent`, `ScoreBoard`. |
| `src/engine/engine.ts`, `view.ts`, `rng.ts`, `invariants.ts` | Engine API (`createGame`, `currentActor`, `legalMoves`, `applyMove`, `aiRng`, `tableViewFor`, `deriveRng`, `checkInvariants`). Never modify. |
| `src/score/score-engine.ts` | `evaluate(state): ScoreBoard`. Never modify. |
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

Details:
- `UnknownStrategyError` message: `Unknown AI strategy "<name>" (known: random)`.
- `createPlayers` maps `seats` in array order (a `GameState`'s seats are in seat order); `player.seat` = `info.seat`. It does not re-validate seat numbers; `runAiLoop` (Iteration 2) checks `players[i].seat === i` and kinds (FR-410). Unknown strategy → `UnknownStrategyError` from `getStrategy`.
- Players are plain object literals (prototype `Object.prototype`), not frozen.

## Conventions & invariants

- **Players purity** (BR-401, spec 00 layer rule): `src/players` imports only `@/src/domain/*` and its own folder (`./`, `../`). No classes except `Error` subclasses; no `Math.random`, `Date`, `crypto`, `process`, `performance`, I/O, `@/src/config`; no barrel `index.ts`. Greps (must print nothing; keep these words out of comments):
  - `grep -rn "class " src/players | grep -v "extends Error"`
  - `grep -rnE "src/(engine|score|service)|GameState" src/players`
  - `grep -rnE "src/(storage|state)|@/src/config|Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\." src/players`
- **Error convention**: `class XError extends Error { constructor(message) { super(message); this.name = 'XError'; } }` (same as `UnknownPresetError`, `InvalidCardError`).
- **Lookup tables** keyed by user-supplied names use `Map` or null-prototype objects so `'constructor'`, `'__proto__'` etc. are never found (D-001).
- **Service layer** (Iteration 2+): `src/service/player-view.ts` and `ai-loop.ts` import only `@/src/domain/*`, `@/src/engine/*`, `@/src/score/*`, `@/src/players/*` and `./*` (P-2: `ai-loop.ts` imports `./player-view`). `buildPlayerView` is the only caller of `evaluate(` in `src` outside `src/score/`.
- **Tests**: `tests/unit/players/*.test.ts`, `tests/unit/service/*.test.ts` (collected by `pnpm test`); `tests/sim/*.sim.test.ts` (only `pnpm test:sim`). Header comment names the FRs/VCs; one `describe` per VC. Tests may use `deriveRng` from `@/src/engine/rng`. Stub views: `{ … } as unknown as PlayerView`.
- **Formatting**: Prettier formats `src/`, `tests/`, `scripts/`, config files; `docs/` and `specs/` are in `.prettierignore`. Run `pnpm exec prettier --write <paths>` before linting.
- `docs/development.md` §1–§11 numbering is fixed until Iteration 5 (README links `#5-configuration`); Iteration 5 inserts "Players, views and simulation" as §12 and renumbers "Known limitations".
- **Commits**: one per iteration, staged by explicit path (never `git add -A`); message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge.

## Commands

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/players/` | Players tests only. |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Required before every commit (lint = ESLint 0 warnings + `prettier --check .`). |
| `pnpm test:sim` | `vitest.sim.config.ts`, `tests/sim` only (empty until Iteration 3; exits 0). |
| `pnpm simulate` | `tsx scripts/simulate.ts` (stub until Iteration 4). |
| `pnpm exec tsx <file.ts>` | Run a scratch TS script (resolves `@/`). |
| `pnpm build` | `next build` (CI runs it). |
| `node -e "const d=require('./package.json').dependencies;console.log(Object.keys(d).sort().join(','),d['@noble/hashes'])"` | NFR-402 check → `@noble/hashes,next,react,react-dom,zod 2.4.0`. |

pnpm prints an "Unsupported engine" WARN locally (Node 26 vs declared 24) and "Ignored build scripts: esbuild"; neither is fatal.

## Known gaps

- `createPlayers` trusts `seats` order and seat numbers; validation of players vs. state is `runAiLoop`'s job (FR-410, Iteration 2).
- `randomStrategy.choose` on an empty `moves` throws the engine Rng's `RangeError` (`int(0, -1): min must not exceed max`); the engine never offers an empty list to an actor, so there is no extra guard (FR-403 says "non-empty").
- No `src/service`, sim suite, CLI or CI `test:sim` step yet (Iterations 2–4); docs not updated (Iteration 5).
