# Iteration 5 — Applying moves and automatic transitions

**Commit**: this commit ("Apply moves with automatic transitions and events"). Previous: `04caeff` (Iteration 4).

## Criteria results

Engine-file rows run with `pnpm vitest run tests/unit/engine/engine-apply.test.ts --reporter=verbose` (40 tests passed) unless noted.

| Criterion | Result | Evidence |
|---|---|---|
| VC-213 (full) | PASS | argentina 4p, mexico 3p, gamerules 7p full games: every `hand-dealt` i has dealer `(first + i) mod N` with `first = deriveRng(seed,'deal',0).int(0,N−1)`; `completedHands[i].dealer` likewise. Hand-0 rows stay in `engine-create.test.ts`. |
| VC-214 (full) | PASS | Hands 1 and 2 recomputed independently (dealer = previous + 1, no draw; shuffle of `deriveRng(seed,'deal',i)`; round-robin from `next(dealer)`; sort by suit index × 100 + rank index) for argentina 4p/3p, spain 3p, gamerules 5p: hands, trump card, `trumpCardInDealerHand`, sorting, mano = `toAct` = `currentTrick.leader`, bids null, tricksWon 0, no `lastTrick`. Hand 0 in `engine-create.test.ts`. |
| VC-216 (dealing part) | PASS | argentina 4p hand 0 and hand 21 (dealt by `applyMove`), both 13 × 4 = 52: `trumpCardInDealerHand true`, trump in dealer's hand only, `hand-dealt` carries the same `trumpCard`. View part → Iteration 6. |
| VC-217 (full) | PASS | Real game over (mexico 3p): `currentActor` null, `legalMoves` `[]` for every seat. |
| VC-218 (`applyMove` rows) | PASS | Bidding state: seats 4, −1, 1.5, NaN → `RangeError`; game-over state: 3, −1, 1.5 → `RangeError`, not `IllegalMoveError`. `tableViewFor` rows → Iteration 6. |
| VC-222 | PASS | Wrong seat → `not-your-turn`; `bid:99`, `play:AS`, `bid:-1`, `bid:01`, `''` during bidding → `unknown-move`; dealer's forbidden `bid:13` → `unknown-move`; bid during playing and a foreign card → `unknown-move`; game over → `game-over` for every seat; messages contain seat and moveId; input unchanged after rejections. |
| VC-223 | PASS | Every move (>500) of a full argentina 4p game: pre-call `structuredClone` deep-equals the input after; no object reachable from `{state, events}` of the result is reachable from the input (identity walk). Mutating `hand.hands[0]`, a card and `seats[0]` of the result leaves the input equal; mutating events leaves the returned state equal. |
| VC-224 | PASS | Seats `[human, ai, ai, human]`: +1 after each AI move only; final `aiDecisionCount` = number of AI moves; `version` 0 throughout. |
| VC-225 | PASS | Hands 0–2: bids mano → dealer, one `bid-made` each, `toAct` next; dealer's bid → `phase 'playing'`, `toAct = next(dealer)`. Every play of the game: `card-played` with the held card; non-final → only `card-played`, card removed, appended to trick, `toAct = next(seat)`; final → `card-played, trick-won`, `trickNumber` 1, 2, … per hand, `lastTrick = {winner, plays}`, `currentTrick = {leader: winner, plays: []}`, `toAct = winner`, `tricksWon[winner] + 1`. |
| VC-226 | PASS | Last play of hand 0: events exactly `card-played, trick-won, hand-completed, hand-dealt`; `completedHands[0]` = `{handIndex 0, cardsPerPlayer, dealer, trumpSuit, bids, tricks}` with `sum = cardsPerPlayer`; hand 1: next dealer, `handPlan[1]` cards, no `lastTrick`, `hand-dealt` payload. Plus FR-235 order checked on every move of a full game. |
| VC-227 | PASS | mexico 3p: last events `hand-completed, game-over`; `phase 'game-over'`, `hand null`, `handIndex 10`, 11 `completedHands`; every state parses (`GameStateSchema`), every event parses (`GameEventSchema`). Extra: argentina 3p, spain 6p, gamerules 7p also end schema-valid. |
| VC-231 | PASS | `pnpm vitest run tests/unit/engine/determinism.test.ts` — gamerules 5p: second run deep-equal state and events after every move; replaying only `bid-made`/`card-played` events (→ `bid:<n>` / `play:<cardId>`) from a fresh `createGame` reproduces the final state. |
| VC-232 | PASS | same file — argentina 4p and spain 3p, `firstMove` vs `lastMove`: all `hand-dealt` events and all freshly dealt `hand.hands` identical; `completedHands` bids differ. |
| VC-237 | PASS | `pnpm vitest run tests/unit/engine/golden.test.ts` — literals (dealer 0, trump `KD` in dealer's hand, four hand-0 hands, 22 `completedHands`) computed once with a scratch script and pasted; cross-checked by an in-test independent recomputation of the hand-0 deal; `ENGINE_VERSION === GOLDEN_ENGINE_VERSION (1)`; header comment says changing literals requires bumping `ENGINE_VERSION`. |
| NFR-203 | PASS | `pnpm vitest run tests/unit/engine/perf.test.ts --silent=false` — 981 moves; runs 46.1, 45.9, 45.4, 44.8, 44.7 ms; **median 45.4 ms** (< 250). Move count asserted = 29 × 3 + 3 × sum(handPlan). |
| Engine dir | PASS | `pnpm vitest run tests/unit/engine/` → 10 files, 207 tests passed. |
| Full gate | PASS | `pnpm typecheck && pnpm lint && pnpm test` → exit 0 (20 files, 422 tests; 0 warnings; Prettier clean). |
| Purity grep | PASS | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/score\|\.\./score' src/engine` → no matches. New import: `./trick`. |
| Mutation sanity | PASS | (1) `const next = state` (no clone) → 16 failures; (2) dealer bid sets `toAct = dealer` → 2 failures; (3) next hand dealt with `previousDealer null` → 9 failures. All restored. |
| Artifacts | PASS | `CONTEXT.md` rewritten (final `engine.ts` API, single-clone rule, event order, `playGame`); D-005 appended; this record. |

## Files

- Added: `tests/unit/engine/engine-apply.test.ts`, `tests/unit/engine/determinism.test.ts`, `tests/unit/engine/golden.test.ts`, `tests/unit/engine/perf.test.ts`, `specs/02-engine-plan-artifacts/iterations/05-apply.md`.
- Changed: `src/engine/engine.ts` (`applyMove`, `HandResult` type import, `./trick` import), `tests/unit/engine/helpers.ts` (`Policy`, `firstMove`, `lastMove`, `PlayedMove`, `PlayedGame`, `playGame`), `specs/02-engine-plan-artifacts/CONTEXT.md`, `specs/02-engine-plan-artifacts/DECISIONS.md`.
- Deleted: none.

## Deviations

- None from Scope. One decision: D-005 (`playGame` contract). Event copies follow D-003 (no new decision).
- `perf.test.ts` drives its own history-free loop instead of `playGame`, so only `legalMoves` + `applyMove` are timed (NFR-203 "move loop only").
- Extras beyond VCs: event-mutation isolation, FR-235 order on every move, three more presets played to a schema-valid end, `playGame` self-check.

## Gotchas

- `firstMove` always bids 0, so the dealer's forbidden bid is `cardsPerPlayer` and golden bids are all zero; use `lastMove` for varied bids (it bids the max, and the dealer the max allowed).
- `lastTrick.plays` is the old `currentTrick.plays` array moved over (safe: both live only in the clone).
- `hand-completed.result` is a `structuredClone` of the pushed `HandResult`; `bids` are cast from `(number|null)[]` — all are set by then (bidding closed).
- The perf test prints its runs with `console.log`; vitest only shows it with `--silent=false` or a reporter that prints stdout.
- `applyMove` treats `hand === null` like game over (`'game-over'`), consistent with `currentActor`.

## For the next iteration

- Iterations 6 and 7 (parallel group A): **import** `playGame`, `firstMove`, `lastMove`, `newGame`, `makeSeats` from `./helpers`; do not edit `helpers.ts` or `engine.ts`.
- Sweep states with `playGame(newGame(id, players, seed)).states`; a game-over state is `.final`.
- Iteration 6: VC-216 view part (argentina 4p hand 0 is a whole-deck hand: dealer holds the trump), VC-218 `tableViewFor(state, N)` rows on bidding and game-over states. For VC-230 an argentina 4p game covers both a whole-deck hand (13 cards, hands 0 and 21) and stock-trump hands.
- Iteration 7: every preset at its minimum player count plays to completion via `playGame` (argentina 3p, spain 3p, gamerules 3p, mexico 3p).
- Decisions so far: D-001 to D-005.
