# La Podrida — Development Guide

> For developers (human or AI) working on the code. Quick start and the command list: [`README.md`](../README.md). What the system does: [`design.md`](./design.md). How it is built and deployed: [`architecture.md`](./architecture.md). Build order: [`implementation.md`](./implementation.md).

This guide explains how the repository is organised, which rules the tooling enforces and why, and how to work within them. Everything described here is checked by `pnpm typecheck`, `pnpm lint` and `pnpm test`, locally and in CI.

---

## 1. Toolchain

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24 (LTS) | `.nvmrc` and `package.json` `engines.node` (`>=24 <25`). Other versions print an "Unsupported engine" warning from pnpm; CI always runs 24. |
| pnpm | 10 (exact version in `package.json` `packageManager`) | Always install with `pnpm install --frozen-lockfile`; it must never change `pnpm-lock.yaml`. |
| Next.js | 16 (App Router) | React 19. |
| TypeScript | 6.0 | `strict`, no emit. Pinned below 7, see §8. |
| Vitest | 5 | With Vite 8 as its peer. |
| ESLint | 10 (flat config) | Plus `typescript-eslint`, the Next.js plugin and a local layer-boundary rule. |
| Prettier | 3 | Checked by `pnpm lint`. |
| Zod | 4 | Runtime dependency, used for configuration (and later the domain). |

**Dependencies.** Runtime `dependencies` are limited to `next`, `react`, `react-dom`, `zod` and `@noble/hashes` (the last one is added when the engine needs hashing). Everything else is a `devDependency`. All versions in `package.json` are **exact pins** (no `^`/`~`): add packages with an explicit version, e.g. `pnpm add -D some-tool@1.2.3`, so every upgrade is a visible, deliberate change.

---

## 2. Project layout

```
app/                    Next.js App Router: pages, layouts, components (UI)
  api/                  HTTP route handlers (added later)
src/
  domain/               Types, rules presets, pure helpers            ┐
  engine/               Game Engine: state transitions, legal moves   │ core: pure, no I/O
  score/                Score Engine                                  │
  players/              Player / AI strategies                        ┘
  state/                Game State Manager: load/save game state      ┐ I/O
  storage/              ObjectStore drivers (memory, file, Vercel Blob)┘
  service/              GameService: orchestrates core + state
  config.ts             Validated environment configuration
tests/
  unit/                 Pure logic, lint-rule fixtures, config
  contract/             Cross-module contracts (e.g. every ObjectStore driver)
  api/                  Route handlers
  sim/                  Long-running simulations (run by `pnpm test:sim` only)
scripts/simulate.ts     Command-line simulator (`pnpm simulate`)
tools/eslint-rules/     Local ESLint rule that enforces the layer boundaries
docs/                   Design docs (this guide included)
```

The layer folders under `src/` are empty for now (each holds a `.gitkeep` so git tracks it). The App Router lives in the root `app/` folder, not `src/app`, so that `src/` holds only the layered backend code.

**Import alias.** `@/` maps to the **project root**, so imports read `@/src/engine/...` or `@/app/...`. It works in TypeScript, Next.js, Vitest and `tsx`.

---

## 3. Layer import rules

The architecture is layered so that the game logic stays pure and testable, and I/O stays isolated. `pnpm lint` enforces the rules below; breaking one is a lint error, not a review comment.

A **layer** is a folder directly under `src/`. The **core** is `domain`, `engine`, `score` and `players`. A file may always import from its own layer.

| Rule | What is enforced | Why |
|---|---|---|
| **Core purity** | Core files may import only `zod` and `@noble/hashes` (and their subpaths) from outside `src/`. Every Node built-in (`fs`, `node:crypto`, …), `next`, `react`, `@vercel/blob` and any other package is an error, **including `import type`**. Core files may not import `src/config.ts`. | The core must run unchanged in tests, the command-line simulator and serverless functions. |
| **Inward dependencies** | `domain` imports no other layer. `engine`, `score` and `players` import only `domain` (not each other). `state` imports only `storage` and `domain`. `service` may import every other layer. | Dependencies point inwards, so the core can be tested without I/O and each layer can be replaced without touching the ones it depends on. |
| **Nothing imports `service`** | No file under `src/` outside `service` may import from `src/service`. | `service` is the top of the backend; only route handlers call it. |
| **Only `storage` touches the filesystem or Blob** | `fs`, `fs/promises`, `node:fs`, `node:fs/promises` and `@vercel/blob` (and subpaths) may be imported only under `src/storage`. | Storage is the one place bound to a concrete backend, so swapping memory / file / Blob drivers never touches other code. |
| **The UI imports types only** | Files under `app/` (except `app/api/`) may use only `import type` from `src/`, and only from `src/domain`. Value imports from any `src` module, and any import of other layers or `src/config.ts` (even `import type`), are errors. | The browser never runs engine logic and never receives server internals; it renders the per-player view it gets from the API. |
| **Configuration access** | `src/config.ts` may be imported by `state`, `storage`, `service` and route handlers, not by the core or the UI. | Configuration is a runtime concern of the I/O and orchestration layers. |

