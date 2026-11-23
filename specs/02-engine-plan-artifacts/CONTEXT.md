# CONTEXT — Game Engine (Phase 2)

Last updated by: Iteration 1 (Seeded RNG and stream derivation)

## Current state

- Phase 0 scaffold and Phase 1 domain model are complete (see `specs/00-project-scaffold-frozen.md`, `specs/01-domain-model-frozen.md`). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`), pnpm 10.15.1, Node 24 declared, Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, layer-boundary lint rule, GitHub Actions CI.
- `@noble/hashes` 2.4.0 is now a runtime dependency (exact pin). `dependencies` = `@noble/hashes, next, react, react-dom, zod` (spec NFR-202).
- `src/engine/rng.ts` is done (spec FR-200 to FR-205): `rngFromSource`, `createXoshiro128ss`, `deriveRng`. `src/engine/.gitkeep` was deleted.
- Not yet built: `sequence.ts` (Iteration 2), `bidding.ts` / `play.ts` / `trick.ts` (3), `engine.ts` (4–5), `view.ts` (6), `invariants.ts` (7), docs (8).
- Tests: `pnpm test` = 11 files, 232 tests (domain 215 + rng 17 + config/smoke/layer-boundaries).

## File map

| Path | Purpose |
|---|---|
| `src/engine/rng.ts` | Seeded RNG: `rngFromSource`, `createXoshiro128ss` (xoshiro128**), `deriveRng` (SHA-256 stream derivation). |
| `tests/unit/engine/rng.test.ts` | VC-201 to VC-205; includes an independent BigInt xoshiro128** reference and a golden test computed in-test from `@noble/hashes`. |
| `src/domain/*.ts` | Phase 1 domain (schemas, cards, decks, rules, types, presets). Use, never redefine. |
| `eslint.config.mjs`, `tools/eslint-rules/layer-boundaries.mjs` | Layer rule. `CORE_EXTERNALS = ['zod', '@noble/hashes']` (subpaths allowed). `engine` may import only `domain`. |
| `vitest.config.ts` | Includes `tests/{unit,contract,api}/**/*.test.ts`. |
| `docs/development.md` | Developer guide (§1–§10). Iteration 8 adds an "Engine" section. |
| `docs/design.md` | System design. Iteration 8 edits §4.4–4.5 (FR-242). |
| `specs/02-engine-plan-artifacts/` | This artifact directory. |

## Public interfaces

### `@/src/engine/rng`

```ts
export function rngFromSource(next: () => number): Rng;
// int and shuffle draw raw outputs only via next() (each value coerced with `>>> 0`, D-001).
export function createXoshiro128ss(words: readonly [number, number, number, number]): Rng;
// Reference xoshiro128**; words copied (argument never mutated); all-zero state replaced by
// (0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x6a09e667).
export function deriveRng(seed: string, ...labels: (string | number)[]): Rng;
// words = bytes 0–15 of sha256(utf8ToBytes(JSON.stringify([seed, ...labels]))) as 4 LE uint32.
```

`Rng` (from `@/src/domain/types`): `int(min, max)` inclusive; `shuffle<T>(items: readonly T[]): T[]` returns a new array.

- `int(min, max)`: `RangeError` for non-integers, `min > max`, or `max − min + 1 > 2**32`. Rejection sampling: `range = max − min + 1`, `limit = floor(2**32 / range) * range`, draw until `u < limit`, return `min + u % range`.
- **`int(0, 2**32 − 1)` returns raw generator outputs unchanged** (limit = 2^32, nothing rejected) — use it in golden tests.
- `shuffle`: copy, then for `i = length−1 … 1`: `j = int(0, i)`, swap. Each swap consumes ≥ 1 draw.
- Golden reference: `deriveRng('golden-seed', 'deal', 0)` first 8 raw outputs = `1610793976, 333462975, 1658162046, 2737170619, 3645462708, 2685186142, 3513667637, 568283462`.

### Domain (Phase 1, unchanged) — import map, no barrel

| Module | Exports |
|---|---|
| `@/src/domain/schemas` | `CardSchema`, `DeckDefinitionSchema`, `BoundSchema`, `SegmentSchema`, `HandSequenceSpecSchema`, `ScoringSpecSchema`, `RuleSetSchema`, `SeatInfoSchema`, `TrickPlaySchema`, `HandStateSchema`, `HandResultSchema`, `GameStateSchema`, `GameEventSchema`; helpers `KNOWN_SUITS`, `KNOWN_RANKS`, `PresetIdSchema` |
| `@/src/domain/cards` | types `Suit`, `Rank`, `Card`; `InvalidCardError`, `cardId`, `parseCard`, `compareRanks` |
| `@/src/domain/decks` | type `DeckDefinition`; `FRENCH_52`, `SPANISH_40`, `buildDeck` |
| `@/src/domain/rules` | types `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `PresetId`, `RuleSet` |
| `@/src/domain/presets` | `PRESET_IDS`, `DEFAULT_PRESET_ID`, `UnknownPresetError`, `getPreset` |
| `@/src/domain/types` | types `Phase`, `SeatInfo`, `TrickPlay`, `HandState`, `HandResult`, `GameState`, `Move`, `LegalMove`, `GameEvent`, `Transition`, `Rng`, `HandScore`, `ScoreBoard`, `TableView`, `PlayerView`, `PlayerUpdate`, `DecisionContext`, `Decision` |

