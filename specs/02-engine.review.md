# Review ledger — 02-engine.md

Original line count: 269 · After pass 1: 272 · After pass 2: 272

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 0 | DECISION | FR-234 | State at game-over | decided | Operator: `hand: null`, `handIndex` stays last |
| R-002 | 0 | DECISION | FR-217/221/223 | Card and legal-move order | decided | Operator: sorted hands; plays in hand order; bids ascending |
| R-003 | 0 | DECISION | FR-205/213 | RNG derivation encoding | decided | Operator: SHA-256 of JSON.stringify([seed,...labels]), first 16 bytes LE; dealer drawn before shuffle |
| R-004 | 0 | DECISION | FR-211 | Invalid createGame input | decided | Operator: validate and throw `InvalidGameSetupError` with every problem |
| R-005 | 0 | DECISION | FR-239 | checkInvariants API | decided | Operator: returns `string[]` |
| R-006 | 0 | DECISION | FR-241 | ENGINE_VERSION format | decided | Operator: integer 1 |
| R-007 | 0 | DECISION | NFR-203 | Perf threshold | decided | Operator: full argentina 3p game < 250 ms |
| R-008 | 0 | DECISION | FR-219 | Out-of-range seat | decided | Operator: `RangeError` |
| R-009 | 1 | MUST | VC-202/VC-204, rng.ts exports | Stub-source tests not writable from the exported API | fixed | Added FR-200 `rngFromSource(next)`; VC-202/204 use it with exact expected values |
| R-010 | 1 | SHOULD | NFR-203/VC-236 | Wall-clock assertion flaky; method unspecified | fixed | Threshold kept (R-007); measured as median of 5 loop-only runs after a warm-up; rationale added |
| R-011 | 1 | SHOULD | FR-235 | Runtime Zod parse vs test-side property ambiguous | fixed | Test-side property; engine parses only in `createGame` |
| R-012 | 1 | SHOULD | FR-241 | Missed ENGINE_VERSION bump undetectable | fixed | VC-237 literal golden fixture |
| R-013 | 1 | SHOULD | Assumptions/VC-205 | `@noble/hashes/sha2` path wrong for 2.x | fixed | Verified 2.4.0 export map: `./sha2.js`, `./utils.js`; pinned 2.4.0 (NFR-202) |
| R-014 | 1 | SHOULD | FR-227 | Copy strategy undecided | fixed | One `structuredClone` per `applyMove`, mutated in place |
| R-015 | 1 | SHOULD | FR-211 | Schema-valid rules whose sequence fails to expand | fixed | Reported as an `InvalidGameSetupError` problem; schema failure = one problem, dependent checks skipped; VC-211 row |
| R-016 | 1 | SHOULD | FR-239/240 | checkInvariants could throw on schema-valid malformed state | fixed | Structural checks (s) first; others skipped on failure; VC-233 rows |
| R-017 | 1 | SHOULD | VC-216/VC-230 | Card-id substring leak check proves nothing | fixed | Recursive Card walk compared by `cardId` |
| R-018 | 1 | SHOULD | VC-214 | "skip the dealer draw" contradicts FR-213 | fixed | Draw and discard `int(0, N−1)` first |
| R-019 | 1 | SHOULD | VC-220 | Rows: hand order, led card missing, flag missing | fixed | Rows list sorted hands, led card, flags, exact outputs |
| R-020 | 1 | COULD | FR-211 | Report first problem only | deferred | Conflicts with operator decision R-004 |
| R-021 | 1 | COULD | FR-201 | Throw on all-zero state instead of replacing | deferred | — |
| R-022 | 1 | COULD | FR-242/VC-235 | `hand: null` already in design §4.5 | deferred | — |
| R-023 | 1 | COULD | — | "Key decisions" list with reasons | deferred | — |
| R-024 | 1 | COULD | NFR-203 | Link threshold to 500 ms p95 | deferred | Rationale line added in R-010 |
| R-025 | 1 | COULD | FR-239 (c) | Tricks-count check tautological | deferred | — |
| R-026 | 1 | COULD | Purpose | "bidding closed … with their events" has no event | deferred | — |
| R-027 | 2 | MUST | VC-220 row 2 | Hand listed unsorted despite "sorted per FR-217" header | fixed | `hold KS, AH, 3H` (reviewer SHOULD; upgraded: contradiction) |
| R-028 | 2 | MUST | FR-239/FR-240 | (f) can throw on off-deck cards a schema-valid state allows | fixed | (f) skipped when (a)/(b) fail (upgraded: contradicts FR-240) |
| R-029 | 2 | MUST | FR-239 (s) | `hand.*` checks unguarded for `hand: null`; N undefined | fixed | `N = seats.length`; hand checks only when non-null |
| R-030 | 2 | MUST | FR-211 | Wrong player count yields two problems | fixed | Expansion skipped when player-range fails |
| R-031 | 2 | SHOULD | FR-241 | "fails on any such change" overclaims VC-237 | fixed | Reworded as tripwire on its path |
| R-032 | 2 | COULD | NFR-203, VC-214, VC-237 order | Rationale number, "discard" wording, VC order | fixed | 0.25 ms/≈981 moves; "draw the dealer"; VC-237 after VC-236 |
| R-033 | 2 | COULD | FR-227 | Events may alias returned state | deferred | — |
| R-034 | 2 | COULD | VC-216/VC-230 | Define what the walk treats as a Card | deferred | — |
| R-035 | 3 | MUST | FR-219/FR-226/VC-218 | Error precedence for out-of-range seat on game-over state | fixed | Range check first in every phase (follows operator decision R-008); VC-218 row added |
| R-036 | 4 | COULD | FR-219/VC-218 | Move "first, in every phase" into FR-219; prefix "On a bidding state"; game-over rows for legalMoves/tableViewFor | deferred | — |

Verdict: **READY** after 4 passes (discovery ×3 parallel, delta, readiness, delta). Verified MUSTs: 1 → 4 → 1 → 0.
