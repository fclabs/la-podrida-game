# Iteration 2 — Hand-plan expansion

**Commit**: this commit ("Expand hand sequences into hand plans for every preset"). Previous: `e77380d` (Iteration 1).

## Criteria results

| Criterion | Result | Command / evidence |
|---|---|---|
| VC-207 | PASS | `pnpm vitest run tests/unit/engine/sequence.test.ts --reporter=verbose` — `maxCardsPerPlayer(FRENCH_52, 3…7)` = 17, 13, 10, 8, 7; `maxCardsPerPlayer(SPANISH_40, 3…6)` = 12, 10, 8, 6. |
| VC-208 | PASS | same command — 18 rows (coverage test checks they match every preset × `players` range); each `expandHandSequence(getPreset(id), n)` deep-equals the hand-written literal array; lengths 29/22/17/14, 25/22/19/16, 19/19/19/15/13, 11/12/13/14/15; gamerules has exactly one `1`; spain/mexico have the top count exactly `n` times. |
| VC-209 | PASS | same command — `[{range 3→3}, {repeat {min:[2,'max']} ×2}]`, 4 players → `[3, 2, 2]`. |
| VC-210 | PASS | same command — argentina-fidepo with 2 and 7 players throws `RangeError` whose message contains the count; `{repeat, cards: 20, times: 1}` with 4 players throws `RangeError` containing `20`. |
| sequence test file | PASS | `pnpm vitest run tests/unit/engine/sequence.test.ts` → 1 file, 47 tests passed. |
| Full gate | PASS | `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm test` exit 0 (12 files, 279 tests). |
| Purity grep | PASS | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/score\|\.\./score' src/engine` → no matches. `sequence.ts` imports only `@/src/domain/decks` and `import type` from `@/src/domain/rules`. |
| Artifacts | PASS | `CONTEXT.md` File map and Public interfaces list `sequence.ts`; this record written. |

## Files

- Added: `src/engine/sequence.ts`, `tests/unit/engine/sequence.test.ts`, `specs/02-engine-plan-artifacts/iterations/02-sequence.md`.
- Changed: `specs/02-engine-plan-artifacts/CONTEXT.md`.
- Deleted: none. `DECISIONS.md` unchanged (no new decision this iteration).

## Deviations

- None from the plan's Scope.
- Small extras: the player-count check also rejects non-integers (the spec only says "outside `rules.players`"); tests add a coverage check that the 18 rows are exactly the presets' player ranges, and a check that every call returns a new array.

## Gotchas

- The 18 expected plans live in a `// prettier-ignore` `PLANS` constant so each plan stays laid out by segment; they are typed by hand from the spec's Hand plans table.
- Range checks run after the whole plan is expanded; the error names the first offending count in plan order.
- The player-count message also contains the min/max of the range (e.g. `player count 2 is outside 3–6 …`), so a `toThrow('2')` assertion is weak for 2 players; the 7-player row and the `20` row are unambiguous.
- `maxCardsPerPlayer` passes `players` to `buildDeck`, which throws its own `RangeError` for non-integers or `< 1`; `expandHandSequence` checks players first, so that path is never hit from it.

## For the next iteration

- Import inside `src/engine` as `import { expandHandSequence, maxCardsPerPlayer } from './sequence'`.
- `createGame` (Iteration 4) should catch `RangeError` from `expandHandSequence` and use `err.message` as the problem string; skip the call when the RuleSetSchema or player-range checks fail (FR-211).
- Decisions so far: D-001 only.
