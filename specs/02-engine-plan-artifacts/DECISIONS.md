# DECISIONS — Game Engine (Phase 2)

Decisions locked in while implementing `specs/02-engine-plan.md`. Append only; each entry uses
`## D-NNN: <title>  (Iteration N)` with Context / Decision / Rejected / Consequences.

## D-001: `rngFromSource` coerces each draw with `>>> 0`  (Iteration 1)

**Context**: FR-200 says `next` returns uint32 values but does not say what happens if a stub returns something else (negative, fractional, ≥ 2^32), which would make `min + u % range` leave `[min, max]`.
**Decision**: `int` reads every draw as `next() >>> 0`. For valid uint32 values this is the identity, so FR-200/FR-202 behaviour and every VC output are unchanged.
**Rejected**: using the raw value as-is (out-of-range results on a bad stub); throwing on non-uint32 (extra API surface the spec does not ask for).
**Consequences**: stub sources in later tests should still return uint32 values; a value like `-1` is read as `2**32 − 1`.
