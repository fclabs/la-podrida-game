# Review ledger — specs/10-retention.md

Original: 218 lines.

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 1 | SHOULD | Scope / FR-1014 vs VC-1017 | "no 500-game fixtures" contradicted a 600-game VC | fixed | VC-1017 replaced by a real-layout end-to-end VC; no large fixtures remain |
| R-002 | 1 | SHOULD | FR-1015 / VC-1020 | Renumbering Known limitations forces a §-reference audit | wontfix | House convention (specs 06–09 insert the new section before Known limitations); the grep VC stays |
| R-003 | 1 | SHOULD | NFR-1002 / VC-1017 | 5 s wall-clock assertion is flaky and says nothing about Blob | fixed | NFR-1002 and the timing assertion deleted; Phase 11 measures real `durationMs` |
| R-004 | 1 | COULD | VC preamble | Run every VC on both stores is more than needed | deferred | Kept: Phase 10 "Done when" requires both stores |
| R-005 | 1 | COULD | FR-1012 / VC-1013 | Info line regardless of log level is a special case | deferred | Kept (Should) |
| R-006 | 1 | COULD | VC-1018 | Static import test duplicates lint | rejected | Lint does not apply to `app/api/**` (eslint.config.mjs ignores it); the static test is the enforcement |
| R-007 | 1 | SHOULD | FR-1013 / VC-1014 | `export const maxDuration` blocked by "exports only GET" | decided | Operator: accept the platform default time limit; recorded in Key decisions; resume covers cut-off runs |
| R-008 | 1 | SHOULD | NFR-1002/1003 | Call bound `500 × (10,000 + 1)` meaningless and inconsistent | fixed | Reworded as NFR-1002 (bounded work) |
| R-009 | 1 | SHOULD | Assumptions | Vercel Cron facts (UTC, production only, Hobby hour precision) | fixed | Added to the first assumption |
| R-010 | 1 | SHOULD | FR-1014 | Default `getStore` binding ambiguous | fixed | `getStore: createObjectStore` |
| R-011 | 1 | COULD | VC-1019 | Lint does not enforce app/api layering | fixed | VC-1019 dropped; VC-1018 states it is the enforcement; VC-1019 reused for the k = 0 case |
| R-012 | 1 | SHOULD | FR-1001 / FR-1009 | Config vs auth vs `getStore` order unspecified | fixed | Order stated in FR-1001; VC-1001 covers `ConfigError` |
| R-013 | 1 | SHOULD | FR-1009 / FR-1012 | Error line `route` value not pinned | fixed | `'cron/cleanup'` in FR-1009 and VC-1008 |
| R-014 | 1 | SHOULD | FR-1006 | Behaviour at exactly the cap | fixed | Stated "no look-ahead"; VC-1006 case added |
| R-015 | 1 | SHOULD | VC-1010 | Fixture unbuildable (`not-a-date` sorts after digits) | fixed | Concrete keys and walk order, `skippedMarkers: 3` |
| R-016 | 1 | SHOULD | VC-1002 | 2026 is not a leap year | fixed | Uses 2028-03-01 |
| R-017 | 1 | SHOULD | FR-1000 / BR-1004 | Constant-time compare has no VC | fixed | Added to VC-1018(b) |
| R-018 | 1 | SHOULD | VC-1007 | Fault point ambiguous | fixed | "second `list` of `games/{id}/`" |
| R-019 | 1 | SHOULD | FR-1001 | 401 message text and logging unstated | fixed | Message reused unchanged; no log line; VC-1001 |
| R-020 | 1 | COULD | VC set | No automated end-to-end on the real layout | fixed | VC-1017 |
| R-021 | 1 | SHOULD | FR-1004 | Empty-listing / k = 0 case implied only | fixed | VC-1019 |
| R-022 | 2 | SHOULD | FR-1001 / FR-1009 | `ConfigError` path: is the error log line written (gamesDeleted 0)? | deferred | Delta pass; not a blocker |
| R-023 | 2 | SHOULD | VC-1018(b) | Static "applied to the secret" check can trip on null checks | deferred | Delta pass; plan to scope the check to the secret and header identifiers |
| R-024 | 2 | SHOULD | NFR-1002 | VC-1006 and VC-1011 do not cite NFR-1002 | deferred | Delta pass |
| R-025 | 2 | COULD | VC-1017 | Clock derived from the real creation time | deferred | Delta pass |
| R-026 | 2 | COULD | VC-1001 | Header value of the cronSecret-unset case | deferred | Delta pass |
| R-027 | impl | SHOULD | VC-1022 | File store leaves empty `games/<id>/commits` folders (`FileObjectStore.delete` removes files only), so "games/<id> no longer exists" cannot hold | decided | Operator: amend the wording to "no file remains under games/<id>/"; src/ and spec 05 unchanged |
