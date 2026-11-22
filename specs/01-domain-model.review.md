# Review ledger — 01-domain-model.md

Original line count: 324 · After pass 1: 339

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 0 | DECISION | Preset sequences | Spain/Mexico top-count hands | decided | Operator: exactly N; `offset` bound (BR-102) |
| R-002 | 0 | DECISION | Scope | GameMeta/Commit/CommitBody placement | decided | Operator: defer to Phase 6 |
| R-003 | 1 | SHOULD | FR-118/VC-117 | Types duplicated by hand + assignability test; mechanism unclear in Vitest 5 | fixed | Types are `z.infer` of schemas; VC-117 uses `expectTypeOf` inside `test()` incl. not-`any` |
| R-004 | 1 | SHOULD | NFR-101/VC-119 | CI timing budget noisy | fixed | Dropped; widened purity grep |
| R-005 | 1 | SHOULD | Scope/FR-119 | Module placement of types unspecified | fixed | Module exports table; no barrel |
| R-006 | 1 | SHOULD | FR-120/VC-118 | design §4.1/§4.2 left contradicting spec | fixed | FR-120 covers §4.1 and §4.2 `id` |
| R-007 | 1 | SHOULD | FR-115 | removeRanksForPlayers key schema / Zod numeric coercion | fixed | `^[1-9][0-9]*$` strings; `'03'`,`'0'` fail in VC-114 |
| R-008 | 1 | COULD | Score/view types | Mark provisional | deferred | |
| R-009 | 1 | COULD | tieBreak | Narrow to fewest-misses | wontfix | Design keeps both modes |
| R-010 | 1 | COULD | Schema notes | `{min:[n]}` n≥1, handPlan ≥1 | deferred | |
| R-011 | 1 | COULD | FR-108/112 | Freeze deck constants | deferred | |
| R-012 | 1 | COULD | FR-115/116 | Nested strictObject mutations in VCs | deferred | |
| R-013 | 2 | SHOULD | VC-117 | Unused imports in type test would fail lint | deferred | Delta pass; plan must reference each import |
| R-014 | 2 | SHOULD | VC-117/FR-118 | Only 4 fields checked; use toEqualTypeOf per listing | deferred | Delta pass; plan to adopt exact equality |
| R-015 | 2 | SHOULD | FR-120 | design.md would reference undefined PresetId | deferred | Delta pass; plan to declare PresetId in §4.2 |
| R-016 | 2 | COULD | Module exports | "type modules" undefined; cards↔decks type-only import; table completeness; Phase vs inferred | deferred | |

## Passes
- Pass 1 (discovery, 3 reviewers): 0 MUST; 5 SHOULD fixed (R-003–R-007).
- Pass 2 (delta): 0 MUST; R-013–R-016 deferred to the plan.
- Pass 3 (readiness): 0 MUST. **Verdict: READY.** Minor latitude noted: trumpSuit membership check, non-empty gameId, `__proto__` guard in getPreset.
