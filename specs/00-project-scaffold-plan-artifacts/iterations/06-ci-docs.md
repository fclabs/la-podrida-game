# Iteration 6 — CI workflow and developer documentation (final)

- Record first written before committing. Previous commit: `2ca0a25` (Add Zod-validated configuration with aggregated ConfigError). This iteration's commit: `Add GitHub Actions CI and developer documentation`.
- CI results arrive only after pushing, so run IDs, timings, the fresh-clone check and the type-error round trip are filled in by a small follow-up commit `Record Phase 0 CI verification results`.
- Environment: macOS, Node 26.13.1 locally (project declares 24), pnpm 10.15.1. CI: `ubuntu-latest`, Node from `.nvmrc`.
- Push authorization: the orchestrator confirmed the user approved pushing `spec/00-project-scaffold` to `origin` (incl. the temporary type-error commit and its revert). No PR, no merge, no force-push.

## Criteria results

| Criterion | Command / steps | Result |
|---|---|---|
| Local green tree | `rm -rf .next next-env.d.ts && pnpm typecheck; pnpm lint; pnpm test; pnpm build` | PASS — all exit 0; 3 files / 74 tests |
| NFR-003 (local) | `grep -ic warn` on lint/typecheck logs | PASS — only pnpm's "Unsupported engine" WARN (Node 26 locally); no ESLint/Prettier/tsc warnings |
| Prettier covers new files | `prettier --file-info README.md .github/workflows/ci.yml docs/development.md` | README + ci.yml checked, `docs/development.md` ignored (D-012) |
| VC-028, VC-030 (CI), fresh clone | see follow-up section below | pending at first write |

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
- README link text for `docs/implementation.md` says "Implementation phases" to avoid confusion with planning artifacts.

## Gotchas

- `pnpm/action-setup@v6` README points to `pnpm/setup`, which needs pnpm ≥ 11; stay on `pnpm/action-setup` while `packageManager` is pnpm 10.
- Prettier reformats Markdown tables in `README.md` (column alignment); run `pnpm format` after editing it.

## For the next iteration (Phase 1)

- CI is the gate: every push/PR runs install → typecheck → lint → test → build. Keep it green.
- Contracts to build on: the layer matrix (`eslint.config.mjs` `LAYER_BOUNDARIES`, documented in `docs/development.md` §3) and the `Config` API (`src/config.ts`, §5).
- `zod` is already a dependency (4.6.7). `@noble/hashes` must be added (exact pin, `dependencies`) in Phase 2.
- Update `docs/development.md` whenever the matrix, env variables, scripts or CI change; Phase 4 adds a `pnpm test:sim` CI step.
