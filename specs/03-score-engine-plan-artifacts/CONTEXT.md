# CONTEXT — Score Engine (Phase 3)

Last updated by: Iteration 2 (hand score and scoreboard). Next: Iteration 3 (docs: `docs/design.md` §6, `docs/development.md` §11 Score).

## Current state

- Phases 0–2 are complete (see `specs/00-project-scaffold-frozen.md`, `specs/01-domain-model-frozen.md`, `specs/02-engine-frozen.md`). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`), pnpm 10.15.1, Node 24 declared, Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, `@noble/hashes` 2.4.0, layer-boundary lint rule, GitHub Actions CI.
- `dependencies` = `@noble/hashes, next, react, react-dom, zod` (spec NFR-302); unchanged by Phase 3.
- `src/score/formulas.ts` is **done** (FR-300, FR-301): `handPoints`.
- `src/score/score-engine.ts` is **done**: `LiveStatus`, `liveStatus` (FR-304), `rankSeats` (FR-305, FR-306), `scoreHand` (FR-302, FR-303), `evaluate` (FR-307 to FR-310). The code side of Phase 3 is complete.
- `src/score/.gitkeep` is deleted.
- Tests: `tests/unit/score/formulas.test.ts` (VC-301–303), `live-status.test.ts` (VC-306), `ranking.test.ts` (VC-307), `score-hand.test.ts` (VC-304, VC-305, FR-310), `evaluate.test.ts` (helper sanity, VC-308–310), `full-game.test.ts` (VC-311, VC-312), `perf.test.ts` (NFR-303; measured median ≈ 15 µs). Full suite: 29 files / 569 tests green.
- Docs (`docs/design.md` §6, `docs/development.md` new §11 Score) are untouched until Iteration 3.

## File map

| Path | Contents |
|---|---|
| `src/score/formulas.ts` | `handPoints` + private `assertNonNegativeInt(name, value)`. |
| `src/score/score-engine.ts` | `LiveStatus`, `liveStatus`, `rankSeats`, `scoreHand`, `evaluate` + private `assertNonNegativeInt(fn, name, value)`, `isIntIn(value, min, max)`, `sum(values)`. Imports `handPoints` from `./formulas`. |
| `tests/unit/score/formulas.test.ts` | VC-301 rows (`ROWS`, shared `SPANISH_ROWS` for spain-ludoteka and mexico-bazas), VC-302 (custom specs, `-0` checks), VC-303. |
| `tests/unit/score/live-status.test.ts` | VC-306 status rows and `RangeError` rows. |
| `tests/unit/score/ranking.test.ts` | VC-307, five cases, full deep-equal arrays. |
| `tests/unit/score/helpers.ts` | Score test builders (not collected): `makeState(options)`, `result(handIndex, cardsPerPlayer, bids, tricks)`, `argentinaPlan(players)`. |
| `tests/unit/score/score-hand.test.ts` | VC-304 (exact deep-equal), VC-305 (7 rows; message starts `scoreHand: handIndex 7: `), FR-310 no-mutation. |
| `tests/unit/score/evaluate.test.ts` | `makeState` parses with `GameStateSchema`; VC-308, VC-309, VC-310 (7 rows; message starts with the full prefix). |
| `tests/unit/score/full-game.test.ts` | VC-311 (spain-ludoteka 4 seats, `lastMove`, every state), VC-312 (`PRESET_IDS` at `players.min`, `lastMove`). |
| `tests/unit/score/perf.test.ts` | NFR-303: final argentina-fidepo 3-player state (`firstMove`, 29 hands), 10 warm-up + 101 timed calls, median < 1 ms. |
| `src/domain/rules.ts` | `ScoringSpec`, `RuleSet` (`tieBreak: 'fewest-misses' \| 'shared'`), `PresetId` (types only). |
| `src/domain/types.ts` | `HandResult`, `HandScore`, `ScoreBoard` (`live?` optional), `GameState`, `HandState`. |
| `src/domain/presets.ts` | `getPreset(id): RuleSet`, `PRESET_IDS`. |
| `src/domain/schemas.ts` | `ScoringSpecSchema` (literal numbers: 10/1/1, 10, 10/5/5), `GameStateSchema`. |
| `tests/unit/engine/helpers.ts` | `newGame`, `playGame`, `firstMove`, `lastMove`, `makeSeats`, `makeHand`, … — import from score tests as `../engine/helpers`; **never modify**. |

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

- `handPoints`: made iff `tricks === bid`. `bonus-plus-tricks`: made `bonus + perTrick·t`, missed `missedPerTrick·t`; `bonus-plus-bid`: made `bonus + b`, missed `0`; `spanish`: made `bonus + perTrick·t`, missed `0 - missPenaltyPerTrick·|t − b|` (D-001). Exhaustive `switch` on `scoring.kind` with a `never` default.
- `liveStatus`: validates first (non-null `bid`, then `tricksWon`, then `tricksLeft`), then in order: `null` → `on-track`; `tricksWon > bid` → `busted`; `tricksWon + tricksLeft < bid` → `busted`; `tricksWon === bid` → `made-so-far`; else `on-track`.
- `rankSeats`: `RangeError` on unequal lengths; `place = 1 + #seats ahead` (ahead = higher total, or equal total and fewer misses under `fewest-misses`); sorted by `place`, then `seat`. O(N²). Returns fresh objects.
- `scoreHand`: checks in FR-303 order, first failure throws — equal lengths; non-empty; `cardsPerPlayer` integer ≥ 1; every bid integer in `0…cardsPerPlayer` (so `null` fails); every trick non-negative integer; `sum(tricks) === cardsPerPlayer`. Returns `{ handIndex, perSeat: [{ seat, bid, tricks, made, points }] }`, fresh objects.
- `evaluate`: (1) for each `completedHands[k]` in order: `bids.length === N`, `tricks.length === N`, then `scoreHand` in `try/catch` (a `RangeError` is rethrown with the `state.completedHands[k]: ` prefix; others rethrown as is); (2) fresh `totals` / `madeCount` / `missedCount` (length N, zeros when no hands); `ranking = rankSeats(totals, missedCount, rules.tieBreak)`; (3) if `state.hand !== null`, checks in order: `cardsPerPlayer` integer ≥ 1; `bids.length === N`; `tricksWon.length === N`; every `tricksWon` non-negative integer; `sum(tricksWon) ≤ cardsPerPlayer`; every non-null bid integer in `0…cardsPerPlayer`; then `live[s] = { seat, bid, tricksWon, status: liveStatus(bid, tricksWon, cardsPerPlayer − sum(tricksWon)) }`. At game over the `live` key is **never created** (`'live' in board === false`). Never mutates `state`, never `structuredClone`s it.

