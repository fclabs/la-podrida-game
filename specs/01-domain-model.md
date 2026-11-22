# Spec 01 — Domain Model

> Version: 0.2 · Last updated: 2026-11-22 · Status: Draft · Owner: Federico Castañeda
> Source: [`docs/implementation.md`](../docs/implementation.md) §3 Phase 1 (Milestone M1). Context: [`docs/design.md`](../docs/design.md) §4, §5.1, §5.5, §6.1–6.2, §8.1; [`docs/game_rules.md`](../docs/game_rules.md) §3.1–3.3, §3.6–3.7.
> Builds on: [`specs/00-project-scaffold-frozen.md`](./00-project-scaffold-frozen.md) (layer rules: `src/domain` imports nothing but `zod`; test layout `tests/unit/**/*.test.ts`).
> Requirement IDs use the 1xx range so they never collide with spec 00.

## Purpose

Every later layer (engine, score, players, state, service, API, UI) speaks the same vocabulary: cards, decks, rule sets, presets, game state, moves and events. This spec defines that vocabulary once, in `src/domain`, as pure TypeScript types, a few pure helpers (card ids, rank order, deck building) and Zod schemas that later phases reuse to validate persisted data. It also pins the four rule presets with every field set, so the engine (Phase 2) and score engine (Phase 3) are driven by configuration rather than special cases. It benefits the developers who build Phases 2–9, who can then rely on one checked definition instead of re-deriving it from the design docs.

## Scope

**In**
- `src/domain/cards.ts`: card types, card id serialization and parsing, rank comparison.
- `src/domain/decks.ts`: the `french-52` and `spanish-40` deck definitions and `buildDeck`.
- `src/domain/rules.ts`: `RuleSet`, `HandSequenceSpec` (including the new `offset` bound), `ScoringSpec` types.
- `src/domain/presets.ts`: the four presets, the preset id list, the default id, and `getPreset`.
- `src/domain/schemas.ts`: Zod schemas for `Card`, `RuleSet`, `GameState`, `GameEvent`.
- `src/domain/types.ts`: the shared types listed in Data & Interfaces.
- Updating `docs/design.md` §4.2 (preset table) and §4.3 (bound types and preset sequences) to match this spec.
- Unit tests in `tests/unit/domain/`.

**Out**
- Expanding a `HandSequenceSpec` into a hand plan, dealing, legal moves, transitions, views, invariants, RNG implementation (Phase 2).
- Scoring logic (Phase 3); players and strategies (Phase 4).
- Persistence types `GameMeta`, `Commit`, `CommitBody` and their schemas (Phase 6, `state/schemas.ts`).
- Preset descriptions for `GET /api/presets` (Phase 8).
- Changing `src/config.ts` (its `DEFAULT_RULES_PRESET` check stays a literal list).
- Spanish 7–8 player decks, the 8/9-card extension, Stay-and-Play rank order, special hands, Pocha bonuses (design §11).

## Actors

| Actor | Description | Permissions |
|---|---|---|
| Developer (later phases) | Imports domain types, helpers, presets and schemas | Read-only use; changing a preset is a spec change |
| State layer (Phase 6) | Validates persisted state and events with the schemas | Calls `GameStateSchema` / `GameEventSchema` |
| UI (Phase 9) | Uses domain types for rendering | `import type` only (spec 00 layer rule) |

## Functional Requirements

### Cards and ranks

- **FR-101 (Must)** — Given a `Card`, when `cardId(card)` is called, then it returns the rank token followed by the suit letter (e.g. `{ rank: '10', suit: 'S' }` → `"10S"`, `{ rank: 'C', suit: 'C' }` → `"CC"`).
- **FR-102 (Must)** — Given a deck definition and a string, when `parseCard(id, deck)` is called, then it treats the last character as the suit and the rest as the rank, and returns the `Card` if that suit and rank both belong to the deck.
- **FR-103 (Must)** — Given a string that is empty, has no rank part, or whose suit or rank is not in the given deck (e.g. `"3O"` for `french-52`, `"KO"` for `spanish-40`, `"1H"`, `"H"`, `"10"`, `"7h"`), when `parseCard` is called, then it throws `InvalidCardError` whose message contains the input string.
- **FR-104 (Must)** — Given a deck definition and two ranks of that deck, when `compareRanks(deck, a, b)` is called, then it returns a positive number if `a` ranks higher, negative if lower, and `0` if equal, using `deck.ranksHighToLow` order.
- **FR-105 (Must)** — Given a rank not in the deck, when `compareRanks` is called with it, then it throws `InvalidCardError`.

