# Iteration 4 — Documentation

Commit: this commit (`Document the game state layer`).

## Criteria results

All commands run with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN`.

| Criterion | Result | Command → outcome |
|---|---|---|
| VC-621 architecture | PASS | `grep -nE "seatTokenHashes\|engineVersion\|actorSeat\|clientRequestId\|scoreboard\|madeCount" docs/architecture.md` → hits at lines 250, 251, 253, 257, all inside §6.2 (lines 236–264). |
| VC-621 design | PASS | `grep -nE "loadMeta\|readFinalScores\|CommitConflictError" docs/design.md` → lines 495, 498, 501, 508 inside §7 (487–518), plus 641 (§9 step 7). |
| VC-621 development | PASS | `grep -n "^## 1[3-5]\." docs/development.md` → `## 13. Storage` (885), `## 14. Game state` (1119), `## 15. Known limitations` (1423). |
| VC-621 cross-references | PASS | Python script: collects every `## N.`/`### N.M` heading, then every `§N(.M)` in the file. 110 internal refs, all resolve; the 5 unresolved hits are refs to other docs (`design.md` §5.5/§6.1/§8.1/§4.2, `architecture.md` §6.3). Printed each referenced number with its heading title and checked the context by hand (e.g. §13.7 → Storage gotchas, §14.7 → Committing, §14.12 → Game state gotchas). No pre-existing ref pointed to §14 (old Known limitations), so only the heading was renumbered. |
| Doc examples run | PASS | Both `ts` blocks of §14 (§14.4 usage, §14.11 test support) copied verbatim (imports merged and de-duplicated, bodies inside two `it`s, plus assertions on the example's variables) into `tests/unit/state/doc-example.test.ts`: `pnpm vitest run tests/unit/state/doc-example.test.ts` → 2 passed; `tsc --noEmit` → no error in the file; `eslint --max-warnings 0` → exit 0. File deleted before the gate (`test ! -e` confirmed). |
| Decisions judged | PASS | All 21 entries, see below. |
| Gates | PASS | `sh -c 'pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm test:sim && pnpm build'` → exit 0. Test 50 passed + 1 skipped files, 961 passed + 30 skipped; sim 5 files, 3605 passed (44.8 s); build compiled. |
| VC-626 local | PASS | `git diff main -- package.json pnpm-lock.yaml` → empty (0 lines); `test ! -e src/state/.gitkeep` → true. `git diff --stat` of this iteration touches no `src/` or `tests/` file. |
| Purity greps (re-run) | PASS | BR-603 grep → nothing; `ifMatch\|lock\|locking` → nothing; `mode: 'overwrite'` → only `game-state-manager.ts:447` (`#writeHead`). |
| NFR-604 local proxy | PASS | JSON reporter to the scratchpad: 8 files, 189 tests, per-file sum 2244 ms. No `.vitest/` left behind. |
| Artifacts | PASS | `CONTEXT.md` rewritten (shipped system + "Hand-off to Phase 7"), D-021 appended, this record. |

## Files

- Changed: `docs/architecture.md` (§4.2 layout adds `errors.ts`; §5 I/O line matches the shipped call rounds; §6.1 Blob caveat says the state layer byte-compares; §6.2 rewritten; §6.3 items 1 and 3), `docs/design.md` (§7 rewritten; §9 step 7 `CommitConflictError`), `docs/development.md` (new §14; §15 renumbered; stale lines in §1, §2, §9.6, §10.8, §11.7, §12.8, §13 intro, §13.7, §15), `docs/implementation.md` (Phase 1 task 6), `specs/06-game-state-manager-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.
- Added: this record. Temporary `tests/unit/state/doc-example.test.ts` created and deleted (not committed).
- README.md: unchanged (D-021).

## Deviations

- §14 has an extra "Using the manager" subsection (§14.4) beyond the plan's list, holding the runnable example (D-021).
- Fixed stale lines beyond the plan's examples: architecture §4.2/§5/§6.1/§6.3, design §9 step 7, several development lines (listed above). All are statements this phase made false or incomplete.
- `docs/implementation.md` Phase 6 left as is: it is the plan of record and none of its lines is false.

## Gotchas

- The architecture §5 I/O line now describes three rounds; it assumes the service runs `loadMeta` in parallel with `loadLatest` (the hand-off recommends that).
- `docs/` and `specs/` are prettier-ignored, so doc examples are never formatted or type-checked by the gates; the temporary-test method is the only check. Keep it for future doc edits.
- The cross-reference script must skip refs to other docs (`design.md` §…, `architecture.md` §…), which share the `§` notation.
- Pre-existing, outside this phase: architecture §7 cites "design §7" for `PlayerUpdate`, which design §7 does not define (it never did); README status paragraph outdated (D-021).

## Decision verdicts

| Entry | Verdict | Where |
|---|---|---|
| D-001 error classes/messages | Reflected | dev §14.10 (messages, `name`, safe to log) |
| D-002 reason tokens, `firstIssuePath` | Reflected | dev §14.10 reasons; §14.1 module map |
| D-003 schema construction | Reflected | dev §14.3 (strict, `schemaVersion`, `superRefine`, `CommitBody`, `''` issue path); "shape before refine" ordering internal |
| D-004 imports in `src/state` | Reflected | dev §14 intro (imports, no config, greps) |
| D-005 strict `Equals` type check | Reflected | dev §14.3, §14.11 (`types.test-d.ts`) |
| D-006 `GAME_ID_PATTERN`, id checked first | Reflected | dev §14.1, §14.2 |
| D-007 numeric typing | Internal | schema detail; only version ranges and `engineVersion ≥ 1` documented |
| D-008 serialization + byte compare | Reflected | arch §6.2; dev §14.5, §14.7 |
| D-009 identity checks on reads | Reflected | arch §6.2; dev §14.6, §14.9 |
| D-010 index date = `createdAt` prefix | Reflected | arch §6.2 |
| D-011 test support files | Reflected | dev §14.11 |
| D-012 file-store temp folder | Reflected | dev §14.11 |
| D-013 tip discovery edges | Reflected | dev §14.6, §14.12; list de-dup/sort internal |
| D-014 seats compare, validation order | Internal (order); effect reflected | dev §14.5 lists the checks |
| D-015 commit write path | Reflected | dev §14.7 |
| D-016 `mapLimit`, 8 in flight | Reflected (limit); helper internal | dev §14.8 |
| D-017 stored bytes = caller input | Reflected | dev §14.7, §14.12 |
| D-018 final scores, gameId check | Reflected | dev §14.9 |
| D-019 race/concurrency tests | Reflected (what is proven); setup internal | dev §14.7, §14.11 |
| D-020 secret-leak tests | Reflected | dev §14.10, §14.11 |
| D-021 docs shape | Internal | this record |

## For the next iteration (orchestrator)

- Run verify-spec with the plan's Final acceptance test block plus the VC-621 greps above; everything passed locally in this iteration.
- After the push, read the CI "Test" step: the 8 `tests/unit/state` file durations must sum to < 15 s (NFR-604; local 2.2 s).
- Phase 7 hand-off notes are in `CONTEXT.md` "Hand-off to Phase 7" (error mapping, call order, id/timestamp formats, `final.json`).
- Consider refreshing README's status paragraph in a later phase (D-021).
