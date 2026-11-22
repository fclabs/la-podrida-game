# Spec 00 — Project Scaffold

> Version: 0.2 · Last updated: 2026-11-22 · Status: Draft · Owner: Federico Castañeda
> Source: [`docs/implementation.md`](../docs/implementation.md) §3 Phase 0 (Milestone M1). Context: [`docs/architecture.md`](../docs/architecture.md) §2, §4.1, §4.2, §9, §11.

## Purpose

La Podrida has design docs but no code. Every later phase (domain, engine, score, players, storage, service, API, UI) needs the same base: a Next.js + TypeScript project with a test runner, lint rules that keep the architecture's layer boundaries from eroding, validated configuration, and CI that fails a PR that breaks any of these. This spec delivers that base so later phases start on a green, enforced foundation. It benefits the developers (human and AI) who build the later phases.

## Scope

**In**
- Next.js (App Router) app with TypeScript `strict`, managed by pnpm, on Node.js 24 LTS.
- ESLint + Prettier configuration, with Prettier checked as part of `pnpm lint`.
- Vitest with the `tests/unit`, `tests/contract`, `tests/sim`, `tests/api` folders.
- `package.json` scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `test`, `test:sim`, `simulate`.
- Lint-enforced import boundaries between `src` layers (architecture §4.1) plus tests that prove them.
- `src/config.ts`: Zod-validated environment configuration (architecture §9) plus tests.
- Empty layer folders `src/{domain,engine,score,players,state,storage,service}`, each with a `.gitkeep` so it is tracked.
- A placeholder home page at `/`.
- GitHub Actions CI workflow.
- `.gitignore` entries for Node/Next artifacts, `.data/`, `.env*.local`.

**Out**
- Any game logic, types, presets, storage drivers, API routes, or real UI (Phases 1–9).
- `vercel.json`, Vercel project setup, Blob stores (Phases 5b, 10, 11).
- Checking that storage credentials exist for the `blob` driver (Phase 5).
- Running `pnpm test:sim` in CI (added in Phase 4).
- Calling `getConfig()` at server startup (e.g. `instrumentation.ts`); this is wired by its first caller, the Phase 8 service factory.
- GitHub branch protection rules.
- Lint enforcement of dynamic `import()` and `require()` (the codebase uses static ESM imports only).
- Import rules for `app/api/**`, `tests/**` and `scripts/**` (unrestricted in this spec).
- Coverage thresholds, pre-commit hooks, Dependabot/Renovate.

## Actors

| Actor | Description | Permissions |
|---|---|---|
| Developer | Human or AI agent writing code in later phases | Runs all `pnpm` scripts locally; pushes branches and opens PRs |
| CI (GitHub Actions) | Runs checks on every push and pull request | Read-only checkout; no secrets in this phase |
| Runtime (Next.js server) | Loads configuration at startup | Reads environment variables |

## Functional Requirements

### Project and scripts

- **FR-001 (Must)** — Given a fresh clone with Node.js 24 and pnpm, when the developer runs `pnpm install --frozen-lockfile`, then dependencies install from the committed `pnpm-lock.yaml` without modifying it.
- **FR-002 (Must)** — Given the project, when `pnpm typecheck` runs, then TypeScript checks the whole project (`src`, `app`, `tests`, `scripts`) with `strict: true` and emits no files.
- **FR-003 (Must)** — Given the project, when `pnpm lint` runs, then ESLint (flat config, invoked directly as `eslint`, with `--max-warnings 0`) checks all source and test files and Prettier checks formatting, and the command exits non-zero on any ESLint error or warning or any unformatted file. ESLint uses `eslint-config-prettier` so the two tools never conflict. *Why Prettier inside lint:* one CI step catches formatting drift.
- **FR-004 (Must)** — Given the project, when `pnpm format` runs, then Prettier rewrites files to the project format.
- **FR-005 (Must)** — Given the project, when `pnpm test` runs, then Vitest runs every `*.test.ts` file under `tests/unit`, `tests/contract` and `tests/api`, and does not run tests under `tests/sim`. Test files outside `tests/` are not run.
- **FR-006 (Must)** — Given the project, when `pnpm test:sim` runs, then Vitest runs only the `*.test.ts` files under `tests/sim`, and exits 0 when that folder contains no test files.
- **FR-007 (Must)** — Given the project, when `pnpm simulate` runs, then `scripts/simulate.ts` executes via `tsx` (a devDependency; chosen because it supports the `@/` path alias and extensionless imports Phase 4 will need), prints a line containing `not implemented until Phase 4`, and exits 0.
- **FR-008 (Must)** — Given the project, when `pnpm build` runs, then the Next.js production build succeeds.
- **FR-009 (Must)** — Given `pnpm dev` is running, when a browser requests `/`, then the server responds with HTTP 200 and a page containing the text `La Podrida`.
- **FR-010 (Must)** — The repository declares Node.js 24 via `.nvmrc` (`24`) and `package.json` `engines.node` (`>=24 <25`), and pins pnpm via `package.json` `packageManager`.

