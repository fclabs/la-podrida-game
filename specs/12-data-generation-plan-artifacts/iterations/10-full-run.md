# Iteration 10 — Full 100,000-game run

Commit: see `git log -1` (message `Phase 12: record first full data-generation run`). No source change. The user confirmed the full run beforehand.
Machine: 10 cores, 375 GB free; Node v26 (pnpm engine warning expected).

## Criteria
- PASS VC-1245: `pnpm generate-data run --run-id s0-full --preset argentina-fidepo --players 5 --games 100000` exit 0 (default workers).
  `run: s0-full  preset: argentina-fidepo  players: 5  games: 100000  shards: 100` /
  `shards: 100 complete (0 skipped, 0 failed)` / `rows: games 100000  hands 1700000  decisions 63500000` /
  `size: 2617.9 MB  duration: 650.3 s`. External wall clock (`date +%s`): 650 s = 10.8 min <= 30 min (NFR-1202).
  Size 2,617,928,524 B = 2617.9 MB <= 8,000 MB (NFR-1203); 26,179 B/game (projection from Iteration 9: 2,622 MB). 6.5 ms/game on 10 workers.
- PASS VC-1245 validate: `pnpm generate-data validate --run-id s0-full` exit 0, `status: OK`, wall 692 s (single-threaded). Report below.
- PASS VC-1246: `s0-full-resume`, same parameters. Started in the background, polled `manifest.json` every 2 s with `jq` until 40 shards were
  `complete`, then `kill -9` on the pnpm/node process; no `generate-data` process remained (`ps`). Manifest after the kill: 40 complete,
  60 pending, 30 stray `.tmp` files in `shards/`. Same command re-run: exit 0, `shards: 100 complete (40 skipped, 0 failed)`,
  `rows: games 100000  hands 1700000  decisions 63500000`, `size: 2623.9 MB  duration: 395.9 s` (external 397 s).
  `skipped` 40 = complete before the kill. `validate --run-id s0-full-resume` exit 0, `status: OK`, wall 699 s.
- PASS isolation: `git diff --stat af777e04..HEAD -- src app` empty; `git status --short` shows only `docs/__future__/` untracked (plus artifact edits);
  `git check-ignore .data/datasets/s0-full/manifest.json` prints the path.
- PASS artifacts: this record, `CONTEXT.md` (299 lines), `DECISIONS.md` (no new decisions).

## Validate report of `s0-full` (verbatim, after the 3 pnpm banner lines)
```
validate: s0-full  status: OK
games: 100000  hands: 1700000  decisions: 63500000
decisions per game: mean 635.0  min 635  max 635
made-bid rate: 14.5%
average final total by seat: 0: 46.7  1: 46.6  2: 46.6  3: 46.6  4: 46.6
average final total by strategy: random: 46.6
bid histogram, 4: 0:495054 1:498457 2:500818 3:502082 4:503589
bid histogram, 5: 0:165837 1:165343 2:166586 3:167058 4:167347 5:167829
bid histogram, 6: 0:141990 1:142509 2:142676 3:142675 4:143593 5:143521 6:143036
bid histogram, 7: 0:124362 1:124422 2:125326 3:124726 4:125602 5:125005 6:125441 7:125116
bid histogram, 8: 0:110715 1:110953 2:111363 3:110875 4:111321 5:111210 6:111189 7:111604 8:110770
bid histogram, 9: 0:99880 1:100207 2:100237 3:99543 4:99736 5:100201 6:99934 7:100030 8:99912 9:100320
bid histogram, 10: 0:90630 1:90615 2:91080 3:90950 4:90654 5:90854 6:90481 7:91045 8:91591 9:90952 10:91148
```

## Figures for the docs
- 100,000 games, 100 shards of 1000; 1,700,000 hands; 63,500,000 decisions (635 per game).
- `s0-full`: 2,617,928,524 B (2617.9 MB, ~2.5 GiB on disk), 26,179 B/game; per shard ~26.2 MB (decisions ~25.8 MB, hands ~349 KB, games ~19 KB).
- Generation 650.3 s on 10 cores; resumed run needed 395.9 s for the 60 missing shards. Validation takes ~11.5 min.
- Datasets are at `.data/datasets/s0-full/` and `.data/datasets/s0-full-resume/` (git-ignored, kept). They hold different games
  (seed includes the run id), hence the 6 MB size difference.

## Files
Added: this record. Changed: `CONTEXT.md`, `DECISIONS.md`. No source, test or package change.

## Deviations / gotchas
- None from the plan. `validate` is far slower than generation (single-threaded, re-scores every game); plan for ~12 min per 100k games.
- The kill script lived in the session scratchpad, not the repo.

## For the next iteration
Iteration 11 (docs) can quote the report and figures above and point to `.data/datasets/s0-full/`.
