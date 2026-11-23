# Iteration 5 — Design and developer documentation

Commit: this commit ("Document players, the AI loop and simulation"; see `git log`).

Read first: spec, plan (Artifact Protocol, Plan decisions, Iteration rules, Iteration 5, Final Verification), `CONTEXT.md`, all of `DECISIONS.md` (D-001 to D-012), every record (01–04), `docs/design.md` §5.5/§8/§9, all of `docs/development.md`, and the shipped code (`src/players/**`, `src/service/**`, `tests/sim/harness.ts`, `tests/sim/ledger.ts`, `scripts/simulate.ts`, `ci.yml`). No reconciliation commit existed (group A ran sequentially).

## Criteria

| Criterion | Command | Result |
|---|---|---|
| VC-417 §8 has no class diagram | `awk '/^## 8. Players/{f=1} /^## 9. GameService/{f=0} f' docs/design.md \| grep -c classDiagram`; `grep -c classDiagram docs/design.md` | PASS — 0 and 0. §8 spans lines 513–610 (`## 8. Players` at 513, `## 9. GameService` at 611). |
| VC-417 six names in design.md | `grep -c <name> docs/design.md` for each | PASS — `createHumanPlayer` 2, `createAiPlayer` 2, `getStrategy` 2, `runAiLoop` 4, `AiLoopLimitError` 2, `buildPlayerView` 5 |
| VC-417 headings | `grep -n "## 12. Players, views and simulation\|## 13. Known limitations" docs/development.md` | PASS — line 617 and line 883 |
| VC-417 five terms | `grep -c <term> docs/development.md` | PASS — `pnpm simulate` 8, `pnpm test:sim` 13, `SIM_SEEDS` 9, `ledger` 12, `replay` 12 |
| VC-417 `§12`/`§13` references | `grep -n "§12\|§13" docs/development.md` | PASS — every hit checked: §2 (l.51 `src/players` §12, helpers §12), §4 (l.109 → §12.5 sim suite), §7 (l.203 → §12.5), §9.6 (l.305 → §12), §10.4 (l.430 → §12.6 ledger), §10.8 (l.474 → §12), §11.4 (l.565 → §12), §11.7 (l.613 → §12), §12.1 (l.651 → §12.4 CLI; l.652 → §12.5, §12.6), §12.2 (l.724 → §12.6 replay), §12.3 (l.745 → §12.4 baseline), §12.5 (l.834, 836 → §12.6), §12.7 (l.866 → §12.4 seat recipe), §12.8 (l.875 → §12.4), §13 (l.888 → §12; l.889 → §12.8). All point to the right subsection. No `§13` reference exists other than the heading; nothing referred to the old "§12 Known limitations". |
| No spec/plan/artifact refs | `git diff docs/ \| grep "^+" \| grep -n "specs/\|04-players\|plan-artifacts\|FR-\|VC-\|BR-\|NFR\|D-0[01]\|P-[1-6]\b\|[Ii]teration"` | PASS — no output (exit 1) |
| Doc example compiles and runs | both §12.2 blocks pasted into temporary `tests/unit/service/doc-example.test.ts` (wrapped in one `it`, plus `expect(final.finalRanking).toEqual(final.scoreboard.ranking)`); `pnpm vitest run tests/unit/service/doc-example.test.ts`; `pnpm exec tsc --noEmit`; `pnpm exec eslint tests/unit/service/doc-example.test.ts --max-warnings 0`; then `rm` it | PASS — 1 test passed; tsc exit 0; eslint exit 0; file deleted (`test ! -e` true). First attempt failed only on an extra assertion of mine (`events.length > 2`; seat 0 can be first to act so the loop applied 0 moves) — fixed to `>= 2`, not a doc problem. |
| Documented `pnpm simulate` | `pnpm --silent simulate --preset gamerules --players 4 --games 5 --seed t` | PASS — exit 0: `preset: gamerules  players: 4  games: 5  hands/game: 19` / `average total per seat: 0: 29.0  1: 33.8  2: 40.2  3: 28.2` / `made-bid rate: 15.5%` / `duration: 0.2 s` — identical to the sample in §12.4 |
| Documented seed-replay tip | `pnpm --silent simulate --preset gamerules --players 4 --seed sim-gamerules-4 --games 18` | PASS — exit 0 |
| Documented `-t` tip | `pnpm exec vitest run --config vitest.sim.config.ts tests/sim/gamerules.sim.test.ts -t "^gamerules 4p seed 17$"` | PASS — 1 passed, 999 skipped (unanchored: 11 passed, hence the anchoring advice) |
| VC-418 / local gates | `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && /usr/bin/time -p pnpm test:sim && pnpm build` | PASS — exit 0; `pnpm test` 34 files / 606 tests; `pnpm test:sim` 5 files / 3,605 tests, Duration 45.12 s, real 45.54 s; build compiled |
| BR-404 grep | `grep -rnE "src/(storage\|state)\|@/src/config\|Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\." src/service/player-view.ts src/service/ai-loop.ts src/players` | PASS — no output (exit 1) |
| NFR-402 | `node -e "const d=require('./package.json').dependencies;console.log(Object.keys(d).sort().join(','),d['@noble/hashes'])"` | PASS — `@noble/hashes,next,react,react-dom,zod 2.4.0` |
| `.gitkeep` | `test ! -e src/players/.gitkeep && test ! -e src/service/.gitkeep && test ! -e tests/sim/.gitkeep` | PASS — exit 0 |
| Every decision reflected or internal | see "Decisions coverage" | PASS |
| Artifacts | `CONTEXT.md` rewritten (final state + "Hand-off to Phase 5+"); this record | PASS |

