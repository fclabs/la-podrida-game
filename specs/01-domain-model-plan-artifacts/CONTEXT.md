# CONTEXT — Domain Model (Phase 1)

Last updated by: Iteration 2 (Rule sets, presets and the RuleSet schema)

## Current state

- Phase 0 scaffold is complete (see `specs/00-project-scaffold-frozen.md`): Next.js 16.4.6, TypeScript 6.0.3 `strict`, pnpm 10.15.1, Node 24 declared, Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, layer-boundary lint rule, GitHub Actions CI.
- `src/domain` holds `schemas.ts`, `cards.ts`, `decks.ts` (spec 01 FR-101 to FR-109) and `rules.ts`, `presets.ts` (FR-110 to FR-115).
- Not built yet: `GameState`/`GameEvent` schemas and `types.ts` (Iteration 3); `docs/design.md` / `docs/development.md` updates (Iteration 4).
- Tests: `tests/unit/domain/cards.test.ts` (VC-101 to VC-105), `decks.test.ts` (VC-106 to VC-108 plus deck/card schema checks), `presets.test.ts` (VC-109 to VC-113), `rule-set-schema.test.ts` (VC-114). `pnpm test`: 7 files, 174 tests.

## File map

| Path | Purpose |
|---|---|
| `src/domain/schemas.ts` | Zod schemas + helper constants. Imports only `zod` (runtime). Card, deck and rule-set schemas; Iteration 3 adds state and event schemas here. |
| `src/domain/cards.ts` | `Suit`, `Rank`, `Card` types; `InvalidCardError`, `cardId`, `parseCard`, `compareRanks`. |
| `src/domain/decks.ts` | `DeckDefinition` type; frozen `FRENCH_52`, `SPANISH_40`; `buildDeck`. |
| `src/domain/rules.ts` | Types only: `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `PresetId`, `RuleSet` (all `z.infer`). |
| `src/domain/presets.ts` | `PRESET_IDS`, `DEFAULT_PRESET_ID`, `UnknownPresetError`, `getPreset`; the four preset literals (private consts `ARGENTINA_FIDEPO`, `SPAIN_LUDOTEKA`, `GAMERULES`, `MEXICO_BAZAS`) in a deeply frozen null-prototype map. |
| `tests/unit/domain/cards.test.ts` | VC-101 to VC-105, one `it`/`it.each` row per spec input. |
| `tests/unit/domain/decks.test.ts` | VC-106 to VC-108; deep-freeze check; `DeckDefinitionSchema` parses both decks; `CardSchema` parses every built card. |
| `tests/unit/domain/presets.test.ts` | VC-109 to VC-113; expected presets are hand-written literals (never imported from `presets.ts`); prototype-key ids. |
| `tests/unit/domain/rule-set-schema.test.ts` | VC-114: one `it.each` row per mutation, each on a fresh `getPreset('spain-ludoteka')`; valid-bound rows. |
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
export const BoundSchema;            // union: z.int() >= 1 | 'max' | strict { min: [int >= 1, 'max'] } | strict { offset: ['max', int <= 0] }
export const SegmentSchema;          // discriminatedUnion('kind'): strict { kind:'range', from: Bound, to: Bound }
                                     //   | strict { kind:'repeat', cards: Bound, times: int >= 1 | 'players' }
export const HandSequenceSpecSchema; // z.array(SegmentSchema).min(1)
export const ScoringSpecSchema;      // discriminatedUnion('kind'), literal values:
                                     //   { kind:'bonus-plus-tricks', bonus:10, perTrick:1, missedPerTrick:1 }
                                     //   | { kind:'bonus-plus-bid', bonus:10 } | { kind:'spanish', bonus:10, perTrick:5, missPenaltyPerTrick:5 }
export const PresetIdSchema;         // z.enum(['argentina-fidepo','spain-ludoteka','gamerules','mexico-bazas']) (helper export, D-001/D-007)
export const RuleSetSchema;          // strict at every level, every field required:
  // { id: PresetIdSchema, deck: DeckDefinitionSchema,
  //   players: strict { min: int >= 2, max: int >= 2 } refined min <= max,
  //   handSequence: HandSequenceSpecSchema, trump: { source: 'next-stock-card-or-dealer-last' },
  //   bidding: { dealerRestriction: boolean, dealerRestrictionExemptCardCounts: (int >= 1)[] },
  //   play: { mustFollowSuit: true, mustTrumpWhenVoid: true, mustBeatLedSuit, beatNotRequiredAfterTrumped,
  //           mustOvertrump: boolean, whenCannotOvertrump: 'any-trump' | 'any-card' },
  //   scoring: ScoringSpecSchema, tieBreak: 'fewest-misses' | 'shared' }
```

