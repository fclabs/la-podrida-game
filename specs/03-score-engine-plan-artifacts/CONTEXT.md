# CONTEXT — Score Engine (Phase 3)

Last updated by: Iteration 3 (docs). **Phase 3 is complete**; next is `verify-spec` (orchestrator), then the CI part of VC-314 after a user-approved push.

## Current state

- Phases 0–3 are complete (see `specs/00-project-scaffold-frozen.md`, `specs/01-domain-model-frozen.md`, `specs/02-engine-frozen.md`; Phase 3 = this directory). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`), pnpm 10.15.1, Node 24 declared, Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, `@noble/hashes` 2.4.0, layer-boundary lint rule, GitHub Actions CI.
- `dependencies` = `@noble/hashes, next, react, react-dom, zod` (NFR-302); unchanged by Phase 3.
- `src/score/formulas.ts` (`handPoints`) and `src/score/score-engine.ts` (`LiveStatus`, `liveStatus`, `rankSeats`, `scoreHand`, `evaluate`) are shipped. `src/score/.gitkeep` is deleted. `src/players`, `src/state`, `src/storage`, `src/service` are still empty (`.gitkeep`).
- Tests: 7 score test files / 88 tests in `tests/unit/score/`; full suite 29 files / 569 tests green. NFR-303 median ≈ 15 µs (bound 1 ms).
- Docs: `docs/design.md` §6 describes the shipped score rules (interface incl. `rankSeats`/`liveStatus`, score sheet, live-status table, ranking with competition places `1, 1, 3`, `RangeError` on malformed input, general formulas). `docs/development.md` has `## 11. Score` (11.1 module map … 11.7 gotchas) and `## 12. Known limitations` (renumbered from §11).

## File map

| Path | Contents |
|---|---|
| `src/score/formulas.ts` | `handPoints` + private `assertNonNegativeInt(name, value)`. |
| `src/score/score-engine.ts` | `LiveStatus`, `liveStatus`, `rankSeats`, `scoreHand`, `evaluate` + private `assertNonNegativeInt(fn, name, value)`, `isIntIn`, `sum`. Imports `handPoints` from `./formulas`. |
| `tests/unit/score/formulas.test.ts` | VC-301–303. |
| `tests/unit/score/live-status.test.ts` | VC-306. |
| `tests/unit/score/ranking.test.ts` | VC-307. |
| `tests/unit/score/score-hand.test.ts` | VC-304, VC-305, `scoreHand` no-mutation. |
| `tests/unit/score/evaluate.test.ts` | `makeState` schema check; VC-308–310. |
| `tests/unit/score/full-game.test.ts` | VC-311, VC-312. |
| `tests/unit/score/perf.test.ts` | NFR-303. |
| `tests/unit/score/helpers.ts` | `makeState(options)`, `result(...)`, `argentinaPlan(players)` (not collected). |
| `docs/design.md` §6 | Score rules (what). |
| `docs/development.md` §11 | Score developer guide (how); §12 Known limitations. |
| `src/domain/rules.ts`, `types.ts`, `presets.ts`, `schemas.ts` | `ScoringSpec`, `RuleSet`, `HandResult`, `HandScore`, `ScoreBoard`, `GameState`, `getPreset`, `PRESET_IDS`, `GameStateSchema`. |
| `tests/unit/engine/helpers.ts` | `newGame`, `playGame`, `firstMove`, `lastMove`, … — **never modify**. |

## Public interfaces

```ts
// src/score/formulas.ts
export function handPoints(scoring: ScoringSpec, bid: number, tricks: number): number;

// src/score/score-engine.ts
export type LiveStatus = 'on-track' | 'made-so-far' | 'busted';
export function liveStatus(bid: number | null, tricksWon: number, tricksLeft: number): LiveStatus;
export function rankSeats(
  totals: readonly number[],
  missedCount: readonly number[],
  tieBreak: RuleSet['tieBreak'],
): ScoreBoard['ranking']; // { seat, total, place }[]
export function scoreHand(rules: RuleSet, result: HandResult): HandScore;
export function evaluate(state: GameState): ScoreBoard;
```

