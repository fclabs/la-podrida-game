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
