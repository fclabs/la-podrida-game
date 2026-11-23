# CONTEXT — Game Engine (Phase 2)

Last updated by: Iteration 5 (Applying moves and automatic transitions)

## Current state

- Phase 0 scaffold and Phase 1 domain model are complete (see `specs/00-project-scaffold-frozen.md`, `specs/01-domain-model-frozen.md`). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`), pnpm 10.15.1, Node 24 declared, Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, layer-boundary lint rule, GitHub Actions CI.
- `@noble/hashes` 2.4.0 is now a runtime dependency (exact pin). `dependencies` = `@noble/hashes, next, react, react-dom, zod` (spec NFR-202).
- `src/engine/rng.ts` is done (spec FR-200 to FR-205): `rngFromSource`, `createXoshiro128ss`, `deriveRng`. `src/engine/.gitkeep` was deleted.
- `src/engine/sequence.ts` is done (spec FR-207 to FR-210): `maxCardsPerPlayer`, `expandHandSequence`.
- `src/engine/bidding.ts` (FR-222 `legalBids`), `src/engine/play.ts` (FR-224 `legalPlays`), `src/engine/trick.ts` (FR-225 `trickWinner`) are done.
- `src/engine/engine.ts` is **complete** (spec FR-206, FR-211 to FR-235, FR-241): `ENGINE_VERSION`, `IllegalMoveError`, `InvalidGameSetupError`, `CreateGameInput`, `createGame`, `currentActor`, `legalMoves`, `applyMove`, `aiRng`, plus internal `dealHand`, `handDealtEvent`, `assertSeatInRange`, `nextSeat`. Games play to completion deterministically for every preset.
- `tests/unit/engine/helpers.ts` has builders `card`, `cards`, `trick`, `rulesWith`, `makeHand`, `makeSeats`, `newGame`, `withHand`, and the game driver `playGame` with policies `firstMove` / `lastMove` (types `Policy`, `PlayedMove`, `PlayedGame`). **Frozen for Iterations 6–7: import, never modify.**
- Not yet built: `view.ts` (6), `invariants.ts` (7), docs (8).
- Tests: `pnpm test` = 20 files, 422 tests (engine dir: 10 files, 207 tests; Iteration 5 added engine-apply 40, determinism 4, golden 4, perf 1).
- NFR-203 measured locally: 981 moves, median ≈ 45 ms (limit 250 ms).

## File map

| Path | Purpose |
|---|---|
| `src/engine/rng.ts` | Seeded RNG: `rngFromSource`, `createXoshiro128ss` (xoshiro128**), `deriveRng` (SHA-256 stream derivation). |
| `src/engine/sequence.ts` | Hand plans: `maxCardsPerPlayer`, `expandHandSequence` (bound resolution, range/repeat expansion, `RangeError` checks). |
| `src/engine/bidding.ts` | `legalBids` (FR-222, dealer restriction / *sucias*). |
| `src/engine/play.ts` | `legalPlays` (FR-224 = design §5.4 algorithm). |
| `src/engine/trick.ts` | `trickWinner` (FR-225). |
| `src/engine/engine.ts` | Game engine: `createGame` (FR-211 validation, FR-212 state), internal `dealHand` (FR-213–217), `currentActor`, `legalMoves`, `applyMove` (FR-226–235: moves, transitions, events), `aiRng`, error classes, `ENGINE_VERSION`. |
| `tests/unit/engine/engine-apply.test.ts` | VC-213 rotation, VC-214 hands 1–2, VC-216 dealing part, VC-217 real game-over, VC-218 `applyMove` rows, VC-222 to VC-227, `playGame` self-check. |
| `tests/unit/engine/determinism.test.ts` | VC-231 (two runs + event replay, gamerules 5p), VC-232 (first vs last policy, argentina 4p and spain 3p). |
| `tests/unit/engine/golden.test.ts` | VC-237 golden fixture (argentina-fidepo 4 seats, seed `golden-seed`) as literals; tripwire for `ENGINE_VERSION`. |
| `tests/unit/engine/perf.test.ts` | NFR-203 timing (warm-up + median of 5, `performance.now()`), asserts < 250 ms and logs the runs. |
| `tests/unit/engine/engine-create.test.ts` | VC-206, VC-211, VC-212, VC-213 (hand 0), VC-214 (hand 0), VC-215, VC-217 (bidding/playing + hand-built game-over), VC-218 (`legalMoves` rows), VC-219 `bid:` ids, VC-220 `play:` ids, VC-234. |
| `tests/unit/engine/helpers.ts` | Shared test builders and `playGame` (see Public interfaces). Frozen after Iteration 5: 6–7 import, never edit. |
| `tests/unit/engine/bidding.test.ts` | VC-219 at function level (ids are in `engine-create.test.ts`). |
| `tests/unit/engine/play.test.ts` | VC-220 at function level: every spec row, each run under all 16 combos of the 4 play flags consistent with the row's fixed flags. |
| `tests/unit/engine/trick.test.ts` | VC-221 (french + spanish decks, leader ≠ seat 0). |
| `tests/unit/engine/sequence.test.ts` | VC-207 to VC-210; the 18 preset hand plans as hand-written literal arrays (`PLANS`, `// prettier-ignore`). |
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