`app/api/**`, `tests/**` and `scripts/**` are not restricted.

Full matrix (✓ allowed, ✗ lint error, "own" = same folder):

| Importer ↓ / target → | domain | engine, score, players | state | storage | service | `src/config` | packages | `fs` / `@vercel/blob` |
|---|---|---|---|---|---|---|---|---|
| `src/domain` | own | ✗ | ✗ | ✗ | ✗ | ✗ | `zod`, `@noble/hashes` only | ✗ |
| `src/engine`, `src/score`, `src/players` | ✓ | own only | ✗ | ✗ | ✗ | ✗ | `zod`, `@noble/hashes` only | ✗ |
| `src/state` | ✓ | ✗ | own | ✓ | ✗ | ✓ | any | ✗ |
| `src/storage` | ✓ | ✓ | ✓ | own | ✗ | ✓ | any | ✓ |
| `src/service` | ✓ | ✓ | ✓ | ✓ | own | ✓ | any | ✗ |
| other files in `src/` (e.g. `src/config.ts`) | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | any | ✗ |
| `app/**` except `app/api/**` | `import type` only | ✗ | ✗ | ✗ | ✗ | ✗ (even type) | any | any |

**How matching works.** The rule looks at every `import …`, `import type …` and `export … from …` statement. It resolves the specifier — relative at any depth (`../../engine/x`) or via `@/` — to a path and checks which layer folder that path falls in. The target file does not have to exist. An `import { type A, type B }` in which every name is marked `type` counts as a type-only import. Dynamic `import()` and `require()` are **not** checked; the codebase uses static ESM imports only.

**Why a local rule.** The rules are implemented by a small project-local ESLint rule (`tools/eslint-rules/layer-boundaries.mjs`) rather than `no-restricted-imports` or `eslint-plugin-boundaries`. The same relative specifier means different things at different depths (`../storage/y` is the storage layer from `src/engine/x.ts` but `src/engine/storage/y` from `src/engine/a/b.ts`), which pattern-based rules cannot express, and resolver-based plugins cannot classify imports of files that do not exist yet. The local rule resolves paths itself and needs no extra dependency.

**Changing the rules.** The matrix is data, not code: edit `LAYER_BOUNDARIES` (and `CORE_EXTERNALS` for packages the core may use) in `eslint.config.mjs`, not the rule itself.

- *Add a layer:* add `<name>: { layers: [...], config: true|false }` to `LAYER_BOUNDARIES.layers`, and add `<name>` to the `layers` list of each existing layer that may import it.
- *Allow a package in the core:* append its name to `CORE_EXTERNALS` (subpaths are allowed automatically).
- Every change gets a fixture row in `tests/unit/layer-boundaries.test.ts` (see §4).

---

## 4. Tests

Tests are Vitest files named `*.test.ts`, placed in the folder that matches what they test:

| Folder | Put here | Run by |
|---|---|---|
| `tests/unit/` | Pure logic: domain helpers, engine and score functions, config, lint-rule fixtures. | `pnpm test` |
| `tests/contract/` | Contracts that several implementations must satisfy (e.g. one suite run against every storage driver). | `pnpm test` |
| `tests/api/` | Route handlers, called directly. | `pnpm test` |
| `tests/sim/` | Long-running simulations (many full games). | `pnpm test:sim` only |

Test files anywhere else (for example next to the code in `src/`) are **never run**. `pnpm test:sim` exits 0 when `tests/sim` has no tests.

Example:

```ts
// tests/unit/example.test.ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@/src/config';

describe('loadConfig', () => {
  it('defaults the log level to info', () => {
    expect(loadConfig({}).logLevel).toBe('info');
  });
});
```

Run a single file with `pnpm vitest run tests/unit/example.test.ts`.