No FAIL in the docs; the checklist was run once from the top after the last doc edit.

## Final Verification (plan table)

| Requirement | VC | Result |
|---|---|---|
| FR-400–FR-405, BR-402 | VC-401–VC-403 | PASS — in `pnpm test` (606 green); greps re-run in Iteration 2/5 |
| FR-406, FR-407, BR-401 | VC-404, VC-405 | PASS — in `pnpm test` |
| FR-408–FR-412, BR-403 | VC-406–VC-410 | PASS — in `pnpm test` |
| FR-413–FR-417, NFR-401 | VC-411 (local) | PASS — `pnpm test:sim` 3,605 tests, 45.5 s |
| FR-415 | VC-412 | PASS — `ledger.sim.test.ts` within `pnpm test:sim` |
| FR-413, NFR-404 | VC-413 | Local parts PASS (Iteration 3). **`SIM_SEEDS=2000 pnpm test:sim`: orchestrator, not run here.** |
| FR-418, FR-419 | VC-414, VC-415 | PASS (Iteration 4); VC-414 command re-run here, same output |
| FR-420, NFR-403 | VC-416, VC-411 CI | Local part PASS (`ci.yml` step "Simulation tests" after "Test"). **Branch CI run and step duration < 10 min: orchestrator, after push.** |
| FR-421 | VC-417 | PASS (above) |
| BR-404, NFR-402 | VC-418 | PASS (above) |

Artifact check: `CONTEXT.md` describes the shipped system; `DECISIONS.md` D-001–D-012, no `D-?`; `iterations/` 01–05.

## Decisions coverage

| Decision | Where |
|---|---|
| D-001 registry is a `Map` | design §8.3; development §12.1, §12.3 (inherited names unknown) |
| D-002 `createPlayers` no re-validation | development §12.2 (player checks), §12.8 |
| D-003 `ai-loop.ts` imports `./player-view` | development §12 intro (purity: "and each other") |
| D-004 VC-405 test input | **internal** (test-only input of one unit test) |
| D-005 cap check before decision, AI only | design §8.5 step 5; development §12.8 |
| D-006 all-AI sim input | development §12.4 (seat recipe, `gameId 'sim'`), §12.5 seeds, §12.8 |
| D-007 `isDeepStrictEqual`, `expect` on mismatch | development §12.6 "Fast deep equality" |
| D-008 ledger checks the dealing seat | development §12.6 |
| D-009 `SIM_SEEDS` validated at load; second run unchecked | development §12.5 (`SIM_SEEDS` table, load error per file; determinism compares full event log) |
| D-010 CLI parsing | development §12.4 "Errors" |
| D-011 summary math | development §12.4 (output bullets) |
| D-012 pnpm banner / `--silent` | development §12.4 "Clean output" |

New decisions this iteration: none (no `DECISIONS.md` change).

## Files

- Changed: `docs/design.md`, `docs/development.md`, `specs/04-players-plan-artifacts/CONTEXT.md`.
- Added: `specs/04-players-plan-artifacts/iterations/05-docs.md`.
- Temporary (created, run, deleted, not committed): `tests/unit/service/doc-example.test.ts`.

## Deviations and other edits

- design.md edits beyond §8: §1.1 goal 4 said "an **AI Player** subclass" — reworded to the plain-object model; §5.5's "`GameService` builds every `PlayerView`…" now names `buildPlayerView` (§8.4) and drops `finalRanking` from the always-present spread. §9 step 5 does not contradict the code and is unchanged.
- development.md edits beyond §12/§13: §2 (which layers exist), §4 (stale "exits 0 when `tests/sim` has no tests" → pointer to §12.5), §7 (CI step list and the local pre-push command now include `pnpm test:sim`; removed "not part of CI yet"), §9.6, §10.4, §10.8, §11.4, §11.7 (point to §12 / `buildPlayerView`). §13 drops the "`pnpm simulate` is a stub" bullet and the "no players" claim.
- Not edited (outside Touches): `README.md` line 34 still says `pnpm simulate` is "a stub for now"; `docs/implementation.md` still names `RandomStrategy`. Recorded in `CONTEXT.md` Known gaps for the orchestrator.

## Gotchas

- `vitest -t` is a regex substring match: `seed 17` also selects seeds 170–179; anchor it.
- Seat 0 (human) can be the first actor, so `runAiLoop` right after `createGame` may apply 0 moves.

## For the next iteration / orchestrator

- Run `time SIM_SEEDS=2000 pnpm test:sim` and record it with the local S = 200 duration (45.5 s here, 45.9 s in Iteration 3) in the PR (NFR-404); then `verify-spec`, push, and check the CI "Simulation tests" step < 10 min.
- Consider fixing the README `pnpm simulate` row in the same PR or the next one.
