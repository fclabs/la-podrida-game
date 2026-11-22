# Iteration 6 — CI workflow and developer documentation (final)

- Record first written before committing. Previous commit: `2ca0a25` (Add Zod-validated configuration with aggregated ConfigError). This iteration's commit: `Add GitHub Actions CI and developer documentation`.
- CI results arrive only after pushing, so run IDs, timings, the fresh-clone check and the type-error round trip were filled in by a small follow-up commit `Record Phase 0 CI verification results`. Branch history: `2bff6e4` (main iteration commit) → `e39fba1` (temporary type error) → `58a3138` (revert) → follow-up record commit.
- Environment: macOS, Node 26.13.1 locally (project declares 24), pnpm 10.15.1. CI: `ubuntu-latest`, Node from `.nvmrc`.
- Push authorization: the orchestrator confirmed the user approved pushing `spec/00-project-scaffold` to `origin` (incl. the temporary type-error commit and its revert). No PR, no merge, no force-push.

## Criteria results

| Criterion | Command / steps | Result |
|---|---|---|
| Local green tree | `rm -rf .next next-env.d.ts && pnpm typecheck; pnpm lint; pnpm test; pnpm build` | PASS — all exit 0; 3 files / 74 tests |
| NFR-003 (local) | `grep -ic warn` on lint/typecheck logs | PASS — only pnpm's "Unsupported engine" WARN (Node 26 locally); no ESLint/Prettier/tsc warnings |
| Prettier covers new files | `prettier --file-info README.md .github/workflows/ci.yml docs/development.md` | README + ci.yml checked, `docs/development.md` ignored (D-012) |
| VC-028 (green) | push `2bff6e4`; `gh run watch 45077246062`; `gh run view 45077246062 --log` | PASS — run [45077246062](https://github.com/fclabs/la-podrida-game/actions/runs/45077246062) success; log `Resolved .nvmrc as 24`, `node: v24.22.3`, pnpm `v10.15.1`; steps in order 5 Install → 6 Typecheck → 7 Lint → 8 Test → 9 Build, all success |
| VC-028 (type error) | commit `e39fba1` adding `tests/unit/tmp-type-error.ts` (`export const x: number = 'a';`), push; `gh run view 45077338650` | PASS — run [45077338650](https://github.com/fclabs/la-podrida-game/actions/runs/45077338650) failure at step 6 Typecheck (`tmp-type-error.ts(1,14): error TS2322`, exit 2); Lint/Test/Build skipped |
| VC-028 (revert green) | `git revert e39fba1` → `58a3138`, push; `gh run watch 45077443835` | PASS — run [45077443835](https://github.com/fclabs/la-podrida-game/actions/runs/45077443835) success, all five steps |
| NFR-001 | Test step timestamps | PASS — run 45077246062: 1 s (22:21:34→35), Vitest `Duration 891ms`; run 45077443835: 2 s, `Duration 1.13s` |
| NFR-002 (warm cache) | `gh run rerun 45077246062` → refused (`Must have admin rights to Repository`); used run 45077443835 instead: same `pnpm-lock.yaml` (`git diff --quiet 2bff6e4 58a3138 -- pnpm-lock.yaml`), cache from run 1 | PASS — `Cache restored from key: node-cache-Linux-x64-pnpm-30e2df…`, install `reused 179, downloaded 0`, `Done in 1.2s`; run wall-clock 35 s (22:23:20→22:23:55) ≤ 5 min. Cold run 45077246062: 32 s (`pnpm cache is not found`, `downloaded 179`) |
| NFR-003 (CI) | Typecheck/Lint step output in run 45077443835 | PASS — no warnings (only match for "warn" is the `--max-warnings 0` command echo); Node 24 so no engine WARN |
| NFR-004 | `node -e "console.log(Object.keys(require('./package.json').dependencies).join(','))"` | PASS — `next,react,react-dom,zod` |
| Fresh clone | `git clone <repo> $S/lp-check` (session scratchpad, at `2bff6e4`) then `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`, `test:sim`, `build`, `simulate` | PASS — all exit 0; 74 tests; `simulate: not implemented until Phase 4`; `git status --porcelain` empty |
| Docs exist / no planning refs | `ls README.md docs/development.md`; `grep -rniE 'specs/\|plan\|VC-\|artifact\|DECISIONS\|D-0' README.md docs/development.md` | PASS — both exist; no matches (the README link to `docs/implementation.md` is titled "Implementation phases") |
| Decision coverage | table below | PASS — D-001…D-012 all reflected |

## Files

Added: `.github/workflows/ci.yml`, `README.md`, `docs/development.md`, this record.
Changed: `CONTEXT.md` (final state), `DECISIONS.md` (D-011, D-012).
Deleted: none.

## Decision coverage in `docs/development.md`

| Decision | Where reflected |
|---|---|
| D-001 typecheck via `next typegen` | §8 first bullet |
| D-002 TypeScript 6.0.x | §1 table, §8 |
| D-003 exact pins | §1 "Dependencies", §8 |
| D-004 `agentRules: false` | §8 |
| D-005 two Vitest configs | §4 "Two Vitest configs" |
| D-006 Prettier scope | §6 "Prettier scope" |
| D-007 ESLint plugin choice, syntax-only | §6 last two bullets |
| D-008 local boundary rule | §3 "Why a local rule", "Changing the rules" |
| D-009 config error aggregation | §5 "Errors list every problem at once" |
| D-010 zod pin; `vi.resetModules()` testing | §1 table + "Dependencies"; §4 "Tests that need a fresh `getConfig()`" |
| D-011 CI workflow shape | §7 |
| D-012 README Prettier-checked | §6 "Prettier scope" |

None judged internal-only.

## Deviations from the plan

- None in scope. `permissions: contents: read` added to the workflow (spec Actors: "read-only checkout").
- Warm-cache timing: `gh run rerun` needs repo admin rights, which the `gh` account lacks. The plan's intent ("a second run on the same lockfile") was met by run 45077443835 (revert commit, identical lockfile, cache restored). The follow-up commit below triggers one more warm run.
- Revert slip: a first `git revert -q` was rejected (no `-q` flag) and the next `git commit --amend` rewrote the *local* temp commit; the push was rejected as non-fast-forward, so nothing reached origin. Local branch reset to `origin/spec/00-project-scaffold` (`e39fba1`), then reverted properly (`58a3138`). No force-push.
- README link text for `docs/implementation.md` says "Implementation phases" to avoid confusion with planning artifacts.

## Gotchas

- `pnpm/action-setup@v6` README points to `pnpm/setup`, which needs pnpm ≥ 11; stay on `pnpm/action-setup` while `packageManager` is pnpm 10.
- `pnpm/action-setup@v6` bootstraps with pnpm 11 then switches to `packageManager`'s 10.15.1, printing a harmless `[WARN] Detected a pnpm v10 installation layout at PNPM_HOME`.
- `Ignored build scripts: esbuild` also appears on Linux CI; tests and build pass, so no `onlyBuiltDependencies` change was needed.
- Prettier reformats Markdown tables in `README.md` (column alignment); run `pnpm format` after editing it.

## For the next iteration (Phase 1)

- CI is the gate: every push/PR runs install → typecheck → lint → test → build. Keep it green.
- Contracts to build on: the layer matrix (`eslint.config.mjs` `LAYER_BOUNDARIES`, documented in `docs/development.md` §3) and the `Config` API (`src/config.ts`, §5).
- `zod` is already a dependency (4.6.7). `@noble/hashes` must be added (exact pin, `dependencies`) in Phase 2.
- Update `docs/development.md` whenever the matrix, env variables, scripts or CI change; Phase 4 adds a `pnpm test:sim` CI step.