**Two Vitest configs.** `vitest.config.ts` (used by `pnpm test`) includes `tests/{unit,contract,api}`; `vitest.sim.config.ts` (used by `pnpm test:sim`) includes only `tests/sim` and allows an empty folder. They are two standalone files because merging configs concatenates the `include` lists (sim would also run everything else) and importing one config from the other is not supported cleanly by Vite's config loader. **Keep the `resolve.alias` and `environment` settings of both files in sync.**

**Layer-rule fixture tests.** `tests/unit/layer-boundaries.test.ts` runs ESLint's `lintText` on inline source strings with a virtual file path (e.g. `src/engine/x.ts`) and asserts whether a `layer-boundaries/imports` error is reported. There are no fixture files on disk, so neither `pnpm lint` nor `pnpm typecheck` sees them. Add a row `[label, virtualPath, code, expectError]` to the `rows` table for each new case.

**Tests that need a fresh `getConfig()`.** `getConfig()` caches its result in the module. To test it from a clean state, call `vi.resetModules()` and import the module dynamically (`await import('@/src/config')`); restore any `process.env` keys you change, and don't replace `process.env` as a whole. There is deliberately no exported "reset" function, to keep the public API minimal.

---

## 5. Configuration

All runtime configuration comes from environment variables, validated by `src/config.ts`:

```ts
loadConfig(env: Record<string, string | undefined>): Config  // validate a map; returns a frozen object
getConfig(): Config                                          // loadConfig(process.env), cached after the first success
class ConfigError extends Error                              // thrown on any invalid configuration
```

| Variable | `Config` field | Allowed values | Default |
|---|---|---|---|
| `STORAGE_DRIVER` | `storageDriver` | `memory`, `file`, `blob` | `blob` if `VERCEL` = `1`, else `file` |
| `FILE_STORE_DIR` | `fileStoreDir` | any non-empty string | `.data/` |
| `BLOB_STORE_ID` | `blobStoreId` | any string; optional | unset |
| `VERCEL_OIDC_TOKEN` | `vercelOidcToken` | any string; optional (secret) | unset |
| `BLOB_READ_WRITE_TOKEN` | `blobReadWriteToken` | any string; optional (secret) | unset |
| `DEFAULT_RULES_PRESET` | `defaultRulesPreset` | `argentina-fidepo`, `spain-ludoteka`, `gamerules`, `mexico-bazas` | `argentina-fidepo` |
| `LOG_LEVEL` | `logLevel` | `debug`, `info`, `warn`, `error` | `info` |
| `RETENTION_DAYS` | `retentionDays` | decimal integer from 1 to 3650 | `365` |
| `CRON_SECRET` | `cronSecret` | non-empty string (secret); **required when `VERCEL_ENV` is `preview` or `production`** | unset |
| `VERCEL_ENV` | `vercelEnv` | `development`, `preview`, `production`; optional | unset |
| `VERCEL` | (only picks the `STORAGE_DRIVER` default) | any | – |

Rules:

- **An empty string counts as unset** for every variable: a variable with a default takes the default, an optional one is `undefined`, and a required `CRON_SECRET` is reported missing.
- **Values are not trimmed.** `RETENTION_DAYS` must be digits only (`"007"` → 7; `" 365"`, `"+5"`, `"1.5"` are invalid).
- **`CRON_SECRET` is optional locally** (no `VERCEL_ENV`, or `development`), so local development and tests start with no variables at all. On preview and production it must be set.
- Only these variables are read; anything else in the environment is ignored.

**Errors list every problem at once.** Invalid configuration throws a single `ConfigError` whose message names every invalid variable, one per line:

```
Invalid configuration:
  - LOG_LEVEL must be one of debug, info, warn, error
  - CRON_SECRET is required when VERCEL_ENV is preview or production
```

It works this way because a misconfigured deployment should be fixed in one pass, not one variable per redeploy. Internally the variables are parsed with a Zod schema keyed by variable name, and the `CRON_SECRET` rule (which depends on another variable) is checked separately so it is reported even when other variables are invalid too. The message is built only from fixed descriptions, never from Zod's messages or the received values, so **a `ConfigError` never contains a secret** (`CRON_SECRET`, `BLOB_READ_WRITE_TOKEN`, `VERCEL_OIDC_TOKEN`).

**Adding a variable:** add it to `ENV_VARS`, to the Zod schema, to `PROBLEMS` (if it can be invalid) and to the mapping that builds the `Config` object, then add tests in `tests/unit/config.test.ts`.

---

## 6. Formatting and linting

`pnpm lint` runs `eslint . --max-warnings 0` and then `prettier --check .`. It fails on any ESLint error, **any ESLint warning** (the Next.js rules are warnings, so they block too), or any unformatted file. Run `pnpm format` to fix formatting.

