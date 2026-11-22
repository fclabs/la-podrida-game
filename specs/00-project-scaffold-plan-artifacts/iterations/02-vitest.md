# Iteration 2 — Vitest, test folders and script entry points

- Record written before committing. Previous commit: `5b312a0` (Scaffold Next.js app with pinned Node 24 / pnpm toolchain). This iteration's commit: `Add Vitest with unit/contract/api/sim split and simulate stub`.
- Environment: macOS, Node 26.13.1 (project declares 24), pnpm 10.15.1.

## Criteria results

Full checklist run once from the top after the final config change. `$S` = session scratchpad (outside the repo). Temporary files listed per row were created only for the check and deleted right after; `git status --porcelain` afterwards showed only this iteration's intended files.

| Criterion | Command / steps | Result |
|---|---|---|
| VC-005 | Created temp `tests/contract/tmp-pass.test.ts`, `tests/api/tmp-pass.test.ts` (passing), `tests/sim/tmp-fail.test.ts` and `src/engine/x.test.ts` (failing). `pnpm test --reporter=verbose > $S/vc005.log` | PASS — exit 0; ran exactly `tests/unit/smoke.test.ts`, `tests/contract/tmp-pass.test.ts`, `tests/api/tmp-pass.test.ts` (3 files, 3 tests passed); nothing from `tests/sim` or `src/` |
| VC-006 (failing) | With temp `tests/sim/tmp-fail.test.ts` present: `pnpm test:sim` | PASS — exit 1, `FAIL tests/sim/tmp-fail.test.ts` |
| VC-006 (empty) | Temp files removed; `ls -A tests/sim` → `.gitkeep`; `pnpm test:sim` | PASS — exit 0, `No test files found, exiting with code 0` |
| VC-007 | `pnpm simulate` | PASS — exit 0, stdout `simulate: not implemented until Phase 4` |
| VC-002 (completion) | `echo "const x: number = 'a';" > tests/unit/tmp-type-error.ts; pnpm typecheck` | PASS — exit 2, `tests/unit/tmp-type-error.ts(1,7): error TS2322`; file removed |
| typecheck clean | `rm -rf .next next-env.d.ts && pnpm typecheck` | PASS — exit 0 |
| test on committed tree | `pnpm test` | PASS — exit 0, 1 file / 1 test |
| NFR-004 | `node -e "console.log(Object.keys(require('./package.json').dependencies).join(','))"` | PASS — `next,react,react-dom` |
| Lockfile frozen | `md5 -q pnpm-lock.yaml; pnpm install --frozen-lockfile; md5 -q pnpm-lock.yaml` | PASS — exit 0, hash unchanged |
| `@/` alias (hand-off check) | Temp `src/engine/tmp-alias-probe.ts`, `tests/unit/tmp-alias.test.ts` and `scripts/tmp-alias.ts` importing `@/src/engine/tmp-alias-probe`; `pnpm test`; `pnpm exec tsx scripts/tmp-alias.ts` | PASS — test passed; tsx printed `tsx alias ok`, exit 0; files removed |
| Artifacts | this file, `CONTEXT.md` (commands verbatim), `DECISIONS.md` D-005 | PASS |

## Files

Added: `vitest.config.ts`, `vitest.sim.config.ts`, `tests/{unit,contract,sim,api}/.gitkeep`, `tests/unit/smoke.test.ts`, `scripts/simulate.ts`, this record.
Changed: `package.json` (scripts `test`, `test:sim`, `simulate`; devDependencies `vitest` 5.1.1, `vite` 8.3.8, `tsx` 4.23.15, exact pins), `pnpm-lock.yaml`, `CONTEXT.md`, `DECISIONS.md`.
Deleted: none.

## Deviations from the plan

- `vite` 8.3.8 added as an explicit devDependency: Vitest 5 declares `vite` as a non-optional peer. Not listed in Scope but required for Vitest to work.
- Sim config is a separate standalone file (plan allowed "a second config"); see D-005 for why not `mergeConfig` / import.

## Gotchas

- `mergeConfig` concatenates arrays (`include`), so it cannot narrow the base include list.
- Importing `./vitest.config` (extensionless) from another Vite config triggers Vite 8's `configLoader: 'native'` warning.
- `pnpm add` prints "Ignored build scripts: esbuild". tsx works anyway (esbuild's binary comes from the optional `@esbuild/<platform>` package). Left unapproved; revisit only if CI on Linux fails.
- Vitest 5 still prints "No test files found" with `passWithNoTests`, but exits 0.
- zsh: `$PIPESTATUS` does not exist; capture exit codes without pipes.

## For the next iteration

- Tests: `*.test.ts` under `tests/{unit,contract,api}` run with `pnpm test` (`vitest.config.ts`); `tests/sim` runs with `pnpm test:sim` (`vitest.sim.config.ts`). Files elsewhere are never run.
- Iteration 3 (ESLint/Prettier) must lint/format `vitest.config.ts`, `vitest.sim.config.ts`, `scripts/simulate.ts`, `tests/unit/smoke.test.ts` too; they use single quotes, semicolons, 2-space indent, trailing commas.
- `tsx` resolves the `@/` alias from `tsconfig.json`; Vitest via `resolve.alias` in both configs (keep in sync, D-005).
- Add devDependencies with exact versions (D-003); `dependencies` still exactly `next`, `react`, `react-dom`.