### Decks

- **FR-106 (Must)** — `FRENCH_52` has suits `S H D C` and ranks high→low `A K Q J 10 9 8 7 6 5 4 3 2`, with no rank removals.
- **FR-107 (Must)** — `SPANISH_40` has suits `O C E B` (oros, copas, espadas, bastos) and ranks high→low `A 3 R C S 7 6 5 4 2`, and removes rank `2` for 3 and for 6 players.
- **FR-108 (Must)** — Given a deck definition and a player count, when `buildDeck(deck, players)` is called, then it returns a new array of every suit × rank combination, minus the ranks in `removeRanksForPlayers[players]`, ordered by suit (deck order) then rank (high→low), with no duplicates.
- **FR-109 (Must)** — Given a `players` value that is not an integer ≥ 1, when `buildDeck` is called, then it throws `RangeError`.

### Rules and presets

- **FR-110 (Must)** — `PRESET_IDS` is the ordered list `argentina-fidepo`, `spain-ludoteka`, `gamerules`, `mexico-bazas`; `DEFAULT_PRESET_ID` is `argentina-fidepo`.
- **FR-111 (Must)** — Given a preset id from `PRESET_IDS`, when `getPreset(id)` is called, then it returns a `RuleSet` equal to the values in the Preset values table, with `id` equal to the requested id.
- **FR-112 (Must)** — Given two calls to `getPreset` with the same id, when the first result is mutated, then the second result is unaffected (each call returns an independent deep copy).
- **FR-113 (Must)** — Given an unknown id (e.g. `"foo"`, `""`), when `getPreset` is called, then it throws `UnknownPresetError` whose message contains the id.
- **FR-114 (Must)** — Given each of the four presets, when it is parsed with `RuleSetSchema`, then parsing succeeds and the parsed value deep-equals the preset.

### Schemas

