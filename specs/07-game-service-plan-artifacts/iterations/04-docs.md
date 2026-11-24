# Iteration 4 — Documentation

- **Commit**: this commit (`Document the game service`).
- **Decisions**: D-017 (doc choices: intended HTTP mapping as a labelled sketch, Phase 8 `since` line left and flagged, how the examples were run).

## Criteria results

All commands run from the repository root with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed.

| Criterion | Command | Result |
|---|---|---|
| VC-728 (GameUnsupported in each doc) | `grep -n "GameUnsupported" docs/design.md docs/architecture.md docs/development.md` | PASS: design.md 3 lines, architecture.md 1, development.md 8 |
| VC-728 (section order) | `grep -n "^## " docs/development.md` | PASS: `1119:## 14. Game state`, `1423:## 15. Service`, `1797:## 16. Known limitations` |
| VC-728 (cross-references) | Script (Python, scratchpad `xref.py`): collect every `##`/`###` heading number of `development.md`; for each `§N`/`§N.M` on a line, treat it as a reference to another document when the clause before it (since the last `.`, `;`, `:` or table `\|`) names `design.md`, `architecture.md`, `implementation.md`, `game_rules.md` or `README.md`; check every other one exists as a heading. Then printed every reference on the changed lines (§2, §10.8, §12, §12.8, §14.12, §15, §16) with its target heading title and read them. | PASS: 75 headings; 139 internal references, 0 missing; 45 references to other docs skipped. Manual title check: every reference in §15/§16 and the edited lines points to the intended section (e.g. §15.4 → Authentication, §15.10 → Service tests, §13.3 → Choosing a driver, §14.7 → Committing, §15.11 → Gotchas and limitations). No `§15` reference existed before the renumbering (grep over `docs/` and `README.md`), so none needed rewriting to §16. |
| Doc examples compile and run | Built `tests/unit/service/doc-example.test.ts` from the seven usage blocks of §15 (imports lifted and deduped, bodies pasted verbatim into `it` blocks, plus assertions for the examples' comments; D-017); `pnpm vitest run tests/unit/service/doc-example.test.ts --reporter verbose`; `pnpm exec tsc --noEmit -p .`; `pnpm exec eslint tests/unit/service/doc-example.test.ts`; then `rm` | PASS: 3 tests passed; tsc and eslint clean; file deleted before the gates and the commit (`git status` shows no file under `tests/`) |
| Decisions judged | — | PASS: table below |
| Gates | `sh -c 'pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm test:sim && pnpm build'` | PASS: exit 0. `pnpm test` 63 passed + 1 skipped files, 1139 passed + 30 skipped tests (2.78 s); `pnpm test:sim` 5 files, 3,605 tests (45.1 s); build compiled |
| Final Verification: service suite | `pnpm vitest run tests/unit/service --reporter verbose` | PASS: 15 files, 202 tests, 877 ms |
| Final Verification: VC-727 | `git diff main -- src/service/player-view.ts src/service/ai-loop.ts src/domain src/engine src/score src/players src/state src/storage` | PASS: empty |
| Final Verification: replay purity | `grep -nE "storage\|config\|node:\|Date\|Math\.random\|crypto" src/service/replay.ts` | PASS: no output (exit 1) |
| Final Verification: R-032 | `grep -nE "(^\|[^.#[:alnum:]_])randomBytes\(\|new Date\(\|Math\.random" src/service/game-service.ts` | PASS: only lines 172–173 (the `deps` defaults) |
| Final Verification: P-5 | `grep -n "eventsSince" src/service/game-service.ts` | PASS: no output (exit 1) |
| VC-730 (local) | `git diff main -- package.json pnpm-lock.yaml` | PASS: empty |
| No code changes | `git status --short` before staging | PASS: only `docs/*.md`, `README.md` and the artifacts |
| README formatting | `pnpm exec prettier --check README.md` | PASS |
| Artifacts | — | PASS: `CONTEXT.md` rewritten for the shipped system with "Hand-off to Phase 8"; D-017 appended; this record |

## DECISIONS verdicts

| Entry | Verdict | Where |
|---|---|---|
| D-001 error classes | Reflected | design §9 error table; development §15.7 (fields, messages, 64-char clip) |
| D-002 `replayGame` | Reflected | design §7 and §9; development §15.9 (guards, order, result) |
| D-003 `buildStoredChain` | Internal (test-only; named in development §15.10) | — |
| D-004 randomness and encodings | Reflected | development §15.2 (draw order), §15.3 (encodings, hash) |
| D-005 constant-time auth | Reflected | design §9; development §15.4 |
| D-006 input checks + edges | Reflected | development §15.3 (checks, UTF-16), §15.11 (configured default, non-string preset) |
| D-007 missed events | Reflected | design §9; development §15.5 |
| D-008 update builder | Reflected | design §9 ("every `PlayerUpdate` … built the same way"); development §15.8 |
| D-009 state-error mapping; non-string id | Mapping reflected (development §15.4, §15.7); `String(gameId)` detail internal | — |
| D-010 test support, `GatedStore` | Reflected | development §15.10 |
| D-011 module mocks | Reflected | development §15.10 (pattern + why one file per mock) |
| D-012 `submitMove` stub | Internal (superseded; no longer in the code) | — |
| D-013 `submitMove` flow | Reflected | design §9 steps 1–9; development §15.6 (flow, store calls) |
| D-014 race resolution | Reflected | design §9 step 7; development §15.6 step 5, §15.11 (external deletes) |
| D-015 shared test helpers | Reflected | development §15.10 (`storeHandmadeGame`, `sha256Hex`, `playToEnd`) |
| D-016 VC-725 method | Internal (test technique); the guarantee is in development §15.8 | — |
| D-017 doc choices | Reflected | development §15.7; `CONTEXT.md` hand-off |

## Files

- Changed: `docs/design.md` (§9 rewritten; §7 replay pointer), `docs/architecture.md` (§4.2 service files, §5 I/O counts, §6.3 item 5 step number, §10 errors and replay), `docs/development.md` (new §15 Service; §16 Known limitations renumbered and updated; stale lines in §2, §10.8, §12, §12.8, §14.12), `docs/implementation.md` (Phase 7 tasks: seven errors, `getUpdate`/`since`, race reload, `replayGame`), `README.md` (status paragraph), `specs/07-game-service-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.
- Added: `specs/07-game-service-plan-artifacts/iterations/04-docs.md`.
- Deleted: none (the temporary `tests/unit/service/doc-example.test.ts` was never committed).

## Deviations

- `docs/design.md` §7 and `docs/architecture.md` §4.2/§6.3/§10 (debugging bullet) also got small edits: each line was made stale or incomplete by this phase (new `replay.ts`, renumbered `submitMove` steps).
- `docs/implementation.md` Phase 8 says `?since` ahead of the current version → 400, but the service returns `events: []` (FR-711). Left unchanged (only Phase 7 lines are in scope) and flagged in `CONTEXT.md` for Phase 8 (D-017).
- `architecture.md` §7's HTTP table has no `GameUnsupported` row: the status is Phase 8's decision; §10 says so and the proposal (410) is given.

## Gotchas

- Subsection headings in `development.md` are `### 15.4 Title` (no dot after the number), top-level ones `## 15. Title`; a cross-reference checker must accept both.
- A `vi.mock` example with `mockImplementationOnce` at module level would fail the next `runAiLoop` call of whichever test runs first; in the temporary test it was placed inside its own `it`.
- `README.md` is under Prettier (unlike `docs/`); check it after editing.

## For the next iteration (orchestrator)

- verify-spec commands: the plan's "Final acceptance test" block, plus `grep -n "GameUnsupported" docs/design.md docs/architecture.md docs/development.md` and `grep -n "^## " docs/development.md | sed -n '/14\./,/16\./p'`.
- NFR-704: after the push, sum the `tests/unit/service/*.test.ts` durations in the CI "Test" step; must be < 20 s (locally ≈ 0.9 s for the folder).
- Phase 8 hand-off: `CONTEXT.md` "Hand-off to Phase 8".
