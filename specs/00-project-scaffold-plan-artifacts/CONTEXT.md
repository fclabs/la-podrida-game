# CONTEXT — Project Scaffold (Phase 0)

Last updated by: Iteration 6 (CI workflow and developer documentation) — final state of Phase 0

## Current state

- Next.js 16.4.6 App Router + React 19.3.1 + TypeScript 6.0.3 (`strict`) project, managed by pnpm 10.15.1, declared for Node 24.
- Installs from the committed `pnpm-lock.yaml` (`pnpm install --frozen-lockfile`), typechecks on a clean checkout (no `.next/`, no `next-env.d.ts`), builds, and serves a placeholder home page at `/` with an `<h1>La Podrida</h1>`.
- `src/` holds seven empty layer folders (each with a `.gitkeep`) and `src/config.ts` (Zod 4.6.7-validated env configuration, see Public interfaces).
- Vitest 5.1.1 (with Vite 8.3.8 as its required peer) runs `tests/{unit,contract,api}` via `pnpm test` and `tests/sim` via `pnpm test:sim`. Tests: `tests/unit/smoke.test.ts`, `tests/unit/layer-boundaries.test.ts` (47 ESLint fixture rows) and `tests/unit/config.test.ts` (26 cases, VC-022–VC-027); 74 tests total.
- `pnpm simulate` runs `scripts/simulate.ts` through `tsx` 4.23.15 and prints a Phase 4 stub line.
- ESLint 10.15.0 (flat config, `eslint.config.mjs`) + `typescript-eslint` 8.73.0 + `@next/eslint-plugin-next` 16.4.6 + `eslint-config-prettier` 10.1.8, and Prettier 3.10.1. `pnpm lint` = ESLint with `--max-warnings 0` then `prettier --check .`; `pnpm format` = `prettier --write .`. Tree is clean under both.
- Layer boundaries (spec FR-011–FR-020) are enforced by a local ESLint rule `layer-boundaries/imports` (`tools/eslint-rules/layer-boundaries.mjs`, D-008) configured with a declarative matrix in `eslint.config.mjs` section 5. No new dependency.
- GitHub Actions CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → test → build on Node 24 with a cached pnpm store on every push and PR; green on `spec/00-project-scaffold` (run IDs in `iterations/06-ci-docs.md`).
- Human docs: `README.md` (overview, prerequisites, getting started, command table, doc links) and `docs/development.md` (layout, layer rules with reasons, tests, configuration, linting/formatting, CI, conventions, known limitations).
- Phase 0 is complete; no game code exists. Next: Phase 1 (domain model) per `docs/implementation.md`.

## File map

