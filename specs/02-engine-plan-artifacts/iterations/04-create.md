# Iteration 4 — Game creation, dealing and legal moves

**Commit**: this commit ("Create games, deal hands and list legal moves"). Previous: `092703a` (Iteration 3).

## Criteria results

All rows run with `pnpm vitest run tests/unit/engine/engine-create.test.ts --reporter=verbose` (1 file, 61 tests passed) unless noted.

| Criterion | Result | Evidence |
|---|---|---|
| VC-206 | PASS | `aiRng(state, 2)` first 10 raw outputs = `deriveRng(seed,'ai',2,0)`; with `aiDecisionCount: 7` = `deriveRng(seed,'ai',2,7)`; differs from the count-0 stream and from the deal stream. |
| VC-211 | PASS | Every row throws `InvalidGameSetupError`: `players.min = 1`; 2 seats argentina-fidepo (exactly 1 problem); 7 seats spain-ludoteka (1); seats `[0,2,1]`; `kind: 'robot'` (1); duplicate `playerId` (1); `gameId ''` (1); `seed ''` (1); custom `{repeat, cards: 20}` with 4 seats (1 problem, contains `20`, equals the `expandHandSequence` RangeError message). Empty seed + duplicate playerIds → `problems.length === 2`. Extra: schema failure + 9 seats → 1 problem; every problem appears in `message`. |
| VC-212 | PASS | argentina-fidepo, 4 seats, `'seed-1'`: parses with `GameStateSchema`; `phase 'bidding'`, `handIndex 0`, `version 0`, `aiDecisionCount 0`, plan length 22; events `['game-started','hand-dealt']` with seats/plan, both parse with `GameEventSchema`; mutating input `rules.players.max` and `seats[0].name` leaves the state deep-equal. |
| VC-213 (hand 0) | PASS | 20 seeds: dealer = `deriveRng(seed,'deal',0).int(0,3)`; 200 seeds (mexico-bazas, 4 players): dealers `{0,1,2,3}`. |
| VC-214 (hand 0) | PASS | Independent recomputation (dealer draw, shuffle, round-robin from `next(dealer)`, sort) matches every seat's hand for argentina 4p/3p, spain 3p (36-card deck), gamerules 5p; hands sorted by suit then rank; `toAct = currentTrick.leader = currentActor = next(dealer)`; bids null; tricksWon 0; no `lastTrick` key. |
| VC-215 | PASS | argentina-fidepo 3p, 3 seeds: 17 cards, `trumpCardInDealerHand false`, trump in no hand, equals shuffled card 51, `trumpSuit === trumpCard.suit`; `hand-dealt` keys are exactly the 6 spec fields (no hands). |
| VC-219 ids | PASS | Via `legalMoves` on hand-built bidding states: dealer 4 cards others 1 → `bid:0,bid:1,bid:2,bid:4`; others 5 → `bid:0…bid:4`; non-dealer → full; `dealerRestriction false` → full; spain 1 card exempt → `bid:0,bid:1`; spain 2 cards → `bid:0,bid:2`; created argentina game ends at `bid:13`. |
| VC-220 ids (carry-over) | PASS | Playing-phase states: 9H led, hold KS AH 3H → `play:AH, play:3H` with full move shape and card copies; empty trick → `play:10S, play:2S, play:QH, play:5D`. |
| VC-217 (bidding + hand-built game-over) | PASS | Bidding and playing: `currentActor = hand.toAct`, other seats `[]`; `{phase:'game-over', hand:null}` → `null`, every seat `[]`. |
| VC-218 (`legalMoves` rows) | PASS | Bidding state: seats `-1, 4, 1.5, NaN` → `RangeError`; game-over state: `-1, 4, 1.5` → `RangeError`. |
| VC-234 | PASS | `ENGINE_VERSION === 1`, `typeof 'number'`. |
| Full gate | PASS | `pnpm typecheck && pnpm lint && pnpm test` → exit 0 (16 files, 373 tests; Prettier clean, 0 warnings). |
| Purity grep | PASS | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/score\|\.\./score' src/engine` → no matches. `engine.ts` imports only `@/src/domain/{cards,decks,rules,schemas,types}` and `./bidding ./play ./rng ./sequence`. |
| Mutation sanity | PASS | Temporarily dealing card `k` to `(dealer + k) % N` failed 4 tests (VC-214 rows); restored. |
| Artifacts | PASS | `CONTEXT.md` rewritten (every `engine.ts` export listed), D-003/D-004 appended, this record written. |

## Files

- Added: `src/engine/engine.ts`, `tests/unit/engine/engine-create.test.ts`, `specs/02-engine-plan-artifacts/iterations/04-create.md`.
- Changed: `tests/unit/engine/helpers.ts` (`makeSeats`, `newGame`, `withHand`), `specs/02-engine-plan-artifacts/CONTEXT.md`, `specs/02-engine-plan-artifacts/DECISIONS.md`.
- Deleted: none.

## Deviations

- None from Scope. `applyMove` not exported (plan decision). `dealHand` not exported (no test needed it).
- Decisions: D-003 (moves/events carry card copies), D-004 (problem granularity and order in `createGame`).
- Extra beyond VCs: VC-220 `play:` ids (orchestrator carry-over), playing-phase VC-217 row, NaN seat row, error-class shape test.

## Gotchas

- `helpers.ts` now imports `engine.ts`; a broken `engine.ts` breaks every engine test file that imports helpers.
- `withHand` builds positions with `makeHand` (4 cards, dealer 0 defaults) that need not match `handPlan` or the dealt cards — fine for `legalMoves`, but such states fail invariants.
- `setupProblems` reads `seats` defensively (`unknown` casts) because invalid inputs are by definition not well-typed; `structuredClone` runs only after validation.
- `currentActor` also returns `null` when `hand` is `null` (keeps `legalMoves` total on malformed states).
- VC-214 test sorts by `suits.indexOf * 100 + ranksHighToLow.indexOf` — independent of `compareRanks`.

## For the next iteration

- Deal next hands with `dealHand(state, state.handIndex + 1, completedHand.dealer)` after bumping `handIndex` (reads `handPlan[handIndex]` passed in, not `state.handIndex`), and emit `handDealtEvent(index, hand)`.
- Reuse `assertSeatInRange(state, seat)` as the first step of `applyMove` in every phase; `nextSeat(seat, N)` is available.
- Follow D-003 for new events (copy cards into `card-played`, copy bids/tricks arrays into `hand-completed.result`).
- Helpers: `makeSeats(n, kinds)` (use for VC-224 `[human, ai, ai, human]`), `newGame(id, players, seed)`, `withHand(state, overrides, phase)`. Add `playGame` per plan.
- **VC parts deferred to Iteration 5**: VC-213 rotation (every next hand's dealer = `(dealer + 1) mod N`); VC-214 hands 1 and 2; VC-216 dealing part (whole-deck hand: `trumpCardInDealerHand`, trump in dealer's hand, `hand-dealt` carries `trumpCard`); VC-217 at a real game-over; VC-218 `applyMove` rows (`applyMove(state, N, 'bid:0')` on bidding state and `applyMove(gameOverState, N, 'bid:0')` → `RangeError`).
- **VC parts deferred to Iteration 6**: VC-216 view part; VC-218 `tableViewFor(state, N)` row.
- Decisions so far: D-001 to D-004.
