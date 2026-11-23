# Spec 02 — Game Engine

> Version: 0.2 · Last updated: 2026-11-22 · Status: Draft · Owner: Federico Castañeda
> Source: [`docs/implementation.md`](../docs/implementation.md) §3 Phase 2 (Milestone M1). Context: [`docs/design.md`](../docs/design.md) §3, §4.3–4.7, §5, §7; [`docs/game_rules.md`](../docs/game_rules.md) §2, §3.3–3.6; [`docs/architecture.md`](../docs/architecture.md) §3, §13.
> Builds on: [`specs/00-project-scaffold-frozen.md`](./00-project-scaffold-frozen.md) (layer rule: `src/engine` imports only `src/domain`, `zod`, `@noble/hashes`; tests in `tests/unit/**/*.test.ts`) and [`specs/01-domain-model-frozen.md`](./01-domain-model-frozen.md) (all domain types, presets, `buildDeck`, `compareRanks`, `cardId`, schemas).
> Requirement IDs use the 2xx range. Domain types (`GameState`, `HandState`, `Transition`, `Rng`, `TableView`, `LegalMove`, `GameEvent`, …) are used exactly as frozen in spec 01 and are not redefined here.

## Purpose

The domain model (spec 01) defines the vocabulary of a La Podrida game, but nothing yet plays one. This spec delivers the Game Engine in `src/engine`: pure, deterministic functions that create a game from a rule set, seats and a secret seed; deal every hand from seeded random streams; list the legal bids and plays for the seat to act under every preset's rules; apply a move and run the automatic transitions (bidding closed, trick won, hand completed, next deal, game over) with their events; build a per-seat table view that hides other hands; and check the game's invariants. It benefits the developers of Phases 3–9 (score engine, players and simulator, service, API, UI), who get one rules implementation that is replayable from a seed and an event log and is driven entirely by the `RuleSet`.

## Scope

**In**
- `src/engine/rng.ts`: `xoshiro128**` PRNG implementing `Rng`, and `deriveRng(seed, ...labels)` using SHA-256 from `@noble/hashes`.
- `src/engine/sequence.ts`: expansion of a `HandSequenceSpec` into a `handPlan`.
- `src/engine/bidding.ts`: legal bids, including the dealer restriction and its exemptions.
- `src/engine/play.ts`: legal plays for every play-flag combination.
- `src/engine/trick.ts`: trick winner.
- `src/engine/engine.ts`: `createGame`, `currentActor`, `legalMoves`, `applyMove`, dealing, the automatic transitions and events, `IllegalMoveError`, `InvalidGameSetupError`, `ENGINE_VERSION`.
- `src/engine/view.ts`: `tableViewFor`.
- `src/engine/invariants.ts`: `checkInvariants`.
- Adding `@noble/hashes` as a runtime dependency.
- Updating `docs/design.md` (§4.4, §4.5) and `docs/development.md` (a new Engine section) to match this spec.
- Unit tests in `tests/unit/engine/`.

**Out**
- Scoring, scoreboards, rankings, `live` status (Phase 3). The engine never imports `src/score`.
- `PlayerView`, players, strategies, the AI loop, the simulator, `tests/sim`, the card-conservation ledger and full replay tests (Phase 4). This phase only guarantees the replay property at engine level (VC-231).
- Seed generation (`crypto.randomBytes`), persistence, setting `version` per commit (Phases 6–7).
- Bid changes after they are made, revokes (*renuncio*), target-score endings, extra tie-break hands, special hands, Pocha bonuses (design §11).
- Clockwise/counter-clockwise presentation (UI concern; seats are abstract indexes).

## Actors

