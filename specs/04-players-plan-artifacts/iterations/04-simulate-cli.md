# Iteration 4 — Simulator CLI

Commit: this commit ("Implement the pnpm simulate CLI"; see `git log`).

Protocol: the orchestrator downgraded parallel group A to sequential, so this iteration used the **full** artifact protocol (rewrote `CONTEXT.md`, appended D-010 to D-012 to `DECISIONS.md`); no "Proposed …" sections.

## Criteria

All CLI commands run from the repo root with `pnpm --silent simulate …` (same script invocation as `pnpm simulate`, without pnpm's own banner on stdout; see D-012). stdout/stderr were redirected to files; byte/line counts from `wc`.

| Criterion | Command | Result |
|---|---|---|
| VC-414 | `pnpm --silent simulate --preset gamerules --players 4 --games 5 --seed t` (×2) | PASS — exit 0 both times; stdout: `preset: gamerules  players: 4  games: 5  hands/game: 19` / `average total per seat: 0: 29.0  1: 33.8  2: 40.2  3: 28.2` / `made-bid rate: 15.5%` / `duration: 0.2 s`; stderr empty |
| VC-414 (determinism) | `diff <(grep -v '^duration:' r1.txt) <(grep -v '^duration:' r2.txt)` | PASS — empty diff |
| FR-418 default run | `/usr/bin/time -p pnpm --silent simulate` | PASS — exit 0; `preset: argentina-fidepo  players: 3  games: 100  hands/game: 29` / `average total per seat: 0: 130.2  1: 131.7  2: 132.5` / `made-bid rate: 11.1%` / `duration: 5.6 s`; real 6.03 s |
| VC-415 `--preset nope` | `pnpm --silent simulate --preset nope` | PASS — exit 1, stdout 0 bytes, stderr 1 line: `simulate: unknown preset "nope" (known: argentina-fidepo, spain-ludoteka, gamerules, mexico-bazas)` |
| VC-415 `--players 9` | `pnpm --silent simulate --players 9` | PASS — exit 1, 0 bytes, `simulate: --players must be an integer from 3 to 6 for argentina-fidepo, got "9"` |
| VC-415 `--players abc` | `pnpm --silent simulate --players abc` | PASS — exit 1, 0 bytes, `simulate: --players must be an integer from 3 to 6 for argentina-fidepo, got "abc"` |
| VC-415 `--games 0` | `pnpm --silent simulate --games 0` | PASS — exit 1, 0 bytes, `simulate: --games must be a positive integer, got "0"` |
| VC-415 `--games 2.5` | `pnpm --silent simulate --games 2.5` | PASS — exit 1, 0 bytes, `simulate: --games must be a positive integer, got "2.5"` |
| VC-415 `--games` (no value) | `pnpm --silent simulate --games` | PASS — exit 1, 0 bytes, `simulate: Option '--games <value>' argument missing` |
| VC-415 `--seed ''` | `pnpm --silent simulate --seed ''` | PASS — exit 1, 0 bytes, `simulate: --seed must not be empty` |
| VC-415 `--bogus` | `pnpm --silent simulate --bogus` | PASS — exit 1, 0 bytes, `simulate: Unknown option '--bogus'` |
| Extra invalid args | `extra`, `--players 2`, `--games 5 --seed`, `--games=` | PASS — each exit 1, 0 bytes stdout, one stderr line (`Unexpected argument 'extra'. This command does not take positional arguments`; `… from 3 to 6 … got "2"`; `Option '--seed <value>' argument missing`; `--games must be a positive integer, got ""`) |
| FR-419 runtime error (manual) | scratch copy of `scripts/simulate.ts` with `maxMoves: 10` (sed), `pnpm exec tsx --tsconfig tsconfig.json <copy> --games 3 --seed x`; copy deleted | PASS — exit 1, stdout 0 bytes, stderr `simulate: game x-0 failed: AI loop limit reached: 10 moves applied and an AI seat is still to act` |
| `scripts/` coverage | `pnpm exec tsc --noEmit --listFilesOnly \| grep scripts/`; `pnpm exec eslint scripts/simulate.ts --max-warnings 0`; `pnpm exec prettier --check scripts/simulate.ts` | PASS — `scripts/simulate.ts` is in the tsc program (tsconfig `include` has `scripts/**/*.ts`); ESLint (via `eslint .`) and Prettier both cover it. The layer rule does not apply to `scripts/` (by design). |
| Toolchain | `pnpm typecheck && pnpm lint && pnpm test` | PASS — each exit 0; `pnpm test` 34 files / 606 tests; ESLint 0 warnings; Prettier clean |
| Sim suite | `pnpm test:sim` | PASS — 5 files / 3,605 tests, Duration 45.15 s |
| Touches only | `git diff --name-only HEAD~1` (after commit) | PASS — `scripts/simulate.ts` and the three artifact files |

No FAIL occurred; the checklist was run once from the top after the last code change.

## Files

- Changed: `scripts/simulate.ts` (stub replaced), `specs/04-players-plan-artifacts/CONTEXT.md` (rewritten), `specs/04-players-plan-artifacts/DECISIONS.md` (D-010 to D-012).
- Added: `specs/04-players-plan-artifacts/iterations/04-simulate-cli.md`.

## Decisions

- D-010 (plan P-5: strict `parseArgs`, positionals rejected, validation order preset → players → games → seed, first problem wins, `/^[1-9][0-9]*$/` integers).
- D-011 (plan P-1: made-bid rate from sums; averages, `hands/game`, duration of the game loop only, one decimal, `-0.0` → `0.0`; a game not at `game-over` is a failure).
- D-012 (pnpm's banner goes to stdout; criteria verified with `pnpm --silent simulate`).
- P-4 is reused (D-006) via an inline `aiSeats` in the script.

## Deviations

- None from the plan's Scope. Additions: positionals rejected (P-5 strict); a game that returns before `game-over` is reported like a thrown error; `-0.0` normalisation.
- VC-414/VC-415 verified with `pnpm --silent simulate` rather than bare `pnpm simulate`: with bare `pnpm`, pnpm itself writes its lifecycle banner, an "Unsupported engine" WARN and `ELIFECYCLE Command failed with exit code 1.` to stdout (the script writes nothing). Exit codes and stderr are identical either way. Fixing that would need `package.json`/`.npmrc` changes, outside Touches (D-012).

## Gotchas

- `parseArgs` messages can be multi-line (e.g. `--games --seed x` → "argument is ambiguous.\nDid you forget …"); only the first line is printed.
- pnpm preserves an empty argument (`--seed ''` arrives as `''`); `--games=` arrives as `''` too.
- Running a copy of the script outside the repo needs `pnpm exec tsx --tsconfig tsconfig.json <file>` so `@/` resolves.
- `pnpm simulate` without `--silent` mixes pnpm's banner into stdout; use `--silent` when piping or diffing.

## For the next iteration

- Iteration 5 (docs) — `pnpm simulate` usage: flags `--preset <id>` (default `argentina-fidepo`), `--players <n>` (default preset `players.min`), `--games <n>` (default 100), `--seed <prefix>` (default `sim`; game i uses `<prefix>-<i>`); P-4 all-AI seats, `random` strategy. Output is the four lines shown in `CONTEXT.md` ("Simulator CLI"); exit 0. Invalid arguments: one `simulate: …` stderr line, exit 1, nothing played; a failing game: `simulate: game <seed> failed: <message>`, exit 1. Mention `pnpm --silent simulate …` for clean output.
- Measured: default run (argentina-fidepo, 3p, 100 games) `duration: 5.6 s`, 6.0 s wall; `gamerules 4p × 5` ≈ 0.2 s. Random AI made-bid rate ≈ 11 % (argentina 3p) / 15.5 % (gamerules 4p, seed t) — a useful baseline for future strategies.
- The doc command to run in Iteration 5's criteria: `pnpm simulate --preset gamerules --players 4 --games 5 --seed t` (expected numbers above, except `duration`).
- Orchestrator: no reconciliation is needed (full protocol used); `DECISIONS.md` ends at D-012.
