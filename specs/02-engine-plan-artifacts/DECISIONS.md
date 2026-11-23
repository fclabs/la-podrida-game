# DECISIONS — Game Engine (Phase 2)

Decisions locked in while implementing `specs/02-engine-plan.md`. Append only; each entry uses
`## D-NNN: <title>  (Iteration N)` with Context / Decision / Rejected / Consequences.

## D-001: `rngFromSource` coerces each draw with `>>> 0`  (Iteration 1)

**Context**: FR-200 says `next` returns uint32 values but does not say what happens if a stub returns something else (negative, fractional, ≥ 2^32), which would make `min + u % range` leave `[min, max]`.
**Decision**: `int` reads every draw as `next() >>> 0`. For valid uint32 values this is the identity, so FR-200/FR-202 behaviour and every VC output are unchanged.
**Rejected**: using the raw value as-is (out-of-range results on a bad stub); throwing on non-uint32 (extra API surface the spec does not ask for).
**Consequences**: stub sources in later tests should still return uint32 values; a value like `-1` is read as `2**32 − 1`.

## D-002: `trickWinner` throws `RangeError` on an empty trick  (Iteration 3)

**Context**: FR-225 defines `trickWinner` for "the plays of a complete trick"; it does not say what an empty `plays` array returns, and `plays[0]` would be `undefined`.
**Decision**: `trickWinner([], …)` throws `RangeError('trickWinner needs at least one play')`. Non-empty inputs (every spec case) are unaffected.
**Rejected**: returning `-1` or `undefined` (a seat-typed value that is not a seat); letting it crash with a `TypeError`.
**Consequences**: `engine.ts` only calls it with a full trick (N plays), so this path is never hit from the engine.

## D-003: Moves and events carry card copies, never state objects  (Iteration 4)

**Context**: `legalPlays` returns the hand's own `Card` objects (Iteration 3); the spec does not say whether `LegalMove.move.card` or the `hand-dealt` / `game-started` payloads may share objects with the state.
**Decision**: `legalMoves` puts `{ ...card }` in each play move; `hand-dealt.trumpCard` is a copy; `game-started` carries `structuredClone(seats)` and a copy of `handPlan`. `dealHand` also stores a copy as `hand.trumpCard`.
**Rejected**: sharing the state's objects (a caller mutating a move or event would corrupt the state).
**Consequences**: Iteration 5 events (`card-played`, `hand-completed`, …) should follow the same rule; tests compare cards by value or `cardId`, not identity.

## D-004: `createGame` problem granularity  (Iteration 4)

**Context**: FR-211 lists the checks and the "one cause, one problem" rule for rules/player range/expansion, but not how many problems a multi-seat failure produces.
**Decision**: one problem per seat whose `seat !== i`, one per seat failing `SeatInfoSchema`, one per duplicated `playerId` value; order: rules → player range → expansion → seats → duplicates → `gameId` → `seed`. A non-array `seats` is one problem (`seats must be an array`).
**Rejected**: one aggregate problem per check type (hides which seats are wrong).
**Consequences**: VC-211 rows with a single cause give exactly one problem (asserted for 2-seat argentina, 7-seat spain, robot kind, duplicate id, empty gameId/seed, bad sequence); seats `[0,2,1]` give two.

## D-005: `playGame` test-helper contract  (Iteration 5)

**Context**: The plan asks for `playGame(transition, policy)` returning "every state and every event"; Iterations 6–7 import it in parallel and may not edit `helpers.ts`, so its shape must be fixed now.
**Decision**: `playGame(start, policy = firstMove, maxMoves = 10_000): PlayedGame` with `Policy = (moves, state) => LegalMove`, `PlayedGame = { states, events, moves, final }` where `states[0] === start.state`, `events` begins with `start.events`, and `moves[i] = { seat, moveId, events }` turned `states[i]` into `states[i + 1]`. Policies `firstMove` and `lastMove` are exported constants. It throws on exceeding `maxMoves` or an actor with no legal move.
**Rejected**: returning only `{ states, events }` (tests could not tell which events a given move produced); a generator API (harder to sweep twice).
**Consequences**: view and invariant sweeps iterate `game.states`; per-move event checks use `game.moves`. The perf test does not use `playGame` (it keeps no history, to time the move loop only).

## D-006: `tableViewFor` keeps a private copy of the FR-219 seat check  (Iteration 6)

**Context**: FR-219 requires `tableViewFor` to throw `RangeError` for an out-of-range seat; `engine.ts` has the check as a private `assertSeatInRange`, and the parallel-group rules forbid editing `engine.ts` in Iteration 6.
**Decision**: `view.ts` defines its own private `assertSeatInRange(state, seat)` with the same condition (`Number.isInteger(seat) && 0 <= seat < N`) and the same message (`seat <s> is outside 0–<N−1>`). Any value other than `'spectator'` goes through it.
**Rejected**: exporting it from `engine.ts` (outside this iteration's files, and it would widen the spec's export table); skipping the check for views.
**Consequences**: two identical 4-line checks; keep them in sync, or export one from `engine.ts` in a later, non-parallel change.

## D-007: Game-over view shape and copy rules  (Iteration 6)

**Context**: FR-237 fixes the game-over values but not what `tableViewFor` does when `hand` is `null` outside `game-over`, or when `completedHands` is empty; FR-236 says "copy" without saying how deep.
**Decision**: the game-over shape is used whenever `phase === 'game-over'` or `hand === null` (same rule as `currentActor`/`applyMove`); `dealer = completedHands.at(-1)?.dealer ?? 0`. Every array and card in the view is fresh (cards copied as `{ suit, rank }`), so no view object is reachable from the state.
**Rejected**: throwing on a `null` hand outside game-over or on empty `completedHands` (neither occurs in a valid state; views stay total like `currentActor`); shallow array copies sharing `Card` objects with the state.
**Consequences**: Phase 4's `PlayerView` can extend the view without cloning; malformed states are reported by `checkInvariants` (g)/(i), not by the view.

## D-008: (e) is checked only when every bid is set  (Iteration 7)

**Context**: FR-239 (e) says the sum of bids ≠ `cardsPerPlayer` once bidding has closed, but a `playing` state may hold a `null` bid (itself an (d) violation), which leaves the sum undefined.
**Decision**: (e) runs in `playing`, when the dealer restriction applies (`dealerRestriction` and `cardsPerPlayer` not exempt), and only if no bid is `null`; "bidding closed" = `phase === 'playing'`.
**Rejected**: treating `null` as 0 (could report a sum violation caused only by the missing bid, double-reporting one cause); also checking at game-over with a non-null hand (that is a (g) state).
**Consequences**: one cause, one message: a null bid gives only `(d)`.

## D-009: (f) is also skipped when `cardsPerPlayer` exceeds the deck size  (Iteration 7)

**Context**: FR-240 requires `checkInvariants` never to throw on a schema-valid state. The schema allows any safe-integer `cardsPerPlayer`; (f) calls `legalMoves` → `legalBids`, which allocates `cardsPerPlayer + 1` entries and throws `RangeError` at 2^32 (memory runs out far earlier).
**Decision**: besides the spec's "(a) or (b) failed", (f) is skipped when `hand.cardsPerPlayer > buildDeck(rules.deck, N).length` — no real hand can be that large. No extra message is added (the spec defines no such rule).
**Rejected**: `try/catch` around `legalMoves` (the plan forbids it); a new rule reporting the oversized count (not in the spec's rule list); bounding by `maxCardsPerPlayer` (would skip (f) on states where it is still computable).
**Consequences**: such a state is usually caught by (c) or (h); if both pass, nothing is reported (Known gap).
