# Review ledger — 06-game-state-manager.md

Original line count: 326 · After pass 1: 357 · After pass 2: 357 (no MUST) · After pass 3: 358 · Readiness (pass 3): 2 MUST fixed; pass 4 delta: 0 MUST → READY

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 0 | DECISION | FR-613 | Where the Blob SDK-retry case is handled | decided | Operator: inside `commit`, re-read and byte-compare; identical → success |
| R-002 | 0 | DECISION | FR-600, FR-604, Scope Out | Who generates gameId and timestamps | decided | Operator: caller (service) supplies; state validates; index date = UTC date of `createdAt` |
| R-003 | 0 | DECISION | FR-611 | How much `commit` validates | decided | Operator: schema + version consistency (`version ≥ 1`, `state.version === version`); no tip+1 check |
| R-004 | 0 | DECISION | FR-615 | `eventsSince` past tip / invalid version | decided | Operator: `[]` when version ≥ tip; `RangeError` for negative/non-integer |
| R-005 | 0 | DECISION | Data (GameMeta) | meta.json contents and seat-token hash format | decided | Operator: lean meta; `seatTokenHashes` array by seat, lowercase hex SHA-256 or null for AI |
| R-006 | 0 | DECISION | FR-607, FR-608 | How meta is exposed / GameNotFound check | decided | Operator: separate `loadMeta`; `loadLatest` checks meta + commit 0 exist in parallel |
| R-007 | 0 | DECISION | FR-605 | `create` on an existing game | decided | Operator: a real clash → `GameExistsError`, stop (refined by R-018: retried writes are absorbed by a byte compare) |
| R-008 | 0 | DECISION | FR-616, FR-617 | final.json semantics | decided | Operator: create-only, all storage errors swallowed, input validation throws; add `readFinalScores` |
| R-009 | 1 | MUST | FR-608, Assumptions, VC-619 | Tip defined as "0…t all exist" but the algorithm and VC-619 use the probed tip | fixed | Tip = result of the forward probe; commits below the start are unchecked; Assumptions reworded |
| R-010 | 1 | MUST | FR-608, NFR-602, VC-625 | A literal step-2 order costs 6 calls, not 5 | fixed | Step 2 = parallel `get(s)` + `exists(s+1)`; read reused as the tip; VC-625 pinned to commits 0…5, head 5 |
| R-011 | 1 | MUST | FR-606 vs FR-607, VC-608 | After a step-3 failure, `loadMeta` returns meta, contradicting FR-606 | fixed | FR-606 split: step ≤ 2 → both NotFound; step 3 → only `loadLatest` NotFound; VC-608 updated |
| R-012 | 1 | MUST | FR-600, FR-604, VC-601 | Bad `meta.gameId` in `create`: InvalidGameIdError or InvalidCommitError? | fixed | `create` checks `meta.gameId` first → `InvalidGameIdError`; VC-601 updated |
| R-013 | 1 | SHOULD | Data comments, FR-602/604/611 | Cross-field rules only in comments; read vs write unclear | decided | Operator: schema refinements (checked on read and write); listed in FR-602; VC-603/606 |
| R-014 | 1 | SHOULD | FR-608 step 1 | Non-corrupt `head.json` errors unspecified | decided | Operator: propagate (first rejection wins); VC-610 |
| R-015 | 1 | SHOULD | HeadSchema | `head.version` ≥ 1e8 makes `commitKey` throw | fixed | `Head.version` bounded to `MAX_COMMIT_VERSION` → corrupt → no hint; VC-610 (g) |
| R-016 | 1 | SHOULD | VC-614, VC-620, FR-611 | FR-610 off-`load` paths, FR-616 version, orphan commit untested/unstated | fixed | VC-614/620 extended; orphan commit documented in FR-611 + VC-615 (operator: allow) |
| R-017 | 1 | SHOULD | FR-615 | `eventsSince` unbounded reads | decided | Operator: at most 8 in flight; NFR-602 formula; VC-619/625 |
| R-018 | 1 | SHOULD | FR-605, Assumptions | Blob SDK retry not acknowledged for `create` | decided | Operator: byte-compare meta/commit 0; marker "exists" = success; VC-607 rewritten |
| R-019 | 1 | COULD | BR-603 vs header | Allowed-import lists differ | fixed | BR-603 now names `storage`, `domain`, `zod`, Node built-ins and says no `src/config` (folded into the R-016 edits) |
| R-020 | 1 | COULD | FR-611, VC-615 | Fixed key order is unnecessary for the same-process byte compare | deferred | COULD |
| R-021 | 1 | COULD | FR-618 | development.md §2 "src/state empty" and implementation.md Phase 1 task 6 go stale | deferred | COULD |
| R-022 | 1 | COULD | FR-607, FR-610 | Identity checks on read are defence in depth without a stated reason | deferred | COULD |
| R-023 | 1 | COULD | FR-601 | Calendar check in `indexCreatedKey` could be a format check | deferred | COULD |
| R-024 | 1 | COULD | NFR-604 | 15 s test budget: no stated basis, manual CI read | deferred | COULD |
| R-025 | 1 | COULD | FR-617 | `final.json` gameId not checked against key | deferred | COULD |
| R-026 | 1 | COULD | VCs | No single end-to-end VC | deferred | COULD |
| R-027 | 1 | COULD | FR-613 | Inline rationale for the same-process byte compare | deferred | COULD |
| R-028 | 2 | SHOULD | FR-608 step 2 | Corrupt commit `s` read while `s+1` exists: propagate or ignore? | deferred | Delta pass; not a blocker |
| R-029 | 2 | SHOULD | FR-609, FR-611, VC-615 | `load(g2, v)` on an orphan commit must not return it; FR-609 order unstated | deferred | Delta pass; not a blocker |
| R-030 | 2 | SHOULD | FR-602 | "a real instant" undefined (Date.parse vs round-trip) | deferred | Delta pass; not a blocker |
| R-031 | 2 | SHOULD | VC-603 | "Each FR-602 rule is broken once" but list misses gameId, `at`, version range, two null cases | deferred | Delta pass; not a blocker |
| R-032 | 2 | COULD | FR-608 | No terminal case if fallback `s = 0` is missing | deferred | COULD |
| R-033 | 2 | COULD | Assumptions | Byte-determinism assumption should cover meta; gap above probe start | deferred | COULD |
| R-034 | 2 | COULD | FR-602 Head, FR-608 | Probe of `s+1` at `MAX_COMMIT_VERSION` throws RangeError | deferred | COULD |
| R-035 | 3 | MUST | FR-610 vs FR-613 | Conflict re-read: CorruptObjectError (FR-610) or CommitConflictError (FR-613)? | fixed | FR-610 excludes the FR-613/FR-605 re-reads; they compare raw bytes only |
| R-036 | 3 | MUST | VC-620 | "the six fields from board" but FinalScores stores four + version | fixed | VC-620 states the exact document |
| R-037 | 4 | SHOULD | FR-602 | "reading method rejects with CorruptObjectError" could cover the byte-compare re-reads | deferred | Delta pass; not a blocker |
| R-038 | 4 | COULD | Changelog, FR-610 wording, VC-620 fixture | Name FR-605 in changelog; "commit read" vs meta re-read; fixture with `live`/`hands` | deferred | COULD |
