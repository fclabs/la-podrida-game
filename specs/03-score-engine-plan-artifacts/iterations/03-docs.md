# Iteration 3 — Design and developer documentation

- **Commit**: this commit — "Document the score engine in design and developer docs" (SHA: see `git log`; Iteration 2 is `3621efb`, Iteration 1 is `d9f5493`).
- **Goal**: the docs describe the shipped score engine (FR-311) and the whole spec is verified locally.

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| VC-313 competition places | `grep -n "1, 1, 3" docs/design.md` | PASS — line 461 (§6.1 Ranking bullet) |
| VC-313 `on-track` | `grep -n "on-track" docs/design.md` | PASS — lines 433 (`LiveStatus`), 454 (`null` bid row), 458 |
| VC-313 `RangeError` | `grep -n "RangeError" docs/design.md` | PASS — line 462 (§6.1 Malformed input) |
| VC-313 Score heading | `grep -n "## 11. Score" docs/development.md` | PASS — line 477 |
| VC-313 Known limitations | `grep -n "## 12. Known limitations" docs/development.md` | PASS — line 616 |
| VC-313 exports/modules | `grep -n "handPoints\|scoreHand\|evaluate\|rankSeats\|liveStatus\|formulas\|score-engine" docs/development.md` | PASS — counts: handPoints 8, scoreHand 12, evaluate 20, rankSeats 8, liveStatus 8, formulas 4, score-engine 3 |
| VC-313 no stale refs | `grep -n "§11\|#11-" docs/development.md` | PASS — 51 (layout: `src/score` §11), 304 (§9.6 scoring → §11), 314 (§10 intro → §11), 473 (§10.8 → §11), 610 (§11.5 subsection), 622–623 (§12 → §11, §11.7). All mean the Score section. No `§12` refs needed (none pointed at Known limitations before). |
| No spec/plan/artifact refs in docs | `grep -n -i "spec 0\|specs/\|plan-artifacts\|FR-3\|VC-3\|NFR-3\|D-00" docs/development.md docs/design.md` | PASS — no output |
| Doc example compiles & runs | temp `tests/unit/score/doc-example.test.ts`; `pnpm vitest run tests/unit/score/doc-example.test.ts --silent=false`; `pnpm exec tsc --noEmit` | PASS — 1 test passed (asserts each value the comments state; winners `[0]`, totals `[112, 91, 95]`); tsc exit 0. Doc block extracted with awk and `diff`ed against the tested code: IDENTICAL. File then deleted (`test ! -e` → deleted) |
| VC-314 toolchain | `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm test:sim && pnpm build` | PASS — exit 0; ESLint 0 warnings, Prettier clean; 29 files / 569 tests; sim "No test files found, exiting with code 0"; build compiled |
| Score tests | `pnpm vitest run tests/unit/score/` | PASS — 7 files / 88 tests |
| NFR-303 | `pnpm vitest run tests/unit/score/perf.test.ts --silent=false` | PASS — median 15.1 µs (bound 1 ms) |
| BR-304 purity | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/engine\|\.\./engine' src/score` | PASS — no output (exit 1) |
| NFR-302 | `node -e "…dependencies…"` | PASS — `@noble/hashes,next,react,react-dom,zod 2.4.0` |
| `.gitkeep` | `test ! -e src/score/.gitkeep && echo gitkeep-removed` | PASS — `gitkeep-removed` |
| DECISIONS coverage | — | PASS — see below |
| Artifacts | — | PASS — `CONTEXT.md` rewritten to the shipped state with "Hand-off to Phase 4+"; this record |

All criteria passed on the first full run; no re-run needed. CI part of VC-314 is pending a user-approved push (orchestrator).

## Final Verification (plan table)

| Requirement | Verified by | Result |
|---|---|---|
| FR-300, FR-301 (VC-301–303) | `formulas.test.ts` in `pnpm vitest run tests/unit/score/` | PASS |
| FR-302, FR-303 (VC-304, VC-305) | `score-hand.test.ts` | PASS |
| FR-304 (VC-306) | `live-status.test.ts` | PASS |
| FR-305, FR-306, BR-303 (VC-307) | `ranking.test.ts` | PASS |
| FR-307, FR-308, FR-309, BR-302 (VC-308–310, VC-312) | `evaluate.test.ts`, `full-game.test.ts` | PASS |
| FR-310, BR-301 (VC-311 + `scoreHand` check) | `full-game.test.ts`, `score-hand.test.ts` | PASS |
| FR-311 (VC-313) | greps above | PASS |
| BR-304, NFR-302, NFR-303 (VC-314) | purity grep, deps check, `perf.test.ts` | PASS |
| NFR-301 (VC-314) | local toolchain chain | PASS locally; CI pending push |

Artifact check: `CONTEXT.md` describes the shipped system; `DECISIONS.md` D-001…D-005 cover the non-obvious choices; `iterations/` holds 01–03.

## DECISIONS coverage

| Entry | Where in the docs |
|---|---|
| D-001 `0 - x`, never `-0` | `development.md` §11.7 first bullet |
| D-002 `as unknown as ScoringSpec` in tests | `development.md` §11.7 (test gotcha; useful to anyone writing score tests, so documented rather than internal) |
| D-003 error prefixes | `development.md` §11.5 table and "Assert on the full prefix" |
| D-004 `makeState` options, empty hands | `development.md` §11.6 helpers paragraph and §11.7 "`makeState` states are shape-valid, not real games" |
| D-005 completed hands before current hand | `development.md` §11.5 check order ("a state broken in both places reports the completed hand") |

None is internal-only. No new decision this iteration (DECISIONS.md unchanged).

## Files

- Changed: `docs/design.md` (§6 intro sentence, §6.1 interface + rules bullets, §6.2 general formulas paragraph), `docs/development.md` (new §11 Score; §11 → §12 Known limitations; §2, §9.3, §9.6, §10 intro, §10.8 text updated to point at §11), `specs/03-score-engine-plan-artifacts/CONTEXT.md`.
- Added: `specs/03-score-engine-plan-artifacts/iterations/03-docs.md`.
- Temporary (created, run, deleted, not committed): `tests/unit/score/doc-example.test.ts`.
- No `src/` or test changes.

## Deviations and why

- `design.md`: no edits outside §6 (nothing there contradicted the code).
- `development.md` §11 is split into seven subsections (module map, usage, rules, relation to the engine, errors, tests, gotchas) mirroring §10's layout.
- Plan rule 2 says Prettier formats `docs/`/`specs/`; repo `.prettierignore` excludes them, so they were not formatted (config wins).
- In §11.7 the "not in the score engine" bullet points to `design.md` §4.2 and its open questions (where target-score endings and tie-break hands are listed), not §1.2.

## Gotchas

- The doc example uses `lastMove`-style choice (`moves[moves.length - 1]`) so bids are varied; with the first move every bid is 0.
- Vitest hides console output of passing tests; use `--silent=false`.

## For the next iteration

- Phase 3 complete. Next: `verify-spec` (orchestrator), then push with user approval and confirm the branch CI run (VC-314 CI part).
