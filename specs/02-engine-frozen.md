# Frozen: Spec 02 — Game Engine

Source: specs/02-engine.md (plan + build record: specs/02-engine-plan.md, specs/02-engine-plan-artifacts/; review: specs/02-engine.review.md)
Status: SHIPPED
Frozen: 2026-11-22
PR / commit: https://github.com/fclabs/la-podrida-game/pull/3 — squash commit 349fc8c

## Purpose
The domain model (spec 01) defines the vocabulary of a La Podrida game, but nothing yet plays one. This spec delivers the Game Engine in `src/engine`: pure, deterministic functions that create a game from a rule set, seats and a secret seed; deal every hand from seeded random streams; list the legal bids and plays for the seat to act under every preset's rules; apply a move and run the automatic transitions (bidding closed, trick won, hand completed, next deal, game over) with their events; build a per-seat table view that hides other hands; and check the game's invariants. It benefits the developers of Phases 3–9 (score engine, players and simulator, service, API, UI), who get one rules implementation that is replayable from a seed and an event log and is driven entirely by the `RuleSet`.

## What it does

**Random streams**
- `rngFromSource(next)` builds an `Rng` that draws only from `next`. `int(min, max)` uses rejection sampling (`limit = floor(2^32/range)·range`, return `min + u mod range`) and throws `RangeError` when an argument is not an integer, when `min > max`, or when the range is larger than 2^32. `shuffle` is a non-mutating Fisher–Yates (`i` from `len−1` down to 1, `j = int(0, i)`).
- `createXoshiro128ss(words)` is reference `xoshiro128**`. The state `(1,2,3,4)` gives `11520, 0, 5927040, 70819200, …`, and an all-zero state is replaced by `(0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x6a09e667)`.
- `deriveRng(seed, ...labels)` seeds xoshiro with the first 16 bytes of `SHA-256(UTF-8(JSON.stringify([seed, ...labels])))`, read as four little-endian uint32 values (`@noble/hashes`).
- There are exactly two kinds of stream. The deal stream for hand `i` is `deriveRng(seed, 'deal', i)`. `aiRng(state, seat)` is `deriveRng(state.seed, 'ai', seat, state.aiDecisionCount)`, and the engine itself never draws from it.

**Hand sequence**
- `maxCardsPerPlayer(deck, n)` = `floor(buildDeck(deck, n).length / n)`.
- `expandHandSequence(rules, n)` resolves the bounds (`'max'`, `{min:[n,'max']}`, `{offset:['max',n]}`, `times:'players'`) and concatenates the segments: a `range` contributes every count from `from` to `to` inclusive, a `repeat` contributes `cards` exactly `times` times. It returns the Hand plans table exactly. When `n` is outside `rules.players`, or any count is `< 1` or `> max`, it throws `RangeError` naming the value.

**Creation and dealing**
- `createGame` validates its input and throws `InvalidGameSetupError` listing every problem: bad rules, player count out of range, `seats[i].seat !== i`, invalid seat, duplicate `playerId`, empty `gameId`, empty `seed`, failed sequence expansion. Each cause is reported once, and checks that depend on a failed check are skipped.
- On valid input it returns a state with `schemaVersion 1`, deep copies of `rules` and `seats`, `handPlan`, `aiDecisionCount 0`, `version 0`, `phase 'bidding'`, `handIndex 0`, `completedHands []` and hand 0 dealt. The events are `[game-started, hand-dealt]`.
- The hand-0 dealer is `int(0, N−1)`, drawn from the hand-0 deal stream **before** the shuffle. Each later dealer is `(prev + 1) mod N`.
- To deal, the stream shuffles `buildDeck(rules.deck, N)` and shuffled card `k` goes to seat `(dealer + 1 + k) mod N`. The trump card is the next stock card (`N·c`, not in any hand), or the dealer's last card (`N·c − 1`, `trumpCardInDealerHand true`) when the whole deck is dealt.
- A new hand has `trumpSuit = trumpCard.suit`, hands sorted by deck suit order and then rank high→low, bids `null`, `tricksWon` 0, and no `lastTrick`. *Mano* (`next(dealer)`) acts first and leads.

