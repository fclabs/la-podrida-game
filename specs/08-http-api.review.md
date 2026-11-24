# Review ledger — specs/08-http-api.md

Original length: 299 lines. After pass 1: see bottom.

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 1 | MUST | FR-803 / VC-805 | Zod 4 `unrecognized_keys` has `path: []`, so the "top-level path segment" rule can't name `seed` | fixed | FR-803: use `issue.keys[0]` for `unrecognized_keys`; VC-805 asserts exact messages |
| R-002 | 1 | SHOULD | Purpose / FR-820 | "Completes M2" contradicts the implementation.md M2 row (preview latency) | fixed | Purpose: "local part of M2"; FR-820 also edits the M2 row |
| R-003 | 1 | SHOULD | FR-817–819 | In-process bench doesn't measure a Vercel move request (can't close OQ 1); built before its consumer | decided | Operator: move the benchmark script to Phase 5b/11. FR-817–819, VC-832/833 (old), BR-805 exception removed; Scope Out says why |
| R-004 | 1 | SHOULD | NFR-801 / VC-834 | Overhead p95 ill-defined (unpaired games) and flaky in CI | decided | Operator: drop NFR-801 |
| R-005 | 1 | SHOULD | NFR-802 | "CI Test step time for tests/api" not measurable (step runs all suites) | fixed | Measured as `vitest run tests/api` Duration |
| R-006 | 1 | SHOULD | FR-813 | Handler signature `(request, context, deps)` contradicts the no-param handlers `(req, deps)` | fixed | FR-813 states both shapes |
| R-007 | 1 | SHOULD | BR-804, BR-805 | No VC | fixed | New VC-832 static check |
| R-008 | 1 | SHOULD | FR-802 | Missing Content-Type, byte vs char counting, 413-vs-400 precedence unspecified | fixed | FR-802 ordered checks; raw bytes; VC-802/803 extended |
| R-009 | 1 | SHOULD | VC-833 (old) | Bench case runner undefined | fixed | Moot: benchmark removed (R-003) |
| R-010 | 1 | COULD | FR-814 | `seat` for 403/410/422 and `durationMs` rounding unspecified | fixed | Folded with the FR-814 wording edit (seat null unless an update is returned; Math.round); VC-827 extended |
| R-011 | 1 | COULD | FR-814/816 | "Every request emits" vs level gating | fixed | "Subject to FR-816" (same edit) |
| R-012 | 1 | COULD | FR-811 / VC-825 | Description content ("names deck and hand-sequence shape") not verified | fixed | Requirement relaxed to a 1–200 char summary sentence |
| R-013 | 1 | COULD | FR-816 | Drop LOG_LEVEL gating | wontfix | Operator chose gating during discovery |
| R-014 | 1 | COULD | Data & Interfaces | Drop Error/Presets response schemas | deferred | Not a blocker |
| R-015 | 1 | COULD | Purpose | Split goal from deliverables | deferred | Not a blocker |
| R-016 | 1 | COULD | FR-813 / Assumptions | Record reliance on Node runtime default and Cache Components off | deferred | Not a blocker |
| R-017 | 1 | COULD | FR-802 | Rationale for the 16 KB cap | fixed | One clause added in the FR-802 rewrite |
| R-018 | 1 | COULD | FR-818 | Memory driver shares one store | fixed | Moot: benchmark removed |
| R-019 | 1 | COULD | FR-819 | Add targetMs to bench output | fixed | Moot: benchmark removed |
After pass 1:      283 lines.

## Pass 2 (delta) — 0 MUST

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-020 | 2 | SHOULD | FR-820 / VC-836 | Other implementation.md lines (17, 283, 320, 330) still place the benchmark in Phase 8 | deferred | Delta pass; not a blocker |
| R-021 | 2 | SHOULD | BR-805 | Scope vs `errors.ts`/`schemas.ts` needing `src/state` errors and `MAX_COMMIT_VERSION` | deferred | Delta pass; VC-832 already scopes to handlers.ts + route.ts |
| R-022 | 2 | SHOULD | FR-802 step 3 | "Valid UTF-8" unenforced by default `request.text()` | deferred | Delta pass |
| R-023 | 2 | SHOULD | FR-803 | Unknown key vs other invalid field: which is named first | deferred | Delta pass |
| R-024 | 2 | COULD | FR-814 | `update.view.you`; `aiMoves` "responding seat" term | deferred | — |
| R-025 | 2 | COULD | Purpose | Blob checks stay in 5b; only the move benchmark moves | deferred | — |
| R-026 | 2 | COULD | Header | `headKey` no longer used | deferred | — |
| R-027 | 2 | COULD | VC-803 | How to send a request with no Content-Type | deferred | — |

## Pass 3 (readiness) — 2 MUST

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-028 | 3 | MUST | BR-801 | Exception only covers the dealer-hand trump; the engine shows the turned-up stock card as trump on non-full deals | fixed | Exception = each hand's public `trumpCard`; revealed cards from earlier hands allowed |
| R-029 | 3 | MUST | VC-831 | `{suit,rank}` match across the whole body fails on earlier-hand events (reshuffled deck) | fixed | Check split by location: view (excl. trick/trump), trump equality, event card positions; key checks at any depth |

## Pass 4 (delta on R-028/R-029) — 0 MUST

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-030 | 4 | SHOULD | VC-831 | Game-over expectations (trumpCard null, yourHand [], empty stock) not stated | deferred | Delta pass; passed to write-spec-plan for test design |
| R-031 | 4 | SHOULD | VC-831 | Stock needs this hand's played cards, which `loadLatest` state doesn't hold | deferred | Same |
| R-032 | 4 | SHOULD | VC-831 | `legalMoves` and other non-view fields no longer checked for foreign cards | deferred | Same |
| R-033 | 4 | COULD | VC-831 (c) | Check `card-played.card` values | deferred | — |
| R-034 | 4 | COULD | BR-801 | Exceptions field could mention revealed cards | deferred | — |

## Verdict: READY

Passes: 1 discovery (3 reviewers) → 1 delta → 1 readiness → 1 delta. Verified MUST trend: 1 → 0 → 2 → 0.
Spec size: 299 → 288 lines.
