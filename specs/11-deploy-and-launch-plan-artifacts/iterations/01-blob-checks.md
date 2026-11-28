# Iteration 1: shared script helpers and blob-checks

Commit: SHA filled in the orchestrator report (message `Phase 11: blob-checks script and shared script helpers`).

## Criteria (all run from the repo root; PASS = observed)

| Criterion | Command | Result |
|---|---|---|
| VC-1107 logic: memory store 20x10 gives violations 0; always-overwrite wrapper gives violations > 0 and passed false | `pnpm vitest run tests/unit/scripts` (blob-checks.test.ts, "VC-1107 exclusivity") | PASS |
| VC-1108 logic: null-after-create gives falseMissing > 0; dropped overwrite gives stale > 0 | same ("VC-1108 consistent reads") | PASS |
| VC-1109 logic: descending lister gives ordered false; memory gives ordered true, keys 25, remaining 0 | same ("VC-1109 listing and delete") | PASS |
| VC-1110: `--rounds 0` and missing token exit 2 with one stderr line (token case names `BLOB_READ_WRITE_TOKEN`), forced store error exits 1 with passed false and `error`, fake token never in stdout/stderr | same ("VC-1110 command line"); also by hand `pnpm -s blob-checks` (no token) and `BLOB_READ_WRITE_TOKEN=x pnpm -s blob-checks --rounds 0`: exit 2 each, one line each | PASS |
| VC-1111: no key under `checks/<runId>/` after a normal run, after an injected error, after an abort signal | same ("VC-1111 cleanup") | PASS |
| typecheck, lint, test | `pnpm typecheck && pnpm lint && pnpm test` | PASS (108 files passed, 1 skipped; 1846 tests passed) |
| `git diff main -- src app vercel.json` empty | `git diff main -- src app vercel.json \| wc -l` | PASS (0) |
| package.json adds exactly one script | `git diff main -- package.json` | PASS (`blob-checks` only) |
| Artifacts | this file, `CONTEXT.md`, `DECISIONS.md` (D-001, D-002 as required, D-003 extra) | PASS |

Real-store runs of VC-1107 to VC-1109 were NOT done here (no token; belongs to Iteration 5). All checks above are on in-memory and faulty stores.

## Files

Added: `scripts/lib/args.ts`, `scripts/lib/stats.ts`, `scripts/lib/http.ts`, `scripts/blob-checks.ts`, `tests/unit/scripts/{args,stats,http,blob-checks}.test.ts`, `tests/unit/scripts/helpers/faulty-store.ts`, the artifact directory. Changed: `package.json` (one script).

## Deviations

- D-001: `listing.passed` also requires 25 keys (stricter than the spec text). Raise with the operator.
- Extra: a `CleanupError` can fail a run whose checks all passed (D-003a).

## Gotchas

- Node on this machine is v26 (engine warning from pnpm); everything passes anyway.
- Zero-winner rounds skip the stored-body check (nothing to attribute).
- The `error` message is redacted with the token and collapsed to one line, but an SDK error text is otherwise passed through (truncated to 200 chars).
- The script uses top-level await behind an entry-point guard (`import.meta.url` equals `process.argv[1]`); a later script should copy that pattern.

- `.gitignore` line 17 (`lib/`, a Python template rule) ignores `scripts/lib/`. The three helper files were added with `git add -f` (explicit paths); once tracked, later edits need no force. New files under `scripts/lib/` in later iterations also need `git add -f`. A `!scripts/lib/` negation in `.gitignore` would fix it permanently but is outside this plan's Touches; raise with the operator.

## For the next iteration

Reuse `parseStrict` (string choices supported: `--scenario`), `request` (pass `{ bypass: env.VERCEL_PROTECTION_BYPASS }`; it returns `{status, body}` after reading the body, so time around it) and `stats`. `bench-moves` needs a `UsageError` for `--samples` with `cold`, which `parseStrict` does not express: check after parsing. Copy `faultyStore` for stores that misbehave. Option values must be `--name value` (no `--name=value` special handling needed; `parseArgs` accepts both).
