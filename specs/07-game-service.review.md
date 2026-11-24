# Review ledger — specs/07-game-service.md

Original size: 254 lines. After pass 1: 267 lines (+5%). Final: 271 lines.

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 1 | MUST | BR-701 vs FR-717 | `AiLoopLimitError.state` and loop `IllegalMoveError` messages carry secrets, yet pass through unchanged | decided | Operator: BR-701 covers returned values and the 7 service errors; non-service errors are server-only, and Phase 8 logs them and answers 500 |
| R-002 | 1 | SHOULD | FR-711/714/719 | `eventsSince` finds the tip again; events can run past `update.version` | decided | Operator: missed events are loaded with `state.load` up to the already-loaded tip (FR-716); VC-712 race case |
| R-003 | 1 | SHOULD | FR-719 | Re-read of v+1 after conflict can throw `CommitNotFoundError`; "≥ v+1" claim unconditional | decided | Operator: counts as no match → `VersionConflict`; claim qualified; VC-720 case |
| R-004 | 1 | SHOULD | NFR-702/FR-707 | Call counts can't detect a sequential implementation | fixed | NFR-702 4-call first round; VC-729 gated wrapper |
| R-005 | 1 | SHOULD | NFR-702 | No budget for `getUpdate(since)` / 409 path | fixed | Counts added (each `load` = 2 calls) |
| R-006 | 1 | SHOULD | VC-703/710/721/722 | `vi.spyOn` on ESM exports won't work | fixed | VC preamble prescribes partial `vi.mock(importOriginal)` |
| R-007 | 1 | SHOULD | FR-701/706/713 | No order among input checks | fixed | Order stated; VC-708 extended |
| R-008 | 1 | SHOULD | FR-704 | `createGame` error paths unspecified | fixed | FR-701 propagation line; VC-731 |
| R-009 | 1 | SHOULD | FR-723 | "rejects" on a sync function | fixed | "throws"; marked synchronous |
| R-010 | 1 | COULD | VC-710 | One human seat makes the "every hash compared" check weak | fixed | Folded into R-006 edit: 2 human seats, exact call count |
| R-011 | 1 | COULD | FR-723 | `replayGame` in production has no production caller | deferred | Discovery decision stands (operator chose production module) |
| R-012 | 1 | COULD | FR-701/713 | Service-side validation duplicates Phase 8 Zod | deferred | Discovery decision (InvalidRequest) |
| R-013 | 1 | COULD | NFR-702 | Totals restate spec-06 internals | deferred | — |
| R-014 | 1 | COULD | NFR-704 | Hand-summed CI duration | deferred | — |
| R-015 | 1 | COULD | VC-703 | Prefer testing the range predicate directly | deferred | — |
| R-016 | 1 | COULD | Purpose | Retention isn't a consumer | deferred | — |
| R-017 | 1 | COULD | FR-702 | Why `node:crypto` rather than `@noble/hashes` | deferred | — |
| R-018 | 1 | COULD | FR-724 | "skips the events of engine createGame" sentence is a no-op | deferred | — |
| R-019 | 1 | COULD | FR-701 | "characters" unit (UTF-16 vs code points) | deferred | — |
| R-020 | 1 | COULD | VC-704 | Give base32 literal; fix randomBytes call order | deferred | — |
| R-021 | 1 | COULD | VC-728 | Check exact heading numbers | deferred | — |
| R-022 | 1 | COULD | VC tags | Tag FR-716 on VC-707/714, BR-704 on VC-723 | deferred | — |
| R-023 | 2 | SHOULD | VC-731 | Repeating all random bytes yields byte-identical docs → create succeeds; test must repeat only the id bytes | fixed | Operator: fold in — VC-731 repeats only the 16 id bytes |
| R-024 | 2 | SHOULD | FR-708 / VC-710 | Partial `vi.mock` misses a default `node:crypto` import; require named imports or mock `default` | fixed | Operator: fold in — FR-708 requires named `node:crypto` imports |
| R-025 | 2 | COULD | Header | Version still 0.1 | fixed | Header bumped to 0.2 |
| R-026 | 2 | COULD | FR-716 | "≤ 8 in flight" has no VC | deferred | — |
| R-027 | 2 | COULD | VC-712 | Name a store-level trigger for the race | deferred | — |
| R-028 | 2 | COULD | FR-719 | Say other errors from the re-read propagate | deferred | — |
| R-029 | 3 | MUST | VC-725 | Hidden-card check fails on correct code: events span hand boundaries, so a played card may sit in an AI's next hand | fixed | Split into (a) per-state view/leak check without events and (b) secret-substring + event-card-shape check |
| R-030 | 4 | MUST | VC-725(b) | `"hands"` key ban fails every correct update (`scoreboard.hands`) and contradicts (a) | fixed | Clause deleted (not re-reviewed: pass cap per skill §2c) |
| R-031 | 4 | COULD | VC-725(a) | `seat` undefined | fixed | "the request's seat" (one-word clarification made with R-030) |
| R-032 | 5 | SHOULD | VC-727 | `randomBytes\(` grep would also match a call through the injected dep (`this.#randomBytes(16)`) | deferred | Delta pass; plan should anchor the grep to a bare call |
| R-033 | 5 | SHOULD | VC-725(b) | After removing the `"hands"` ban, non-VersionConflict service errors have no hand-leak check | deferred | Delta pass; plan may ban the `"hands":[[` substring in error JSON |
| R-034 | 5 | COULD | FR-708 | Namespace-import ban stricter than vi.mock needs | deferred | — |
| R-035 | 5 | COULD | VC-725(a) | "the request's seat" for createGame = result seat 0 | deferred | — |
| R-036 | 5 | COULD | VC-731 | Meta differs because of the token hash, not the seed | deferred | — |

## Verdict

READY — 2026-11-23, after 5 passes (discovery, delta, readiness, delta, delta). Verified MUSTs per pass: 1 → 0 → 1 → 1 → 0. Final size 271 lines (original 254, +7%).