**Turn order and legal moves**
- `currentActor` returns `null` at game over and `hand.toAct` otherwise. A seat that isn't an integer in `0…N−1` makes `legalMoves`, `applyMove` and `tableViewFor` throw `RangeError` (checked first, in every phase). For any non-acting seat, `legalMoves` returns `[]`.
- Bids are `bid:<n>` for each value from `legalBids`, ascending. `legalBids` returns `0…cardsPerPlayer`, minus the dealer's forbidden value `cardsPerPlayer − sum(others)` when `dealerRestriction` is on and the card count is not exempt.
- Plays are `play:<cardId>` for each card from `legalPlays`, in hand order. `legalPlays` implements design §5.4: all cards on an empty trick; follow the led suit (beating the highest led-suit card when `mustBeatLedSuit` applies, a requirement waived when `beatNotRequiredAfterTrumped` is set and a trump is on the table but the led suit is not trump); when void, play trumps (when a trump is on the table and `mustOvertrump` is set, only higher trumps, falling back to `whenCannotOvertrump`: `any-trump` or `any-card`); when void with no trumps, play any card.
- `trickWinner` returns the seat of the highest trump played, or else the seat of the highest card of the led suit.

**Applying moves**
- `applyMove` throws `IllegalMoveError` with reason `game-over`, `not-your-turn` or `unknown-move` (checked in that order; the message names the seat and the move id). It works on one `structuredClone`, so the input is never mutated and nothing is shared with it. It increments `aiDecisionCount` only for AI seats and never changes `version`.
- A bid emits `bid-made`, and the dealer's bid moves the hand to `playing` with *mano* to act. A play emits `card-played`. A completed trick emits `trick-won { seat, trickNumber }` (1-based within the hand), and the winner leads the next trick. A completed hand appends `HandResult { handIndex, cardsPerPlayer, dealer, trumpSuit, bids, tricks }` and emits `hand-completed`, followed by either `hand-dealt` for the next hand or `game-over` (`hand: null`, `handIndex` stays at the last hand).
- Events from one call always come in the order `bid-made|card-played`, `trick-won`, `hand-completed`, `hand-dealt|game-over`. Tests check that every state and event parses with its schema; the engine itself doesn't run Zod inside `applyMove`.

**View and invariants**
- `tableViewFor(state, seat | 'spectator')` returns a fresh `TableView`: state metadata, per-seat `{seat, name, kind, cardCount, bid, tricksWon}`, dealer, trump, the viewer's own hand (`[]` for a spectator), the current trick and the last trick. At game over everything is zeroed or `null`, and `dealer` is the last completed hand's dealer.
- `checkInvariants(state)` returns one message per violated rule. It first checks structure (s), then (a) no duplicate cards, (b) every card is in the game's deck, (c) hand sizes, (d) every bid is set in `playing`, (e) the dealer restriction holds once bidding has closed, (f) the actor has a legal move, (g) `hand` is `null` iff the game is over, (h) `cardsPerPlayer` matches `handPlan`, and (i) the `completedHands` count. It skips checks that can't run on broken data, never throws on a schema-valid state, and doesn't mutate its input.
- `ENGINE_VERSION = 1`. `docs/design.md` §4.4–4.5 and `docs/development.md` §10 (Engine) document all of the above.

**Business rules**
- **Determinism (BR-201):** the same input and the same `(seat, moveId)` sequence produce deep-equal states and events.
- **Deals ignore AI choices (BR-202):** hand `i`'s deal depends only on the seed, `i`, the rules, `N` and the hand-0 dealer.
- **Only legal moves (BR-203):** moves are accepted only by the id of a currently legal move, so a revoke or a forbidden dealer bid can't happen.
- **The engine never scores (BR-204):** there are no points, totals or rankings in state, events or views.
- **Information hiding (BR-205):** views and events reveal no hidden card except the shown trump. Views also omit the seed, the rules and `aiDecisionCount`.
- **Purity (BR-206):** no I/O, no ambient randomness or time; the engine imports only `src/domain`, `zod` and `@noble/hashes`.

