# Iteration 9 — Measurement run and no-regression

Commit: see `git log -1` (message `Phase 12: measurement run and regression check`). No source change; no bug found.

## Criteria
- PASS VC-1230 (run part): `pnpm generate-data run --run-id measure-1k --games 1000` exit 0. Summary:
  `run: measure-1k  preset: argentina-fidepo  players: 3  games: 1000  shards: 1` /
  `shards: 1 complete (0 skipped, 0 failed)` / `rows: games 1000  hands 29000  decisions 981000` / `size: 41.9 MB  duration: 72.1 s`.
  `pnpm generate-data validate --run-id measure-1k` exit 0, report (head):
  `validate: measure-1k  status: OK` / `games: 1000  hands: 29000  decisions: 981000` / `decisions per game: mean 981.0  min 981  max 981` /
  `made-bid rate: 10.3%` / `average final total by seat: 0: 129.8  1: 128.3  2: 129.6` / `average final total by strategy: random: 129.2` /
  then one bid histogram line per cards_dealt (4..17 shown flat across bids).
  Decisions per game 981; bytes per game 41,942 (decisions 41,431,139 B, hands 497,120 B, games 14,002 B); 72.1 ms per game.
- PASS NFR-1201: `pnpm --silent simulate --games 200` -> `duration: 11.1 s` = 55.5 ms/game. `pnpm generate-data run --run-id measure-1k-w1
  --games 1000 --workers 1` (fresh id, I-2) exit 0, `duration: 71.9 s` = 71.9 ms/game. Ratio 1.30x <= 3x.
  (The default-workers run is also a single shard, 72.1 s.)
- PASS NFR-1203 projection: the 5-player run `--run-id measure-1k-p5 --players 5 --games 1000` exit 0, validate OK
  (635,000 decisions, 635.0 per game), `size: 26.2 MB` (26,223,824 B), `duration: 44.0 s`. 26.2 / 1000 x 100000 = 2,622 MB <= 8,000 MB.
  Extra: 5-player simulator `--games 200 --players 5` 6.6 s = 33.0 ms/game, generator 44.0 ms/game = 1.33x. 3-player projection 4,194 MB.
- PASS VC-1243: both greps print nothing; `git diff --stat af777e04..HEAD -- src app` empty.
- PASS VC-1244: `pnpm typecheck` 0; `pnpm lint` 0; `pnpm test` 0 (116 files passed, 1 skipped; 1987 tests passed, 30 skipped);
  `pnpm test:sim` 0 (5 files, 3605 tests passed). `pnpm --silent simulate --games 200 --seed sim` prints the four baseline lines
  (`129.9 / 132.0 / 130.1`, `10.8%`, 29 hands/game; duration 11.1 s vs 11.3 s). `git check-ignore .data/datasets/x/manifest.json`
  prints `.data/datasets/x/manifest.json`.
- PASS artifacts: this record, `CONTEXT.md` (measured figures section), `DECISIONS.md` (no new decisions).
- Cleanup: `.data/datasets/measure-1k*` deleted (`.data/datasets` empty); no stray processes.

## Figures for the docs
| run | decisions/game | bytes/game | ms/game |
|---|---|---|---|
| 3 players | 981 | 41,942 | 72.1 (w1: 71.9) |
| 5 players | 635 | 26,224 | 44.0 |
Simulator: 55.5 ms/game (3p), 33.0 ms/game (5p). Full run (100,000 games, 5p): 2,622 MB.

## Files
Added: this record. Changed: `CONTEXT.md`, `DECISIONS.md`. No source, test or package change.

## Deviations / gotchas
- None from the plan. A default 1,000-game run is one shard, so only one worker is busy (expected); the "default workers" and
  `--workers 1` runs therefore time the same. Timings are from a single measurement each, on a machine that also ran nothing else.
- Full 100,000-game run is 100 shards of 1000: on N cores about 44 s x 100 / N.

## For the next iteration
None planned; Iteration 9 is the last. The docs iteration (if any) can quote the figures above and the command list in `CONTEXT.md`.
