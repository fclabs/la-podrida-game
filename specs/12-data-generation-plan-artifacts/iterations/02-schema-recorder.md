# Iteration 2: Row schemas and the recorder

Commit: the Phase 12 commit "Phase 12: decision row schema and observing recorder" (`git log -1 --format=%H` on it).

## Criteria
- PASS VC-1207: `pnpm vitest run tests/unit/datagen` -> recorder.test.ts "steps run 0..m-1" (5 seeds, m = unrecorded `moves`).
- PASS VC-1208: same run, "bid and play row shapes".
- PASS VC-1209: same run, "legal ids equal legalMoves(prev) and the chosen id is accepted" (also BR-1208: `applyMove(prev, seat, chosen_move_id)` replays 5 whole games to `game-over`).
- PASS VC-1210 (recorder part): "strategy name, policy_probs null, explore false".
- PASS VC-1211 / VC-1212: "union is the full deck; stock lengths per trump case". Configs: argentina-fidepo 3, 4, 5 players and spain-ludoteka 4, 5 players. Trump in dealer's hand occurs for argentina-fidepo 4p (13 x 4 = 52) and spain-ludoteka 5p (8 x 5 = 40); a stock exists in the other cases. The test asserts both cases were seen; `createGame` fallback was not needed.
- PASS VC-1214: key-name test on rows and on the schema shape.
- PASS VC-1215: 50 seeds (`obs-0..49`, argentina-fidepo 3 players), deep-equal state (incl. `aiDecisionCount`) and events, recorded vs unwrapped.
- PASS VC-1216: spy strategy receives the identical view/moves/rng references, same number of RNG draws as alone, one inner call per decision (also over a whole game).
- PASS schema tests: column order, pending vs complete, strictness.
- PASS `pnpm typecheck`; PASS `pnpm lint`; PASS `pnpm vitest run tests/unit/datagen` (4 files, 92 tests).
- PASS VC-1243: `grep -rE "from '(@/)?(\.\./)*src/(storage|state)|game-service" scripts/datagen scripts/generate-data.ts` and `grep -rn "scripts/" src app` print nothing; `git diff --stat af777e04fcf3d8b751444c48770134c470622a9b..HEAD -- src app` is empty.
- PASS artifacts: this record, CONTEXT.md, DECISIONS.md (D-004..D-006).

## Files
Added: `scripts/datagen/{schema,cards,recorder}.ts`, `tests/unit/datagen/{recorder,schema}.test.ts`, this record.
Changed: `CONTEXT.md`, `DECISIONS.md`. Deleted: none.

## Deviations
None from the spec. Interpretation: "outcome columns nullable/optional only for the pre-label type" is implemented as two schemas (D-004): the pending schema has no outcome keys at all.

## Gotchas
- `createRecorder` needs the INITIAL state (hand 0 dealt, no plays); one recorder per game.
- The view-derived columns are captured before the inner strategy runs, so a strategy that mutated its view could not corrupt the row.
- The VC-1215 test takes ~5 s; it has a 60 s timeout.

## For the next iteration
- `rec.rows()` returns the live `readonly PendingDecisionRow[]`; produce `DecisionRow` by spreading a row and adding the 7 `OutcomeColumns` (`hand_bid, hand_tricks_won, hand_made, hand_points, won_this_trick, final_place, final_total`); `won_this_trick` is `null` for bid rows.
- Trick winners: rebuild from `card-played`/`trick-won` events of the game (`runAiLoop` result `events`); `trick-won` event has `seat` (winner) and `trickNumber`.
- `hiddenStockLeft` and `cardIds` live in `scripts/datagen/cards.ts`.
- Build players with `createAiPlayer(seat, name, rec.wrapStrategy(seat, getStrategy(name)))`, `runAiLoop(state, players, { onTransition: rec.onTransition })`.