Key domain facts for later iterations (from the Phase 1 hand-off):
- `cardId(card)` = `${rank}${suit}` (`10S`, `CC`); `parseCard` reads the last char as suit. `compareRanks(deck, a, b) > 0` when `a` is higher (deck `ranksHighToLow`; Spanish order `A 3 R C S 7 6 5 4 2`).
- `buildDeck(deck, players)`: fresh cards, suit-major (deck order) then rank high→low, minus `removeRanksForPlayers[String(players)]` (Spanish: 36 cards for 3 and 6 players). No shuffle.
- `getPreset(id)` returns a mutable deep clone; deck constants are deeply frozen.
- Bound semantics: `max = floor(deckSize / players)` (deck after removals); `{min:[n,'max']}` = min(n, max); `{offset:['max', n]}` = max + n (n ≤ 0); `range` inclusive, steps ±1.
- Expected hand counts: argentina-fidepo 29/22/17/14 (3–6 players); spain-ludoteka 25/22/19/16 (3–6; max 12/10/8/6); gamerules 19/19/19/15/13 (3–7); mexico-bazas 11/12/13/14/15 (3–7).
- Schemas validate shape only; per-game consistency is engine invariants (Iteration 7). Optional fields: `SeatInfo.strategy`, `HandState.lastTrick`; `GameState.hand` is required but nullable.

## Conventions & invariants

- **Engine purity** (spec BR-206, plan rule 8): `src/engine` imports only `@/src/domain/*` (from the spec-01 modules; no barrel), its own files (relative `./x`), `zod`, and `@noble/hashes/*.js`. No `Math.random`, `Date`, `crypto`, `process`, `performance`, I/O, or `src/score`. Purity grep (must find nothing):
  `grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.|src/score|\.\./score' src/engine` — avoid these words even in comments.
- **`@noble/hashes` specifiers must end in `.js`**: `@noble/hashes/sha2.js`, `@noble/hashes/utils.js`. The 2.4.0 export map has no bare `./sha2` / `./utils`. ESM-only; hash input is `Uint8Array`.
- Integer arithmetic for uint32 uses plain numbers, `Math.imul` and `>>> 0`; no `BigInt` in `src/engine` (tests may use it for independent references).
- **Tests**: `tests/unit/engine/<topic>.test.ts`; header comment names the spec FRs/VCs; one `describe` per VC named `VC-NNN …`, one `it`/`it.each` row per spec input. Shared helpers go in `tests/unit/engine/helpers.ts` (not collected). Expected values are computed independently of the code under test where the plan asks for it.
- Imports in tests use `@/src/engine/<module>` and `@/src/domain/<module>`.
- Formatting: Prettier (single quotes, semicolons, trailing commas, width 100). Run `pnpm prettier --write <paths>` before committing; `specs/` and `docs/` are not formatted.
- `dependencies` must stay exactly `next, react, react-dom, zod, @noble/hashes` (NFR-202); add packages with exact versions (`pnpm add -E pkg@x.y.z`).
- Commits: staged by explicit path, never `git add -A`; message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge.
- Error classes set `this.name` to the class name.

## Commands

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/engine/` | Run the engine tests only (single file: append the file name). |
| `pnpm typecheck` | `next typegen && tsc --noEmit` (whole project incl. tests). |
| `pnpm lint` | ESLint `--max-warnings 0` + `prettier --check .`. |
| `pnpm format` | `prettier --write .`. |
| `pnpm test` | `vitest run` over `tests/{unit,contract,api}/**/*.test.ts`. |
| `pnpm test:sim` | Sim tests (none yet; exits 0). |
| `pnpm exec tsx <file.ts>` | Run a scratch TS script (resolves `@/`); keep scratch files out of the repo. |
| `node -e "const d=require('./package.json').dependencies;console.log(Object.keys(d).join(','), d['@noble/hashes'])"` | NFR-202 check. |

pnpm prints an "Unsupported engine" WARN locally (Node 26 vs declared 24) and "Ignored build scripts: esbuild"; neither is fatal.

## Known gaps

- Everything after the RNG (sequence expansion, legal bids/plays, trick winner, engine, view, invariants, docs) is not built yet.
- `int` accepts any `Number.isInteger` bounds, including unsafe integers beyond 2^53 (results there are imprecise); the spec only requires integers. Engine callers use small ranges.
- `docs/development.md` still says `@noble/hashes` "is added when the engine needs hashing"; Iteration 8 updates the docs.