- **Prettier style:** single quotes, semicolons, trailing commas, 2-space indent, 100-character lines. Prettier and ESLint never conflict because `eslint-config-prettier` turns off ESLint's stylistic rules.
- **Prettier scope:** code and config files (`app/`, `src/`, `tests/`, `scripts/`, `tools/`, root config files, `README.md`, the CI workflow). `docs/` is excluded on purpose (see `.prettierignore`): the design docs are hand-written Markdown whose tables and line breaks should not be rewritten. Files in `.gitignore` are skipped too.
- **ESLint scope:** every `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.mjs` and `.cjs` file that is not ignored. Rules: `@eslint/js` recommended, `typescript-eslint` recommended, the Next.js `core-web-vitals` rules for `app/`, and the layer-boundary rule.
- **Linting is syntax-only** (no type-aware rules). Type-aware linting needs a TypeScript program, which would slow `pnpm lint` down and break the layer-rule fixture tests that lint virtual files outside the project. Type errors are caught by `pnpm typecheck` instead.
- We use `@next/eslint-plugin-next` directly rather than `eslint-config-next`, which would bring in several extra plugins we don't need.

---

## 7. Continuous integration

`.github/workflows/ci.yml` runs on every push to any branch and on every pull request. One job on `ubuntu-latest`:

1. Checkout.
2. Set up pnpm (version read from `packageManager` in `package.json`).
3. Set up Node.js from `.nvmrc`, with the pnpm store cached between runs (the cache key is the hash of `pnpm-lock.yaml`).
4. `pnpm install --frozen-lockfile`
5. `pnpm typecheck`
6. `pnpm lint`
7. `pnpm test`
8. `pnpm build`

The run fails as soon as one step fails. CI needs no secrets and sets no environment variables: tests pass explicit environment maps to `loadConfig`. The workflow has read-only access to the repository.

**Why `build` is in CI.** `next build` catches errors that typecheck and lint don't (for example invalid page exports or prerendering failures), and there are no preview deployments yet to catch them. `pnpm test:sim` is not part of CI yet; it is added once the simulations exist.

Every change must keep CI green. Run the same commands locally before pushing:

```sh
pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

---

## 8. Conventions and why they exist

- **`pnpm typecheck` works on a clean checkout.** It runs `next typegen && tsc --noEmit`. `next-env.d.ts` and `.next/` are generated files and are git-ignored, so on a fresh clone (and in CI, where typecheck runs before build) they don't exist. `next typegen` generates them, including typed routes, without a full build. As a side effect, `typecheck` writes `.next/` and `next-env.d.ts`; both are ignored. Keep `next-env.d.ts`, `.next/types/**/*.ts` and `.next/dev/types/**/*.ts` in `tsconfig.json` `include`.
- **TypeScript stays on 6.0.x.** `typescript-eslint` supports TypeScript only below 6.1, so upgrading to TypeScript 7 would break linting. Upgrade TypeScript only within the range `typescript-eslint` supports.
- **`@types/node` stays on the 24 line**, matching the Node.js runtime.
- **Exact version pins** (see §1): the lockfile fixes versions anyway; exact pins in `package.json` make every upgrade an explicit change.
- **`agentRules: false` in `next.config.ts`.** Without it, `next dev` writes an `AGENTS.md` file into the repository root on every start.
- **Generated files are never committed:** `node_modules/`, `.next/`, `out/`, `.data/` (local file storage), `.env*.local`, `coverage/`, `*.tsbuildinfo`, `next-env.d.ts`.
- **Secrets** go in `.env.local` (git-ignored), never in committed files.
- **pnpm build scripts.** pnpm prints "Ignored build scripts: esbuild" on install. This is expected: esbuild (used by `tsx` and Vite) ships its binary as an optional platform package, so its install script is not needed.

---

## 9. Known limitations

- **Configuration is not validated at server startup yet.** `getConfig()` has no caller; it is wired in by its first user, the GameService factory (Phase 8 in [`implementation.md`](./implementation.md)). Until then a misconfigured deployment would still start.
- **Storage credentials for the `blob` driver are not checked** by `loadConfig`; that check arrives with the storage layer (Phase 5).
- **`pnpm simulate` is a stub** that prints `simulate: not implemented until Phase 4` and exits 0. The simulator and the `tests/sim` suite arrive in Phase 4.
- **The layer rule does not check dynamic `import()` or `require()`.** Use static `import` statements.
- **No game code yet:** the `src/` layers are empty, and `/` is a placeholder page.