- **FR-115 (Must)** — `RuleSetSchema` accepts exactly the `RuleSet` shape in Data & Interfaces: every field is required (no optional fields), unknown keys are rejected at every level, `players.min` and `players.max` are integers with `2 ≤ min ≤ max`, `dealerRestrictionExemptCardCounts` holds positive integers, `removeRanksForPlayers` keys match `^[1-9][0-9]*$` (validated as strings, never coerced to numbers, so `"03"` and `"0"` are rejected) and its values are ranks of the same deck, and `deck.suits` and `deck.ranksHighToLow` are non-empty with no duplicates.
- **FR-116 (Must)** — `GameStateSchema` accepts exactly the `GameState` shape in Data & Interfaces (strict at every level) and rejects: `schemaVersion` other than `1`; `phase` outside `bidding | playing | game-over`; negative or non-integer `version`, `aiDecisionCount`, `handIndex`, seat indexes, bids or trick counts; an empty `seed`; `hand` missing (it must be present, possibly `null`); a card whose suit or rank is not in the union of both decks' suits and ranks.
- **FR-117 (Must)** — `GameEventSchema` accepts each of the seven event variants in Data & Interfaces, discriminated by `type`, and rejects an unknown `type`, a missing field, or an extra field.
- **FR-118 (Must)** — The schemas are the single source of truth for persisted shapes: `Card`, `DeckDefinition`, `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `RuleSet`, `SeatInfo`, `TrickPlay`, `HandState`, `HandResult`, `GameState` and `GameEvent` are exported as `z.infer<typeof …Schema>` of their schemas, not written by hand. The interface listings in Data & Interfaces document the shape those inferences must produce. *Why:* one definition cannot drift; the cost (less readable hovers) is acceptable.

### Shared types

- **FR-119 (Must)** — Every type and value in Data & Interfaces is exported from the module named in the Module exports table, with the shapes given there, so later phases import them from `@/src/domain/<module>`. There is no barrel `index.ts`.

### Design docs

- **FR-120 (Must)** — `docs/design.md` matches this spec: §4.1's `DeckDefinition` has `removeRanksForPlayers: Record<string, Rank[]>` (required, `{}` when none); §4.2's `RuleSet.id` is `PresetId` and its preset table shows the Spain and Mexico sequences with exactly N hands at the top card count; §4.3 documents the `{ offset: ['max', n] }` bound and the four preset sequences exactly as in this spec's Preset values table.

## Business Rules

- **BR-101 — Every preset field is explicit.** No preset relies on a default; fields that a preset's flags make irrelevant still carry a fixed value (see the table). *Rationale:* design §4.2; makes presets comparable and diffable. *Exceptions:* none.
- **BR-102 — Exactly N hands at the top card count for Spain and Mexico.** `spain-ludoteka` and `mexico-bazas` play exactly `players` hands at their top card count; their ramps stop one card short. *Rationale:* operator decision (2026-11-22) reading "N hands at Max" as the total. *Exceptions:* `argentina-fidepo`, whose 5-card hands bracket the 4-card block (F.I.DE.PO. table: 29/22/17/14 hands), and `gamerules`, whose turning 1-card hand appears once.
- **BR-103 — Rules are data.** A `RuleSet` is plain JSON-serializable data (no functions, no class instances, no `undefined` values). *Rationale:* rule sets are frozen into each game's state and persisted (design §4.3, §4.5). *Exceptions:* none.
- **BR-104 — Domain is pure.** `src/domain` performs no I/O, has no randomness and imports only `zod` (spec 00 layer rule). *Rationale:* the core runs unchanged in tests, the simulator and serverless functions. *Exceptions:* none.
- **BR-105 — Card identity.** A card is identified by `cardId`; two cards are the same card iff their ids are equal. *Rationale:* move ids (`play:QH`) and invariants (Phase 2) depend on it. *Exceptions:* none.

## Non-Functional Requirements

- **NFR-101** — `pnpm typecheck`, `pnpm lint` (0 warnings) and `pnpm test` pass, locally and in CI.
- **NFR-102** — `src/domain` adds no new runtime dependency (`dependencies` stay `next, react, react-dom, zod`).

## Data & Interfaces

### Module exports

| Module | Exports |
|---|---|
| `src/domain/schemas.ts` | `CardSchema`, `DeckDefinitionSchema`, `BoundSchema`, `SegmentSchema`, `HandSequenceSpecSchema`, `ScoringSpecSchema`, `RuleSetSchema`, `SeatInfoSchema`, `TrickPlaySchema`, `HandStateSchema`, `HandResultSchema`, `GameStateSchema`, `GameEventSchema` |
| `src/domain/cards.ts` | types `Suit`, `Rank`, `Card`; `InvalidCardError`, `cardId`, `parseCard`, `compareRanks` |
| `src/domain/decks.ts` | type `DeckDefinition`; `FRENCH_52`, `SPANISH_40`, `buildDeck` |
| `src/domain/rules.ts` | types `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `PresetId`, `RuleSet` |
| `src/domain/presets.ts` | `PRESET_IDS`, `DEFAULT_PRESET_ID`, `UnknownPresetError`, `getPreset` |
| `src/domain/types.ts` | every other type in this section (`Phase`, `SeatInfo`, `TrickPlay`, `HandState`, `HandResult`, `GameState`, `Move`, `LegalMove`, `GameEvent`, `Transition`, `Rng`, `HandScore`, `ScoreBoard`, `TableView`, `PlayerView`, `PlayerUpdate`, `DecisionContext`, `Decision`) |

Type modules may import `schemas.ts` (for `z.infer`); `schemas.ts` imports only `zod`. `CardSchema` checks suit and rank membership with refinements on `z.string()` (not `z.enum`), so `Suit` and `Rank` infer as `string`; decks are data, not types. `PresetId` is the literal union and `PRESET_IDS` is typed `readonly PresetId[]`.

### Cards and decks

