# CONTEXT — Domain Model (Phase 1)

Last updated by: Iteration 1 (Cards, decks and their schemas)

## Current state

- Phase 0 scaffold is complete (see `specs/00-project-scaffold-frozen.md`): Next.js 16.4.6, TypeScript 6.0.3 `strict`, pnpm 10.15.1, Node 24 declared, Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, layer-boundary lint rule, GitHub Actions CI.
- `src/domain` now holds `schemas.ts`, `cards.ts`, `decks.ts` (spec 01 FR-101 to FR-109). The `.gitkeep` was deleted.
- Not built yet: `rules.ts`, `presets.ts` and the rule schemas (Iteration 2); `GameState`/`GameEvent` schemas and `types.ts` (Iteration 3); `docs/design.md` / `docs/development.md` updates (Iteration 4).
- Tests: `tests/unit/domain/cards.test.ts` (VC-101 to VC-105) and `tests/unit/domain/decks.test.ts` (VC-106 to VC-108 plus deck/card schema checks). `pnpm test`: 5 files, 131 tests.

## File map

| Path | Purpose |
|---|---|
| `src/domain/schemas.ts` | Zod schemas + helper constants. Imports only `zod` (runtime). Iterations 2–3 add the rule, state and event schemas here. |
| `src/domain/cards.ts` | `Suit`, `Rank`, `Card` types; `InvalidCardError`, `cardId`, `parseCard`, `compareRanks`. |
| `src/domain/decks.ts` | `DeckDefinition` type; frozen `FRENCH_52`, `SPANISH_40`; `buildDeck`. |
| `tests/unit/domain/cards.test.ts` | VC-101 to VC-105, one `it`/`it.each` row per spec input. |
| `tests/unit/domain/decks.test.ts` | VC-106 to VC-108; deep-freeze check; `DeckDefinitionSchema` parses both decks; `CardSchema` parses every built card. |
| `src/config.ts` | Phase 0 env config; its `DEFAULT_RULES_PRESET` check stays a literal list (spec 01 Scope Out). |
| `eslint.config.mjs`, `tools/eslint-rules/layer-boundaries.mjs` | Layer rule: `src/domain` may import only its own files and `zod` / `@noble/hashes`. |
| `specs/01-domain-model-plan-artifacts/` | This artifact directory. |

## Public interfaces

### `@/src/domain/schemas`

```ts
export const KNOWN_SUITS: readonly string[];   // frozen: S H D C O E B
export const KNOWN_RANKS: readonly string[];   // frozen: A K Q J 10 9 8 7 6 5 4 3 2 R C S
export const CardSchema;                       // z.strictObject({ suit: z.string().refine(∈ KNOWN_SUITS), rank: z.string().refine(∈ KNOWN_RANKS) })
export const DeckDefinitionSchema;             // z.strictObject({ id: z.enum(['french-52','spanish-40']),
                                               //   suits, ranksHighToLow: non-empty, distinct string[],
                                               //   removeRanksForPlayers: z.record(z.string().regex(/^[1-9][0-9]*$/), z.array(z.string())) })
                                               //   .superRefine(every removed rank ∈ ranksHighToLow)
```

### `@/src/domain/cards`

```ts
export type Suit = string;
export type Rank = string;
export type Card = z.infer<typeof CardSchema>;            // { suit: string; rank: string }
export class InvalidCardError extends Error {}           // name === 'InvalidCardError'
export function cardId(card: Card): string;              // `${rank}${suit}`: "10S", "CC"
export function parseCard(id: string, deck: DeckDefinition): Card;            // last char = suit, rest = rank; throws InvalidCardError with `"<id>"` in message
export function compareRanks(deck: DeckDefinition, a: Rank, b: Rank): number; // >0 if a higher; throws InvalidCardError for ranks not in deck
```

### `@/src/domain/decks`