## Conventions & invariants

- **Score purity** (spec BR-304, plan rule 8): `src/score` imports only `@/src/domain/*` (spec-01 modules `rules`, `types`; `import type` is enough so far) and its own files. Never `src/engine`. No `Math.random`, `Date`, `crypto`, `process`, `performance`, I/O, no barrel `index.ts`. Purity grep (must find nothing; avoid these words even in comments):
  `grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.|src/engine|\.\./engine' src/score`
- **Error messages** (all `RangeError`):
  - `<functionName>: <argName> must be a non-negative integer, got <value>` (e.g. `handPoints: bid must be a non-negative integer, got -1`; `liveStatus: tricksWon …`). `rankSeats: totals and missedCount must have equal length, got A and B`.
  - `scoreHand: handIndex <n>: <check>`, e.g. `scoreHand: handIndex 7: tricks[2] must be a non-negative integer, got -1`, `… sum(tricks) must equal cardsPerPlayer 3, got 2`.
  - `evaluate` (D-003): `state.completedHands[<k>]: <check>` — wrapping a `scoreHand` failure gives `state.completedHands[1]: scoreHand: handIndex 1: sum(tricks) …`; and `state.hand: <check>`, e.g. `state.hand: tricksWon[1] must be a non-negative integer, got -1`. Tests assert on the full prefixes (`message.startsWith`), never on the bare word `hand`.
