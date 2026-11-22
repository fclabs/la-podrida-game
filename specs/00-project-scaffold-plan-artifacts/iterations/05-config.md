# Iteration 5 — Validated configuration (`src/config.ts`)

- Record written before committing. Previous commit: `04dfe1f` (Enforce architecture layer boundaries with ESLint and fixture tests). This iteration's commit: `Add Zod-validated configuration with aggregated ConfigError`.
- Environment: macOS, Node 26.13.1 (project declares 24), pnpm 10.15.1.

## Criteria results

Full checklist run from the top after the last code change (no FAIL occurred). `$S` = session scratchpad. Temporary edits were reverted right after their check; `git status --porcelain` afterwards showed only this iteration's files.

| Criterion | Command / steps | Result |
|---|---|---|
| VC-022–VC-027 (+ VC-031 via VC-024/025) | `pnpm vitest run tests/unit/config.test.ts --reporter=verbose` | PASS — exit 0, 26/26 tests; every VC case is its own test or `it.each` row |
| VC-022 detail | same file, `describe('VC-022 getConfig()')` | PASS — same reference twice, `Object.isFrozen` true; `LOG_LEVEL=trace` throws `ConfigError`, then `LOG_LEVEL=warn` succeeds (error not cached) |
| VC-024/025/027 precision | tests assert the exact set of variable names listed in the message (`listedVariables`) | PASS — e.g. `{VERCEL_ENV:'production', LOG_LEVEL:'trace'}` → `['CRON_SECRET','LOG_LEVEL']` |
| Extra: mutation | `cp src/config.ts $S/config.ts.bak`; disabled the cross-field `CRON_SECRET` check (`if (false && …)`); `pnpm vitest run tests/unit/config.test.ts`; restored, `cmp` identical | PASS — mutated: 4 failed / 22 passed (three VC-025 tests, one VC-027); restored: 26/26 |
| Extra: message shape | temp `scripts/tmp-msg.ts` calling `loadConfig` with 4 problems, `pnpm exec tsx scripts/tmp-msg.ts`; file removed | PASS — 4 lines `  - STORAGE_DRIVER …`, `LOG_LEVEL`, `RETENTION_DAYS`, `CRON_SECRET`; no values echoed; `RETENTION_DAYS='007'` → 7 |
| Boundary rules | `grep -n '^import' src/config.ts`; `pnpm exec eslint src/config.ts tests/unit/config.test.ts --max-warnings 0` | PASS — only `import { z } from 'zod'`; eslint exit 0 |
| Green tree | `rm -rf .next next-env.d.ts && pnpm typecheck; pnpm lint; pnpm test` | PASS — all exit 0; `pnpm test` 3 files / 74 tests; only pnpm's "Unsupported engine" WARN (Node 26 locally) |
| NFR-004 | `node -e "console.log(Object.keys(require('./package.json').dependencies).join(','))"` | PASS — `next,react,react-dom,zod` |
| Lockfile frozen | `md5 -q pnpm-lock.yaml; pnpm install --frozen-lockfile; md5 -q pnpm-lock.yaml` | PASS — exit 0, hash unchanged |
| No startup call | `grep -rn getConfig app src scripts tests next.config.ts`; `ls instrumentation.*` | PASS — only `src/config.ts` and its test; no `instrumentation.*` |
| Artifacts | this file; `CONTEXT.md` (Public interfaces: config API; Known gaps: startup wiring deferred to Phase 8); `DECISIONS.md` D-009, D-010 | PASS |

## Files

Added: `src/config.ts`, `tests/unit/config.test.ts`, this record.
Changed: `package.json` (`dependencies.zod` = `4.6.7`, exact pin), `pnpm-lock.yaml`, `CONTEXT.md`, `DECISIONS.md`.
Deleted: none.

## Deviations from the plan

- None in scope. `ConfigError` sets `this.name = 'ConfigError'` (a constructor only; the class shape stays `class ConfigError extends Error`).
- Added two tests beyond the VC list: a value-echo check (CRON_SECRET/LOG_LEVEL/RETENTION_DAYS values absent from the message) and `Object.isFrozen` on `loadConfig({})`.

## Gotchas

- Zod 4 `.default(x)` short-circuits on `undefined` with an *output*-typed value, so `RETENTION_DAYS` uses `.default(365)` after the `regex → transform(Number) → pipe(int 1–3650)` chain.
- `z.object` strips unknown keys, but the code normalises only the 11 known names first, so `process.env` noise never reaches the schema.
- Don't reassign `process.env = {...}` in tests (it drops Node's string coercion); the VC-022 tests save and restore individual keys.
- Vitest `it.each` titles: each `%s`/`%j` consumes one row element; a third placeholder prints `undefined`.
- The shell for tool calls is zsh: use `$?` per command (no `PIPESTATUS`); globs with no match error out.

## For the next iteration

- Iteration 6 (CI + docs): no CI secrets are needed — tests call `loadConfig` with explicit maps, and `getConfig` tests set/restore only the env vars they touch. CI must not set `VERCEL_ENV` to preview/production without `CRON_SECRET`.
- Docs should list the env table (spec 00 Data & Interfaces) and say that `getConfig()` is not yet called at startup (Phase 8), and that `src/config.ts` is importable from `state`, `storage`, `service`, `app/api/**` only.
- `dependencies` is now exactly `next`, `react`, `react-dom`, `zod`.