### `@/src/engine/sequence`

```ts
export function maxCardsPerPlayer(deck: DeckDefinition, players: number): number;
// floor(buildDeck(deck, players).length / players) — deck after removals; buildDeck throws
// RangeError unless players is an integer >= 1.
export function expandHandSequence(rules: RuleSet, players: number): number[];
// New array every call. Bounds: number → itself; 'max' → max; {min:[n,'max']} → min(n, max);
// {offset:['max', n]} → max + n; times 'players' → players. range inclusive, step ±1.
```

`expandHandSequence` throws `RangeError` (checked in this order):
- player count not an integer in `rules.players`: message `player count <n> is outside <min>–<max> for rule set <id>`;
- after full expansion, the first count `< 1` or `> max`: message `hand of <count> cards is outside 1–<max> for <players> players with rule set <id>`.
Iteration 4 (`createGame`, FR-211) uses `err.message` verbatim as the `InvalidGameSetupError` problem; VC-211 checks the message contains `20` for `{repeat, cards: 20}` with 4 seats.

### `@/src/engine/bidding`, `@/src/engine/play`, `@/src/engine/trick`

```ts
export function legalBids(hand: HandState, seat: number, rules: RuleSet): number[];
// 0…cardsPerPlayer ascending (new array). If seat === hand.dealer && rules.bidding.dealerRestriction
// && !dealerRestrictionExemptCardCounts.includes(cardsPerPlayer): removes
// cardsPerPlayer − sum(other seats' bids) (null bids count as 0) when it is in range.
export function legalPlays(hand: HandState, seat: number, rules: RuleSet, deck: DeckDefinition): Card[];
// Design §5.4 over hand.hands[seat], using hand.currentTrick.plays and hand.trumpSuit.
// Returns a NEW array holding the hand's own Card objects (not copies), in hand order.
// Waiver: beatNotRequiredAfterTrumped && a trump on the table && led suit !== trump.
export function trickWinner(plays: readonly TrickPlay[], trumpSuit: Suit, deck: DeckDefinition): number;
// Seat of highest trump, else of highest led-suit card (led = plays[0].card.suit).
// Throws RangeError on an empty plays array (D-002).
```

All three are pure, never mutate their inputs, and compare ranks with `compareRanks(deck, a, b) > 0`.
`engine.ts` (Iteration 4) calls `legalBids(state.hand, seat, state.rules)`,
`legalPlays(state.hand, seat, state.rules, state.rules.deck)` and
`trickWinner(plays, state.hand.trumpSuit, state.rules.deck)`. They read `toAct` / `phase` nowhere:
turn and phase checks are the caller's job.

### `@/src/engine/engine` (final API)

```ts
export const ENGINE_VERSION = 1;
export type IllegalMoveReason = 'game-over' | 'not-your-turn' | 'unknown-move';
export class IllegalMoveError extends Error {           // name 'IllegalMoveError'
  readonly reason: IllegalMoveReason; readonly seat: number; readonly moveId: string;
  constructor(reason: IllegalMoveReason, seat: number, moveId: string);
  // message: `Illegal move "<moveId>" by seat <seat>: <reason>`
}
export class InvalidGameSetupError extends Error {      // name 'InvalidGameSetupError'
  readonly problems: string[];
  constructor(problems: string[]);                      // message: `Invalid game setup: ` + problems.join('; ')
}
export interface CreateGameInput { gameId: string; rules: RuleSet; seats: SeatInfo[]; seed: string }
export function createGame(input: CreateGameInput): Transition;
export function currentActor(state: GameState): number | null;   // null if game-over (or hand null)
export function legalMoves(state: GameState, seat: number): LegalMove[];
export function applyMove(state: GameState, seat: number, moveId: string): Transition;
export function aiRng(state: GameState, seat: number): Rng;      // deriveRng(seed,'ai',seat,aiDecisionCount)
```