```ts
export type Suit = string;   // 'S' | 'H' | 'D' | 'C' (french-52), 'O' | 'C' | 'E' | 'B' (spanish-40)
export type Rank = string;   // 'A','K','Q','J','10'…'2' (french-52); 'A','3','R','C','S','7','6','5','4','2' (spanish-40)
export interface Card { suit: Suit; rank: Rank }

export interface DeckDefinition {
  id: 'french-52' | 'spanish-40';
  suits: Suit[];
  ranksHighToLow: Rank[];
  removeRanksForPlayers: Record<string, Rank[]>;   // keys are player counts as decimal strings; {} when none
}

export class InvalidCardError extends Error {}
export function cardId(card: Card): string;
export function parseCard(id: string, deck: DeckDefinition): Card;
export function compareRanks(deck: DeckDefinition, a: Rank, b: Rank): number;

export const FRENCH_52: DeckDefinition;
export const SPANISH_40: DeckDefinition;
export function buildDeck(deck: DeckDefinition, players: number): Card[];
```

Deck sizes `buildDeck` must produce: `french-52` → 52 for any player count; `spanish-40` → 36 for 3 players, 40 for 4, 40 for 5, 36 for 6, 40 for any other count.

### Rules

```ts
export type Bound =
  | number
  | 'max'
  | { min: [number, 'max'] }        // min(n, max)
  | { offset: ['max', number] };    // max + n, n ≤ 0 (e.g. ['max', -1])
export type Segment =
  | { kind: 'range'; from: Bound; to: Bound }                   // inclusive, steps ±1
  | { kind: 'repeat'; cards: Bound; times: number | 'players' };
export type HandSequenceSpec = Segment[];

export type ScoringSpec =
  | { kind: 'bonus-plus-tricks'; bonus: 10; perTrick: 1; missedPerTrick: 1 }
  | { kind: 'bonus-plus-bid'; bonus: 10 }
  | { kind: 'spanish'; bonus: 10; perTrick: 5; missPenaltyPerTrick: 5 };

export type PresetId = 'argentina-fidepo' | 'spain-ludoteka' | 'gamerules' | 'mexico-bazas';

export interface RuleSet {
  id: PresetId;
  deck: DeckDefinition;
  players: { min: number; max: number };
  handSequence: HandSequenceSpec;
  trump: { source: 'next-stock-card-or-dealer-last' };
  bidding: { dealerRestriction: boolean; dealerRestrictionExemptCardCounts: number[] };
  play: {
    mustFollowSuit: true;
    mustTrumpWhenVoid: true;
    mustBeatLedSuit: boolean;
    beatNotRequiredAfterTrumped: boolean;
    mustOvertrump: boolean;
    whenCannotOvertrump: 'any-trump' | 'any-card';
  };
  scoring: ScoringSpec;
  tieBreak: 'fewest-misses' | 'shared';
}

export const PRESET_IDS: readonly PresetId[];
export const DEFAULT_PRESET_ID: 'argentina-fidepo';
export class UnknownPresetError extends Error {}
export function getPreset(id: string): RuleSet;
```

Schema constraints beyond the types: `Bound` numbers are integers ≥ 1; `offset` n is an integer ≤ 0; `repeat.times` number is an integer ≥ 1.

### Preset values

| Field | argentina-fidepo | spain-ludoteka | gamerules | mexico-bazas |
|---|---|---|---|---|
| deck | `FRENCH_52` | `SPANISH_40` | `FRENCH_52` | `FRENCH_52` |
| players | 3–6 | 3–6 | 3–7 | 3–7 |
| handSequence | `range max→5`, `repeat 4 × players`, `range 5→max` | `range 1→{offset:['max',-1]}`, `repeat max × players`, `range {offset:['max',-1]}→1` | `range {min:[10,'max']}→1`, `range 2→{min:[10,'max']}` | `range 3→6`, `repeat 7 × players`, `range 6→3` |
| trump.source | `next-stock-card-or-dealer-last` | same | same | same |
| bidding.dealerRestriction | `true` | `true` | `true` | `true` |
| bidding.dealerRestrictionExemptCardCounts | `[]` | `[1]` | `[]` | `[]` |
| play.mustFollowSuit / mustTrumpWhenVoid | `true` / `true` | `true` / `true` | `true` / `true` | `true` / `true` |
| play.mustBeatLedSuit | `false` | `true` | `false` | `true` |
| play.beatNotRequiredAfterTrumped | `false` (unused) | `false` | `false` (unused) | `true` |
| play.mustOvertrump | `false` | `true` | `false` | `true` |
| play.whenCannotOvertrump | `any-trump` (unused) | `any-trump` | `any-trump` (unused) | `any-trump` |
| scoring | `bonus-plus-tricks` 10/1/1 | `spanish` 10/5/5 | `bonus-plus-bid` 10 | `spanish` 10/5/5 |
| tieBreak | `fewest-misses` | `fewest-misses` | `fewest-misses` | `fewest-misses` |

