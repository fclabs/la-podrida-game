# Iteration 3 — Simulation suite and CI step

Commit: this commit ("Add the seeded simulation suite and run it in CI"; see `git log`).

Protocol: the orchestrator downgraded parallel group A to sequential, so this iteration used the **full** artifact protocol (rewrote `CONTEXT.md`, appended D-006 to D-009 to `DECISIONS.md`); no "Proposed …" sections.

## Criteria

| Criterion | Command | Result |
|---|---|---|
| VC-411 (local) | `/usr/bin/time -p pnpm test:sim` | PASS — 5 files / **3,605 tests** (18 combinations × 200 seeds + 5 ledger tests); vitest Duration 45.52 s; **real 45.94 s**, user 172.09 s, sys 1.27 s. < 5 min, so no stop (NFR-404 early warning). |
| VC-412 | `pnpm vitest run --config vitest.sim.config.ts tests/sim/ledger.sim.test.ts` | PASS — 1 file / 5 tests (unaltered game passes; other seat's card → `ledger: hand 2: card … played by seat s was dealt to seat t`; never-dealt stock trump → `… was not dealt`; duplicated card in the hand-2 `hand-dealt` state → `ledger: hand 2: card … dealt twice`; same in the hand-0 deal → `hand 0`) |
| VC-413 (local part) | `SIM_SEEDS=3 pnpm test:sim` | PASS — 5 files / 59 tests (18 × 3 + 5); `SIM_SEEDS=3 pnpm exec vitest run --config vitest.sim.config.ts --reporter verbose tests/sim/mexico-bazas.sim.test.ts` lists 15 tests `mexico-bazas <3–7>p seed <0–2>` |
| VC-413 (local part) | `SIM_SEEDS=2k pnpm test:sim` | PASS (fails as required) — exit 1, `Error: SIM_SEEDS must be a positive integer in decimal digits, got "2k"` |
| VC-413 (local part) | `SIM_SEEDS=0 pnpm test:sim` | PASS (fails as required) — exit 1, `… got "0"` |
| VC-416 (local part) | `grep -n "pnpm test" .github/workflows/ci.yml` | PASS — line 40 `run: pnpm test`, line 45 `run: pnpm test:sim` (step "Simulation tests", before "Build") |
| `.gitkeep` gone | `test ! -e tests/sim/.gitkeep` | PASS (removed with `git rm`) |
| Toolchain | `pnpm typecheck && pnpm lint && pnpm test && pnpm test:sim` | PASS — each exit 0; `pnpm test` 34 files / 606 tests; ESLint 0 warnings; Prettier clean |
| Touches only | `git diff --name-only HEAD~1` (after commit) | PASS — `.github/workflows/ci.yml`, `tests/sim/*` (6 new + `.gitkeep` deleted), the three artifact files |

Not run here (orchestrator): `SIM_SEEDS=2000 pnpm test:sim` (NFR-404) and the branch CI run (VC-411 / VC-416 CI parts, step < 10 min).

No FAIL occurred; the checklist was run once from the top after the last code change.

## Files

- Added: `tests/sim/harness.ts`, `tests/sim/ledger.ts`, `tests/sim/ledger.sim.test.ts`, `tests/sim/argentina-fidepo.sim.test.ts`, `tests/sim/spain-ludoteka.sim.test.ts`, `tests/sim/gamerules.sim.test.ts`, `tests/sim/mexico-bazas.sim.test.ts`, `specs/04-players-plan-artifacts/iterations/03-sim.md`.
- Deleted: `tests/sim/.gitkeep`.
- Changed: `.github/workflows/ci.yml` (new step "Simulation tests" after "Test"), `specs/04-players-plan-artifacts/CONTEXT.md` (rewritten), `specs/04-players-plan-artifacts/DECISIONS.md` (D-006 to D-009).

## Decisions

- D-006 (plan P-4: sim input), D-007 (plan P-6: `isDeepStrictEqual`, `expect` only on mismatch; per-move checks throw `move <k>: …`), D-008 (ledger also checks the seat a card was dealt to), D-009 (`SIM_SEEDS` validated at harness load; FR-416 second run without checks, full event log compared).

## Deviations

- None from the plan's Scope. Additions: the ledger's per-seat ownership check (D-008, stricter than FR-415); two extra VC-412 cases (never-dealt card; duplicate in the hand-0 deal); each sim test also asserts the last event is `game-over`; replay also compares the initial state; scoreboard check also asserts `hands.length === completedHands.length`.
- The per-preset suite lives in `defineSimTests(presetId)` in the harness; each `<presetId>.sim.test.ts` is a 1-line call, so all four files stay identical in behaviour.

## Gotchas

- `fail(...)` helpers must be **function declarations** with `: never` for TypeScript to narrow after them (a `const fail = (): never =>` arrow does not narrow); inside callbacks (e.g. `.filter`) narrowing of the closure's `let open` is lost — copy to a local `const` first.
- `transition.events` of the move that ends a hand contain `hand-completed` then `hand-dealt`; the ledger closes then reopens in that order and skips the after-transition `check` (the deal is checked by `openHand`).
- `game.events` from `playSimGame` includes `createGame`'s `game-started` + first `hand-dealt` (unlike `runAiLoop`'s `result.events`); `replay` skips every non-move event.
- vitest prints a load error once per file for an invalid `SIM_SEEDS` (5 times), exit 1.
- zsh: `$PIPESTATUS` is `$pipestatus`; run gate commands unpiped to read exit codes.

## For the next iteration

- Iteration 4 (CLI): build games exactly like `simInput` (P-4 / D-006) but with seeds `<prefix>-<i>`; you may not import from `tests/` in `scripts/` — re-create the 5-line seat recipe. Expect ~60 ms per argentina-fidepo 3p game (100 games ≈ 6 s).
- Iteration 5 (docs): document `pnpm test:sim` (~46 s locally, 3,605 tests), `SIM_SEEDS` rule (positive decimal integer, else load error), test names `<presetId> <players>p seed <i>`, determinism/replay on the first 10 seeds, the ledger's checks and `LedgerError` message format, and the CI step "Simulation tests".
- Orchestrator: run `time SIM_SEEDS=2000 pnpm test:sim` (expect ≈ 10× the S = 200 time, ~7–8 min locally) and record it with the S = 200 duration (45.9 s) in the PR.
