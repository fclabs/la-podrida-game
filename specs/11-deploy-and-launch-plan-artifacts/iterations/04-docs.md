# Iteration 4: deployment runbook and developer docs

Commit: message `Phase 11: deployment runbook and developer docs` (SHA in the orchestrator report). Docs only.

## Criteria (run from the repo root)

| Criterion | Command | Result |
|---|---|---|
| VC-1128 sections | `docs/deployment.md` has `## 2. Launch runbook`, `## 3. Manual browser checklist`, `## 4. Rollback`, `## 5. Launch record`; `grep -n -E "^## " docs/development.md` shows `## 19. Deployment and launch checks`, `## 20. Known limitations` | PASS |
| VC-1128 cross-refs | `git grep -n -E '§19\|#19' -- docs README.md` | PASS (no output; the one old reference in 18.9 now says §20; no table of contents exists) |
| VC-1128 README | `grep -n -E "blob-checks\|bench-moves\|smoke" README.md` | PASS (3 rows) |
| VC-1129 | `vercel rollback --help` shows `vercel rollback <deployment> [options]`, `status [project]`, `--timeout`, `--yes`, `--json`; `vercel ls --help` shows `list`, `-e/--environment`, `-n/--limit`, `--next`; section 4 uses exactly these forms and states production only and no data deletion | PASS |
| VC-1120 content | the six FR-1120 items are the six checklist rows, each with Preview and Production pass/fail cells | PASS |
| VC-1134 | `git grep -n -E "BLOB_READ_WRITE_TOKEN=[^ ]\|CRON_SECRET=[^ ]\|x-vercel-protection-bypass: [A-Za-z0-9]{8}"` | PASS for new content (no hit in `docs/deployment.md` or the new §19); see deviation for pre-existing hits. `git check-ignore .env.local .vercel` lists both: PASS |
| Standalone | `grep -n -E "11-deploy\|specs/\|artifacts" docs/deployment.md` | PASS (no output) |
| lint, typecheck, test | `pnpm lint && pnpm typecheck && pnpm test` | PASS (110 files passed, 1 skipped; 1888 tests passed) |
| No code change | `git diff main --stat -- src app vercel.json 'specs/*-frozen.md'` | PASS (empty) |
| Artifacts | this file, `CONTEXT.md` | PASS |

## Files

Added: `docs/deployment.md`. Changed: `docs/development.md` (new §19, Known limitations is §20, one cross-reference), `README.md` (three rows, runbook link; Prettier re-aligned the table), artifacts.

## Deviations

- The VC-1134 grep, read literally, still prints tracked lines that predate this iteration: `docs/development.md` (`BLOB_READ_WRITE_TOKEN=…` placeholder, `CRON_SECRET=local-test-secret` dummy for a local run), `scripts/blob-checks.ts` and `tests/contract` comments, and the spec/plan/artifact text that quotes the command itself. None is a secret value and none was added here; they are outside this iteration's Touches or are placeholders. Raise with the operator if a literal empty result is required.
- No decisions made (DECISIONS.md unchanged).
- Unverified CLI forms (only `--help` for rollback and ls was allowed): `vercel env ls` (read the Environments column), `vercel env add CRON_SECRET <env>`, `vercel blob list-stores`, `vercel project inspect`, `vercel logs` (spec names them), `vercel promote <deployment>` after a rollback. Iteration 5 should check them against `--help` and fix the runbook if they differ.

## Gotchas

- Secret handling uses `read -rs VAR` then `export VAR` so no `NAME=value` appears.
- The runbook says production smoke normally needs no bypass; confirm in Iteration 7.
- The launch record table cells for JSON lines are wide; Iterations 5-8 may paste each line in a code span or add rows.

## For the next iteration

Pause: the operator pushes and opens the PR. Iteration 5 follows `docs/deployment.md` sections 1 and 2 and fills section 5 (5.1 runs, 5.2 waivers, 5.3 regions, 5.4 checklist). Keep the anchors and the `**Launch status:**` / `**Gate:**` lines (Iteration 6 sets them).
