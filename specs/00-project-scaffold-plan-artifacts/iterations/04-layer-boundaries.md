# Iteration 4 — Lint-enforced layer boundaries with fixture tests

- Record written before committing. Previous commit: `5b38015` (Add ESLint flat config and Prettier, enforced by pnpm lint). This iteration's commit: `Enforce architecture layer boundaries with ESLint and fixture tests`.
- Environment: macOS, Node 26.13.1 (project declares 24), pnpm 10.15.1.

## Criteria results

Full checklist run once from the top after the last code change (no FAIL occurred). `$S` = session scratchpad. Temporary edits were reverted right after their check; `git status --porcelain` afterwards showed only this iteration's files.

| Criterion | Command / steps | Result |
|---|---|---|
| VC-011–VC-020 + 8 extra cases | `pnpm vitest run tests/unit/layer-boundaries.test.ts --reporter=verbose` | PASS — exit 0, 47/47 rows (39 VC rows + 8 extra rows from the plan) |
| VC-021 (test) | `pnpm test` | PASS — exit 0, 2 files / 48 tests (fixtures + smoke) |
| VC-021 (lint) | `pnpm lint` | PASS — exit 0; `eslint -f json .` lists `tests/unit/layer-boundaries.test.ts` and `tools/eslint-rules/layer-boundaries.mjs` with 0 errors / 0 warnings; Prettier clean |
| Extra: rule fires via `pnpm lint` | temp `src/engine/tmp-probe.ts` importing `../storage/x`; `pnpm lint`; file removed | PASS — exit 1, `'src/engine' may not import from layer 'src/storage' ('../storage/x')  layer-boundaries/imports` |
| Mutation check | `cp eslint.config.mjs $S/…bak`; deleted the `engine:` line of `LAYER_BOUNDARIES.layers` (the engine policy; the config has one block, so this is the engine-specific config); `pnpm vitest run tests/unit/layer-boundaries.test.ts`; restored from backup, `cmp` identical, reran | PASS — mutated: exit 1, 13 failed / 34 passed, incl. every VC-012 error row involving engine (engine→storage, engine→score, engine→`@/src/config`, score→engine; players→state still passes since the players policy was untouched) plus VC-011/VC-013/VC-014/extra engine rows; restored: 47/47 pass |
| Green tree | `rm -rf .next next-env.d.ts && pnpm typecheck; pnpm lint; pnpm test` | PASS — all exit 0; only pnpm's "Unsupported engine" WARN (Node 26 locally), no tool warnings |
| No dependency change | `git status --porcelain` | PASS — `package.json`/`pnpm-lock.yaml` untouched (no plugin added); `dependencies` still `next,react,react-dom` |
| Artifacts | this file; `CONTEXT.md` (import matrix table under Conventions & invariants, file map); `DECISIONS.md` D-008 (tool choice + rejected options, written before the rule) | PASS |

## Files

Added: `tools/eslint-rules/layer-boundaries.mjs`, `tests/unit/layer-boundaries.test.ts`, this record.
Changed: `eslint.config.mjs` (import of the local plugin, `CORE_EXTERNALS`, `LAYER_BOUNDARIES`, section-5 block, header comment), `CONTEXT.md`, `DECISIONS.md`.
Deleted: none.

## Deviations from the plan

- Enforcement is a custom local rule rather than `no-restricted-imports`/`eslint-plugin-boundaries` (the plan's fallback path); reason recorded first as D-008.
- One config block instead of per-folder blocks: the rule selects the policy from the file path, so the plan's mutation step "delete the src/engine block" was done by deleting the `engine` entry of the matrix.
- Files directly under `src/` that are not in a layer (e.g. the future `src/config.ts`) get FR-017 (no fs/Blob) and BR-002 ("nothing in `src` imports `service`"); FR-015 literally names only layers, BR-002 decides the case.
- Test helper also asserts no fatal (parse) message, so a broken fixture cannot pass as "no error".

## Gotchas

- Same relative specifier, different target by depth: `../storage/y` from `src/engine/a/b.ts` is `src/engine/storage/y` (own layer). That is why path-pattern rules were rejected.
- ESLint 9+/10 rejects options for rules without `meta.schema`; the rule declares `schema: [{ type: 'object' }]`.
- `context.cwd` + `context.filename` give the root-relative path for both real files and `lintText` virtual paths.
- A scratch script outside the repo cannot `import 'eslint'` (no `node_modules` up the tree); import `<repo>/node_modules/eslint/lib/api.js` instead.

## For the next iteration

- Iteration 5 creates `src/config.ts`: the rule already treats `src/config` (and `src/config.<ext>`) as the config module — importable from `state`, `storage`, `service`; ✗ from core and UI. `src/config.ts` itself may not import `fs`/`@vercel/blob` or `service`; `zod` is fine there. Fixtures already cover `@/src/config` virtually; nothing to change.
- **Add a layer**: add `<name>: { layers: [...], config: bool, externals?: [...] }` to `LAYER_BOUNDARIES.layers` in `eslint.config.mjs`, and add `<name>` to the `layers` list of every existing layer allowed to import it (`service`, usually `storage`). Update the CONTEXT matrix and add fixture rows.
- **Allow a core dependency**: append its package name to `CORE_EXTERNALS` (subpaths are allowed automatically). I/O modules live in `LAYER_BOUNDARIES.io.modules`.
- **Add a fixture case**: append `[vcLabel, virtualPath, code, expectError]` to `rows` in `tests/unit/layer-boundaries.test.ts`; `imp(spec)` builds a one-import value module. Virtual paths need no file on disk; keep the file Prettier-formatted (`pnpm format`).
- Iteration 6 docs: mention `tools/eslint-rules/` and the matrix location.
