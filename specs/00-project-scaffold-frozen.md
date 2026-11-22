# Frozen: Spec 00 — Project Scaffold

Source: specs/00-project-scaffold.md (plan + build record: specs/00-project-scaffold-plan.md, specs/00-project-scaffold-plan-artifacts/)
Status: SHIPPED
Frozen: 2026-11-22
PR / commit: https://github.com/fclabs/la-podrida-game/pull/1 — squash commit 4711e27

## Purpose
La Podrida has design docs but no code. Every later phase (domain, engine, score, players, storage, service, API, UI) needs the same base: a Next.js + TypeScript project with a test runner, lint rules that keep the architecture's layer boundaries from eroding, validated configuration, and CI that fails a PR that breaks any of these. This spec delivers that base so later phases start on a green, enforced foundation. It benefits the developers (human and AI) who build the later phases.

## What it does
- Next.js App Router (`app/` at root) + TypeScript `strict`, Node 24 (`.nvmrc`, `engines >=24 <25`), pnpm 10 (`packageManager`), exact version pins; `@/*` aliases the project root (`@/src/engine/...`).
- Scripts: `dev`, `build`, `typecheck` (`next typegen && tsc --noEmit`, works on a clean checkout), `lint` (ESLint flat config `--max-warnings 0` + `prettier --check`), `format`, `test` (`tests/{unit,contract,api}/**/*.test.ts` only), `test:sim` (`tests/sim/**/*.test.ts`, passes with no tests), `simulate` (`tsx scripts/simulate.ts`, a stub until Phase 4).
- A custom ESLint rule (`tools/eslint-rules/layer-boundaries.mjs`, table in `eslint.config.mjs` §5) enforces by resolved path, at any relative depth or via `@/`, covering `import`, `import type`, `export … from`:
  - `domain` → nothing; `engine`/`score`/`players` → `domain` only; `state` → `storage`, `domain`; `service` → core + `state`; nothing in `src` imports `service`.
  - Core may import only `zod` and `@noble/hashes` (and subpaths); no Node built-ins, `next`, `react`, `@vercel/blob`, `src/config.ts`.
  - Only `storage` may import `fs`/`node:fs`/`@vercel/blob`; `src/config.ts` is importable from `state`, `storage`, `service`.
  - `app/**` outside `app/api/**` imports only types, only from `src/domain`. `app/api/**`, `tests/**`, `scripts/**` are unrestricted.
- `src/config.ts` validates env with Zod: one `ConfigError` names every invalid variable by env name (incl. cross-field `CRON_SECRET`), never includes received values; result frozen; `getConfig()` memoises success only.
- GitHub Actions (`.github/workflows/ci.yml`) on every push/PR: Node 24, pnpm store cached, install → typecheck → lint → test → build; no secrets.

## Public interfaces / data

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

## Key decisions
- Core purity (`zod`/`@noble/hashes` only): the core must run unchanged in tests, the simulator and serverless functions.
- Custom path-resolving lint rule: `no-restricted-imports` matches text only and misreads nested relative paths; `eslint-plugin-boundaries` can't classify non-existent targets.
- `pnpm build` runs in CI because Vercel preview builds are not part of the pipeline until Phase 11.
- TypeScript pinned to 6.0.3 (typescript-eslint 8.x requires `<6.1`); `zod` 4.6.7; all deps pinned exactly.
- Prettier skips `docs/` and `specs/` (hand-written docs are not reformatted); `README.md` is checked.
- `next.config.ts` sets `agentRules: false` so `next dev` doesn't write `AGENTS.md`.
- Separate `vitest.config.ts` / `vitest.sim.config.ts` (merging would union `include` lists); alias and environment duplicated in both.

## Known limits (still true at freeze)
- `getConfig()` is not called at startup; fail-fast wiring arrives with the Phase 8 service factory.
- `@noble/hashes` is allowed in the core but not installed (Phase 2 adds it); `dependencies` = `next, react, react-dom, zod`.
- Lint does not check dynamic `import()`/`require()`.
- `test:sim` is not in CI yet (Phase 4 adds it). The `blob` driver's credentials are not validated (Phase 5).

## Deliberately excluded
- Game logic, storage, API routes, real UI; `vercel.json`, Vercel project and Blob setup; branch protection; coverage thresholds and pre-commit hooks.
