# Iteration 2: bench-moves

Commit: message `Phase 11: bench-moves script (warm, stale, cold)` (SHA in the orchestrator report).

## Criteria (run from the repo root; PASS = observed)

| Criterion | Command | Result |
|---|---|---|
| VC-1113: warm, 100 samples on the real handlers: n 100, integer p95, passed = p95 < 500; injected 600 ms clock gives passed false, exit 1 | `pnpm vitest run tests/unit/scripts/bench-moves.test.ts` ("VC-1113 warm") | PASS |
| VC-1114: stale on a shared MemoryObjectStore: per sample `get:v`, `put:v-1`, `get:v-1` (spy); different store exits 1 at the first pre-overwrite read, no put made; head that does not move also exits 1 | same ("VC-1114 stale") | PASS |
| VC-1115: cold n 1, passed true at 9000 ms; `--scenario cold --samples 2` exit 2; also by hand `pnpm -s bench-moves --base-url https://x.test --scenario cold --samples 2` exit 2 | same ("VC-1115 cold") | PASS |
| VC-1116: 20 presets requests after the last move, integer `baselineMedianMs` | same ("VC-1116 baseline") | PASS |
| VC-1117: 404 on moves exit 1, `passed:false`; `--samples 0`, missing `--scenario`, stale without token (also empty) each exit 2 with one stderr line; also network error, timeout, signal abort | same ("VC-1117 failure and boundary paths") | PASS |
| VC-1106 logic: bypass header on every request when set, none when not set; value and token never in stdout/stderr (also in a forced error line, redacted) | same ("VC-1106 bypass header") | PASS |
| typecheck, lint, test | `pnpm typecheck && pnpm lint && pnpm test` | PASS (109 files passed, 1 skipped; 1874 tests passed) |
| `git diff main -- src app vercel.json` empty | `git diff main -- src app vercel.json \| wc -l` | PASS (0) |
| package.json adds exactly two scripts in total | `git diff main -- package.json` | PASS (`blob-checks`, `bench-moves`) |
| Artifacts | this file, `CONTEXT.md`, `DECISIONS.md` (D-004 required, D-005 extra) | PASS |

No real URL or store was touched; every run is in-process.

## Files

Added: `scripts/bench-moves.ts`, `tests/unit/scripts/bench-moves.test.ts`, `tests/unit/scripts/helpers/in-process-fetch.ts`. Changed: `package.json` (one script), `CONTEXT.md`, `DECISIONS.md`, this record.

## Deviations

- D-004: an aborted run's line has `baselineMedianMs: null` and `n` = samples taken (spec silent); the reason goes to stderr.
- Any failing request aborts, including untimed ones (create, warm-up) and presets baseline requests (the spec names only timed requests).

## Gotchas

- The script is tested with an injected `now`; with the real `performance.now` the in-process tests show small numbers, so only the injected-clock tests prove `passed: false`.
- `request` reads the body inside its timeout; the timed window is `now()` before to `now()` after the `request` call, so it includes header building and the 30 s guard code path (negligible).
- The percentile test drives the clock from a wrapped fetch (each timed move advances it by a known amount).
- Node 26 engine warning from pnpm, as before.

## For the next iteration (smoke)

Import `inProcessApi` from `./helpers/in-process-fetch` (see CONTEXT.md). It routes create, presets, move and get-game; add the cron route (`cleanupHandler`, CRON_SECRET bearer) to the helper for smoke's cron step, keeping the helper's existing behaviour. Reuse `parseStrict`, `request`, `runCli`-style entry with `fetch`/`now` in deps and the `import.meta.url` main guard as in `bench-moves.ts`. Game facts: moves use `legalMoves[0].id`; a game ends (`view.phase === 'game-over'`, `view.finalRanking`) in fewer than 400 human moves with 2 AIs.