- **No `live` key at game over**: `evaluate` builds the board without `live` and adds it only when `hand !== null`. Do not "simplify" to `live: hand ? … : undefined` — that breaks `'live' in board === false` (FR-308).
- **Never `-0`**: write negative scores as `0 - x`, never unary minus (D-001).
- **Casting test `ScoringSpec`s**: the schema fields are literal types (`bonus: 10`, `perTrick: 5`, …), so a custom spec needs `as unknown as ScoringSpec` (a plain `as ScoringSpec` fails `tsc` with TS2352).
- **Tests**: `tests/unit/score/<topic>.test.ts`; header comment names the spec FRs/VCs; one `describe` per VC named `VC-NNN …`, `it.each` rows per spec input. Score-only builders live in `tests/unit/score/helpers.ts` (not collected):
  - `makeState({ players = 3, completedHands = [], handIndex = completedHands.length, hand, phase })` → schema-valid argentina-fidepo `GameState` (`handPlan = argentinaPlan(players)`, seats from `makeSeats`). `hand` is a partial override of a fresh bidding hand (`cardsPerPlayer = handPlan[handIndex]`, bids `null`, tricksWon `0`, empty `hands`, trump 2S), or `null` for game over (phase then defaults to `'game-over'`). Not engine-consistent (D-004).
  - `result(handIndex, cardsPerPlayer, bids, tricks)` → `HandResult` (dealer `handIndex mod N`, trump `'S'`).
  - `argentinaPlan(players)` → argentina-fidepo hand plan for 3–6 players (spec 02 table). Imports use `@/src/score/<module>` and `@/src/domain/<module>`; tests may import `@/src/engine/*` and `../engine/helpers`.
- Formatting: Prettier (single quotes, semicolons, trailing commas, width 100). Run `pnpm prettier --write src/score tests/unit/score` before committing. `docs/` and `specs/` are in `.prettierignore` (not formatted, despite plan rule 2's wording).
- `dependencies` must stay exactly `next, react, react-dom, zod, @noble/hashes`.
- Commits: staged by explicit path, never `git add -A`; message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge.

## Commands

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/score/` | Run the score tests only (single file: append the file name). |
| `pnpm vitest run tests/unit/score/perf.test.ts --silent=false` | Show the NFR-303 median log line (passing tests' console output is otherwise not shown). |
| `pnpm typecheck` | `next typegen && tsc --noEmit` (whole project incl. tests). |
| `pnpm lint` | ESLint `--max-warnings 0` + `prettier --check .`. |
| `pnpm format` / `pnpm prettier --write <paths>` | Format everything / given paths. |
| `pnpm test` | `vitest run` over `tests/{unit,contract,api}/**/*.test.ts`. |
| `pnpm test:sim` | Sim tests (none yet; exits 0). |
| `pnpm build` | Next.js production build. |
| `pnpm exec tsx <file.ts>` | Run a scratch TS script (resolves `@/`); keep scratch files out of the repo. |
| `node -e "const d=require('./package.json').dependencies;console.log(Object.keys(d).sort().join(','),d['@noble/hashes'])"` | NFR-302 check. |

pnpm prints an "Unsupported engine" WARN locally (Node 26 vs declared 24) and "Ignored build scripts: esbuild"; neither is fatal.

## Engine hand-off (from Phase 2)

- `GameState.completedHands: HandResult[]`, each `{ handIndex, cardsPerPlayer, dealer, trumpSuit, bids: number[], tricks: number[] }` with `sum(tricks) === cardsPerPlayer`, every bid set; one per finished hand, in order (`handPlan.length` at game over).
- `state.hand` (`HandState`): `bids` may hold `null` during bidding; `tricksWon`, `cardsPerPlayer`; completed tricks = `sum(tricksWon)`. `hand` is `null` at game over.
- Test game driver: `playGame(newGame(preset, players, seed), policy)` returns the visited states and `final`; `firstMove` makes every bid `0`, `lastMove` gives non-trivial bids. Timing pattern in `tests/unit/engine/perf.test.ts`.

## Known gaps

- `ScoreBoard.live[].status` in `types.ts` is an inline union equal to `LiveStatus` (not imported from score; domain stays independent).
- `evaluate` does not cross-check state consistency beyond FR-309 (e.g. `completedHands[k].handIndex === k`, `handIndex` vs. `handPlan`, `phase` vs. `hand`); engine states satisfy these by invariants.
- When both a completed hand and the current hand are malformed, the completed-hand error wins (D-005).
- `handPoints` trusts the `ScoringSpec` numbers (no validation of the spec object itself; callers hold schema-valid rule sets).
- `rankSeats` does not validate that totals or misses are integers (spec requires only the length check).
- Docs (`docs/design.md` §6, `docs/development.md` §11 Score, §12 Known limitations renumber) are Iteration 3.