```ts
export type DeckDefinition = z.infer<typeof DeckDefinitionSchema>;
// { id: 'french-52' | 'spanish-40'; suits: string[]; ranksHighToLow: string[]; removeRanksForPlayers: Record<string, string[]> }
export const FRENCH_52: DeckDefinition;   // S H D C; A K Q J 10 … 2; removeRanksForPlayers {}         (deeply frozen)
export const SPANISH_40: DeckDefinition;  // O C E B; A 3 R C S 7 6 5 4 2; { '3': ['2'], '6': ['2'] }  (deeply frozen)
export function buildDeck(deck: DeckDefinition, players: number): Card[];
// new array of new card objects, suit-major (deck order) then rank high→low, minus removeRanksForPlayers[String(players)];
// RangeError unless players is an integer >= 1. Sizes: french 52 always; spanish 36 (3, 6 players) else 40.
```

## Conventions & invariants

- **Domain purity** (spec BR-104, plan rule 8): `src/domain` imports only `zod` and its own files; no randomness, I/O or `Date`. Purity grep: `grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.' src/domain` must find nothing.
- **Schemas are the source of truth** (FR-118): `Card`, `DeckDefinition` and later `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `RuleSet`, `SeatInfo`, `TrickPlay`, `HandState`, `HandResult`, `GameState`, `GameEvent` are `z.infer<typeof …Schema>`; never write them by hand.
- **Type modules** = `cards.ts`, `decks.ts`, `rules.ts`, `types.ts`. They may import `schemas.ts`; between each other they use `import type` only (no runtime cycles). `schemas.ts` imports only `zod`. Today `cards.ts` and `decks.ts` import `zod` and `schemas.ts` as `import type` too (only `z.infer` is needed).
- `schemas.ts` may export helpers beyond the spec's Module exports table (e.g. `KNOWN_SUITS`, `KNOWN_RANKS`) — D-001.
- Card schema uses `z.string().refine(...)`, not `z.enum`, so `Suit`/`Rank` infer as `string`. It validates against the union of both decks; per-game deck membership is the engine's job (Phase 2).
- Schemas are strict objects (`z.strictObject`) at every level; unknown keys are rejected.
- Deck constants are deeply frozen (D-003); `buildDeck` returns fresh, unfrozen arrays and card objects. Presets (Iteration 2) must clone decks (`structuredClone`) — a clone of a frozen object is unfrozen.
- `removeRanksForPlayers` lookups use `Object.hasOwn` with `String(players)`.
- Error classes set `this.name` to the class name (same pattern as `ConfigError`).
- Imports from tests use `@/src/domain/<module>`; there is no barrel `index.ts` (FR-119). Inside `src/domain`, relative `./<module>` imports.
- Tests: `tests/unit/domain/<topic>.test.ts`; header comment names the spec FRs/VCs; one `describe` per VC named `VC-NNN …`, one `it`/`it.each` row per spec input.
- Formatting: Prettier (single quotes, semicolons, trailing commas, width 100). Run `pnpm format` (or `pnpm prettier --write <paths>`) before committing; `specs/` and `docs/` are not formatted.
- `dependencies` must stay exactly `next, react, react-dom, zod` (NFR-102).

## Commands

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/domain/` | Run the domain tests only. |
| `pnpm typecheck` | `next typegen && tsc --noEmit` (whole project incl. tests). |
| `pnpm lint` | ESLint `--max-warnings 0` + `prettier --check .`. |
| `pnpm format` | `prettier --write .`. |
| `pnpm test` | `vitest run` over `tests/{unit,contract,api}/**/*.test.ts`. |
| `pnpm test:sim` | Sim tests (none yet; exits 0). |
| `pnpm exec tsx <file.ts>` | Run a scratch TS script (resolves `@/`); keep scratch files out of the repo. |

pnpm prints an "Unsupported engine" WARN locally (Node 26 vs declared 24); not fatal.

## Known gaps

- Rule types, presets and `RuleSetSchema` not yet built (Iteration 2). Game state/event schemas and `types.ts` not yet built (Iteration 3).
- `DeckDefinitionSchema` does not restrict `suits`/`ranksHighToLow` to `KNOWN_SUITS`/`KNOWN_RANKS` (spec does not require it).
- `docs/design.md` §4.1–4.3 not yet aligned (Iteration 4).
- Branch not pushed; CI verification of Phase 1 happens in Iteration 4.
