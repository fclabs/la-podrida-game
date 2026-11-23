# Iteration 3 — Legal bids, legal plays, trick winner

**Commit**: this commit ("Add legal bids, legal plays and trick resolution"). Previous: `1a6cd13` (Iteration 2).

## Criteria results

| Criterion | Result | Command / evidence |
|---|---|---|
| VC-219 (function level) | PASS | `pnpm vitest run tests/unit/engine/bidding.test.ts --reporter=verbose` — dealer, 4 cards, others sum 1 → `[0,1,2,4]`; others sum 5 (forbidden −1) → `[0,1,2,3,4]`; non-dealer → `[0..4]`; `dealerRestriction: false` → `[0..4]`; spain-ludoteka 1 card (exempt), others 0 → `[0,1]`; spain-ludoteka 2 cards, others 1 → `[0,2]` (restriction applies). Extras: exemption list emptied → `[0]`; dealer seat 0 (not last) → `[0,1,3,4]`. |
| VC-220 (function level) | PASS | `pnpm vitest run tests/unit/engine/play.test.ts --reporter=verbose` — all 14 spec rows (montar and the trump-led row split one row per flag value) give exactly the listed arrays, hands in the listed order, spades trump, trick led by seat 0. Each row is run under every combination of the four play flags consistent with its fixed flags (16 / 2^k combos). Extra: result is a new array of the hand's own card objects; hand not mutated. |
| VC-221 | PASS | `pnpm vitest run tests/unit/engine/trick.test.ts --reporter=verbose` — no trump (AD on hearts led loses), one trump over led aces, two trumps, trump led, led card wins, leader 2 and 3 (seat returned, not index), Spanish `3O` beats `RO` (oros led, leader 2), Spanish low trump beats led ace, empty trick throws `RangeError`. |
| Iteration test files | PASS | `pnpm vitest run tests/unit/engine/{bidding,play,trick}.test.ts` → 3 files, 33 tests passed. |
| Full gate | PASS | `pnpm typecheck` exit 0; `pnpm lint` exit 0 (Prettier clean); `pnpm test` exit 0 (15 files, 312 tests). |
| Purity grep | PASS | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/score\|\.\./score' src/engine` → no matches. New files import only `@/src/domain/{cards,decks,rules,types}`. |
| Mutation sanity | PASS | Temporarily dropping `&& led !== trump` from the waiver in `play.ts` made 2 VC-220 rows fail (trump-led rows); restored. |
| Artifacts | PASS | `CONTEXT.md` rewritten (three signatures, helper list); D-002 appended; this record written. |

## Files

- Added: `src/engine/bidding.ts`, `src/engine/play.ts`, `src/engine/trick.ts`, `tests/unit/engine/helpers.ts`, `tests/unit/engine/bidding.test.ts`, `tests/unit/engine/play.test.ts`, `tests/unit/engine/trick.test.ts`, `specs/02-engine-plan-artifacts/iterations/03-rules.md`.
- Changed: `specs/02-engine-plan-artifacts/CONTEXT.md`, `specs/02-engine-plan-artifacts/DECISIONS.md` (D-002).
- Deleted: none.

## Deviations

- None from the plan's Scope. One small API choice recorded as D-002: `trickWinner([])` throws `RangeError` (the spec only defines complete tricks).
- Tests go beyond the VCs: VC-220 rows are run under every compatible flag combination (the Goal says "every flag combination"); a few extra VC-219/VC-221 rows (see table).

## Gotchas

- `legalPlays` returns the hand's own `Card` objects (new array, same objects). `engine.ts` may put them straight into `Move`s; never mutate them.
- In `legalPlays`, "highest led-suit card on the table" is never `null` because the lead is of the led suit; *montar* compares against it, not against the current winner (design §5.4).
- The `beatNotRequiredAfterTrumped` waiver requires a trump on the table **and** led suit ≠ trump; the trump-led rows check that the waiver does not apply.
- `legalBids` counts `null` bids of other seats as 0 and excludes the seat itself from the sum.
- In VC-220 tests the acting seat is `plays.length` (leader 0), so hands are placed at that index of a 4-seat `hands` array.

## For the next iteration

- Import inside `src/engine` as `import { legalBids } from './bidding'`, `import { legalPlays } from './play'`, `import { trickWinner } from './trick'`.
- Call shapes: `legalBids(state.hand, seat, state.rules)`, `legalPlays(state.hand, seat, state.rules, state.rules.deck)`, `trickWinner(plays, hand.trumpSuit, state.rules.deck)`. None of them checks turn, phase or seat range: `legalMoves` must do that (FR-218 to FR-220) before calling.
- Test VC-219 ids (`bid:0,bid:1,bid:2,bid:4`) and VC-220 ids (`play:<cardId>`) via `legalMoves` in `engine-create.test.ts`.
- Helpers available: `card`, `cards`, `trick`, `rulesWith`, `makeHand` (see CONTEXT.md). Iterations 4–5 may add helpers to `helpers.ts`.
- Decisions so far: D-001, D-002.