"(unused)": the engine ignores this flag because `mustBeatLedSuit` / `mustOvertrump` is `false`; the value is fixed so the preset stays fully explicit (BR-101).

Intended hand counts (informative; expansion and its tests belong to Phase 2): argentina-fidepo 29/22/17/14 for 3/4/5/6 players; spain-ludoteka 25/22/19/16 for 3/4/5/6 (max 12/10/8/6); gamerules 19/19/19/15/13 for 3/4/5/6/7 (start 10/10/10/8/7); mexico-bazas 11/12/13/14/15 for 3/4/5/6/7.

### Game state, moves, events (design §4.4–4.7; schemas in `schemas.ts`)

```ts
export type Phase = 'bidding' | 'playing' | 'game-over';
export interface SeatInfo { seat: number; playerId: string; name: string; kind: 'human' | 'ai'; strategy?: string }
export interface TrickPlay { seat: number; card: Card }
export interface HandState {
  cardsPerPlayer: number;
  dealer: number;
  trumpCard: Card;
  trumpCardInDealerHand: boolean;
  trumpSuit: Suit;
  hands: Card[][];
  bids: (number | null)[];
  tricksWon: number[];
  currentTrick: { leader: number; plays: TrickPlay[] };
  lastTrick?: { winner: number; plays: TrickPlay[] };
  toAct: number;
}
export interface HandResult {
  handIndex: number; cardsPerPlayer: number; dealer: number; trumpSuit: Suit; bids: number[]; tricks: number[];
}
export interface GameState {
  schemaVersion: 1;
  gameId: string;
  rules: RuleSet;
  handPlan: number[];
  seats: SeatInfo[];
  seed: string;
  aiDecisionCount: number;
  phase: Phase;
  handIndex: number;
  hand: HandState | null;
  completedHands: HandResult[];
  version: number;
}

export type Move = { type: 'bid'; seat: number; tricks: number } | { type: 'play'; seat: number; card: Card };
export interface LegalMove { id: string; move: Move }      // "bid:3", "play:QH"

export type GameEvent =
  | { type: 'game-started'; seats: SeatInfo[]; handPlan: number[] }
  | { type: 'hand-dealt'; handIndex: number; dealer: number; cardsPerPlayer: number; trumpCard: Card; trumpCardInDealerHand: boolean }
  | { type: 'bid-made'; seat: number; tricks: number }
  | { type: 'card-played'; seat: number; card: Card }
  | { type: 'trick-won'; seat: number; trickNumber: number }
  | { type: 'hand-completed'; handIndex: number; result: HandResult }
  | { type: 'game-over' };

export interface Transition { state: GameState; events: GameEvent[] }
export interface Rng { int(min: number, max: number): number; shuffle<T>(items: readonly T[]): T[] }  // int inclusive; shuffle returns a new array
```

Schema notes: optional fields in the schemas are exactly `SeatInfo.strategy` and `HandState.lastTrick`. `trickNumber` is an integer ≥ 1; `cardsPerPlayer` ≥ 1; every other count/index is an integer ≥ 0.

### Score, view and player types (types only; behavior in Phases 2–4)

```ts
export interface HandScore { handIndex: number; perSeat: { seat: number; bid: number; tricks: number; made: boolean; points: number }[] }
export interface ScoreBoard {
  hands: HandScore[];
  totals: number[];
  madeCount: number[];
  missedCount: number[];
  live?: { seat: number; bid: number | null; tricksWon: number; status: 'on-track' | 'made-so-far' | 'busted' }[];
  ranking: { seat: number; total: number; place: number }[];
}
export interface TableView {
  gameId: string; version: number; phase: Phase;
  you: number | null;
  seats: { seat: number; name: string; kind: 'human' | 'ai'; cardCount: number; bid: number | null; tricksWon: number }[];
  handIndex: number; handPlan: number[];
  dealer: number; toAct: number | null;
  trumpCard: Card | null;
  trumpCardInDealerHand: boolean;
  yourHand: Card[];
  currentTrick: TrickPlay[];
  lastTrick: { winner: number; plays: TrickPlay[] } | null;
}
export interface PlayerView extends TableView {
  scoreboard: ScoreBoard;
  finalRanking?: { seat: number; total: number; place: number }[];
}
export interface PlayerUpdate { version: number; events: GameEvent[]; view: PlayerView; legalMoves: LegalMove[] }
export interface DecisionContext { view: PlayerView; legalMoves: LegalMove[]; rng: Rng }
export type Decision = { type: 'move'; moveId: string } | { type: 'await' };
```

