# Iteration 7 — `validate` and the distribution report

Commit: see `git log -1` (message `Phase 12: generate-data validate and distribution report`).

## Criteria
- PASS VC-1233: `pnpm vitest run tests/unit/datagen/validate.test.ts` ("validate a good run"): 60-game run, `--replay-every 1 --shard-size 20 --workers 2`; `validate` exit 0, `status: OK`, `games: 60`, `round(mean*60) == decisions == rows counted in the decisions files`, one `bid histogram, <n>:` line per distinct `cards_dealt`, ascending, each with `n+1` entries. (The decisions per game are constant for one preset/player count, so mean x 60 is exact.) Manual run: 20 games, 3 players -> `status: OK`, histograms for 4..17.
- PASS VC-1234 (same file, "validate corrupted runs"; one 12-game run, 2 shards, `--replay-every 1`, copied per case). Each case: exit 1, empty stdout, exactly one stderr line:
  - shard file deleted -> `check 2 (files): shard 1 hands: file ... is missing`
  - one byte changed -> `check 2 (files): shard 0 games: SHA-256 ... differs from the manifest`
  - games line removed -> `check 4 (join): shard 0: ...`; decisions line removed -> `check 5 (decisions per game): shard 1 game ...`
  - `hands.points_by_seat` changed -> `check 6 (labels): shard 0 ...`; `decisions.chosen_move_id` changed -> `check 7 (replay): ... step 3 differs`
  - `manifest.json` = `{}` -> `check 1 (manifest): manifest.json: ...`; plus an unparsable hands row -> `check 3 (rows): shard 0 hands line 2`.
  How the later checks were reached: the test helper `rewriteTable` gunzips the table, applies the edit, writes it back properly gzipped, and updates that manifest entry's `bytes`, `sha256` and `rows`, so check 2 passes and only the targeted check can fail. The delete and byte-change cases are NOT rewritten (check 2 is the target).
- PASS VC-1235: 9 games, shard size 3, `HOOK_FAIL_SEED=i-1-0 HOOK_MODE=not-game-over` -> shards `complete, failed, complete`; `validate` stdout line 1 `validate: i  status: INCOMPLETE`, `games: 6 ...`, exit 1, stderr empty.
- PASS VC-1236: missing run dir and a dir without `manifest.json` -> exit 1, stdout empty, stderr exactly `generate-data: no run "<id>" in <out>`; `validate` with no `--run-id` -> exit 1, one `generate-data: ...` line, stdout empty. (Also `args.test.ts`: the old "stub" test now asserts the no-run line.)
- PASS VC-1237: 30 games, 3 players, `argentina-fidepo`: report `made-bid rate` equals `oneDecimal(100 x made / sum(n_hands x 3))` computed from the files in the test; `average final total by seat` equals the means of `final_total_by_seat[k]`.
- PASS `pnpm typecheck`, `pnpm lint`, `pnpm vitest run tests/unit/datagen` (11 files, 172 tests).
- PASS VC-1243: both greps print nothing; `git diff --stat af777e04..HEAD -- src app` empty; `grep -n manifest scripts/datagen/worker.ts` prints nothing.
- PASS artifacts: this record, `CONTEXT.md`, `DECISIONS.md` (D-022..D-025). `.data/datasets` left empty.

## Files
Added: `scripts/datagen/validate.ts`, `scripts/datagen/report.ts`, `tests/unit/datagen/validate.test.ts`, this record.
Changed: `scripts/generate-data.ts` (validate wired), `scripts/datagen/game.ts` (exports `replayAgainst`; replay code moved there, same messages), `tests/unit/datagen/args.test.ts` (stub test replaced), `CONTEXT.md`, `DECISIONS.md`. Deleted: none.

## Deviations
- `game.ts` is touched although the plan's "Touches" omits it: required to reuse the replay code (D-023).
- Checks 3-7 run per shard rather than each over the whole dataset (D-022). `oneDecimal` exists in both `run.ts` and `report.ts` (D-025).
- Gate fix (D-026): check 6 first used a consistency proxy; it now re-scores each hand with `scoreHand` (FR-1212 check 5) and a test covers a self-consistent tampering (points +5 on one hand and seat, `final_total_by_seat` and the decisions labels adjusted, manifest rewritten) -> check 6.

## Gotchas
- BSD `sed -i` needs `-i ''`; use eslint `--fix` for `no-regex-spaces` (regexes with double spaces must be written ` {2}`).
- gzip corruption that leaves bytes/sha matching the manifest is reported as `check 2 ... cannot be read`, or check 3 when only the streaming pass sees it.
- Strategy order in `average final total by strategy` is first appearance by seat.

## For the next iteration
- Resume (8): VC-1238 can call `validate --run-id <id> --out <tmp>` and expects exit 0 once all shards are complete; `executeValidate(options, { out, err })` can also be called in-process.
- `validate` never reads `.tmp` files and ignores stray files in `shards/`.
- The error lines in CONTEXT.md ("Public interfaces") are the wording the docs (Iteration 11) should quote; the report function is `formatReport(runId, status, stats)`.