## Data & Interfaces

### Module exports

| Module | Exports |
|---|---|
| `src/engine/rng.ts` | `rngFromSource(next: () => number): Rng`; `createXoshiro128ss(words: readonly [number, number, number, number]): Rng`; `deriveRng(seed: string, ...labels: (string \| number)[]): Rng` |
| `src/engine/sequence.ts` | `maxCardsPerPlayer(deck: DeckDefinition, players: number): number`; `expandHandSequence(rules: RuleSet, players: number): number[]` |
| `src/engine/bidding.ts` | `legalBids(hand: HandState, seat: number, rules: RuleSet): number[]` |
| `src/engine/play.ts` | `legalPlays(hand: HandState, seat: number, rules: RuleSet, deck: DeckDefinition): Card[]` |
| `src/engine/trick.ts` | `trickWinner(plays: readonly TrickPlay[], trumpSuit: Suit, deck: DeckDefinition): number` |
| `src/engine/engine.ts` | `ENGINE_VERSION`; `IllegalMoveError`; `InvalidGameSetupError`; `createGame`; `currentActor`; `legalMoves`; `applyMove`; `aiRng` |
| `src/engine/view.ts` | `tableViewFor(state: GameState, seat: number \| 'spectator'): TableView` |
| `src/engine/invariants.ts` | `checkInvariants(state: GameState): string[]` |

No barrel `index.ts` (same convention as spec 01). Domain types come from their spec-01 modules.

### `engine.ts`

```ts
export const ENGINE_VERSION = 1;

export type IllegalMoveReason = 'game-over' | 'not-your-turn' | 'unknown-move';
export class IllegalMoveError extends Error {
  readonly reason: IllegalMoveReason;
  readonly seat: number;
  readonly moveId: string;
}
export class InvalidGameSetupError extends Error {
  readonly problems: string[];      // one entry per failed check (FR-211); message joins them
}

export interface CreateGameInput { gameId: string; rules: RuleSet; seats: SeatInfo[]; seed: string }
export function createGame(input: CreateGameInput): Transition;
export function currentActor(state: GameState): number | null;
export function legalMoves(state: GameState, seat: number): LegalMove[];
export function applyMove(state: GameState, seat: number, moveId: string): Transition;
export function aiRng(state: GameState, seat: number): Rng;   // deriveRng(state.seed, 'ai', seat, state.aiDecisionCount)
```

Move ids: `bid:<n>` (decimal, no padding) and `play:<cardId>` (spec 01 `cardId`, e.g. `play:10S`).

### Hand plans

| Preset | Players | max | handPlan |
|---|---|---|---|
| argentina-fidepo | 3 | 17 | 17→5 (13 hands), 4×3, 5→17 (13) — 29 |
| argentina-fidepo | 4 | 13 | 13→5 (9), 4×4, 5→13 (9) — 22 |
| argentina-fidepo | 5 | 10 | 10→5 (6), 4×5, 5→10 (6) — 17 |
| argentina-fidepo | 6 | 8 | 8→5 (4), 4×6, 5→8 (4) — 14 |
| spain-ludoteka | 3 | 12 | 1→11 (11), 12×3, 11→1 (11) — 25 |
| spain-ludoteka | 4 | 10 | 1→9 (9), 10×4, 9→1 (9) — 22 |
| spain-ludoteka | 5 | 8 | 1→7 (7), 8×5, 7→1 (7) — 19 |
| spain-ludoteka | 6 | 6 | 1→5 (5), 6×6, 5→1 (5) — 16 |
| gamerules | 3 | 17 | 10→1 (10), 2→10 (9) — 19 |
| gamerules | 4 | 13 | 10→1 (10), 2→10 (9) — 19 |
| gamerules | 5 | 10 | 10→1 (10), 2→10 (9) — 19 |
| gamerules | 6 | 8 | 8→1 (8), 2→8 (7) — 15 |
| gamerules | 7 | 7 | 7→1 (7), 2→7 (6) — 13 |
| mexico-bazas | 3 | 17 | 3→6 (4), 7×3, 6→3 (4) — 11 |
| mexico-bazas | 4 | 13 | 3→6 (4), 7×4, 6→3 (4) — 12 |
| mexico-bazas | 5 | 10 | 3→6 (4), 7×5, 6→3 (4) — 13 |
| mexico-bazas | 6 | 8 | 3→6 (4), 7×6, 6→3 (4) — 14 |
| mexico-bazas | 7 | 7 | 3→6 (4), 7×7, 6→3 (4) — 15 |

