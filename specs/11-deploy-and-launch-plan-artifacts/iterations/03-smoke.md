# Iteration 3: smoke

Commit: message `Phase 11: smoke script` (SHA in the orchestrator report).

## Criteria (run from the repo root; PASS = observed)

| Criterion | Command | Result |
|---|---|---|
| VC-1118: in-process run with `CRON_SECRET` set: `passed:true`, ten step names in order, all ok | `pnpm vitest run tests/unit/scripts/smoke.test.ts` ("VC-1118") | PASS |
| VC-1119: `CRON_SECRET` unset (and empty) exits 2, one stderr line naming it; wrong secret fails at `cron-run`, exit 1; secret value in no output | same ("VC-1119") | PASS |
| Failure paths: server that changes the retried body fails at `retry`; one that leaks a `seed` key (or echoes the seat token) fails at `no-leak`; never conflicting fails at `conflict`; network error and timeout fail their step; each stops the run there | same ("failure paths") | PASS |
| VC-1106 logic: bypass header on every request iff set (unset and empty: none); redacted in errors | same ("VC-1106") | PASS |
| Usage: missing/non-https `--base-url`, unknown option exit 2 | same; by hand `pnpm -s smoke` prints `smoke: --base-url is required`, exit 2 | PASS |
| VC-1130 | `git diff main -- package.json` shows exactly `blob-checks`, `bench-moves`, `smoke` (each `tsx scripts/<name>.ts`), no dependency change | PASS |
| typecheck, lint, test, build | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | PASS (110 files passed, 1 skipped; 1888 tests passed) |
| VC-1133 | `git diff main --stat -- src app vercel.json 'specs/*-frozen.md'` | PASS (empty) |
| Artifacts | this file, `CONTEXT.md` (all three scripts: options, env, exit codes, JSON lines, step names), `DECISIONS.md` (D-006) | PASS |

No real URL or store was touched; every run is in-process with fake secrets.

## Files

Added: `scripts/smoke.ts`, `tests/unit/scripts/smoke.test.ts`. Changed: `tests/unit/scripts/helpers/in-process-fetch.ts` (cron route, optional `cronSecret`; backward compatible), `package.json` (one script), `CONTEXT.md`, `DECISIONS.md`, this record.

## Deviations

- D-006: after a failed step the line's `steps` holds only the steps run; the reason goes to stderr.

## Gotchas

- `conflict` needs `legalMoves.length >= 2` at game start; true for the real handlers.
- The retry test breaks the server by altering any repeated identical move request body (the conflict winner's request is the only one re-sent unchanged).
- BSD `sed` has no `-i` without a suffix; use the Edit tool for package.json.
- Node 26 engine warning from pnpm, as before.

## For the next iteration (runbook, docs only)

Quote the three scripts' CLI, env, exit codes and JSON lines from `CONTEXT.md` (Commands section, smoke step names exactly: `presets`, `create`, `auth`, `conflict`, `play`, `resume`, `retry`, `no-leak`, `cron-auth`, `cron-run`). Note for operators: `smoke` needs `CRON_SECRET` of the target environment and `VERCEL_PROTECTION_BYPASS` on a protected Preview; a failed run prints a shorter `steps` list plus one stderr line with the reason.
