# Review ledger — 03-score-engine.md

Original line count: 150 · After pass 1: 151 · After pass 2: 151 (no edits) · Readiness (pass 3): READY, 0 MUST

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 0 | DECISION | FR-305 | Place numbering after a shared place | decided | Operator: competition numbering (1, 1, 3) |
| R-002 | 0 | DECISION | FR-304/FR-308 | Live status for a seat with no bid | decided | Operator: `on-track`; `live` present whenever a hand is in progress, absent at game over |
| R-003 | 0 | DECISION | FR-303/FR-309 | Malformed input to scoring | decided | Operator: shape checks throw `RangeError` |
| R-004 | 0 | DECISION | FR-305/FR-306 | Ranking mid-game and listing order of shared places | decided | Operator: same rule mid-game and at game over; shared places listed by seat ascending |
| R-005 | 1 | SHOULD | NFR-303 | "Must not dominate" rationale inconsistent with 1 ms vs 0.25 ms/move | fixed | Rationale reframed as a safety ceiling (linear walk, CI noise); 29 hands = longest default-preset plan |
| R-006 | 1 | SHOULD | FR-303/FR-309/VC-310 | Error message location wording differs between scoreHand and evaluate | fixed | FR-309: message contains literal `completedHands[k]` or `hand`, also for FR-303 failures |
| R-007 | 1 | SHOULD | FR-309 | Current-hand `tricksWon[i]` and `cardsPerPlayer` not checked | fixed | Added to FR-309; VC-310 rows |
| R-008 | 1 | SHOULD | VC-308 | Expected totals left to the test writer | fixed | Concrete two-hand data, expected totals/counts/ranking incl. a misses tie-break |
| R-009 | 1 | COULD | FR-301/FR-304 | Per-argument validation repeated in helpers | deferred | Public helpers; not a blocker |
| R-010 | 1 | COULD | Data & Interfaces | `LiveStatus` restates domain union | deferred | |
| R-011 | 1 | COULD | FR-311 | design §6.1 interface to list `rankSeats`/`liveStatus` | deferred | |
| R-012 | 1 | COULD | VC-314 | Name perf test file, seed, policy | deferred | |
| R-013 | 1 | COULD | BR-301 | Clarify "never stored" vs commit snapshots (design §6.3) | deferred | |
| R-014 | 1 | COULD | FR-300/FR-301 | Arg names `bid`/`tricks`; `-0` rule only in VC-302 | deferred | |
| R-015 | 1 | COULD | VC-310/VC-304/VC-313 | Extra length rows; scoreHand no-mutation check; stale-ref grep precision | deferred | |
| R-016 | 2 | SHOULD | FR-309/VC-310 | Literal `hand` location is a substring of `handIndex`; weak assertion | deferred | Delta pass; not a blocker |
| R-017 | 2 | COULD | VC-310 | No row for a non-integer current-hand bid | deferred | |
| R-018 | 2 | COULD | VC-308 | Current hand fields (`cardsPerPlayer 15`, `tricksWon`) not stated | deferred | |
