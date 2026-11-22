# DECISIONS — Project Scaffold (Phase 0)

## D-001: `typecheck` = `next typegen && tsc --noEmit`  (Iteration 1)
**Context**: CI runs `pnpm typecheck` before `pnpm build` on a clean checkout, where `next-env.d.ts` (git-ignored, FR-029) and `.next/types` do not exist; `tsc` alone would lack Next's ambient types (CSS/image modules, route types).
**Decision**: Next 16.4.6 provides `next typegen`, which writes `next-env.d.ts` and `.next/types` route types without building. The script is `next typegen && tsc --noEmit`. Verified with `rm -rf .next next-env.d.ts && pnpm typecheck` → exit 0.
**Rejected**: committing a hand-written `types/next.d.ts` with `/// <reference types="next" />` (works, but duplicates what Next generates and misses typed routes); running `next build` before typecheck (slow, wrong CI order).
**Consequences**: `typecheck` writes `.next/` and `next-env.d.ts` as a side effect (both ignored). `tsconfig.json` `include` must keep `next-env.d.ts`, `.next/types/**/*.ts` and `.next/dev/types/**/*.ts`.

## D-002: TypeScript pinned to 6.0.3, not 7.x  (Iteration 1)
**Context**: `typescript@latest` is 7.0.2 (native port). The plan asks for "TypeScript ≥ 5.6, latest stable", but Iteration 3 adds `typescript-eslint` 8.73.0, whose peer range is `typescript >=4.8.4 <6.1.0`.
**Decision**: Pin `typescript` to 6.0.3, the newest release inside `typescript-eslint`'s supported range. Next 16.4.6 builds and typechecks with it.
**Rejected**: TypeScript 7.0.2 (would break the ESLint toolchain in Iteration 3 and its JS API compatibility with Next's build check is unverified).
**Consequences**: Do not bump TypeScript beyond what `typescript-eslint` supports. Revisit when `typescript-eslint` widens its peer range.

## D-003: Exact version pins in `package.json`  (Iteration 1)
**Context**: Versions were added with explicit `pkg@x.y.z`, so pnpm wrote exact specifiers.
**Decision**: Keep exact pins: next 16.4.6, react/react-dom 19.3.1, typescript 6.0.3, @types/react / @types/react-dom 19.3.0, @types/node 24.19.2 (24 line to match the Node 24 runtime).
**Rejected**: caret ranges (lockfile already fixes versions; exact pins make upgrades explicit).
**Consequences**: Later iterations should add packages with explicit versions for consistency.

## D-004: `agentRules: false` in `next.config.ts`  (Iteration 1)
**Context**: Next 16.4's `next dev` writes an `AGENTS.md` into the repo root on every start, leaving an untracked file the spec does not ask for.
**Decision**: Set `agentRules: false` (a documented `NextConfig` option, verified in `next/dist/server/config-schema.js`).
**Rejected**: committing the generated `AGENTS.md` (out of scope, not in the spec's file list); git-ignoring it (would hide a file a later phase may want).
**Consequences**: `next.config.ts` is no longer empty; keep the option unless the project decides to adopt Next's agent rules file.

## D-005: Two standalone Vitest configs for the sim split  (Iteration 2)
**Context**: `pnpm test` must exclude `tests/sim`, while `pnpm test:sim` must run only `tests/sim` and pass when it is empty, without `passWithNoTests` leaking into `pnpm test`.
**Decision**: `vitest.config.ts` (default, `include: tests/{unit,contract,api}/**/*.test.ts`) and `vitest.sim.config.ts` (`include: tests/sim/**/*.test.ts`, `passWithNoTests: true`), selected by `vitest run` vs `vitest run --config vitest.sim.config.ts`. The sim config duplicates the small `resolve.alias`/`environment` block instead of importing the base config.
**Rejected**: `mergeConfig(base, sim)` — concatenates `include` arrays, so sim would also run unit/contract/api. Importing `./vitest.config` and spreading — Vite 8 warns that extensionless TS imports in configs are unsupported by its future native config loader, and `.ts` extensions would need `allowImportingTsExtensions` in `tsconfig.json`. Vitest `projects` + `--project` — `passWithNoTests` is root-level, so scoping it is awkward.
**Consequences**: Any change to alias/environment must be made in both configs. Vite 8.3.8 is an explicit devDependency (non-optional peer of Vitest 5).

## D-006: Prettier scope excludes `docs/` and `specs/`  (Iteration 3)
**Context**: The spec says `pnpm lint` checks formatting but does not say which files; `prettier --check .` would otherwise reformat the hand-written Markdown design docs and specs.
**Decision**: `.prettierignore` lists `docs/`, `specs/`, `LICENSE`, `pnpm-lock.yaml`, `.next/`, `coverage/` (Prettier 3 also honours `.gitignore`). Prettier checks code and config: `app/`, `src/`, `tests/`, `scripts/`, root `*.ts`/`*.mjs`/`*.json`. Options: `singleQuote`, `semi`, `trailingComma: "all"`, `printWidth: 100`.
**Rejected**: formatting everything (rewrites curated docs/spec tables and line breaks); restricting Prettier to an explicit glob list (new top-level folders would silently go unchecked).
**Consequences**: Markdown under `docs/`/`specs/` is never checked or rewritten. A future root `README.md` *is* covered by Prettier unless added to `.prettierignore`.

## D-007: ESLint 10 with `@next/eslint-plugin-next`, not `eslint-config-next`  (Iteration 3)
**Context**: Plan allows either the Next plugin or `eslint-config-next`. ESLint 10.15.0 is latest stable (spec: ≥ 9); `typescript-eslint` 8.73.0 supports `^10`.
**Decision**: `eslint` 10.15.0 + `@eslint/js` 10.0.1 + `typescript-eslint` 8.73.0 + `@next/eslint-plugin-next` 16.4.6 (its flat `core-web-vitals` config, scoped to `app/**/*.{ts,tsx}`) + `eslint-config-prettier` 10.1.8 (`/flat`, last). TypeScript rules are `tseslint.configs.recommended` (syntax-only, no type-aware linting), scoped to `**/*.{ts,tsx,mts,cts}`.
**Rejected**: `eslint-config-next` (pulls react/react-hooks/import/jsx-a11y plugins not asked for, with ESLint 10 support not guaranteed); `recommendedTypeChecked` (needs a TS program; Iteration 4's `lintText` with virtual file paths outside the tsconfig project would fail or need `allowDefaultProject`).
**Consequences**: Iteration 4 can call `ESLint#lintText` on virtual paths without type info. Next rules are `warn`-level, so `--max-warnings 0` makes them blocking.

## D-008: Layer boundaries via a small local ESLint rule, not `no-restricted-imports` / `eslint-plugin-boundaries`  (Iteration 4)
**Context**: The spec matches imports by *resolved* path (relative at any depth or `@/`, target need not exist). The same specifier means different things at different depths: `../storage/y` from `src/engine/x.ts` is the storage layer, but from `src/engine/a/b.ts` it is `src/engine/storage/y` (own layer). App files need type-only detection incl. all-inline-`type` specifiers.
**Decision**: A local rule `layer-boundaries/imports` (`tools/eslint-rules/layer-boundaries.mjs`, no new dependency) resolves each `import`/`export … from` specifier against the file path (or `@/` against the root), classifies the target (layer / `src/config` / other `src` / bare module) and checks a declarative matrix passed as rule options in `eslint.config.mjs` section 5. One block covers `src/**` and `app/**` (minus `app/api/**`), so there is no block-override/merge problem.
**Rejected**: `@typescript-eslint/no-restricted-imports` — patterns see only the raw specifier, so relative depth needs one generated `files` block per nesting depth with full pattern lists (blocks replace, not merge) and still mis-handles forms like `./../storage`. `eslint-plugin-boundaries` 7.4.4 — classifies via an import resolver, so imports of non-existent files (all FR-021 fixtures; spec: "does not require the target file to exist") are unknown; adds a plugin with 6 direct dependencies; ESLint 10 support only via an open `>=6` peer range.
**Consequences**: The rule is project code: keep it small and covered by `tests/unit/layer-boundaries.test.ts`. Dynamic `import()`/`require()` are not checked (spec Out of scope). New layers/allowed modules are edited in the options, not the rule.

## D-009: Config errors aggregated from Zod issues plus a manual cross-field check  (Iteration 5)
**Context**: FR-024/VC-025 require one `ConfigError` naming every invalid variable *and* `CRON_SECRET` together; Zod skips object-level refinements when a field fails. FR-027 forbids secret values in messages.
**Decision**: Env vars are first normalised (only the 11 known names are read; `''` → `undefined`). A `z.object` keyed by **env var names** is `safeParse`d, so each issue's `path[0]` is the variable name. The `CRON_SECRET` rule (`VERCEL_ENV` ∈ {preview, production} and `CRON_SECRET` unset) is checked manually on the normalised input, always, and merged into the same problem map. The message is built only from fixed per-variable descriptions (`  - NAME description`); Zod's own messages and all received values are discarded.
**Rejected**: `superRefine` over a leniently parsed schema (re-implements validation in the refinement); using Zod's messages (future Zod versions could echo inputs).
**Consequences**: Adding a variable means adding it to `ENV_VARS`, the schema, `PROBLEMS` (if it can be invalid) and the `Config` mapping. An invalid `VERCEL_ENV` (e.g. `staging`) reports only `VERCEL_ENV`, not `CRON_SECRET`.

## D-010: `zod` pinned to 4.6.7 in `dependencies`; `getConfig` tested via `vi.resetModules()`  (Iteration 5)
**Context**: Spec requires Zod ≥ 4; D-003 asks for exact pins. FR-022 memoisation needs a fresh module per test.
**Decision**: `zod` 4.6.7 (latest stable, exact pin). VC-022 tests use `vi.resetModules()` + `await import('@/src/config')` instead of an exported test-only reset hook, keeping the public API exactly as typed in the spec.
**Rejected**: an exported `resetConfigForTests()` (widens the public API).
**Consequences**: `dependencies` = `next`, `react`, `react-dom`, `zod`. Tests that need a fresh `getConfig` cache must reset modules and import dynamically.
