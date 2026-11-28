# Review ledger — specs/11-deploy-and-launch.md

Original: 194 lines. After pass 1: 204 lines (+5%).

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 1 | MUST | NFR-2, VC-1137 vs BR-1103 | Unconditional p95 < 500 cannot hold under a latency waiver | fixed | NFR-2 and VC-1137 accept a recorded FAILED + WAIVED pair |
| R-002 | 1 | MUST | VC-1129, FR-1129 | Rollback rehearsal on Preview impossible (production only) | fixed | VC-1129 is a docs check; FR-1129 states production-only |
| R-003 | 1 | SHOULD+DECISION | BR-1102, FR-1109 | Transient errors / unordered listing have no path | decided | Operator: rerun once for transient errors (FR-1126); violation needs §6.3 redesign; unordered listing blocks but is waivable (BR-1102, VC-1138) |
| R-004 | 1 | SHOULD+DECISION | NFR-2, NFR-4 | Latency only on Preview from operator's machine | decided | Operator: Preview-only proxy; stated in NFR-2, FR-1122; regions recorded |
| R-005 | 1 | SHOULD | FR-1121, NFR-2, VC-1115 | Five cold runs (~75 min) gate nothing | decided | Operator: one cold run |
| R-006 | 1 | SHOULD | FR-1105, VC-1105 vs BR-1101 | Production CRON_SECRET timing contradicts the gate | fixed | FR-1105 Preview only; Production secret in FR-1123; VC-1105 split |
| R-007 | 1 | SHOULD | FR-1121 | Launch order, merge point, post-merge records undefined | fixed | Numbered sequence in FR-1121 |
| R-008 | 1 | SHOULD | FR-1104, VC-1104, Data | Blob store id variable unnamed; local token source unspecified | fixed | Named `BLOB_STORE_ID`; local token procedure in FR-1104 and Assumptions |
| R-009 | 1 | SHOULD | VC-1114, VC-1106, VC-1111, VC-1110 | VCs lacked a mechanism | fixed | Read-back in FR-1114; header clause dropped; SIGINT + stderr runId in FR-1111; exit 2 for missing token |
| R-010 | 1 | SHOULD | FR-1114/1116/1118 | Version-0 stale hint, baseline ordering, single legal move | fixed | Stated in each FR |
| R-011 | 1 | SHOULD | VCs | No end-to-end "launch complete" VC; no production failure path | fixed | VC-1139; FR-1125 and FR-1129 cover failure |
| R-012 | 1 | SHOULD | NFR | Hobby Blob quota budget missing; no request timeout | fixed | NFR-4 |
| R-013 | 1 | SHOULD | VC-1101/1103/1136 | CLI outputs may not show repo/env scoping | fixed | Dashboard authoritative, CLI cross-check |
| R-014 | 1 | SHOULD | Purpose | End states unclear | fixed | One sentence added |
| R-015 | 1 | SHOULD | FR-1109 | `complete` field gates nothing | fixed | Removed |
| R-016 | 1 | SHOULD | FR-1110 | Composite `passed` undefined | fixed | Defined per section |
| R-017 | 1 | SHOULD | FR-1127 / FR-1128 | Defer FR-1127; avoid renumbering development.md | wontfix | Spec 10 explicitly leaves listing-order verification to Phase 11; earlier phases renumbered the same way |
| R-018 | 1 | COULD | FR-1118 steps 7, 8 | Duplicates frozen API tests | wontfix | They exercise the real Blob path, which API tests (memory store) never did |
| R-019 | 1 | COULD | FR-1116 | Drop `baselineMedianMs` | wontfix | Kept: it documents network distance for the proxy claim (R-004) |
| R-020 | 1 | COULD | rationale | Sample sizes, 15 min idle, two stores, NFR-3 threshold, "no violation observed" wording | deferred | Optional |

## Pass 2 (delta)

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-021 | 2 | MUST | BR-1101, Purpose, FR-1126, BR-1102, VC-1138 | Listing-order waiver allowed by BR-1102 but not by the gate text | fixed | Gate, Purpose, FR-1126 and BR-1102 now name both waivable results |
| R-022 | 2 | MUST | FR-1114, VC-1114 | Wrong-store check cannot yield exit 1 | fixed | Pre-overwrite read of `head.json` must hold `version`, else exit 1 |
| R-023 | 2 | SHOULD | FR-1109/1110 | Listing check vacuous without `complete`; `keys` undefined | deferred | Delta pass |
| R-024 | 2 | SHOULD | FR-1110 | Output shape on unexpected error / SIGINT | deferred | Delta pass |
| R-025 | 2 | SHOULD | FR-1116/1117 | Aborted bench run never takes the baseline | deferred | Delta pass |
| R-026 | 2 | SHOULD | VC-1122/1123/1137 | No VC for regions, proxy wording, Production secret distinctness, NFR-4 | deferred | Delta pass |
| R-027 | 2 | SHOULD | FR-1121, FR-1125 | Write-up before merge not placed; cron run could precede step 4 | deferred | Delta pass |
| R-028 | 2 | COULD | FR-1117, NFR-4 | Read-back mismatch in FR-1117 list; 30 s on SDK calls | deferred | Delta pass |

## Pass 3 (delta)

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-029 | 3 | SHOULD | BR-1101 | Waiver disjunction could be misread as waiving the whole gate | deferred | Delta pass |
| R-030 | 3 | SHOULD | FR-1114 | Pre-read relies on spec 06 repairing head after a stale-hint commit | deferred | Delta pass |
| R-031 | 3 | SHOULD | FR-1126 | Listing exception sits outside the "unexpected error" trigger | deferred | Delta pass |
| R-032 | 3 | COULD | Actors | Operator row still says "latency result" only | deferred | Delta pass |

Delta pass 3: no MUST. Verified MUST trend: pass 1 = 2, pass 2 = 2 (introduced by pass-1 fixes), pass 3 = 0.

## Pass 4 (readiness)

Verdict: **READY**. No verified MUST. Implementer could build without asking a question: yes.
Passes: 1 discovery (3 reviewers), 2 delta, 1 readiness (4 total review rounds). MUST trend: 2 → 2 → 0 → 0. Spec size: 194 → 204 lines (+5%).
