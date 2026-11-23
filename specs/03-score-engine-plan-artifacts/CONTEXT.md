# CONTEXT — Score Engine (Phase 3)

Last updated by: Iteration 1 (formulas, live status and ranking). Next: Iteration 2 (`scoreHand`, `evaluate`).

## Current state

- Phases 0–2 are complete (see `specs/00-project-scaffold-frozen.md`, `specs/01-domain-model-frozen.md`, `specs/02-engine-frozen.md`). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`), pnpm 10.15.1, Node 24 declared, Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, `@noble/hashes` 2.4.0, layer-boundary lint rule, GitHub Actions CI.
- `dependencies` = `@noble/hashes, next, react, react-dom, zod` (spec NFR-302); unchanged by Phase 3.
- `src/score/formulas.ts` is **done** (FR-300, FR-301): `handPoints`.
- `src/score/score-engine.ts` is **partial**: `LiveStatus`, `liveStatus` (FR-304) and `rankSeats` (FR-305, FR-306) are done. `scoreHand` (FR-302, FR-303) and `evaluate` (FR-307 to FR-310) are added in Iteration 2.
- `src/score/.gitkeep` is deleted.
- Tests: `tests/unit/score/formulas.test.ts` (VC-301, VC-302, VC-303), `live-status.test.ts` (VC-306), `ranking.test.ts` (VC-307). Full suite: 25 files / 539 tests green.
- Docs (`docs/design.md` §6, `docs/development.md` new §11 Score) are untouched until Iteration 3.

## File map

| Path | Contents |
|---|---|
| `src/score/formulas.ts` | `handPoints` + private `assertNonNegativeInt(name, value)`. |
| `src/score/score-engine.ts` | `LiveStatus`, `liveStatus`, `rankSeats` + private `assertNonNegativeInt(fn, name, value)`. Iteration 2 adds `scoreHand`, `evaluate` here. |
| `tests/unit/score/formulas.test.ts` | VC-301 rows (`ROWS`, shared `SPANISH_ROWS` for spain-ludoteka and mexico-bazas), VC-302 (custom specs, `-0` checks), VC-303. |
| `tests/unit/score/live-status.test.ts` | VC-306 status rows and `RangeError` rows. |
| `tests/unit/score/ranking.test.ts` | VC-307, five cases, full deep-equal arrays. |
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
```

- `handPoints`: made iff `tricks === bid`. `bonus-plus-tricks`: made `bonus + perTrick·t`, missed `missedPerTrick·t`; `bonus-plus-bid`: made `bonus + b`, missed `0`; `spanish`: made `bonus + perTrick·t`, missed `0 - missPenaltyPerTrick·|t − b|` (D-001). Exhaustive `switch` on `scoring.kind` with a `never` default.
- `liveStatus`: validates first (non-null `bid`, then `tricksWon`, then `tricksLeft`), then in order: `null` → `on-track`; `tricksWon > bid` → `busted`; `tricksWon + tricksLeft < bid` → `busted`; `tricksWon === bid` → `made-so-far`; else `on-track`.
- `rankSeats`: `RangeError` on unequal lengths; `place = 1 + #seats ahead` (ahead = higher total, or equal total and fewer misses under `fewest-misses`); sorted by `place`, then `seat`. O(N²). Returns fresh objects.

## Conventions & invariants

- **Score purity** (spec BR-304, plan rule 8): `src/score` imports only `@/src/domain/*` (spec-01 modules `rules`, `types`; `import type` is enough so far) and its own files. Never `src/engine`. No `Math.random`, `Date`, `crypto`, `process`, `performance`, I/O, no barrel `index.ts`. Purity grep (must find nothing; avoid these words even in comments):
  `grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.|src/engine|\.\./engine' src/score`
- **Error messages**: `RangeError` with `<functionName>: <argName> must be a non-negative integer, got <value>` (e.g. `handPoints: bid must be a non-negative integer, got -1`; `liveStatus: tricksWon …`). `rankSeats`: `rankSeats: totals and missedCount must have equal length, got A and B`. Iteration 2 adds the prefixes `scoreHand: handIndex N: …` and `state.completedHands[k]: ` / `state.hand: ` (plan decision for FR-309).
- **Never `-0`**: write negative scores as `0 - x`, never unary minus (D-001).
- **Casting test `ScoringSpec`s**: the schema fields are literal types (`bonus: 10`, `perTrick: 5`, …), so a custom spec needs `as unknown as ScoringSpec` (a plain `as ScoringSpec` fails `tsc` with TS2352).
- **Tests**: `tests/unit/score/<topic>.test.ts`; header comment names the spec FRs/VCs; one `describe` per VC named `VC-NNN …`, `it.each` rows per spec input. Score-only builders go in `tests/unit/score/helpers.ts` (not collected). Imports use `@/src/score/<module>` and `@/src/domain/<module>`; tests may import `@/src/engine/*` and `../engine/helpers`.
- Formatting: Prettier (single quotes, semicolons, trailing commas, width 100). Run `pnpm prettier --write src/score tests/unit/score` before committing. `docs/` and `specs/` are in `.prettierignore` (not formatted, despite plan rule 2's wording).
- `dependencies` must stay exactly `next, react, react-dom, zod, @noble/hashes`.
- Commits: staged by explicit path, never `git add -A`; message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge.

## Commands

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/score/` | Run the score tests only (single file: append the file name). |
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

- `scoreHand` and `evaluate` do not exist yet (Iteration 2); `ScoreBoard.live[].status` in `types.ts` is an inline union equal to `LiveStatus` (not imported from score; domain stays independent).
- `handPoints` trusts the `ScoringSpec` numbers (no validation of the spec object itself; callers hold schema-valid rule sets).
- `rankSeats` does not validate that totals or misses are integers (spec requires only the length check).
- Docs are not updated until Iteration 3.