- `createGame` problems (collected in this order, D-004): RuleSetSchema failure (one problem; then player range + expansion skipped) → seat count outside `rules.players` (one; expansion skipped) → `expandHandSequence` `RangeError` message verbatim → per seat: `seats[i].seat !== i`, `SeatInfoSchema` failure → one per duplicated `playerId` → empty `gameId` → empty `seed`.
- State copies: `structuredClone(input.rules)` and `structuredClone(input.seats)`; `handPlan` from `expandHandSequence` (new array). `game-started` carries its own clones of seats and plan; `hand-dealt` carries a copy of `trumpCard` and never any hand (D-003).
- Internal `dealHand(state: GameState, handIndex: number, previousDealer: number | null): HandState` (not exported). Reads `seed`, `rules`, `seats.length`, `handPlan[handIndex]`; never mutates `state`. Stream `deriveRng(seed, 'deal', handIndex)`; `previousDealer === null` → dealer = `rng.int(0, N−1)` drawn **before** the shuffle; else dealer = `(previousDealer + 1) % N` (no draw). Shuffles `buildDeck(rules.deck, N)`; card `k` → seat `(dealer + 1 + k) % N`; trump = shuffled[`N·c`] (stock) or shuffled[`N·c − 1`] when whole deck dealt (`trumpCardInDealerHand true`); trumpCard is a copy. Sort: suit index in `rules.deck.suits`, then `compareRanks` high→low. Bids `null`, `tricksWon` 0, `currentTrick {leader: mano, plays: []}`, `toAct` mano, no `lastTrick` key. Iteration 5: next hand = `dealHand(state, handIndex + 1, hand.dealer)` plus the internal `handDealtEvent(handIndex, hand)` helper for the event.
- `legalMoves`: `RangeError` unless `seat` is an integer in `0…N−1` (internal `assertSeatInRange(state, seat)`, reuse it in `applyMove`) → `[]` if `hand === null` or seat ≠ `currentActor` → bidding: `{id:'bid:<n>', move:{type:'bid',seat,tricks:n}}` from `legalBids` → otherwise (playing): `{id:'play:<cardId>', move:{type:'play',seat,card}}` from `legalPlays`, `card` a **copy** (D-003).
- Internal `nextSeat(seat, N)` = `(seat + 1) % N`.
- `applyMove(state, seat, moveId)`:
  1. `assertSeatInRange` → `RangeError` (every phase, also at game over).
  2. `phase === 'game-over'` (or `hand === null`) → `IllegalMoveError('game-over')`; seat ≠ `currentActor` → `'not-your-turn'`; `moveId` not an `id` in `legalMoves(state, seat)` → `'unknown-move'`. Validation reads the input only; the move applied is the `LegalMove.move` found.
  3. **Single clone**: `const next = structuredClone(state)`, mutated in place and returned. Never mutate `state`; never copy sub-objects separately.
  4. `seats[seat].kind === 'ai'` → `aiDecisionCount += 1`. `version` never touched.
  5. Bid: `bids[seat] = n`, event `bid-made`; dealer → `phase 'playing'`, `toAct = next(dealer)`; else `toAct = next(seat)`.
  6. Play: card spliced from `hands[seat]` (by `cardId`), pushed to `currentTrick.plays`, event `card-played` (card copy); trick not full → `toAct = next(seat)`.
  7. Trick full (N plays): `winner = trickWinner(plays, trumpSuit, rules.deck)`, `tricksWon[winner]++`, `lastTrick = { winner, plays }` (the old plays array moves over), `currentTrick = { leader: winner, plays: [] }`, `toAct = winner`, event `trick-won { seat: winner, trickNumber = sum(tricksWon) }`.
  8. `trickNumber === cardsPerPlayer`: push `HandResult { handIndex, cardsPerPlayer, dealer, trumpSuit, bids, tricks: [...tricksWon] }` to `completedHands`, event `hand-completed` with a `structuredClone` of the result.
  9. Not last hand: `handIndex++`, `phase 'bidding'`, `hand = dealHand(next, handIndex, oldDealer)`, event `handDealtEvent(...)`. Last hand: `phase 'game-over'`, `hand = null`, `handIndex` unchanged, event `game-over`.
