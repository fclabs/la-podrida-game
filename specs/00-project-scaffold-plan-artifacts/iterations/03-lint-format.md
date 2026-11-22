# Iteration 3 — ESLint flat config and Prettier in `pnpm lint`

- Record written before committing. Previous commit: `6e7a990` (Add Vitest with unit/contract/api/sim split and simulate stub). This iteration's commit: `Add ESLint flat config and Prettier, enforced by pnpm lint`.
- Environment: macOS, Node 26.13.1 (project declares 24), pnpm 10.15.1.

## Criteria results

Full checklist run once from the top after the final config change (no FAIL occurred). `$S` = session scratchpad. Every temporary file was deleted right after its check; `git status --porcelain` afterwards showed only this iteration's files.

| Criterion | Command / steps | Result |
|---|---|---|
| VC-003 (clean) | `pnpm lint` | PASS — exit 0; ESLint silent, `All matched files use Prettier code style!` |
| VC-003 (negative) | `echo 'export const a = "x";' > app/tmp.ts; pnpm lint` | PASS — exit 1, `[warn] app/tmp.ts` / `Code style issues found`; file removed |
| VC-004 | `printf 'export   const   b = "y"\nexport function f( x:number ){return x+1}\n' > app/tmp.ts; pnpm format; pnpm lint` | PASS — format exit 0 (file rewritten to single quotes/semicolons), lint exit 0; file removed |
| NFR-003 (warning blocks) | `app/tmp.ts` = `// eslint-disable-next-line no-console` + `export const c = 1;`; `pnpm lint` | PASS — exit 1, `warning Unused eslint-disable directive`, `ESLint found too many warnings (maximum: 0)`; file removed |
| Extra: ESLint error in tests | `echo 'export const d: any = 1;' > tests/unit/tmp-any.ts; pnpm lint` | PASS — exit 1, `@typescript-eslint/no-explicit-any`; file removed |
| Prettier scope | `pnpm format` (run during VC-004) then `git status --porcelain docs specs` | PASS — empty (docs/specs untouched); `prettier --file-info` confirms they are ignored |
| Coverage | `eslint . -f json` file list; `prettier --file-info` over tracked files | ESLint: `app/layout.tsx`, `app/page.tsx`, `eslint.config.mjs`, `next.config.ts`, `scripts/simulate.ts`, `tests/unit/smoke.test.ts`, `vitest.config.ts`, `vitest.sim.config.ts`. Prettier: same TS/MJS files + `package.json`, `tsconfig.json`, `.prettierrc.json` |
| Next rules active | `eslint --print-config app/page.tsx` | 22 `@next/next/*` rules, 39 `@typescript-eslint/*` rules |
| NFR-003 (green) | `rm -rf .next next-env.d.ts && pnpm typecheck; pnpm lint; pnpm test`; `grep -i warn` on logs | PASS — all exit 0; only pnpm's "Unsupported engine" WARN (Node 26 locally), no tool warnings |
| Lockfile frozen | `md5 -q pnpm-lock.yaml; pnpm install --frozen-lockfile; md5 -q pnpm-lock.yaml` | PASS — exit 0, hash unchanged |
| NFR-004 | `dependencies` keys | PASS — `next,react,react-dom` |
| Artifacts | this file; `DECISIONS.md` D-006 (Prettier scope), D-007; `CONTEXT.md` rewritten | PASS |

## Files

Added: `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, this record.
Changed: `package.json` (scripts `lint`, `format`; devDependencies `eslint` 10.15.0, `@eslint/js` 10.0.1, `typescript-eslint` 8.73.0, `@next/eslint-plugin-next` 16.4.6, `eslint-config-prettier` 10.1.8, `prettier` 3.10.1 — exact pins), `pnpm-lock.yaml`, `CONTEXT.md`, `DECISIONS.md`.
Deleted: none. Reformatting: `pnpm format` changed no existing file (tree already conformed).

## Deviations from the plan

- `@eslint/js` added (base `js.configs.recommended` for all linted files, incl. `eslint.config.mjs`); not listed in Scope but standard for a flat config.
- `out/` added to ESLint global ignores (it is in `.gitignore`; Next static export dir).
- Used `@next/eslint-plugin-next` rather than `eslint-config-next` (plan allowed either) — D-007.

## Gotchas

- Prettier 3 reads `.gitignore` as well as `.prettierignore`, so ignored paths (`.next/`, `node_modules/`, `next-env.d.ts`) are skipped without repeating them.
- `eslint-config-prettier` flat config is imported from `eslint-config-prettier/flat`.
- The Next plugin's flat config is `nextPlugin.configs['core-web-vitals']` (the `-legacy` variants are eslintrc format). Its rules are `warn`, blocking only through `--max-warnings 0`.
- ESLint lints `*.ts` only because a config block has a matching `files` pattern; keep `TS_FILES` blocks.
- pnpm again printed "Ignored build scripts: esbuild" (unchanged, see Iteration 2).

## For the next iteration

- Config: `/Users/fede/devel/fclabs/la-podrida-game/eslint.config.mjs`, `defineConfig(...)` with numbered sections. **Insert layer-boundary `files` blocks at the comment `// 5. Layer-boundary rules`**, i.e. after the Next.js block and before `prettierConfig` (which must stay last). Later blocks override earlier ones for the same rule key, so use one block per importing folder (`src/domain/**`, `src/{engine,score,players}/**`, `src/state/**`, …, `app/**` with `ignores: ['app/api/**']`) and be aware that two blocks setting the same rule (e.g. `@typescript-eslint/no-restricted-imports`) for one file do not merge — the later one wins.
- Linting is syntax-only (no type info), so `new ESLint({ cwd })` + `lintText(code, { filePath })` works on virtual paths such as `src/engine/x.ts` or `app/game/[id]/page.tsx`. `@typescript-eslint/no-restricted-imports` with `allowTypeImports` needs no type info.
- In fixture tests filter messages by `ruleId` — Next rules apply to `app/**` and TS recommended rules to all `.ts` files (e.g. `no-unused-vars` on an unused import).
- `tests/unit/layer-boundaries.test.ts` is itself linted and Prettier-checked (single quotes, printWidth 100).
- Prettier options: `singleQuote`, `semi`, `trailingComma: "all"`, `printWidth: 100`. `docs/` and `specs/` are excluded (D-006).