`ScoreBoard.live[].bid` is `number | null` because during bidding some seats have not bid yet (design §6.1 leaves it untyped).

## Verification Criteria

### Cards and ranks
- **VC-101** (FR-101, BR-105): `cardId` of `{rank:'7',suit:'H'}`, `{rank:'10',suit:'S'}`, `{rank:'3',suit:'O'}`, `{rank:'C',suit:'C'}` → `"7H"`, `"10S"`, `"3O"`, `"CC"`.
- **VC-102** (FR-102): for both decks, every card from `buildDeck(deck, 4)` round-trips: `parseCard(cardId(c), deck)` deep-equals `c`; `parseCard('10S', FRENCH_52)` → `{rank:'10',suit:'S'}`; `parseCard('CC', SPANISH_40)` → `{rank:'C',suit:'C'}`.
- **VC-103** (FR-103): each of `''`, `'H'`, `'10'`, `'1H'`, `'7h'`, `'3O'` with `FRENCH_52`, and `'KO'`, `'10O'`, `'7H'` with `SPANISH_40` → throws `InvalidCardError` whose message contains the input.
- **VC-104** (FR-104): `compareRanks(FRENCH_52,'A','K') > 0`, `('2','3') < 0`, `('10','J') < 0`, `('Q','Q') === 0`; `compareRanks(SPANISH_40,'3','R') > 0`, `('A','3') > 0`, `('S','7') > 0`, `('2','4') < 0`; for each deck, sorting its ranks with `compareRanks` descending reproduces `ranksHighToLow`.
- **VC-105** (FR-105): `compareRanks(SPANISH_40,'K','A')` and `compareRanks(FRENCH_52,'R','A')` → throw `InvalidCardError`.

### Decks
- **VC-106** (FR-106, FR-107): `FRENCH_52` and `SPANISH_40` deep-equal the definitions in FR-106/FR-107 (`removeRanksForPlayers` = `{}` and `{ '3': ['2'], '6': ['2'] }`).
- **VC-107** (FR-108): `buildDeck(FRENCH_52, n).length` = 52 for n ∈ {3,4,5,6,7}; `buildDeck(SPANISH_40, n).length` = 36, 40, 40, 36 for n = 3, 4, 5, 6; no card id appears twice in any result; `SPANISH_40` with 3 and 6 players contains no rank `2`; the first three cards of `buildDeck(FRENCH_52, 4)` are `AS`, `KS`, `QS`; mutating a returned array does not change the next call's result.
- **VC-108** (FR-109): `buildDeck(FRENCH_52, 0)`, `(…, -1)`, `(…, 2.5)`, `(…, NaN)` → throw `RangeError`.

### Rules and presets
- **VC-109** (FR-110): `PRESET_IDS` deep-equals `['argentina-fidepo','spain-ludoteka','gamerules','mexico-bazas']`; `DEFAULT_PRESET_ID === 'argentina-fidepo'`.
- **VC-110** (FR-111, BR-101, BR-102): for each preset id, `getPreset(id)` deep-equals a literal expected object written in the test from the Preset values table (all fields, including the "(unused)" values and the exact `handSequence` segments).
- **VC-111** (FR-112): `const a = getPreset('gamerules'); a.players.max = 99; a.handSequence.push({kind:'repeat',cards:1,times:1});` → `getPreset('gamerules').players.max === 7` and its `handSequence` has 2 segments.
- **VC-112** (FR-113): `getPreset('foo')` and `getPreset('')` → throw `UnknownPresetError`; the first message contains `foo`.
- **VC-113** (FR-114, BR-103): for each preset, `RuleSetSchema.parse(preset)` deep-equals the preset, and `JSON.parse(JSON.stringify(preset))` deep-equals the preset.

