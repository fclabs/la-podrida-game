# Frozen: Spec 01 — Domain Model

Source: specs/01-domain-model.md (plan + build record: specs/01-domain-model-plan.md, specs/01-domain-model-plan-artifacts/)
Status: SHIPPED
Frozen: 2026-11-22
PR / commit: https://github.com/fclabs/la-podrida-game/pull/2 — squash commit 050f441

## Purpose
Every later layer (engine, score, players, state, service, API, UI) speaks the same vocabulary: cards, decks, rule sets, presets, game state, moves and events. This spec defines that vocabulary once, in `src/domain`, as pure TypeScript types, a few pure helpers (card ids, rank order, deck building) and Zod schemas that later phases reuse to validate persisted data. It also pins the four rule presets with every field set, so the engine (Phase 2) and score engine (Phase 3) are driven by configuration rather than special cases. It benefits the developers who build Phases 2–9, who can then rely on one checked definition instead of re-deriving it from the design docs.

## What it does
- `cardId(card)` returns rank token + suit letter (`"10S"`, `"CC"`); a card's identity is its id (move ids like `play:QH` and Phase 2 invariants rely on it).
- `parseCard(id, deck)` takes the last character as suit and the rest as rank and returns the card if both belong to the deck; otherwise (empty, no rank, wrong case, foreign suit/rank) it throws `InvalidCardError` naming the input.
- `compareRanks(deck, a, b)` orders by `deck.ranksHighToLow` (positive = `a` higher) and throws `InvalidCardError` for a rank not in the deck.
- `FRENCH_52` (suits `S H D C`, `A K Q J 10…2`, no removals) and `SPANISH_40` (suits `O C E B`, `A 3 R C S 7 6 5 4 2`, rank `2` removed for 3 and 6 players) are deeply frozen.
- `buildDeck(deck, players)` returns a new array of suit × rank minus removed ranks, ordered by suit (deck order) then rank high→low (`french-52` starts `AS KS QS`); non-integer or < 1 `players` throws `RangeError`.
- `PRESET_IDS` = `argentina-fidepo, spain-ludoteka, gamerules, mexico-bazas`; `DEFAULT_PRESET_ID` = `argentina-fidepo`.
- `getPreset(id)` returns an independent deep copy of the preset (mutating it never affects later calls); unknown ids, including prototype keys like `__proto__`, throw `UnknownPresetError` naming the id. Every preset round-trips through `RuleSetSchema` and JSON unchanged.
- `RuleSetSchema` is strict at every level with no optional fields: `2 ≤ players.min ≤ players.max` integers, positive exempt card counts, `removeRanksForPlayers` keys matching `^[1-9][0-9]*$` (strings, never coerced) with values from the same deck, non-empty duplicate-free suits and ranks.
- `GameStateSchema` is strict at every level: `schemaVersion: 1`, phase `bidding | playing | game-over`, non-negative integer counts/indexes, non-empty `seed`, `hand` required (possibly `null`); cards are checked against the union of both decks' suits/ranks (per-game deck membership is a Phase 2 invariant).
- `GameEventSchema` is a strict discriminated union on `type` over the seven events.
- The 13 persisted types are `z.infer` of their schemas, never hand-written; each type and value is imported from its own module (`@/src/domain/<module>`), with no barrel `index.ts`.
- `docs/design.md` §4.1–4.3 matches this spec (required `removeRanksForPlayers`, `id: PresetId`, the `offset` bound, preset sequences and hand counts); `docs/development.md` §9 documents the domain for developers.

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

## Key decisions
- Every preset field is explicit, including flags its other flags make irrelevant ("(unused)"): presets stay comparable and diffable (design §4.2).
- Spain and Mexico play exactly `players` hands at their top card count; their ramps stop one card short, expressed with the new `{ offset: ['max', -1] }` bound. This was an operator decision (2026-11-22). Argentina's 5-card hands bracket the 4-card block (29/22/17/14 hands); gamerules' turning 1-card hand appears once.
- Rules are plain JSON data (no functions, classes or `undefined`) because rule sets are frozen into each game's state and persisted.
- Schemas are the single source of truth for persisted shapes (`z.infer`): one definition can't drift, and the cost is less readable type hovers.
- `Suit`/`Rank` are `string` (schema refinements, not `z.enum`): decks are data, not types.
- `GameState` card validation uses the union of both decks, because the schema checks shape and the engine checks per-game membership.

## Known limits (still true at freeze)
- `src/domain` is pure: no I/O, no randomness, no `Date`, and it imports only `zod` (the lint rule also allows `@noble/hashes`). Runtime `dependencies` are `next, react, react-dom, zod`.
- `src/config.ts`'s `DEFAULT_RULES_PRESET` check is a literal list, kept in sync with `PRESET_IDS` by review only.
- The view, score and player types (`HandScore`, `ScoreBoard`, `TableView`, `PlayerView`, `PlayerUpdate`, `DecisionContext`, `Decision`, `Move`, `LegalMove`, `Transition`, `Rng`) are hand-written types with no behavior yet; Phases 2–4 implement them.
- The hand counts in the Preset values table are informative: expanding `HandSequenceSpec` into `handPlan` and its fixtures belong to Phase 2.

## Deliberately excluded
- Hand-plan expansion, dealing, legal moves, transitions, views, invariants and the RNG (Phase 2); scoring (Phase 3); players (Phase 4); persistence types `GameMeta`/`Commit`/`CommitBody` (Phase 6); preset descriptions for the API (Phase 8).
- Spanish 7–8 player decks, the 8/9-card extension, Stay-and-Play rank order, special hands, Pocha bonuses (design §11).