`a→b` is the inclusive range; `c×k` is `c` repeated `k` times. Tests list each plan as a full literal array. gamerules has exactly one 1-card hand; argentina's 5-card hands appear once on each side of the 4-card block.

## Key decisions
- **`JSON.stringify` framing of the stream labels**: it's unambiguous (`('s','deal',1)` ≠ `('s','deal','1')`). Never "simplify" it to string joining.
- **First dealer drawn from the hand-0 deal stream before the shuffle, and separate AI streams keyed by `aiDecisionCount`**: changing an AI strategy never changes the cards (BR-202).
- **`ENGINE_VERSION` bump rule**: any change to the deals or move outcomes for an existing seed and move sequence bumps it by 1, because stored games replay only on the engine version that created them. `tests/unit/engine/golden.test.ts` holds literal fixtures that act as the tripwire (deal, sort, French-deck trick path only). Bump `ENGINE_VERSION` and `GOLDEN_ENGINE_VERSION` together before changing those literals.
- **One `structuredClone` per `applyMove`**: this is the simplest way to guarantee no mutation and no shared objects. Moves, events and views also carry card *copies*, never state objects (D-003, D-007).
- **Moves by id only**: callers pick from `legalMoves`, so rule violations can't be expressed.
- **Engine has no Zod in the hot path**: only `createGame` parses its input. Schema validity of states and events is a property the tests check.
- **`createGame` problem granularity (D-004)**: one problem per bad seat or duplicated `playerId`, in the order rules → player range → expansion → seats → duplicates → `gameId` → `seed`.
- **Invariant check details**: (e) runs only when every bid is set (D-008). (f) is skipped when (a) or (b) fails or when `cardsPerPlayer` exceeds the deck (D-009). Messages start with `(<tag>) `.
- **Rationale for BR-201 to BR-206**: replay from seed + event log (design §7), the layer rule from spec 00 (the engine runs in tests, the simulator and serverless functions), and keeping scoring in Phase 3.

## Known limits (still true at freeze)
- **NFR-203**: a 3-player `argentina-fidepo` game (≈981 moves, first legal move each time) takes < 250 ms median in CI, about 45 ms measured locally. Callers can assume well under 1 ms per move.
- **NFR-202**: runtime `dependencies` are exactly `next, react, react-dom, zod, @noble/hashes` (`2.4.0`, exact pin).
- `legalPlays` and `trickWinner` assume the cards belong to `deck` (otherwise `compareRanks` throws) and don't validate seat or turn. `trickWinner([])` throws `RangeError` (D-002).
- `checkInvariants` doesn't check card conservation across a hand, because the stock isn't stored. The Phase 4 simulator must keep that ledger from the `hand-dealt` and `card-played` events.
- With the first-legal-move policy every bid is `0`. Use `lastMove` (test helper `playGame`, D-005) to get non-trivial bids.
- `view.ts` keeps a private copy of the seat-range check (D-006).
- **Hand-off**: the Score Engine reads `completedHands`, and `state.hand` for `live` status; it never calls the engine. Replay is `createGame` followed by applying every `bid-made` (`bid:<n>`) and `card-played` (`play:<cardId>`) event in order. Persistence stores `ENGINE_VERSION` with each game and sets `version` per commit.

## Deliberately excluded
- Scoring, scoreboards, rankings and `live` status (Phase 3). `PlayerView`, players and strategies, the AI loop, the simulator and the card-conservation ledger (Phase 4). Seed generation, persistence and `version` per commit (Phases 6–7).
- Bid changes, revokes (*renuncio*), target-score endings, tie-break hands, special hands, Pocha bonuses, and clockwise/counter-clockwise presentation.
