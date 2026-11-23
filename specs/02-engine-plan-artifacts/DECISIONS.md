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