### Schemas
- **VC-114** (FR-115): starting from a valid preset, each mutation → `RuleSetSchema.safeParse` fails: `players.min = 1`; `players = {min:5,max:4}`; `players.max = 4.5`; delete `tieBreak`; delete `deck.removeRanksForPlayers`; add `play.extra = true`; `play.mustFollowSuit = false`; `dealerRestrictionExemptCardCounts = [0]`; `deck.suits = []`; `deck.ranksHighToLow = ['A','A']`; `deck.removeRanksForPlayers = {'x':['2']}`; `{'03':['2']}`; `{'0':['2']}`; `deck.removeRanksForPlayers = {'3':['Z']}`; a segment `{kind:'range',from:0,to:5}`; a bound `{offset:['max',1]}`; `scoring.bonus = 11`. And `{offset:['max',-1]}`, `{min:[10,'max']}`, `'max'` bounds → succeed.
- **VC-115** (FR-116): a hand-built valid `GameState` fixture (3 seats, `phase: 'playing'`, a `hand` with one card in `currentTrick` and a `lastTrick`, one `completedHands` entry, seat 2 with `strategy: 'random'`) → parses and deep-equals itself; the same with `hand: null` and `phase: 'game-over'` → parses. Each mutation fails: `schemaVersion: 2`; `phase: 'dealing'`; `version: -1`; `aiDecisionCount: 1.5`; `seed: ''`; delete `hand`; `hand.bids[0] = -1`; a card `{suit:'X',rank:'A'}`; a card `{suit:'H',rank:'1'}`; an extra top-level key `foo`; an extra key in a seat.
- **VC-116** (FR-117): one valid example per event type parses; `{type:'unknown'}`, `{type:'bid-made',seat:0}` (missing `tricks`), `{type:'game-over',extra:1}`, `{type:'trick-won',seat:0,trickNumber:0}` → fail.
- **VC-117** (FR-118, FR-119): `tests/unit/domain/types.test.ts` imports every type and value named in the Module exports table from its listed module, and inside a `test()` uses Vitest `expectTypeOf` to assert that each FR-118 type is not `any` and that `GameState['version']` is `number`, `RuleSet['id']` is `PresetId`, `Card` equals `{ suit: string; rank: string }` and `GameEvent['type']` is the union of the seven event names; `pnpm test` and `pnpm typecheck` exit 0. A grep of `src/domain` shows each FR-118 type defined via `z.infer`.

### Design docs
- **VC-118** (FR-120): `docs/design.md` §4.1 shows `removeRanksForPlayers: Record<string, Rank[]>` without `?`; §4.2's `RuleSet` has `id: PresetId`; §4.3 contains the `offset` bound in its `Bound` type and lists the four preset sequences matching the Preset values table; §4.2's table shows `1→max−1, N×max, max−1→1` for spain-ludoteka and `3→6, N×7, 6→3` for mexico-bazas.

### NFR and purity
- **VC-119** (NFR-101, NFR-102, BR-104): on the final tree `pnpm typecheck && pnpm lint && pnpm test` exit 0 with 0 lint warnings, locally and in the branch's CI run; `package.json` `dependencies` keys are `next, react, react-dom, zod`; imports are covered by the spec 00 lint rule, and `grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.' src/domain` finds nothing.

## Open Questions

None.

## Assumptions

- The union of suit letters across both decks is `S H D C O E B` and of rank tokens is `A K Q J 10 9 8 7 6 5 4 3 2 R C S`; the `GameState` card check uses these unions because the schema validates shape, not per-game deck membership (the engine's invariants in Phase 2 check membership).
- `src/config.ts`'s literal preset list stays in sync with `PRESET_IDS` by review; no code link is added in this phase.

## Changelog

- 0.2 (2026-11-22): review pass 1 — types derived from schemas (`z.infer`), module exports table, design §4.1/§4.2 alignment, `removeRanksForPlayers` key format, dropped CI timing budget, widened purity grep.
- 0.1 (2026-11-22): initial draft from implementation.md Phase 1 and discovery answers (exactly N top-count hands for Spain/Mexico via `offset` bound; persistence types deferred to Phase 6).