- **Event order per `applyMove`** (FR-235): `bid-made | card-played` → `trick-won` → `hand-completed` → `hand-dealt | game-over`, each only when it occurs. Events never share objects with the returned state (D-003). No Zod parsing in `applyMove`; schema conformance is test-side.

### Test helpers — `tests/unit/engine/helpers.ts` (import as `./helpers`)

```ts
card(id: string, deck = FRENCH_52): Card;          // parseCard
cards(ids: string, deck = FRENCH_52): Card[];      // 'KS AH 3H' → cards, order kept
trick(leader, ids, seatCount = 4, deck = FRENCH_52): TrickPlay[]; // seats leader, leader+1, … mod N
rulesWith(id: PresetId, { play?, bidding? } = {}): RuleSet;      // getPreset clone + shallow overrides
makeHand(overrides: Partial<HandState> = {}, seatCount = 4): HandState;
// defaults: cardsPerPlayer 4, dealer 0, trumpCard 2S, trumpCardInDealerHand false, trumpSuit 'S',
// hands [[]×N], bids [null×N], tricksWon [0×N], currentTrick { leader: 1, plays: [] }, toAct 1;
// no lastTrick key.
makeSeats(count: number, kinds: SeatInfo['kind'][] = []): SeatInfo[];
// seat i, playerId `p<i>`, name `Player <i>`, kind kinds[i] ?? 'human'.
newGame(id: PresetId, players: number, seed = 'seed-1'): Transition;
// createGame({ gameId: 'game-1', rules: getPreset(id), seats: makeSeats(players), seed }).
withHand(state: GameState, overrides: Partial<HandState>, phase = 'bidding'): GameState;
// clone of state with hand = makeHand(overrides, seats.length) and phase set (hand-built positions).

type Policy = (moves: LegalMove[], state: GameState) => LegalMove;   // moves non-empty; return one of them
const firstMove: Policy;   // moves[0]  (lowest bid / first card in hand order)
const lastMove: Policy;    // moves.at(-1) (highest bid / last card)
interface PlayedMove { seat: number; moveId: string; events: GameEvent[] }
interface PlayedGame {
  states: GameState[];   // [start.state, state after move 1, …]; length = moves.length + 1
  events: GameEvent[];   // [...start.events, ...every move's events]
  moves: PlayedMove[];   // moves[i] turned states[i] into states[i + 1]
  final: GameState;      // states.at(-1), phase 'game-over'
}
playGame(start: Transition, policy: Policy = firstMove, maxMoves = 10_000): PlayedGame;
// loop: actor = currentActor(state); legalMoves(state, actor); policy; applyMove — until actor null.
// Throws if maxMoves exceeded or an actor has no legal move. Never mutates start.
```

Usage: `const game = playGame(newGame('mexico-bazas', 3));` — every intermediate state for view/invariant
sweeps is `game.states`; the state right after hand `i` was dealt is `game.states[j + 1]` where `j` is the
move whose events contain `hand-dealt` with `handIndex i` (hand 0: `game.states[0]`). Each call replays a
full game (argentina 3p ≈ 981 moves, ~50 ms); memoise in a test file if used repeatedly.

`helpers.ts` now imports `@/src/engine/engine`, so every test that imports `./helpers` loads the engine.

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
- **Single-clone rule** (FR-227): any engine function returning a new state builds it from exactly one `structuredClone` of its input, mutated in place. Inputs are never mutated.
- **Events carry copies** (D-003): cards, results and seat lists in events are copies, never objects of the returned state.
- **Event order** (FR-235): `bid-made|card-played`, `trick-won`, `hand-completed`, `hand-dealt|game-over`.
- `tests/unit/engine/golden.test.ts` literals change only together with an `ENGINE_VERSION` bump.

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

- View (6), invariants (7) and docs (8) are not built yet.
- Still open for Iteration 6: VC-216 view part, VC-218 `tableViewFor(state, N)` rows (bidding and game-over).
- With the first-legal-move policy every bid is `0` (the dealer's forbidden value is `cardsPerPlayer`), so golden `completedHands` bids are all zero; `lastMove` gives non-trivial bids.
- `legalPlays` / `trickWinner` assume cards belong to `deck` (`compareRanks` throws `InvalidCardError` otherwise); they do not validate seats or turn.
- `int` accepts any `Number.isInteger` bounds, including unsafe integers beyond 2^53 (results there are imprecise); the spec only requires integers. Engine callers use small ranges.
- `docs/development.md` still says `@noble/hashes` "is added when the engine needs hashing"; Iteration 8 updates the docs.