### `@/src/domain/rules` (types only)

```ts
export type Bound = z.infer<typeof BoundSchema>;   // number | 'max' | { min: [number, 'max'] } | { offset: ['max', number] }
export type Segment = z.infer<typeof SegmentSchema>;
export type HandSequenceSpec = z.infer<typeof HandSequenceSpecSchema>;   // Segment[]
export type ScoringSpec = z.infer<typeof ScoringSpecSchema>;
export type PresetId = z.infer<typeof PresetIdSchema>;   // 'argentina-fidepo' | 'spain-ludoteka' | 'gamerules' | 'mexico-bazas'
export type RuleSet = z.infer<typeof RuleSetSchema>;
```

### `@/src/domain/presets`

```ts
export const PRESET_IDS: readonly PresetId[];            // frozen copy of PresetIdSchema.options (spec order)
export const DEFAULT_PRESET_ID: 'argentina-fidepo';
export class UnknownPresetError extends Error {}         // name === 'UnknownPresetError'; message `Unknown rules preset "<id>"`
export function getPreset(id: string): RuleSet;          // structuredClone of the frozen internal preset (mutable, independent);
                                                         // Object.hasOwn on a null-prototype map, so '__proto__'/'constructor'/'toString' throw
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
- **Type modules** = `cards.ts`, `decks.ts`, `rules.ts`, `types.ts`. They may import `schemas.ts`; between each other they use `import type` only (no runtime cycles). `schemas.ts` imports only `zod`. Today `cards.ts`, `decks.ts` and `rules.ts` import `zod` and `schemas.ts` as `import type` too (only `z.infer` is needed). `presets.ts` is not a type module: it value-imports `./decks` and `./schemas` and type-imports `./rules`.
- `schemas.ts` may export helpers beyond the spec's Module exports table (e.g. `KNOWN_SUITS`, `KNOWN_RANKS`) — D-001.
- Card schema uses `z.string().refine(...)`, not `z.enum`, so `Suit`/`Rank` infer as `string`. It validates against the union of both decks; per-game deck membership is the engine's job (Phase 2).
- Schemas are strict objects (`z.strictObject`) at every level; unknown keys are rejected.
- Deck constants are deeply frozen (D-003); `buildDeck` returns fresh, unfrozen arrays and card objects. Presets clone decks with `structuredClone` (a clone of a frozen object is unfrozen) and are then deep-frozen themselves (D-006).
- `removeRanksForPlayers` lookups use `Object.hasOwn` with `String(players)`.
- **Presets**: `getPreset` returns a fresh deep clone (callers may mutate it). The internal presets are deeply frozen. Integers in schemas use `z.int()` (rejects non-integers and unsafe integers).
- **How to add or change a preset** (a spec change — Preset values table first): add the id to `PresetIdSchema` (this also extends `PresetId` and `PRESET_IDS`), add a `const` in `presets.ts` with *every* `RuleSet` field spelled out (BR-101; mark flags the engine ignores with `// unused`), `structuredClone` the deck constant, register it in the `PRESETS` map (the `Record<PresetId, RuleSet>` type forces a complete map), and add a hand-written expected literal to `presets.test.ts` VC-110. `src/config.ts`'s literal list must be updated by hand.
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

- Game state/event schemas and `types.ts` not yet built (Iteration 3); the type-level `expectTypeOf` checks for rule types come with VC-117 there.
- Hand-sequence expansion (bounds → hand plan) and the intended hand counts are Phase 2; nothing validates semantic sanity of a sequence (e.g. `range 5→max` with max < 5).
- `DeckDefinitionSchema` does not restrict `suits`/`ranksHighToLow` to `KNOWN_SUITS`/`KNOWN_RANKS` (spec does not require it).
- `docs/design.md` §4.1–4.3 not yet aligned (Iteration 4).
- Branch not pushed; CI verification of Phase 1 happens in Iteration 4.