| Actor | Description | Permissions |
|---|---|---|
| GameService (Phase 7) | Creates games with a server-generated seed, applies moves, builds views | Calls every exported engine function |
| Simulator and tests (Phase 4, this phase's tests) | Drive the engine directly with fixed seeds | Calls every exported engine function, including `checkInvariants` |
| Score Engine (Phase 3) | Reads `GameState.completedHands` and the current hand | Reads state only; never calls the engine |

## Functional Requirements

### Random streams

- **FR-200 (Must)** — Given a function `next` returning uint32 values, when `rngFromSource(next)` is called, then it returns an `Rng` whose `int` and `shuffle` (FR-202 to FR-204) draw raw outputs only by calling `next`. `createXoshiro128ss` is `rngFromSource` over the xoshiro128** generator.
- **FR-201 (Must)** — Given four uint32 words, when `createXoshiro128ss(words)` is called, then it returns an `Rng` whose raw 32-bit outputs follow the reference `xoshiro128**` algorithm (`result = rotl(s1 × 5, 7) × 9`), so state `(1, 2, 3, 4)` produces `11520, 0, 5927040, 70819200, 2031721883, 1637235492` as its first six raw outputs. An all-zero state is replaced by `(0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x6a09e667)`.
- **FR-202 (Must)** — Given integers `min ≤ max` with `max − min + 1 ≤ 2^32`, when `rng.int(min, max)` is called, then it returns an integer in `[min, max]` (inclusive) chosen by rejection sampling: with `range = max − min + 1` and `limit = floor(2^32 / range) × range`, it draws raw outputs until one is `< limit` and returns `min + (u mod range)`.
- **FR-203 (Must)** — Given non-integer arguments, `min > max`, or a range above `2^32`, when `rng.int` is called, then it throws `RangeError`.
- **FR-204 (Must)** — Given an array, when `rng.shuffle(items)` is called, then it returns a new array that is a Fisher–Yates permutation of the input (for `i` from `length − 1` down to `1`: `j = int(0, i)`, swap `i` and `j`), and leaves the input unchanged.
- **FR-205 (Must)** — Given a seed string and labels (strings or integers), when `deriveRng(seed, ...labels)` is called, then it returns `createXoshiro128ss(words)` where `words` are the first 16 bytes of `SHA-256(UTF-8(JSON.stringify([seed, ...labels])))`, read as four little-endian uint32; the UTF-8 bytes come from `utf8ToBytes` (`@noble/hashes/utils.js`) and the hash from `sha256` (`@noble/hashes/sha2.js`). Equal inputs always give equal streams. *Why `JSON.stringify`:* it frames labels unambiguously (`('s','deal',1)` never collides with `('s','deal','1')` or a concatenation), so it must not be "simplified" to string joining.
- **FR-206 (Must)** — The engine uses exactly two kinds of stream: the deal stream for hand `i` is `deriveRng(seed, 'deal', i)`; the AI stream helper `aiRng(state, seat)` returns `deriveRng(state.seed, 'ai', seat, state.aiDecisionCount)`. The engine itself never draws from an AI stream, so AI decisions cannot change any deal.

### Hand sequence

- **FR-207 (Must)** — Given a deck definition and a player count, when `maxCardsPerPlayer(deck, players)` is called, then it returns `floor(buildDeck(deck, players).length / players)`.
- **FR-208 (Must)** — Given a `RuleSet` and a player count within `rules.players`, when `expandHandSequence(rules, players)` is called, then it resolves each bound (`number` → itself; `'max'` → max; `{ min: [n, 'max'] }` → `min(n, max)`; `{ offset: ['max', n] }` → `max + n`; `times: 'players'` → `players`) and concatenates the segments: a `range` yields every count from `from` to `to` inclusive in steps of ±1 (one value when equal); a `repeat` yields `cards` exactly `times` times.
- **FR-209 (Must)** — Given each preset and each player count in its `players` range, when `expandHandSequence` is called, then it returns exactly the hand plan in the Hand plans table, with lengths 29/22/17/14 (argentina-fidepo, 3–6), 25/22/19/16 (spain-ludoteka, 3–6), 19/19/19/15/13 (gamerules, 3–7), 11/12/13/14/15 (mexico-bazas, 3–7).
- **FR-210 (Must)** — Given a player count outside `rules.players`, or a sequence that resolves to any count `< 1` or `> max`, when `expandHandSequence` is called, then it throws `RangeError` whose message names the offending value.

### Game creation and dealing

- **FR-211 (Must)** — Given `{ gameId, rules, seats, seed }`, when `createGame` is called, then it validates the input and throws `InvalidGameSetupError` listing **every** problem found when: `rules` fails `RuleSetSchema`; `seats.length` is outside `rules.players`; `seats[i].seat !== i` for any `i`; any seat fails `SeatInfoSchema`; two seats share a `playerId`; `gameId` is empty; `seed` is empty; `expandHandSequence(rules, seats.length)` throws (its message becomes the problem). A `RuleSetSchema` failure counts as one problem, and the checks that read `rules` (player range, sequence expansion) are skipped when it fails, and sequence expansion is also skipped when the player-range check fails (one cause, one problem).
- **FR-212 (Must)** — Given valid input, when `createGame` is called, then it returns a `Transition` whose state has `schemaVersion: 1`, the given `gameId` and `seed`, a deep copy of `rules` and `seats`, `handPlan = expandHandSequence(rules, seats.length)`, `aiDecisionCount: 0`, `version: 0`, `phase: 'bidding'`, `handIndex: 0`, `completedHands: []`, and hand 0 dealt; its events are exactly `[game-started { seats, handPlan }, hand-dealt { … hand 0 … }]`. Mutating the input afterwards does not change the state.
- **FR-213 (Must)** — Given hand 0, when it is dealt, then the first dealer is `rng.int(0, N − 1)` drawn from the deal stream for hand 0 **before** that stream shuffles the deck. Given hand `i > 0`, the dealer is `next(previous dealer)` = `(previous dealer + 1) mod N`.
- **FR-214 (Must)** — Given hand `i` with `c = handPlan[i]` cards per player and `N` players, when it is dealt, then the deck `buildDeck(rules.deck, N)` is shuffled with the deal stream for hand `i`, and shuffled card `k` (for `k = 0 … N·c − 1`) goes to seat `(dealer + 1 + k) mod N`.
- **FR-215 (Must)** — Given `N·c` is less than the deck size, when hand `i` is dealt, then `trumpCard` is shuffled card `N·c` (the next stock card), `trumpCardInDealerHand` is `false`, and that card is in no seat's hand.
- **FR-216 (Must)** — Given `N·c` equals the deck size, when hand `i` is dealt, then `trumpCard` is shuffled card `N·c − 1` (the dealer's last card), `trumpCardInDealerHand` is `true`, and the card stays in the dealer's hand.
- **FR-217 (Must)** — Given a dealt hand, then `trumpSuit = trumpCard.suit`, each seat's hand is sorted by suit in `rules.deck.suits` order and then by rank high→low, `bids` are all `null`, `tricksWon` are all `0`, `currentTrick = { leader: next(dealer), plays: [] }`, there is no `lastTrick`, and `toAct = next(dealer)` (*mano*).

### Turn order and legal moves

- **FR-218 (Must)** — Given a state, when `currentActor(state)` is called, then it returns `null` if `phase === 'game-over'`, otherwise `state.hand.toAct`.
- **FR-219 (Must)** — Given a seat that is not an integer in `0 … N − 1`, when `legalMoves`, `applyMove` or `tableViewFor` is called with it, then it throws `RangeError`.
- **FR-220 (Must)** — Given a valid seat that is not `currentActor(state)` (including any seat at `game-over`), when `legalMoves(state, seat)` is called, then it returns `[]`.
- **FR-221 (Must)** — Given the seat to act in `bidding`, when `legalMoves` is called, then it returns `{ id: 'bid:<n>', move: { type: 'bid', seat, tricks: n } }` for each `n` returned by `legalBids`, in ascending order.
- **FR-222 (Must)** — Given a hand, a seat and rules, when `legalBids(hand, seat, rules)` is called, then it returns `0 … cardsPerPlayer` ascending, except that when `seat === hand.dealer`, `rules.bidding.dealerRestriction` is `true`, and `cardsPerPlayer` is not in `dealerRestrictionExemptCardCounts`, the value `cardsPerPlayer − (sum of the other seats' bids)` is removed if it lies in that range.
- **FR-223 (Must)** — Given the seat to act in `playing`, when `legalMoves` is called, then it returns `{ id: 'play:<cardId>', move: { type: 'play', seat, card } }` for each card returned by `legalPlays`, in that seat's hand order.
- **FR-224 (Must)** — Given a hand, a seat and rules, when `legalPlays(hand, seat, rules, deck)` is called, then it returns the subset of the seat's hand (in hand order) given by the algorithm in design §5.4 exactly: empty trick → all cards; holding the led suit → the cards of the led suit that beat the highest led-suit card on the table if `mustBeatLedSuit` applies and any exist (the requirement is waived when `beatNotRequiredAfterTrumped` is `true`, a trump is on the table and the led suit is not trump), else all led-suit cards; void with trumps → if a trump is on the table and `mustOvertrump`, the higher trumps if any, else all trumps (`whenCannotOvertrump: 'any-trump'`) or all cards (`'any-card'`); otherwise all trumps; void with no trumps → all cards. "Higher" and "beat" use `compareRanks(deck, …)`.
- **FR-225 (Must)** — Given the plays of a complete trick, the trump suit and the deck, when `trickWinner(plays, trumpSuit, deck)` is called, then it returns the seat of the highest trump played if any trump was played, otherwise the seat of the highest card of the led suit (the first play's suit).

### Applying moves and automatic transitions

- **FR-226 (Must)** — Given a state, a seat that passes the FR-219 range check (always performed first, in every phase) and a `moveId`, when `applyMove` is called, then it throws `IllegalMoveError` with `reason: 'game-over'` if the game is over, `'not-your-turn'` if the seat is not `currentActor(state)`, or `'unknown-move'` if `moveId` is not the `id` of an entry in `legalMoves(state, seat)`. The error message contains the seat and the `moveId`.
- **FR-227 (Must)** — Given any call to `applyMove`, then the input state is not mutated (deep-equal to a copy taken before the call), and the returned state shares no mutable object with the input. `applyMove` works on a single `structuredClone` of the input state, mutated in place, then returned (simplest way to guarantee both properties).
- **FR-228 (Must)** — Given a legal move by a seat whose `kind` is `'ai'`, when it is applied, then the new state's `aiDecisionCount` is the old value + 1; for a `'human'` seat it is unchanged. `applyMove` never changes `version`.
- **FR-229 (Must)** — Given a legal bid, when it is applied, then `bids[seat]` is set and the transition emits `bid-made { seat, tricks }`; if the bidder was not the dealer, `toAct = next(seat)`; if the bidder was the dealer, then `phase` becomes `'playing'` and `toAct = next(dealer)` (*mano* leads the first trick).
- **FR-230 (Must)** — Given a legal play, when it is applied, then the card leaves the seat's hand, is appended to `currentTrick.plays`, the transition emits `card-played { seat, card }`, and, if the trick is not complete, `toAct = next(seat)`.
- **FR-231 (Must)** — Given a play that completes the trick (N plays), when it is applied, then the winner is `trickWinner(…)`, `tricksWon[winner]` increases by 1, `lastTrick = { winner, plays }`, `currentTrick = { leader: winner, plays: [] }`, `toAct = winner`, and the transition emits `trick-won { seat: winner, trickNumber }` where `trickNumber` is the 1-based number of the trick within the hand.
- **FR-232 (Must)** — Given a trick that completes the hand (`cardsPerPlayer` tricks played), when it is applied, then `{ handIndex, cardsPerPlayer, dealer, trumpSuit, bids, tricks: tricksWon }` is appended to `completedHands` and the transition emits `hand-completed { handIndex, result }`.
- **FR-233 (Must)** — Given a completed hand that is not the last of `handPlan`, when the hand completes, then `handIndex` increases by 1, `phase` becomes `'bidding'`, the next hand is dealt per FR-213 to FR-217, and the transition emits `hand-dealt { handIndex, dealer, cardsPerPlayer, trumpCard, trumpCardInDealerHand }`.
- **FR-234 (Must)** — Given the last hand of `handPlan` completes, then `phase` becomes `'game-over'`, `hand` becomes `null`, `handIndex` stays at `handPlan.length − 1`, and the transition emits `game-over`.
- **FR-235 (Must)** — Given one `applyMove` call, then its events appear in this order, each only when it occurs: `bid-made` or `card-played`, `trick-won`, `hand-completed`, then `hand-dealt` or `game-over`. Every returned state parses with `GameStateSchema` and every event with `GameEventSchema`; this is a property checked by tests — the engine does not run Zod parsing in `applyMove` (only `createGame` parses `rules` and seats, FR-211).

### Table view

- **FR-236 (Must)** — Given a state and a seat (or `'spectator'`), when `tableViewFor` is called, then it returns a `TableView` with: `gameId`, `version`, `phase`, `handIndex` and a copy of `handPlan` from the state; `you` = the seat or `null`; `toAct = currentActor(state)`; per seat `{ seat, name, kind, cardCount, bid, tricksWon }` taken from the current hand; `dealer` from the current hand; `trumpCard` and `trumpCardInDealerHand` from the current hand; `yourHand` = a copy of the viewer's hand (`[]` for a spectator); `currentTrick` = a copy of `currentTrick.plays`; `lastTrick` = a copy of `lastTrick` or `null`.
- **FR-237 (Must)** — Given `phase === 'game-over'` (so `hand` is `null`), when `tableViewFor` is called, then `toAct`, `trumpCard` and `lastTrick` are `null`, `trumpCardInDealerHand` is `false`, `yourHand` and `currentTrick` are `[]`, every seat has `cardCount: 0`, `bid: null`, `tricksWon: 0`, and `dealer` is the dealer of the last completed hand.
- **FR-238 (Must)** — Given any state and viewer, then the view contains no other seat's cards except the publicly shown `trumpCard` (also when it is in the dealer's hand), and contains neither the seed, the rules, `aiDecisionCount` nor any undealt card other than `trumpCard`.

### Invariants

- **FR-239 (Must)** — Given a state, when `checkInvariants(state)` is called, then it returns a `string[]` with one human-readable message per violated rule (empty when the state is valid), with `N = seats.length`, checking first the structure — (s) `handIndex < handPlan.length`; and, when `hand` is non-null, `hand.hands`, `hand.bids`, `hand.tricksWon` have length N and `hand.toAct`, `hand.dealer`, `hand.currentTrick.leader` are in `0 … N − 1` — and then: (a) no card appears twice across all hands and the current trick; (b) every such card belongs to `buildDeck(rules.deck, N)`; (c) each seat's hand size = `cardsPerPlayer` − completed tricks in the hand − (1 if the seat has played to the current trick), where completed tricks = sum of `tricksWon`; (d) in `playing`, every bid is set; (e) once bidding has closed on a hand where the dealer restriction applies, the sum of bids ≠ `cardsPerPlayer`; (f) `legalMoves(state, toAct)` is non-empty while the game is not over; (g) `hand` is `null` iff `phase === 'game-over'`; (h) `hand.cardsPerPlayer === handPlan[handIndex]`; (i) `completedHands.length` = `handIndex` while `phase ≠ 'game-over'`, or `handPlan.length` at game-over. Checks (a)–(f) and (h) apply only when `hand` is non-null. If any (s) check fails, it is reported and (a)–(i) are skipped; if (a) or (b) fails, (f) is skipped (it would rank off-deck cards). So no check runs on data it cannot handle.
- **FR-240 (Must)** — `checkInvariants` never throws for a state that parses with `GameStateSchema`; it performs no I/O and does not mutate its input.

### Version and docs

- **FR-241 (Must)** — `src/engine/engine.ts` exports `ENGINE_VERSION = 1` (a number). It must be incremented by 1 by any later change that alters the deals or move outcomes produced for an existing seed and move sequence; the golden fixture of VC-237 is the tripwire for such changes on its path (deal, sort, French-deck trick resolution); other paths are covered by recomputing VCs and code review.
- **FR-242 (Must)** — `docs/design.md` §4.4–4.5 matches this spec (the exact stream derivation of FR-205/FR-206, the first dealer drawn before the shuffle, sorted hands, `hand: null` at game-over), and `docs/development.md` gains an "Engine" section with the module map, the public functions, the determinism rules and when to bump `ENGINE_VERSION`.

## Business Rules

- **BR-201 — Determinism.** The same `createGame` input followed by the same sequence of `(seat, moveId)` calls yields deep-equal states and events. *Rationale:* replay from seed + event log (design §7). *Exceptions:* none.
- **BR-202 — Deals are independent of AI choices.** Hand `i`'s deal depends only on the seed, `i`, the rules and the player count (and, for `i > 0`, the hand-0 dealer). *Rationale:* changing an AI strategy never changes the cards (design §4.5). *Exceptions:* none.
- **BR-203 — Only legal moves are applied.** `applyMove` accepts a move only by the `id` of a currently legal move, so revokes and dealer-restriction violations cannot happen. *Rationale:* design §4.6, §11. *Exceptions:* none.
- **BR-204 — The engine never scores.** No points, totals or rankings appear in engine state, events or views. *Rationale:* architecture §3 (`engine` never calls `score`). *Exceptions:* none.
- **BR-205 — Information hiding.** Views and events reveal no hidden card except the dealer's publicly shown trump card when the whole deck is dealt. *Rationale:* design §4.5, §4.7, §5.5. *Exceptions:* that one card.
- **BR-206 — Engine purity.** `src/engine` performs no I/O, uses no ambient randomness or time, and imports only `src/domain`, `zod` and `@noble/hashes`. *Rationale:* spec 00 layer rule; the engine runs in tests, the simulator and serverless functions. *Exceptions:* none.

## Non-Functional Requirements

- **NFR-201** — `pnpm typecheck`, `pnpm lint` (0 warnings) and `pnpm test` pass, locally and in CI.
- **NFR-202** — `package.json` `dependencies` are exactly `next, react, react-dom, zod, @noble/hashes`, with `@noble/hashes` pinned to exactly `2.4.0`.
- **NFR-203** — One full `argentina-fidepo` 3-player game (29 hands) driven by always applying the first legal move, calling `legalMoves` before every move, completes in < 250 ms in the CI test run, measured as the median of 5 timed runs of the move loop only (after `createGame`), following one untimed warm-up game. *Why 250 ms:* about 0.25 ms per move (≈ 981 moves), well inside the architecture's "well under 1 ms per move" and the 1,000-move cap per request.

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

## Verification Criteria

### Random streams
- **VC-201** (FR-201): `createXoshiro128ss([1,2,3,4])` — the first six raw outputs (observed through `int(0, 2**32 − 1)`) are `11520, 0, 5927040, 70819200, 2031721883, 1637235492`; `createXoshiro128ss([0,0,0,0])` produces the same outputs as `createXoshiro128ss([0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x6a09e667])`.
- **VC-202** (FR-200, FR-202): 10,000 calls of `int(1, 6)` on a fixed stream all lie in `[1, 6]` and each face appears between 1,500 and 1,850 times; `int(5, 5)` → `5`; `int(-3, -1)` stays in `[-3, -1]`; `rngFromSource` over a stub returning `2**32 − 1` then `0`, for `int(0, 2)`, rejects the first draw (`2**32 − 1 ≥ limit`) and returns `0`.
- **VC-203** (FR-203): `int(1.5, 3)`, `int(3, 1)`, `int(0, 2**32)` → throw `RangeError`.
- **VC-204** (FR-200, FR-204): shuffling `[0..51]` returns a permutation of the same values, the input array is unchanged, and with `rngFromSource` over a stub returning `0` forever, shuffling `[a,b,c,d]` yields `[b,c,d,a]` (every `j = 0`: swaps (3,0), (2,0), (1,0)); shuffling `[]` and `[x]` returns `[]` and `[x]`.
- **VC-205** (FR-205): `deriveRng('s', 'deal', 0)` and a second `deriveRng('s', 'deal', 0)` produce identical first 100 outputs; `('s','deal',0)`, `('s','deal',1)`, `('t','deal',0)`, `('s','ai',0,0)` produce pairwise different first outputs; a golden test pins the first 8 raw outputs of `deriveRng('golden-seed', 'deal', 0)` to the values computed from the FR-205 formula by an independent in-test computation using `@noble/hashes/sha2.js` directly.
- **VC-206** (FR-206, BR-202): `aiRng(state, 2)` equals `deriveRng(state.seed, 'ai', 2, state.aiDecisionCount)` (same first 10 outputs).

### Hand sequence
- **VC-207** (FR-207): `maxCardsPerPlayer(FRENCH_52, n)` = 17, 13, 10, 8, 7 for n = 3…7; `maxCardsPerPlayer(SPANISH_40, n)` = 12, 10, 8, 6 for n = 3…6.
- **VC-208** (FR-208, FR-209): for every preset × valid player count (18 rows), `expandHandSequence(getPreset(id), n)` deep-equals the full literal array from the Hand plans table, its length is as listed, gamerules plans contain exactly one `1`, and spain/mexico plans contain the top count exactly `n` times.
- **VC-209** (FR-208): a custom rule set with `[{kind:'range',from:3,to:3},{kind:'repeat',cards:{min:[2,'max']},times:2}]` and 4 players → `[3, 2, 2]`.
- **VC-210** (FR-210): `expandHandSequence(getPreset('argentina-fidepo'), 2)` and `(…, 7)` → `RangeError`; a custom sequence `{kind:'repeat',cards:20,times:1}` with 4 players (max 13) → `RangeError` whose message contains `20`.

### Creation and dealing
- **VC-211** (FR-211): each invalid input → `InvalidGameSetupError`: rules with `players.min = 1`; 2 seats for argentina-fidepo; 7 seats for spain-ludoteka; seats indexed `[0, 2, 1]`; a seat with `kind: 'robot'`; two seats with the same `playerId`; `gameId: ''`; `seed: ''`; a schema-valid custom rule set whose sequence is `{kind:'repeat',cards:20,times:1}` with 4 seats (problem message contains `20`). An input with both an empty seed and duplicate playerIds → `problems.length === 2`.
- **VC-212** (FR-212): `createGame` with argentina-fidepo, 4 seats, seed `'seed-1'` → state parses with `GameStateSchema`, has `phase 'bidding'`, `handIndex 0`, `version 0`, `aiDecisionCount 0`, `handPlan` of length 22; events are `['game-started','hand-dealt']` with the seats and plan; mutating the input `rules.players.max` and `seats[0].name` afterwards leaves the state unchanged.
- **VC-213** (FR-213): for 20 seeds, the hand-0 dealer equals `deriveRng(seed,'deal',0).int(0, N−1)`; across one game, every next hand's dealer is `(dealer + 1) mod N`; over 200 seeds with 4 players all four seats appear as first dealer.
- **VC-214** (FR-214, FR-217): for a fixed seed, recomputing the deal independently in the test (`buildDeck`, `deriveRng(seed,'deal',i)`, for `i = 0` first draw the dealer with `int(0, N − 1)`, then shuffle, round-robin from `next(dealer)`, sort) reproduces every seat's hand for hands 0, 1 and 2; each hand is sorted by suit order then rank high→low; *mano* = `toAct` = `currentTrick.leader` = `next(dealer)`; bids all `null`; no `lastTrick`.
- **VC-215** (FR-215): argentina-fidepo with 3 players, hand 0 (17 cards each, 51 of 52 dealt) → `trumpCardInDealerHand false`, `trumpCard` in no hand, `trumpSuit === trumpCard.suit`.
- **VC-216** (FR-216, BR-205): argentina-fidepo with 4 players, hand 0 (13 × 4 = 52) → `trumpCardInDealerHand true`, `trumpCard` is in the dealer's hand; `hand-dealt` contains `trumpCard`; for every seat and `'spectator'`, `tableViewFor` shows that `trumpCard`, and, collecting every `Card` object in the view by a recursive walk and mapping it with `cardId`, none belongs to the dealer's hand other than the trump unless the viewer is the dealer.

### Legal moves
- **VC-217** (FR-218, FR-220): `currentActor` = `hand.toAct` during play and `null` at game-over; `legalMoves` for a non-acting seat → `[]`; at game-over every seat → `[]`.
- **VC-218** (FR-219): `legalMoves(state, -1)`, `(state, N)`, `(state, 1.5)`, `applyMove(state, N, 'bid:0')`, `tableViewFor(state, N)` on a bidding state → throw `RangeError`; `applyMove(gameOverState, N, 'bid:0')` → `RangeError` (not `IllegalMoveError`).
- **VC-219** (FR-221, FR-222): with 4 cards and others' bids summing to 1, the dealer's legal bids are `[0,1,2,4]` (3 removed), ids `bid:0,bid:1,bid:2,bid:4`; with others summing to 5 (forbidden value −1) → `[0,1,2,3,4]`; a non-dealer gets `[0..4]`; with `dealerRestriction: false` the dealer gets `[0..4]`; spain-ludoteka with 1 card (exempt) → dealer gets `[0,1]` even when others sum to 0; spain-ludoteka with 2 cards → restriction applies.
- **VC-220** (FR-223, FR-224): legal plays, one row per case (spades trump unless noted), each on a hand built in the test and listed below in hand order (sorted per FR-217):
  - empty trick → all cards in hand order;
  - follow suit, `mustBeatLedSuit false`: 9H led, hold KS, AH, 3H → `[AH, 3H]`;
  - *montar*: 9H led, 2S played, hold AH, 3H; `mustBeatLedSuit true`, `beatNotRequiredAfterTrumped false` → `[AH]`; same with `true` → `[AH, 3H]`;
  - must beat but cannot, `mustBeatLedSuit true`: 9H led, hold 3H, 2H → `[3H, 2H]`;
  - trump led (QS), hold KS, 2S, AH: `mustBeatLedSuit true` → `[KS]`; `false` → `[KS, 2S]`; `beatNotRequiredAfterTrumped true` does not waive beating when trump was led → `[KS]`;
  - 9H led, void in hearts, hold KS, 2S, 5D, no trump on table → `[KS, 2S]`;
  - 9H led then KS played, void in hearts, hold AS, 2S, 5D, `mustOvertrump true` → `[AS]`;
  - 9H led then AS played, void in hearts, hold 3S, 2S, 5D, `mustOvertrump true`: `any-trump` → `[3S, 2S]`; `any-card` → `[3S, 2S, 5D]`;
  - 9H led then AS played, void in hearts, hold 3S, 2S, 5D, `mustOvertrump false` → `[3S, 2S]`;
  - 9H led, void in hearts, hold AD, 5C (no trumps) → `[AD, 5C]`.
- **VC-221** (FR-225): `trickWinner` — no trump: highest led-suit card wins and off-suit high cards (e.g. AD on hearts led) do not; one trump wins over led aces; two trumps → higher trump; Spanish deck ranks (`3O` beats `RO`, oros led); returns the seat, not the play index (leader ≠ seat 0).

### Applying moves
- **VC-222** (FR-226, BR-203): on a bidding state, `applyMove` with the wrong seat → `IllegalMoveError` `reason 'not-your-turn'`; with `bid:99`, `play:AS` during bidding, or the dealer's forbidden bid → `'unknown-move'`; on a game-over state → `'game-over'`; each message contains the seat and the moveId.
- **VC-223** (FR-227): for every move of one full seeded 4-player game, `structuredClone` of the input taken before `applyMove` deep-equals the input after it; mutating the returned state's `hand.hands[0]` and `seats[0]` does not change the input.
- **VC-224** (FR-228): seats `[human, ai, ai, human]`; after a human move `aiDecisionCount` is unchanged, after an AI move it is +1; at the end of a full game it equals the number of moves made by AI seats; `version` stays `0` throughout.
- **VC-225** (FR-229, FR-230, FR-231): bids go *mano* → … → dealer, each emitting `bid-made`; after the dealer's bid `phase 'playing'` and `toAct = next(dealer)`; a non-final play emits only `card-played` and sets `toAct = next(seat)`; the final play of a trick emits `card-played, trick-won` with `trickNumber` 1, 2, … within the hand, sets `lastTrick`, and the winner leads (`toAct = currentTrick.leader = winner`).
- **VC-226** (FR-232, FR-233, FR-235): the last play of hand 0 emits `card-played, trick-won, hand-completed, hand-dealt` in that order; `completedHands[0]` equals `{handIndex:0, cardsPerPlayer, dealer, trumpSuit, bids, tricks}` of that hand with `sum(tricks) === cardsPerPlayer`; hand 1 has the next dealer and `handPlan[1]` cards and no `lastTrick`.
- **VC-227** (FR-234, FR-235): playing a full mexico-bazas 3-player game (11 hands) by first legal move → final events end `hand-completed, game-over`; final state has `phase 'game-over'`, `hand null`, `handIndex 10`, 11 `completedHands`; every intermediate state parses with `GameStateSchema` and every event with `GameEventSchema`.

### View
- **VC-228** (FR-236): a mid-trick view for seat 1 has `you 1`, `yourHand` equal to seat 1's hand, `cardCount` per seat equal to hand lengths, bids and `tricksWon` from the hand, `currentTrick` equal to the plays, `toAct` = current actor; a spectator view has `you null` and `yourHand []`; mutating the view does not change the state.
- **VC-229** (FR-237): a game-over view has `toAct null`, `trumpCard null`, `lastTrick null`, `trumpCardInDealerHand false`, empty `yourHand` and `currentTrick`, all seats `cardCount 0`, `bid null`, `tricksWon 0`, `dealer` = last `completedHands` entry's dealer.
- **VC-230** (FR-238, BR-205): for every state reached in one seeded 4-player argentina game (covering both a stock-trump and a whole-deck hand) and every viewer, the `Card` objects collected from the view by a recursive walk (compared by `cardId`) include no card of another seat's hand except `trumpCard`; the serialized view does not contain the seed string; no `rules`, `aiDecisionCount` or `seed` key.

### Determinism
- **VC-231** (BR-201): two runs of the same seed and the same `(seat, moveId)` sequence (first legal move each time) over a full gamerules 5-player game produce deep-equal states and event lists after every move; replaying only the `bid-made`/`card-played` events of run 1 through `applyMove` from a fresh `createGame` reproduces run 1's final state.
- **VC-232** (BR-202): same seed, two policies (always first legal move vs always last legal move) → every `hand-dealt` event and every freshly dealt `hand.hands` are identical across the two runs, while `completedHands` bids differ.

### Invariants
- **VC-233** (FR-239, FR-240): `checkInvariants` returns `[]` for every state of one full seeded game for each preset (at the minimum player count); each mutation yields a non-empty result naming the rule: duplicate card in two hands; a card not in the game's deck (a hand card replaced by the Spanish card `{suit:'O',rank:'3'}` in a French-deck game); one seat with an extra card; a `null` bid in `playing`; dealer bid making the sum equal `cardsPerPlayer` after bidding closed; `hand: null` while `phase 'bidding'`; `hand.cardsPerPlayer` ≠ `handPlan[handIndex]`; `completedHands` length off by one; `hand.toAct = N` (reported, no throw, and (f) skipped); `hand.bids` of length N − 1. Calling it does not mutate the state.

### Version, docs, NFRs
- **VC-234** (FR-241): `ENGINE_VERSION === 1` and `typeof ENGINE_VERSION === 'number'`.
- **VC-235** (FR-242): `docs/design.md` §4.5 states the `JSON.stringify([seed, ...labels])` → SHA-256 → first 16 bytes little-endian derivation, the hand-0 dealer drawn before the shuffle, sorted hands, and `hand: null` at game-over; `docs/development.md` has an "Engine" section listing the eight engine modules and the `ENGINE_VERSION` bump rule.
- **VC-236** (NFR-201, NFR-202, NFR-203, BR-204, BR-206): on the final tree `pnpm typecheck && pnpm lint && pnpm test` exit 0 with 0 warnings locally and in the branch's CI run; `package.json` `dependencies` keys are exactly `next, react, react-dom, zod, @noble/hashes` with `@noble/hashes` at exactly `2.4.0`; a test times the NFR-203 game as specified there (warm-up, median of 5) and asserts < 250 ms; `grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.|src/score|\.\./score' src/engine` finds nothing (the timing test lives in `tests/`).
- **VC-237** (FR-241, BR-201): a golden fixture written as literals in the test (not recomputed) for `createGame` with argentina-fidepo, 4 seats, seed `'golden-seed'`: the hand-0 dealer, `trumpCard` and every seat's hand-0 cards, and the full `completedHands` after playing the game by first legal move. The test states that changing these literals requires bumping `ENGINE_VERSION`.

## Open Questions

None.

## Assumptions

- `structuredClone` is available in every runtime the engine targets (Node 24, modern browsers, Vercel functions) and may be used for deep copies; it is a language global, not I/O.
- `@noble/hashes` is pinned to `2.4.0` (exact; ESM-only, export map exposes `./sha2.js` and `./utils.js`, hash input is `Uint8Array`). Both subpaths are allowed by the spec 00 lint rule.

## Changelog

- 0.2 (2026-11-22): review pass 1 — `rngFromSource` export (FR-200) for stub-driven RNG tests; `@noble/hashes` 2.4.0 `.js` subpaths and `JSON.stringify` rationale; `createGame` reports sequence-expansion failures; single-clone copy strategy; schema conformance is test-side; structural checks in `checkInvariants` (null-hand guard; (f) skipped on off-deck cards); one problem per cause in `createGame`; golden fixture VC-237; NFR-203 measurement method; Card-walk leak checks; exact VC-214/VC-220 rows.
- 0.1 (2026-11-22): initial draft from implementation.md Phase 2 and discovery answers (hand `null` at game-over; sorted hands, legal plays in hand order, bids ascending; pinned RNG derivation with first dealer before shuffle; `createGame` validates and throws `InvalidGameSetupError`; `checkInvariants` returns violations; `ENGINE_VERSION = 1`; full-game < 250 ms NFR; out-of-range seat → `RangeError`).
