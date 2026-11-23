# Iteration 1 — Formulas, live status and ranking

- **Commit**: this commit — "Add scoring formulas, live status and seat ranking" (SHA: see `git log`).
- **Goal**: `handPoints`, `liveStatus`, `rankSeats` per spec FR-300, FR-301, FR-304, FR-305, FR-306.

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| VC-301 (all preset rows) | `pnpm vitest run tests/unit/score/formulas.test.ts` | PASS — 43 tests (19 VC-301 rows, 19 `-0` rows + 2 custom-spec tests, 3 VC-303 rows) |
| VC-302 (`perTrick: 3` → 16; no `-0`; zero penalty → `+0`) | same | PASS |
| VC-303 (`(-1,0)`, `(0,1.5)`, `(NaN,0)` → `RangeError` naming arg + value) | same | PASS |
| VC-306 (8 status rows + 2 `RangeError` rows) | `pnpm vitest run tests/unit/score/live-status.test.ts` | PASS — 10 tests |
| VC-307 (5 cases incl. places `1, 1, 3, 4` and length mismatch) | `pnpm vitest run tests/unit/score/ranking.test.ts` | PASS — 5 tests |
| `src/score/.gitkeep` removed | `test ! -e src/score/.gitkeep && echo gitkeep-removed` | PASS — `gitkeep-removed` |
| Purity grep (BR-304, early check) | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/engine\|\.\./engine' src/score` | PASS — no output (exit 1) |
| Toolchain | `pnpm typecheck && pnpm lint && pnpm test` | PASS — exit 0; 25 files / 539 tests |
| Artifacts | — | PASS — this record; `CONTEXT.md` lists the three functions and `LiveStatus` with signatures |

First full run FAILED at `pnpm typecheck` (TS2352 on `{ ...spec, perTrick: 3 } as ScoringSpec`); fixed with `as unknown as ScoringSpec` (D-002) and the whole checklist re-run from the top: all PASS.

## Files

- Added: `src/score/formulas.ts`, `src/score/score-engine.ts`, `tests/unit/score/formulas.test.ts`, `tests/unit/score/live-status.test.ts`, `tests/unit/score/ranking.test.ts`, `specs/03-score-engine-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-formulas-ranking.md}`.
- Deleted: `src/score/.gitkeep`.
- Changed: none.

## Decisions

- D-001 (plan decision): spanish miss as `0 - x`.
- D-002: test casts via `as unknown as ScoringSpec`.

## Deviations and why

- Plan text says `as ScoringSpec`; that does not typecheck against the literal-typed schema, so tests use `as unknown as ScoringSpec` (D-002). Behaviour tested is identical.
- Added one extra VC-302 test row beyond the VC list (zero penalty gives `+0`), as the plan Scope asks.

## Gotchas

- `git rm src/score/.gitkeep` removes the now-empty `src/score/` directory; recreate it before writing files.
- `ScoringSpec` numbers are literal types; spreading and overriding needs a double cast.
- `.prettierignore` excludes `docs/` and `specs/`, so artifacts are not Prettier-checked (plan rule 2 says otherwise; the repo config wins).
- `liveStatus` validates the arguments before the `null` short-circuit, so `liveStatus(null, -1, 0)` still throws.

## For the next iteration

- Add `scoreHand` and `evaluate` to `src/score/score-engine.ts`; reuse `handPoints` (import `./formulas`), `rankSeats`, `liveStatus`. A private `assertNonNegativeInt(fn, name, value)` already exists there.
- `rankSeats` returns fresh objects, so `evaluate` can use its result directly.
- Error prefixes to add: `scoreHand: handIndex N: <check>`; `state.completedHands[k]: ` / `state.hand: ` for `evaluate`.
- Build `ScoreBoard` without a `live` key at game over (never `live: undefined`).