| Path | Purpose |
|---|---|
| `package.json` | `private`, `"type": "module"`, `packageManager: pnpm@10.15.1`, `engines.node: ">=24 <25"`, scripts `dev`/`build`/`typecheck`/`lint`/`format`/`test`/`test:sim`/`simulate`. Exact-version pins. |
| `pnpm-lock.yaml` | Lockfile (lockfileVersion 9). Must stay unmodified by `pnpm install --frozen-lockfile`. |
| `.nvmrc` | `24` |
| `tsconfig.json` | `strict`, `noEmit`, `moduleResolution: bundler`, `jsx: react-jsx`, `paths: { "@/*": ["./*"] }`, Next TS plugin; `include` covers `next-env.d.ts`, `app/**`, `src/**`, `tests/**/*.ts`, `scripts/**/*.ts`, root `*.ts`, `.next/types/**`, `.next/dev/types/**`. |
| `next.config.ts` | `agentRules: false` only (stops `next dev` writing `AGENTS.md`). |
| `app/layout.tsx` | Root layout: `<html lang="es"><body>`; metadata title `La Podrida`. |
| `app/page.tsx` | Home page: `<main><h1>La Podrida</h1></main>`. |
| `src/{domain,engine,score,players,state,storage,service}/.gitkeep` | Empty layer folders (the `.gitkeep` is their only content). |
| `src/config.ts` | `Config` type, `ConfigError`, `loadConfig(env)`, `getConfig()`. Imports only `zod`. Not in a layer; importable from `state`, `storage`, `service`, `app/api/**`, `tests/**`, `scripts/**` (✗ from core and UI). |
| `tests/unit/config.test.ts` | One test per VC-022–VC-027 case; `listedVariables()` parses the `  - NAME` lines of a `ConfigError` message; VC-022 uses `vi.resetModules()` + dynamic `import('@/src/config')` and restores the env vars it touches. |
| `vitest.config.ts` | Config for `pnpm test`: `include: ['tests/{unit,contract,api}/**/*.test.ts']`, `environment: 'node'`, `resolve.alias` `'@'` → project root. |
| `vitest.sim.config.ts` | Config for `pnpm test:sim`: `include: ['tests/sim/**/*.test.ts']`, `passWithNoTests: true`, same alias/environment. Standalone (D-005) — keep `resolve`/`environment` in sync with `vitest.config.ts`. |
| `eslint.config.mjs` | Flat config via `defineConfig`, numbered sections: 1 global ignores (`.next/`, `node_modules/`, `coverage/`, `out/`, `next-env.d.ts`); 2 `@eslint/js` recommended; 3 `typescript-eslint` recommended (syntax-only) on `**/*.{ts,tsx,mts,cts}`; 4 Next `core-web-vitals` on `app/**/*.{ts,tsx}`; 5 one layer-boundary block (`src/**`, `app/**` minus `app/api/**`, all JS/TS extensions) running `layer-boundaries/imports` with the `LAYER_BOUNDARIES` options object (matrix) and `CORE_EXTERNALS` defined at the top of the file; 6 `eslint-config-prettier/flat` (must stay last). |
| `tools/eslint-rules/layer-boundaries.mjs` | Local ESLint plugin (`layer-boundaries`) with rule `imports`: resolves each `import`/`import type`/`export … from` specifier (relative against the file's folder, `@/` against the root; target need not exist), classifies it (layer / `src/config` / other `src` / bare module) and reports against the options. Linted and Prettier-checked like other code. |
| `tests/unit/layer-boundaries.test.ts` | FR-021 fixtures: one shared `new ESLint({ cwd: <root> })`, `lintText(code, { filePath })` with virtual paths, `it.each(rows)` table of `[vc, filePath, code, expectError]`; asserts only `layer-boundaries/imports` errors and fails on any fatal parse error. |
| `.prettierrc.json` | `singleQuote: true`, `semi: true`, `trailingComma: "all"`, `printWidth: 100`. |
| `.prettierignore` | `docs/`, `specs/`, `LICENSE`, `pnpm-lock.yaml`, `.next/`, `coverage/` (D-006). Prettier also honours `.gitignore`. |
| `tests/{unit,contract,sim,api}/.gitkeep` | Keep the four test folders tracked. |
| `tests/unit/smoke.test.ts` | Trivial passing test. |
| `scripts/simulate.ts` | CLI simulator stub: prints `simulate: not implemented until Phase 4`, exits 0. Implemented in Phase 4. |
| `.gitignore` | Original Python template kept; Node/Next block appended at the end. |
| `.github/workflows/ci.yml` | CI (D-011): job `check`, `ubuntu-latest`, `actions/checkout@v7`, `pnpm/action-setup@v6` (version from `packageManager`), `actions/setup-node@v7` (`.nvmrc`, `cache: pnpm`), steps Install/Typecheck/Lint/Test/Build. `permissions: contents: read`, no secrets/env. |
| `README.md` | Project overview + getting started + command table + links to `docs/`. Prettier-checked (D-012). |
| `docs/development.md` | Developer guide (§1 toolchain … §9 known limitations). Under `docs/`, so not Prettier-checked. Keep in sync when rules, config variables, scripts or CI change. |
| `docs/{design,architecture,game_rules,implementation}.md` | Pre-existing design docs (not changed in Phase 0). |
| `specs/00-project-scaffold-plan-artifacts/` | This artifact directory. |

## Public interfaces

Routes: `GET /` → static page containing `La Podrida`.

### `@/src/config` (spec 00 FR-022–FR-027, Data & Interfaces)

```ts
export type Config = Readonly<{
  storageDriver: 'memory' | 'file' | 'blob';          // STORAGE_DRIVER; default 'blob' if VERCEL === '1', else 'file'
  fileStoreDir: string;                               // FILE_STORE_DIR; default '.data/'
  blobStoreId?: string;                               // BLOB_STORE_ID
  vercelOidcToken?: string;                           // VERCEL_OIDC_TOKEN (secret)
  blobReadWriteToken?: string;                        // BLOB_READ_WRITE_TOKEN (secret)
  defaultRulesPreset: 'argentina-fidepo' | 'spain-ludoteka' | 'gamerules' | 'mexico-bazas'; // DEFAULT_RULES_PRESET; default 'argentina-fidepo'
  logLevel: 'debug' | 'info' | 'warn' | 'error';      // LOG_LEVEL; default 'info'
  retentionDays: number;                              // RETENTION_DAYS: ^[0-9]+$, 1–3650; default 365
  cronSecret?: string;                                // CRON_SECRET (secret); required when VERCEL_ENV ∈ {preview, production}
  vercelEnv?: 'development' | 'preview' | 'production'; // VERCEL_ENV
}>;
export class ConfigError extends Error {}             // name === 'ConfigError'
export function loadConfig(env: Record<string, string | undefined>): Config; // frozen result
export function getConfig(): Config;                  // memoises loadConfig(process.env) on success only
```

- Full env table: spec 00 Data & Interfaces. An empty string counts as unset for every variable; values are not trimmed.
- Any problem → **one** `ConfigError` whose message is `Invalid configuration:` followed by one `  - <ENV_VAR_NAME> <fixed description>` line per invalid variable, in table order, with the cross-field `CRON_SECRET` line last (D-009). Messages never contain any received value.
- `DEFAULT_RULES_PRESET` is validated against the four literal names; Phase 1 may switch the check to the preset registry without changing behavior.
- Nobody calls `getConfig()` yet (no `instrumentation.ts`); the first caller is the Phase 8 service factory.

## Conventions & invariants

### Layer import matrix (enforced by `layer-boundaries/imports`)

Layer = folder directly under `src/`. Import = static `import`, `import type`, `export … from` (dynamic `import()`/`require()` not checked). Matching is by resolved path (relative at any depth or `@/`), target need not exist. ✓ allowed, ✗ error. "own" = same layer folder, always ✓.

| Importer ↓ / target → | domain | engine | score | players | state | storage | service | `src/config` | bare modules | `fs`, `node:fs`(/…), `@vercel/blob`(/…) |
|---|---|---|---|---|---|---|---|---|---|---|
| `src/domain` | own | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | only `zod`, `@noble/hashes` (+subpaths) | ✗ |
| `src/engine`, `src/score`, `src/players` | ✓ | own / ✗ | own / ✗ | own / ✗ | ✗ | ✗ | ✗ | ✗ | only `zod`, `@noble/hashes` (+subpaths); all built-ins ✗ | ✗ |
| `src/state` | ✓ | ✗ | ✗ | ✗ | own | ✓ | ✗ | ✓ | any | ✗ |
| `src/storage` | ✓ | ✓ | ✓ | ✓ | ✓ | own | ✗ | ✓ | any | ✓ |
| `src/service` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | own | ✓ | any | ✗ |
| other `src/*` files (e.g. `src/config.ts`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ (BR-002) | ✓ | any | ✗ |
| `app/**` except `app/api/**` | `import type` only (incl. all-inline-`type` specifiers) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ (even `import type`) | any (outside `src`) | any |
| `app/api/**`, `tests/**`, `scripts/**` | unrestricted | | | | | | | | | |

Core = domain, engine, score, players: each may import only its own layer and `domain`. Imports into `src/` paths that are not a declared layer or `src/config` (e.g. `src/utils/x`) are not restricted for `src` files; for UI files they are ✗.

- Edit the matrix in `eslint.config.mjs` (`LAYER_BOUNDARIES`), not the rule. Add a fixture row in `tests/unit/layer-boundaries.test.ts` for every matrix change.

### General

- `@/` alias maps to the **project root**: imports read `@/src/engine/...`, `@/app/...`.
- App Router lives in root `app/` (not `src/app`), per architecture §4.2.
- `dependencies` must stay ⊆ {`next`, `react`, `react-dom`, `zod`, `@noble/hashes`} (NFR-004). Today exactly `next`, `react`, `react-dom`, `zod` (4.6.7). Everything else is a devDependency. `@noble/hashes` is not installed in Phase 0.
- TypeScript is pinned to 6.0.x (not 7.x) — see D-002; do not upgrade past `typescript-eslint`'s peer range.
- `@types/node` is pinned to the 24 line to match the runtime.
- `next-env.d.ts`, `.next/`, `*.tsbuildinfo` are git-ignored and regenerated; never commit them.
- `typecheck` must keep working without `.next/` (CI runs it before `build`) — see D-001.
- Tests are `*.test.ts` files under `tests/<folder>/**`. Folder roles: `unit` (pure logic, lint-boundary fixtures, config), `contract` (cross-module contracts), `api` (route handlers), `sim` (long-running simulations; excluded from `pnpm test`, run by `pnpm test:sim`). Test files anywhere else (e.g. `src/**`) are never run.
- `@/` alias works in Vitest (`resolve.alias`) and in `tsx` (reads `tsconfig.json` `paths`); both verified with a temporary `@/src/...` import.
- Formatting is owned by Prettier (single quotes, semicolons, 2-space indent, trailing commas, width 100); run `pnpm format` before committing. `docs/` and `specs/` are never formatted (D-006); `README.md` and `.github/` are (D-012).
- Docs: user-facing rules live in `docs/development.md`; any change to the layer matrix, env variables, scripts or CI must update it (and `README.md` for scripts).
- `pnpm lint` must pass with 0 errors **and 0 warnings** (`--max-warnings 0`); Next plugin rules are `warn`-level and therefore blocking.
- ESLint covers every `.ts/.tsx/.mts/.cts/.js/.mjs/.cjs` file not ignored: `app/`, `src/`, `tests/`, `scripts/`, root configs. Linting is syntax-only (no type-aware rules, D-007).

## Commands

| Command | What it does |
|---|---|
| `pnpm install --frozen-lockfile` | Install from lockfile (prints an "Unsupported engine" WARN on non-24 Node; not fatal). |
| `pnpm dev` | `next dev` (Turbopack) on http://localhost:3000. |
| `pnpm build` | `next build` (Turbopack; also runs its own TS check). |
| `pnpm typecheck` | `next typegen && tsc --noEmit` — generates `next-env.d.ts` + `.next/types` route types, then typechecks the whole project (incl. `tests/`, `scripts/`, root `vitest*.config.ts`). |
| `pnpm lint` | `eslint . --max-warnings 0 && prettier --check .` — fails on any ESLint error/warning or unformatted file. |
| `pnpm format` | `prettier --write .` — rewrites files to the project format (skips `docs/`, `specs/`). |
| `pnpm test` | `vitest run` — runs `tests/{unit,contract,api}/**/*.test.ts` (uses `vitest.config.ts`). |
| `pnpm test:sim` | `vitest run --config vitest.sim.config.ts` — runs `tests/sim/**/*.test.ts`; exits 0 when there are none. |
| `pnpm simulate` | `tsx scripts/simulate.ts` — prints `simulate: not implemented until Phase 4`, exit 0. |
| CI (GitHub Actions) | On push to any branch / PR: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` on Node 24. Inspect with `gh run list --branch <b>`, `gh run view <id> --log`. |

## Known gaps

- Configuration is not validated at server startup: `getConfig()` has no caller until Phase 8 wires it (spec Scope Out). A misconfigured deployment would currently start.
- Storage credentials for the `blob` driver are not checked (Phase 5).

- Layer rule does not check dynamic `import()`/`require()` (spec Out of scope) or `import x = require()`.
- pnpm reports "Ignored build scripts: esbuild" (tsx/vite dependency); the platform binary ships as an optional package, so `tsx` works without the postinstall. Not approved in `package.json`.
- Local verification ran on Node 26.13.1 (engines are advisory in pnpm without `engine-strict`); CI runs Node 24.
- `pnpm test:sim` is not in CI (added in Phase 4). No branch protection rules (spec Out).
