# Iteration 2 — Hand score and scoreboard

- **Commit**: this commit — "Score hands and evaluate the scoreboard from game state" (SHA: see `git log`; Iteration 1 is `d9f5493`).
- **Goal**: `scoreHand` and `evaluate` produce the `ScoreBoard` of spec FR-302, FR-303, FR-307 to FR-310 for hand-built and engine-played states, within NFR-303.

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| VC-304, VC-305, `scoreHand` no-mutation (FR-310) | `pnpm vitest run tests/unit/score/score-hand.test.ts` | PASS — 9 tests (1 VC-304, 7 VC-305 rows, 1 purity) |
| VC-308, VC-309, VC-310 (+ `makeState` schema check) | `pnpm vitest run tests/unit/score/evaluate.test.ts` | PASS — 14 tests (2 helper, 2 VC-308, 3 VC-309, 7 VC-310 rows asserting full prefixes) |
| VC-311, VC-312 | `pnpm vitest run tests/unit/score/full-game.test.ts` | PASS — 6 tests (2 VC-311, 4 VC-312 presets) |
| NFR-303 / VC-314 timing part | `pnpm vitest run tests/unit/score/perf.test.ts --silent=false` | PASS — 29 completed hands asserted; **median 14.8 µs** (0.0148 ms) over 101 calls, bound 1 ms |
| BR-304 purity grep | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/engine\|\.\./engine' src/score` | PASS — no output (exit 1) |
| Toolchain | `pnpm typecheck && pnpm lint && pnpm test` | PASS — exit 0; ESLint 0 warnings, Prettier clean; 29 files / 569 tests |
| Artifacts | — | PASS — this record; `CONTEXT.md` lists all five exports with signatures and the error-prefix convention |

All criteria passed on the first full run; no re-run needed.

## Files

- Added: `tests/unit/score/helpers.ts`, `tests/unit/score/score-hand.test.ts`, `tests/unit/score/evaluate.test.ts`, `tests/unit/score/full-game.test.ts`, `tests/unit/score/perf.test.ts`, `specs/03-score-engine-plan-artifacts/iterations/02-scoreboard.md`.
- Changed: `src/score/score-engine.ts` (`scoreHand`, `evaluate`, private `isIntIn`, `sum`), `specs/03-score-engine-plan-artifacts/CONTEXT.md`, `specs/03-score-engine-plan-artifacts/DECISIONS.md`.
- Deleted: none.

## Decisions

- D-003 (plan decision): `evaluate` error prefixes `state.completedHands[k]: ` / `state.hand: `, rethrow wraps `scoreHand`'s message.
- D-004: `makeState` options object; empty per-seat `hands` (schema accepts them).
- D-005: completed hands are checked before the current hand.

## Deviations and why

- `makeState` takes an options object (`{ players, completedHands, handIndex, hand, phase }`) instead of generic `overrides` (D-004); same purpose, fewer rebuilt hands in tests.
- Added `argentinaPlan(players)` to `helpers.ts` (hand plan for 3–6 players, hard-coded max per spec 02 table) so 4-seat hand-built states (VC-309) get a correct plan without the engine.
- VC-311 additionally scribbles over every mutable part of every board (hands, totals, counts, live, ranking) and checks the state is still equal to its clone — stronger than the spec's three-field check, which is also done.
- `tricks` / `tricksWon` entry checks reuse the private `assertNonNegativeInt` with `fn` = `scoreHand: handIndex N` / `state.hand`, so their messages follow the Iteration 1 convention.

## Gotchas

- Vitest hides `console.log` of passing tests by default here; use `--silent=false` to see the NFR-303 median line.
- `null` bids in a `HandResult` need `null as unknown as number` in tests (domain type is `number[]`).
- `board.live!` non-null assertion is accepted by the lint config in tests.
- `evaluate` must not set `live: undefined` at game over — the key must be absent.

## For the next iteration

- Document in `docs/design.md` §6 and `docs/development.md` §11 Score: the five exports, check order, the three error-message shapes (`<fn>: <arg> …`, `scoreHand: handIndex N: …`, `state.completedHands[k]: ` / `state.hand: `), no `live` at game over, `0 - x` for misses, perf median ≈ 15 µs vs. the 1 ms bound.
- Usage example idea (compiles today): `const { final } = playGame(newGame('argentina-fidepo', 3, 's'), lastMove); const board = evaluate(final); board.ranking[0]` — in docs, write it against `createGame`/`applyMove` rather than test helpers.
- D-004 is internal (test-only); D-001, D-003 and D-005 belong in the developer docs.
