# CONTEXT — Domain Model (Phase 1)

Last updated by: Iteration 4 (Design doc alignment, developer docs and CI check) — final state of Phase 1

## Current state

- Phase 0 scaffold is complete (see `specs/00-project-scaffold-frozen.md`): Next.js 16.4.6, TypeScript 6.0.3 `strict`, pnpm 10.15.1, Node 24 declared, Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, layer-boundary lint rule, GitHub Actions CI.
- `src/domain` is code-complete for Phase 1: `schemas.ts`, `cards.ts`, `decks.ts` (spec 01 FR-101 to FR-109), `rules.ts`, `presets.ts` (FR-110 to FR-115), and the state/event schemas plus `types.ts` (FR-116 to FR-119).
- Docs: `docs/design.md` §4.1–4.3 match spec 01 (FR-120: required `removeRanksForPlayers: Record<string, Rank[]>`, `type PresetId` + `RuleSet.id: PresetId`, `offset` bound, all four preset sequences and hand counts). `docs/development.md` §9 "Domain model" documents the domain for developers; Known limitations is now §10.
- Branch `spec/01-domain-model` pushed to `origin`; CI run 45084646885 on `2d1fbfa` succeeded (install, typecheck, lint, test, build); details in `iterations/04-docs-ci.md`. No PR opened yet (orchestrator's job).
- Phase 1 is complete; next is Phase 2 (engine).
- Tests: `tests/unit/domain/cards.test.ts` (VC-101 to VC-105), `decks.test.ts` (VC-106 to VC-108 plus deck/card schema checks), `presets.test.ts` (VC-109 to VC-113), `rule-set-schema.test.ts` (VC-114), `game-state-schema.test.ts` (VC-115), `game-event-schema.test.ts` (VC-116), `types.test.ts` (VC-117, type-level). `pnpm test`: 10 files, 215 tests.

## File map

| Path | Purpose |
|---|---|
| `src/domain/schemas.ts` | Every Zod schema + helper constants. Imports only `zod` (runtime). Card, deck, rule-set, game-state and game-event schemas. |
| `src/domain/cards.ts` | `Suit`, `Rank`, `Card` types; `InvalidCardError`, `cardId`, `parseCard`, `compareRanks`. |
| `src/domain/decks.ts` | `DeckDefinition` type; frozen `FRENCH_52`, `SPANISH_40`; `buildDeck`. |
| `src/domain/rules.ts` | Types only: `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `PresetId`, `RuleSet` (all `z.infer`). |
| `src/domain/types.ts` | Types only. Inferred: `SeatInfo`, `TrickPlay`, `HandState`, `HandResult`, `GameState`, `GameEvent`; `Phase = GameState['phase']`; hand-written: `Move`, `LegalMove`, `Transition`, `Rng`, `HandScore`, `ScoreBoard`, `TableView`, `PlayerView`, `PlayerUpdate`, `DecisionContext`, `Decision`. |
| `src/domain/presets.ts` | `PRESET_IDS`, `DEFAULT_PRESET_ID`, `UnknownPresetError`, `getPreset`; the four preset literals (private consts `ARGENTINA_FIDEPO`, `SPAIN_LUDOTEKA`, `GAMERULES`, `MEXICO_BAZAS`) in a deeply frozen null-prototype map. |
| `tests/unit/domain/cards.test.ts` | VC-101 to VC-105, one `it`/`it.each` row per spec input. |
| `tests/unit/domain/decks.test.ts` | VC-106 to VC-108; deep-freeze check; `DeckDefinitionSchema` parses both decks; `CardSchema` parses every built card. |
| `tests/unit/domain/presets.test.ts` | VC-109 to VC-113; expected presets are hand-written literals (never imported from `presets.ts`); prototype-key ids. |
| `tests/unit/domain/rule-set-schema.test.ts` | VC-114: one `it.each` row per mutation, each on a fresh `getPreset('spain-ludoteka')`; valid-bound rows. |
| `tests/unit/domain/game-state-schema.test.ts` | VC-115: playing fixture (mexico-bazas, 3 seats, `lastTrick`, one completed hand, seat 2 `strategy: 'random'`) and its `hand: null`/`game-over` variant parse and deep-equal; one `it.each` row per mutation (VC list + FR-116 extras + D-009 + nested strictness). |
| `tests/unit/domain/game-event-schema.test.ts` | VC-116: one valid example per event type (parse deep-equals input); the four invalid VC rows. |
| `tests/unit/domain/types.test.ts` | VC-117: imports every Module-exports name from its module; `expectTypeOf` not-`any` checks, exact value signatures, and `toEqualTypeOf` of the 13 FR-118 types against hand-copied `Exp*` shapes (D-011). Checked by `pnpm typecheck`; runs as 7 trivial tests in Vitest. |
| `src/config.ts` | Phase 0 env config; its `DEFAULT_RULES_PRESET` check stays a literal list (spec 01 Scope Out). |
| `eslint.config.mjs`, `tools/eslint-rules/layer-boundaries.mjs` | Layer rule: `src/domain` may import only its own files and `zod` / `@noble/hashes`. |
| `docs/design.md` | System design; §4.1–4.3 aligned with the domain (decks, `PresetId`, presets table, bounds incl. `offset`, four sequences + hands-per-game table). |
| `docs/development.md` | Developer guide; §9 Domain model (module map, cards/decks, presets and how to add one, schemas as source of truth, domain imports, what is not there yet). |
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

```ts
// Game state and events (Iteration 3). Private helpers: nonNegativeInt = z.int().min(0),
// positiveInt = z.int().min(1), knownSuit = z.string() refined to KNOWN_SUITS, handPlan = z.array(positiveInt).
export const SeatInfoSchema;    // strict { seat: >=0, playerId: string, name: string, kind: 'human'|'ai', strategy?: string }
export const TrickPlaySchema;   // strict { seat: >=0, card: CardSchema }
export const HandStateSchema;   // strict { cardsPerPlayer: >=1, dealer: >=0, trumpCard: Card, trumpCardInDealerHand: boolean,
                                //   trumpSuit: knownSuit, hands: Card[][], bids: (>=0 | null)[], tricksWon: (>=0)[],
                                //   currentTrick: strict { leader: >=0, plays: TrickPlay[] },
                                //   lastTrick?: strict { winner: >=0, plays: TrickPlay[] }, toAct: >=0 }
export const HandResultSchema;  // strict { handIndex: >=0, cardsPerPlayer: >=1, dealer: >=0, trumpSuit: knownSuit, bids: (>=0)[], tricks: (>=0)[] }
export const GameStateSchema;   // strict { schemaVersion: 1, gameId: non-empty, rules: RuleSetSchema, handPlan, seats: SeatInfo[],
                                //   seed: non-empty, aiDecisionCount: >=0, phase: 'bidding'|'playing'|'game-over', handIndex: >=0,
                                //   hand: HandStateSchema.nullable() (key required), completedHands: HandResult[], version: >=0 }
export const GameEventSchema;   // discriminatedUnion('type'), every variant strict:
  // game-started { seats, handPlan } | hand-dealt { handIndex, dealer, cardsPerPlayer >=1, trumpCard, trumpCardInDealerHand }
  // | bid-made { seat, tricks } | card-played { seat, card } | trick-won { seat, trickNumber >=1 }
  // | hand-completed { handIndex, result: HandResult } | game-over {}
```

Only optional schema fields: `SeatInfo.strategy`, `HandState.lastTrick`.

### `@/src/domain/types` (types only)

```ts
export type SeatInfo = z.infer<typeof SeatInfoSchema>;
export type TrickPlay = z.infer<typeof TrickPlaySchema>;
export type HandState = z.infer<typeof HandStateSchema>;
export type HandResult = z.infer<typeof HandResultSchema>;
export type GameState = z.infer<typeof GameStateSchema>;
export type Phase = GameState['phase'];               // 'bidding' | 'playing' | 'game-over' (D-010)
export type GameEvent = z.infer<typeof GameEventSchema>;
// Hand-written, exactly as the spec's listings (never persisted, no schema):
export type Move = { type: 'bid'; seat: number; tricks: number } | { type: 'play'; seat: number; card: Card };
export interface LegalMove { id: string; move: Move }                 // "bid:3", "play:QH"
export interface Transition { state: GameState; events: GameEvent[] }
export interface Rng { int(min: number, max: number): number; shuffle<T>(items: readonly T[]): T[] }
export interface HandScore; ScoreBoard; TableView; PlayerView extends TableView; PlayerUpdate; DecisionContext;
export type Decision = { type: 'move'; moveId: string } | { type: 'await' };
// Score/view/player shapes: see spec 01 "Score, view and player types"; behavior is Phases 2–4.
```

### Domain export map (spec FR-119; no barrel)

| Module | Exports |
|---|---|
| `@/src/domain/schemas` | `CardSchema`, `DeckDefinitionSchema`, `BoundSchema`, `SegmentSchema`, `HandSequenceSpecSchema`, `ScoringSpecSchema`, `RuleSetSchema`, `SeatInfoSchema`, `TrickPlaySchema`, `HandStateSchema`, `HandResultSchema`, `GameStateSchema`, `GameEventSchema`; helpers `KNOWN_SUITS`, `KNOWN_RANKS`, `PresetIdSchema` |
| `@/src/domain/cards` | types `Suit`, `Rank`, `Card`; `InvalidCardError`, `cardId`, `parseCard`, `compareRanks` |
| `@/src/domain/decks` | type `DeckDefinition`; `FRENCH_52`, `SPANISH_40`, `buildDeck` |
| `@/src/domain/rules` | types `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `PresetId`, `RuleSet` |
| `@/src/domain/presets` | `PRESET_IDS`, `DEFAULT_PRESET_ID`, `UnknownPresetError`, `getPreset` |
| `@/src/domain/types` | types `Phase`, `SeatInfo`, `TrickPlay`, `HandState`, `HandResult`, `GameState`, `Move`, `LegalMove`, `GameEvent`, `Transition`, `Rng`, `HandScore`, `ScoreBoard`, `TableView`, `PlayerView`, `PlayerUpdate`, `DecisionContext`, `Decision` |

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
- **Schemas are the source of truth** (FR-118): `Card`, `DeckDefinition`, `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `RuleSet`, `SeatInfo`, `TrickPlay`, `HandState`, `HandResult`, `GameState`, `GameEvent` are `z.infer<typeof …Schema>`; never write them by hand.
- **Type modules** = `cards.ts`, `decks.ts`, `rules.ts`, `types.ts`. They may import `schemas.ts`; between each other they use `import type` only (no runtime cycles). `schemas.ts` imports only `zod`. Today `cards.ts`, `decks.ts` and `rules.ts` import `zod` and `schemas.ts` as `import type` too (only `z.infer` is needed). `presets.ts` is not a type module: it value-imports `./decks` and `./schemas` and type-imports `./rules`.
- `schemas.ts` may export helpers beyond the spec's Module exports table (e.g. `KNOWN_SUITS`, `KNOWN_RANKS`) — D-001.
- Card schema uses `z.string().refine(...)`, not `z.enum`, so `Suit`/`Rank` infer as `string`. It validates against the union of both decks; per-game deck membership is the engine's job (Phase 2).
- Schemas are strict objects (`z.strictObject`) at every level, including every union variant; unknown keys are rejected. `grep -nE 'z\.object\(|looseObject|passthrough' src/domain/schemas.ts` finds nothing.
- `GameStateSchema` validates shape only (cards against the union of both decks, `KNOWN_*`); per-game consistency (deck membership, array lengths = seat count, phase/hand agreement) is Phase 2 invariants.
- **Changing a persisted shape**: edit the schema, the spec listing, and the matching `Exp*` type in `tests/unit/domain/types.test.ts` (D-011); `pnpm typecheck` fails until they agree.
- `DEFAULT_PRESET_ID` is a widening `const` literal: `expectTypeOf(DEFAULT_PRESET_ID)` sees `string`; use `typeof DEFAULT_PRESET_ID`.
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

- Persistence types `GameMeta`, `Commit`, `CommitBody` and their schemas are deferred to Phase 6 (`state/schemas.ts`), per spec 01 Scope Out.
- Score, view and player types (`HandScore` … `Decision`) are hand-written shapes with no behavior; Phases 2–4 implement them.
- Hand-sequence expansion (bounds → hand plan) and the intended hand counts are Phase 2; nothing validates semantic sanity of a sequence (e.g. `range 5→max` with max < 5).
- `DeckDefinitionSchema` does not restrict `suits`/`ranksHighToLow` to `KNOWN_SUITS`/`KNOWN_RANKS` (spec does not require it).
- `src/config.ts`'s `DEFAULT_RULES_PRESET` literal list is kept in sync with `PRESET_IDS` by review only (documented in development.md §9.3).

## Hand-off to Phase 2

- Import map: see "Domain export map" above (no barrel).
- `getPreset` returns a mutable deep clone; deck constants are deeply frozen; `buildDeck` order is suit-major (deck order), rank high→low, no shuffle.
- Bound semantics: `max = floor(deckSize / players)` with `deckSize` after `removeRanksForPlayers`; `{min:[n,'max']}` = min(n, max); `{offset:['max', n]}` = max + n (n ≤ 0); `range` is inclusive, steps ±1.
- Intended hand counts the `handPlan` expansion and fixtures must reproduce: argentina-fidepo 29/22/17/14 (3–6 players); spain-ludoteka 25/22/19/16 (3–6; max 12/10/8/6); gamerules 19/19/19/15/13 (3–7; start 10/10/10/8/7); mexico-bazas 11/12/13/14/15 (3–7).