Behaviour (full text in `docs/development.md` §11.3–11.5):
- `handPoints`: made iff `t === b`; `bonus-plus-tricks` made `bonus + perTrick·t` / missed `missedPerTrick·t`; `bonus-plus-bid` made `bonus + b` / missed `0`; `spanish` made `bonus + perTrick·t` / missed `0 - missPenaltyPerTrick·|t − b|` (D-001).
- `liveStatus`: validate args first; `null` → on-track; `tricksWon > bid` → busted; `tricksWon + tricksLeft < bid` → busted; `===` → made-so-far; else on-track.
- `rankSeats`: `place = 1 + #ahead` (competition `1, 1, 3`); sorted by place then seat; length mismatch → `RangeError`.
- `scoreHand`: FR-303 checks in order, first failure throws `scoreHand: handIndex N: <check>`.
- `evaluate`: completed hands (seat-count checks, then `scoreHand` rethrown with `state.completedHands[k]: `), then totals/counts/ranking, then current-hand checks (`state.hand: `) and `live`; no `live` key at game over; never mutates the state.

## Conventions & invariants

- **Score purity** (BR-304): `src/score` imports only `@/src/domain/*` and its own files. Purity grep (must find nothing; keep these words out of comments):
  `grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.|src/engine|\.\./engine' src/score`
- **Error prefixes** (all `RangeError`): `<fn>: <arg> must be a non-negative integer, got <v>`; `rankSeats: totals and missedCount must have equal length, got A and B`; `scoreHand: handIndex N: <check>`; `state.completedHands[k]: <check>` / `state.hand: <check>` (D-003). Completed hands are checked before the current hand (D-005). Tests assert full prefixes.
- **No `live` key at game over**; never `live: undefined`.
- **Never `-0`**: negative scores as `0 - x` (D-001).
- **Test casts**: custom `ScoringSpec` → `as unknown as ScoringSpec` (D-002); `null` bid in `HandResult` → `null as unknown as number`.
- **`makeState` states** have empty hands; shape-valid, not engine-consistent (D-004).
- Tests: `tests/unit/score/<topic>.test.ts`, header comment names FRs/VCs, one `describe` per VC.
- Formatting: Prettier for `src/`, `tests/`; `docs/` and `specs/` are in `.prettierignore`.
- `docs/development.md` §1–§10 numbering is fixed (README links `#5-configuration`).
- Commits: staged by explicit path; message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge.

## Commands

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/score/` | Score tests only. |
| `pnpm vitest run tests/unit/score/perf.test.ts --silent=false` | Shows the NFR-303 median line. |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm test:sim` / `pnpm build` | Full toolchain (lint = ESLint 0 warnings + `prettier --check .`). |
| `pnpm exec tsx <file.ts>` | Run a scratch TS script (resolves `@/`). |
| `node -e "const d=require('./package.json').dependencies;console.log(Object.keys(d).sort().join(','),d['@noble/hashes'])"` | NFR-302 check → `@noble/hashes,next,react,react-dom,zod 2.4.0`. |

pnpm prints an "Unsupported engine" WARN locally (Node 26 vs declared 24) and "Ignored build scripts: esbuild"; neither is fatal.

## Hand-off to Phase 4+

- **Call `evaluate(state)` wherever a score is needed** — every `PlayerView` (HTTP responses) and every AI decision. It is pure and fast (≈ 15 µs for a 29-hand game), so recompute; never cache it in `GameState`.
- **`PlayerView`** (`src/service/player-view.ts`, Phase 4): `{ ...tableViewFor(state, seat), scoreboard: evaluate(state), finalRanking }`, with `finalRanking = scoreboard.ranking` only when `phase === 'game-over'`. `tableViewFor` returns fresh copies and the board is freshly built, so no cloning is needed.
- **Simulator / `tests/sim`**: after every move, `evaluate` must not throw; assert BR-302 (`totals[s] = Σ hands[k].perSeat[s].points`, `madeCount[s] + missedCount[s] = hands.length`), `'live' in board === (state.hand !== null)`, and on replay compare scoreboards step by step. Print average scores / made-bid rate from `totals` and `madeCount`.
- **Persistence (Phases 6–7)**: each commit stores `evaluate(state)` as `scoreboard`; `final.json` = the terminal board (best-effort).
- **AI strategies** may read `view.scoreboard.live` (status per seat) and `totals`; `liveStatus` is exported for "what if" reasoning.
- `src/score` must stay free of engine imports; the service is the only place combining them.

## Known gaps

- `ScoreBoard.live[].status` in `types.ts` is an inline union equal to `LiveStatus` (domain cannot import score); change both together.
- `evaluate` does not cross-check `completedHands[k].handIndex === k`, `handIndex` vs. `handPlan`, `phase` vs. `hand`; engine invariants guarantee these.
- `handPoints` trusts the `ScoringSpec` numbers; `rankSeats` checks lengths only, not integer values.
- When both a completed hand and the current hand are malformed, the completed-hand error wins (D-005).
- CI part of VC-314 not yet observed (needs a push).
