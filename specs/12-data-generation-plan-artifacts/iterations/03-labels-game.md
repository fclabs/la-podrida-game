# Iteration 3: Labels, `games`/`hands` rows, per-game checks, replay

Commit: the Phase 12 commit "Phase 12: outcome labels, game and hand rows, per-game checks and replay" (`git log -1 --format=%H`).

## Criteria
Command for the test criteria: `pnpm vitest run tests/unit/datagen` -> 6 files, 111 tests passed.
- PASS VC-1204 (game level): game.test.ts "formats R-s-i" and "game_id == seed == R-s-i in every row".
- PASS VC-1206: game.test.ts "strategy_by_seat equals the list and a hand replay reproduces the totals" (4 players, createGame + runAiLoop by hand).
- PASS VC-1213: labels.test.ts "won_this_trick follows the next trick-won event" (3, 5, 4 players; null on bids; true-plays per hand/seat == tricks won).
- PASS VC-1217, VC-1218, VC-1220: labels.test.ts "hands rows match evaluate; places and totals add up".
- PASS VC-1219: labels.test.ts "decision labels equal the hands/games entries".
- PASS VC-1248: game.test.ts, 20 games, every row checked against hands row and a replay of the seed (`buildPlayerView` per step).
- PASS VC-1250: labels.test.ts and game.test.ts (3 and 5 players; all per-seat array columns).
- PASS per-game checks: game.test.ts checks 1, 2, 3, 4, 5 each throw `GameFailure` (seed set, message names the check); replay differing by one move -> `replay: step 6 differs`; replay runs for exactly indices 0, 100, 200 over 0..204 by default and for every index with `replay_every` 1; the `runAiLoop` hook is not used for the replay.
- PASS `pnpm typecheck`; PASS `pnpm lint`; PASS `pnpm test` (110 files passed, 1916 tests).
- PASS VC-1243: `grep -rE "from '(@/)?(\.\./)*src/(storage|state)|game-service" scripts/datagen scripts/generate-data.ts` and `grep -rn "scripts/" src app` print nothing; `git diff --stat af777e04fcf3d8b751444c48770134c470622a9b..HEAD -- src app` empty.
- PASS artifacts: this record, CONTEXT.md, DECISIONS.md (D-007..D-009).

## Files
Added: `scripts/datagen/{labels,game}.ts`, `tests/unit/datagen/{labels,game}.test.ts`, this record.
Changed: `scripts/datagen/schema.ts` (+`GamesRowSchema`, `HandsRowSchema`), `CONTEXT.md`, `DECISIONS.md`. Deleted: none.

## Deviations
None. Interpretation: hook parameters are ready functions, not `(real) => fn` factories (D-007).

## Gotchas
- `createGame`'s events (hand 0 `hand-dealt`) are not in the loop result, so hand 0's deal columns come from the initial state.
- `GameFailure` carries only `seed` and `message`; errors from the loop (`AiLoopLimitError`, `IllegalMoveError`) propagate unchanged, shard processing must record the seed itself for those.
- `index % replay_every === 0`; the games test over 205 games takes a few seconds.
- `rec.rows()` is live; `buildTables` builds new `DecisionRow` objects, so `transformRows` may mutate freely.

## For the next iteration
- Call `playRecordedGame({ run_id, shard, index, preset, strategies, replay_every })` per game; it returns `{ games, hands, decisions }` (one `games` row, arrays of rows). Nothing is written; the sink must serialize rows with keys in schema order (spread order already matches) and gzip.
- Rows are not Zod-parsed in `playRecordedGame`; parse in tests / validate with `GamesRowSchema`, `HandsRowSchema`, `DecisionRowSchema`.
- For failures outside `GameFailure`, the shard processor knows the seed via `gameSeed(run_id, shard, index)`.
- The manifest schema is still to be added to `schema.ts`.