### Layer boundaries (architecture §4.1)

Layer = the folder directly under `src/` (`domain`, `engine`, `score`, `players`, `state`, `storage`, `service`). "Core" = `domain`, `engine`, `score`, `players`. An import of another layer means an import specifier — relative (resolved against the importing file's folder, at any depth such as `../../engine/x`) or via the `@/` alias — whose path falls inside that layer's folder. Matching is by path and does not require the target file to exist. Covered statement forms: `import …`, `import type …`, and `export … from …`. An `import { type A, type B }` where every specifier is inline-`type` counts as a type-only import. The enforcement tool (`no-restricted-imports` variants or `eslint-plugin-boundaries`, per implementation.md) is a plan choice; FR-021 tests define the behavior.

- **FR-011 (Must)** — Given a file in `src/domain`, when it imports from any other `src` layer or from `src/config.ts`, then `pnpm lint` reports an error.
- **FR-012 (Must)** — Given a file in `src/engine`, `src/score` or `src/players`, when it imports from any `src` layer other than `domain` and its own layer, or from `src/config.ts`, then `pnpm lint` reports an error.
- **FR-013 (Must)** — Given a file in the core, when it imports a third-party or built-in module other than `zod` or `@noble/hashes` (including any `node:*` module, bare Node built-in such as `fs` or `crypto`, `next`, `next/*`, `react`, `@vercel/blob`), then `pnpm lint` reports an error.
- **FR-014 (Must)** — Given a file in `src/state`, when it imports from any `src` layer other than `storage`, `domain` and its own layer, then `pnpm lint` reports an error.
- **FR-015 (Must)** — Given a file in any `src` layer other than `service`, when it imports from `src/service`, then `pnpm lint` reports an error.
- **FR-016 (Must)** — Given a file in `src/service`, when it imports from `domain`, `engine`, `score`, `players`, `state` or its own layer, then `pnpm lint` reports no layer error.
- **FR-017 (Must)** — Given a file anywhere under `src/` outside `src/storage`, when it imports `node:fs`, `node:fs/promises`, `fs`, `fs/promises` or `@vercel/blob`, then `pnpm lint` reports an error. `src/config.ts` may be imported by `state`, `storage` and `service`.
- **FR-018 (Must)** — Given a file under `app/` that is not under `app/api/`, when it imports a value (non-`import type`) from any `src` module, then `pnpm lint` reports an error.
- **FR-019 (Must)** — Given a file under `app/` that is not under `app/api/`, when it imports from any `src` module outside `src/domain` (including `src/config.ts`, even with `import type`), then `pnpm lint` reports an error.
- **FR-020 (Must)** — Given a file under `app/` that is not under `app/api/`, when it uses `import type` from `src/domain`, then `pnpm lint` reports no layer error.
- **FR-021 (Must)** — The boundary rules are verified by automated tests in `tests/unit` that run ESLint on fixture source text with a given virtual file path and assert the presence or absence of an error. Fixtures are inline strings passed to ESLint's `lintText` with a virtual `filePath`; there are no fixture files on disk, so neither `pnpm lint` nor `pnpm typecheck` sees them.

### Configuration (architecture §9)

- **FR-022 (Must)** — `src/config.ts` exports `loadConfig(env)`, which takes an environment map (`Record<string, string | undefined>`) and returns a frozen `Config` object, and `getConfig()`, which calls `loadConfig(process.env)` on first use and returns the same object on later calls (a thrown `ConfigError` is not cached; the next call re-validates).
- **FR-023 (Must)** — Given an environment with none of the variables in Data & Interfaces set, when `loadConfig` runs, then it returns the defaults listed there.
- **FR-024 (Must)** — Given a variable set to a value outside its allowed values, when `loadConfig` runs, then it throws `ConfigError` whose message names every invalid variable (not just the first), including `CRON_SECRET` when FR-025 also applies.
- **FR-025 (Must)** — Given `VERCEL_ENV` is `preview` or `production` and `CRON_SECRET` is unset or empty, when `loadConfig` runs, then it throws `ConfigError` naming `CRON_SECRET`.
- **FR-026 (Must)** — Given `VERCEL_ENV` is unset or `development` and `CRON_SECRET` is unset, when `loadConfig` runs, then it succeeds with `cronSecret` undefined.
- **FR-027 (Must)** — `ConfigError` messages never contain the value of `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN` or `VERCEL_OIDC_TOKEN`.

### CI

- **FR-028 (Must)** — Given a push to any branch or a pull request, when GitHub Actions runs `.github/workflows/ci.yml`, then it runs on Node.js 24 with the pnpm store cached between runs (keyed on `pnpm-lock.yaml`), in order: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and the run fails if any step fails. *Why build in CI:* Vercel preview builds don't exist until Phase 11.

### Repository hygiene

- **FR-029 (Must)** — `.gitignore` excludes `node_modules/`, `.next/`, `.data/`, `.env*.local`, `coverage/`, `*.tsbuildinfo` and `next-env.d.ts` (regenerated by Next.js on `dev`/`build`).

## Business Rules

- **BR-001 — Core purity.** The core (`domain`, `engine`, `score`, `players`) has no I/O and no framework dependencies; its only allowed third-party imports are `zod` and `@noble/hashes`. *Rationale:* the core must run unchanged in tests, the CLI simulator and serverless functions (architecture §2). *Exceptions:* none; `import type` is subject to the same rule.
- **BR-002 — Inward dependencies.** Layer imports follow architecture §4.1: `domain` → nothing; `engine`/`score`/`players` → `domain`; `state` → `storage`, `domain`; `service` → core + `state`; nothing in `src` imports `service`. *Rationale:* keeps the core testable and the I/O isolated. *Exceptions:* `app/api/**`, `tests/**`, `scripts/**` are unrestricted in this spec; `storage`'s and `service`'s imports from other layers are not restricted beyond FR-015 and FR-017.
- **BR-003 — Only storage touches the filesystem or Blob SDK.** *Rationale:* `state` and `storage` are the only I/O modules, and storage is the only one bound to a concrete backend (architecture §4.1). *Exceptions:* `tests/**` and `scripts/**`.
- **BR-004 — UI sees types only.** Pages and components under `app/` (excluding `app/api/`) import only types, and only from `domain`. *Rationale:* the browser never runs engine logic and never receives server internals (architecture §4.1, §8).
- **BR-005 — Fail fast on configuration.** `loadConfig` rejects invalid configuration with one error listing every problem. *Rationale:* a misconfigured deployment must not serve requests; startup wiring that turns this into a refusal to start arrives with the first caller (Phase 8). *Exceptions:* `CRON_SECRET` is optional outside preview/production so local dev and tests start without it.
- **BR-006 — Every phase ends green.** CI (FR-028) reports failure on any push or PR that breaks install, typecheck, lint, test or build. *Rationale:* implementation.md §1.

## Non-Functional Requirements

- **NFR-001** — The `pnpm test` step completes in ≤ 30 s on the GitHub Actions `ubuntu-latest` runner for this phase's test suite.
- **NFR-002** — A CI run (FR-028) completes in ≤ 5 min wall-clock when the pnpm store cache is warm (second run on the same lockfile).
- **NFR-003** — `pnpm typecheck` and `pnpm lint` report 0 errors and 0 warnings on the delivered tree (kept enforced by `--max-warnings 0`, FR-003).
- **NFR-004** — No dependency is added to `dependencies` beyond `next`, `react`, `react-dom`, `zod` and `@noble/hashes`; everything else is a `devDependency`.

## Data & Interfaces

### Environment variables → `Config`

| Variable | `Config` field | Allowed values | Default |
|---|---|---|---|
| `STORAGE_DRIVER` | `storageDriver` | `memory` \| `file` \| `blob` | `blob` if `VERCEL` = `1`, else `file` |
| `FILE_STORE_DIR` | `fileStoreDir` | any non-empty string | `.data/` |
| `BLOB_STORE_ID` | `blobStoreId` | any string; optional | `undefined` |
| `VERCEL_OIDC_TOKEN` | `vercelOidcToken` | any string; optional | `undefined` |
| `BLOB_READ_WRITE_TOKEN` | `blobReadWriteToken` | any string; optional | `undefined` |
| `DEFAULT_RULES_PRESET` | `defaultRulesPreset` | `argentina-fidepo` \| `spain-ludoteka` \| `gamerules` \| `mexico-bazas` | `argentina-fidepo` |
| `LOG_LEVEL` | `logLevel` | `debug` \| `info` \| `warn` \| `error` | `info` |
| `RETENTION_DAYS` | `retentionDays` | decimal integer string, 1–3650 | `365` |
| `CRON_SECRET` | `cronSecret` | non-empty string; required when `VERCEL_ENV` ∈ {`preview`, `production`} | `undefined` |
| `VERCEL_ENV` | `vercelEnv` | `development` \| `preview` \| `production`; optional | `undefined` |
| `VERCEL` | (only used for the `STORAGE_DRIVER` default) | any | – |

An empty string counts as unset for **every** variable: a variable with a default takes the default, an optional one is `undefined`, and `CRON_SECRET` when required is reported missing. Values are not trimmed. `RETENTION_DAYS` must match `^[0-9]+$` and parse to 1–3650 (so `"007"` → 7; `" 365"`, `"+5"`, `"1.5"` are invalid).

```ts
export type Config = Readonly<{
  storageDriver: 'memory' | 'file' | 'blob';
  fileStoreDir: string;
  blobStoreId?: string;
  vercelOidcToken?: string;
  blobReadWriteToken?: string;
  defaultRulesPreset: 'argentina-fidepo' | 'spain-ludoteka' | 'gamerules' | 'mexico-bazas';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  retentionDays: number;
  cronSecret?: string;
  vercelEnv?: 'development' | 'preview' | 'production';
}>;
export class ConfigError extends Error {}
export function loadConfig(env: Record<string, string | undefined>): Config;
export function getConfig(): Config;
```

### Files created

`package.json`, `pnpm-lock.yaml`, `.nvmrc`, `tsconfig.json` (with `@/*` → project root alias), ESLint config, Prettier config, `vitest.config.ts` (or workspace equivalent), `next.config.*`, `app/layout.tsx`, `app/page.tsx`, `src/config.ts`, placeholder files in each `src/<layer>/`, `tests/{unit,contract,sim,api}/` (folders tracked), `scripts/simulate.ts`, `.github/workflows/ci.yml`, `.gitignore` updates.

## Verification Criteria

### Project and scripts
- **VC-001** (FR-001): fresh clone, `pnpm install --frozen-lockfile` → exits 0 and `git status` shows no changes to `pnpm-lock.yaml`.
- **VC-002** (FR-002): `pnpm typecheck` on the delivered tree → exits 0; adding `const x: number = 'a'` in a file under `tests/unit` → exits non-zero.
- **VC-003** (FR-003): `pnpm lint` on the delivered tree → exits 0; a file with Prettier-violating formatting (e.g. double quotes when the config uses single) → `pnpm lint` exits non-zero.
- **VC-004** (FR-004): unformatted file, `pnpm format` then `pnpm lint` → second command exits 0.
- **VC-005** (FR-005): a passing test in each of `tests/unit`, `tests/contract`, `tests/api` and a deliberately failing test in `tests/sim` → `pnpm test` exits 0 and reports the three passing tests.
- **VC-006** (FR-006): `tests/sim` with no test files → `pnpm test:sim` exits 0; a failing test in `tests/sim` → exits non-zero.
- **VC-007** (FR-007): `pnpm simulate` → stdout contains `not implemented until Phase 4`, exit code 0.
- **VC-008** (FR-008): `pnpm build` → exits 0.
- **VC-009** (FR-009): `pnpm dev`, `curl -s -o body -w '%{http_code}' localhost:3000/` → `200` and body contains `La Podrida`.
- **VC-010** (FR-010): `.nvmrc` contains `24`; `package.json` has `engines.node` = `>=24 <25` and a `packageManager` field starting `pnpm@`.

### Layer boundaries (each via the FR-021 ESLint fixture tests)
- **VC-011** (FR-011, BR-002): `src/domain/x.ts` importing `../engine/y` → error; importing `@/src/config` → error; importing `./cards` → no error.
- **VC-012** (FR-012, BR-002): `src/engine/x.ts` importing `../domain/y` → no error; importing `../storage/y` → error; importing `../score/y` → error; `src/score/x.ts` importing `../engine/y` → error; `src/players/x.ts` importing `../state/y` → error; `src/engine/x.ts` importing `@/src/config` → error.
- **VC-013** (FR-013, BR-001): `src/engine/x.ts` importing `@noble/hashes/sha2` → no error; `zod` → no error; `node:crypto` → error; `crypto` → error; `next/server` → error; `react` → error; `@vercel/blob` → error; `lodash` → error; `src/domain/x.ts` with `import type { X } from 'next'` → error.
- **VC-014** (FR-014): `src/state/x.ts` importing `../storage/y` → no error; `../domain/y` → no error; `../engine/y` → error; `../service/y` → error.
- **VC-015** (FR-015): `src/storage/x.ts` importing `../service/y` → error; `src/players/x.ts` importing `@/src/service/y` → error.
- **VC-016** (FR-016): `src/service/x.ts` importing each of `../domain/y`, `../engine/y`, `../score/y`, `../players/y`, `../state/y` → no error.
- **VC-017** (FR-017, BR-003): `src/storage/x.ts` importing `node:fs` → no error; `@vercel/blob` → no error; `src/state/x.ts` importing `node:fs/promises` → error; `src/service/x.ts` importing `@vercel/blob` → error; `src/service/x.ts` importing `fs` → error.
- **VC-018** (FR-018, BR-004): `app/page.tsx` with `import { createGame } from '@/src/engine/engine'` → error; with `import { X } from '@/src/domain/types'` (value import) → error.
- **VC-019** (FR-019, BR-004): `app/game/[id]/page.tsx` with `import type { X } from '@/src/engine/engine'` → error.
- **VC-020** (FR-020): `app/page.tsx` with `import type { X } from '@/src/domain/types'` → no error; `app/api/games/route.ts` importing a value from `@/src/service/game-service` → no error.
- **VC-021** (FR-021): the fixture tests run as part of `pnpm test`; the fixture text is not under a path matched by `pnpm lint` → `pnpm lint` exits 0 on the delivered tree while the fixture tests pass.

### Configuration
- **VC-022** (FR-022): `getConfig()` called twice → returns the same object reference; `Object.isFrozen(result)` → `true`; with `process.env.LOG_LEVEL='trace'` the first call throws, and after fixing it the next call succeeds.
- **VC-023** (FR-023): `loadConfig({})` → `{ storageDriver: 'file', fileStoreDir: '.data/', defaultRulesPreset: 'argentina-fidepo', logLevel: 'info', retentionDays: 365 }` with all optional fields undefined; `loadConfig({ VERCEL: '1' })` → `storageDriver: 'blob'`.
- **VC-024** (FR-024, BR-005): each of `STORAGE_DRIVER=s3`, `LOG_LEVEL=trace`, `DEFAULT_RULES_PRESET=foo`, `RETENTION_DAYS=0`, `RETENTION_DAYS=3651`, `RETENTION_DAYS=1.5`, `RETENTION_DAYS=abc`, `RETENTION_DAYS=' 365'`, `VERCEL_ENV=staging` → throws `ConfigError` naming that variable; `RETENTION_DAYS=1` and `RETENTION_DAYS=3650` → accepted; `{ STORAGE_DRIVER: 's3', LOG_LEVEL: 'trace' }` → one `ConfigError` whose message names both variables; `{ LOG_LEVEL: '', FILE_STORE_DIR: '' }` → `logLevel: 'info'`, `fileStoreDir: '.data/'`.
- **VC-025** (FR-025): `{ VERCEL_ENV: 'preview' }` and `{ VERCEL_ENV: 'production', CRON_SECRET: '' }` → throw `ConfigError` naming `CRON_SECRET`; `{ VERCEL_ENV: 'production', CRON_SECRET: 's3cret' }` → `cronSecret: 's3cret'`; `{ VERCEL_ENV: 'production', LOG_LEVEL: 'trace' }` → one `ConfigError` naming both `LOG_LEVEL` and `CRON_SECRET`.
- **VC-026** (FR-026): `{}`, `{ VERCEL_ENV: 'development' }` and `{ CRON_SECRET: '' }` → succeed with `cronSecret` undefined.
- **VC-027** (FR-027): `{ VERCEL_ENV: 'production', CRON_SECRET: '', BLOB_READ_WRITE_TOKEN: 'tok-SECRET-1', VERCEL_OIDC_TOKEN: 'oidc-SECRET-2', LOG_LEVEL: 'trace' }` → `ConfigError` message contains neither `tok-SECRET-1` nor `oidc-SECRET-2`.

### CI and hygiene
- **VC-028** (FR-028, BR-006): push the branch to `origin` → the GitHub Actions run of `ci.yml` is green, its log shows Node 24 and the five steps in order; a pushed commit with a type error → the run fails at `typecheck`.
- **VC-029** (FR-029): `git check-ignore -q` succeeds for `.data/x`, `.env.local`, `.env.production.local`, `node_modules/x`, `.next/x`, `coverage/x`, `tsconfig.tsbuildinfo`, `next-env.d.ts`.

### NFR check
- **VC-030** (NFR-001–004): the `pnpm test` step in the green CI run ≤ 30 s; a second CI run on the same lockfile (warm cache) took ≤ 5 min; `pnpm typecheck` and `pnpm lint` print 0 warnings; `package.json` `dependencies` keys ⊆ {`next`, `react`, `react-dom`, `zod`, `@noble/hashes`}.
- **VC-031** (BR-005): covered by VC-024 and VC-025 (one `ConfigError` lists every problem).

## Open Questions

None.

## Assumptions

- The GitHub remote `origin` (`fclabs/la-podrida-game`) has Actions enabled.
- Minimum majors: Next.js ≥ 15.5 (App Router; `next lint` not used), ESLint ≥ 9 (flat config), Zod ≥ 4, Vitest ≥ 3, TypeScript ≥ 5.6, pnpm 10. Latest stable within these at implementation time; exact versions fixed by `pnpm-lock.yaml`. Node 24 is chosen because it is the current LTS supported by Vercel.
- `DEFAULT_RULES_PRESET` validates against the four preset names from design §4.2 as literals; Phase 1 may switch the check to the preset registry without changing behavior.
- The existing `.gitignore` (Python template) is kept and extended, not replaced.

## Changelog

- 0.2 (2026-11-22): review pass 1 — empty-string rule, BR-005 scoped to `loadConfig` (startup wiring deferred to Phase 8), `pnpm build` added to CI, import-matching semantics, tool/version pins.
- 0.1 (2026-11-22): initial draft from implementation.md Phase 0 and discovery answers (Node 24, Prettier enforced via lint, `simulate` stub exits 0, CI on GitHub).
