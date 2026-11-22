# CONTEXT — Project Scaffold (Phase 0)

Last updated by: Iteration 2 (Vitest, test folders and script entry points)

## Current state

- Next.js 16.4.6 App Router + React 19.3.1 + TypeScript 6.0.3 (`strict`) project, managed by pnpm 10.15.1, declared for Node 24.
- Installs from the committed `pnpm-lock.yaml` (`pnpm install --frozen-lockfile`), typechecks on a clean checkout (no `.next/`, no `next-env.d.ts`), builds, and serves a placeholder home page at `/` with an `<h1>La Podrida</h1>`.
- `src/` holds only seven empty layer folders, each with a `.gitkeep`.
- Vitest 5.1.1 (with Vite 8.3.8 as its required peer) runs `tests/{unit,contract,api}` via `pnpm test` and `tests/sim` via `pnpm test:sim`; one smoke test exists (`tests/unit/smoke.test.ts`).
- `pnpm simulate` runs `scripts/simulate.ts` through `tsx` 4.23.15 and prints a Phase 4 stub line.
- Not yet present: ESLint/Prettier, `src/config.ts`, zod, CI workflow, README.

## File map

| Path | Purpose |
|---|---|
| `package.json` | `private`, `"type": "module"`, `packageManager: pnpm@10.15.1`, `engines.node: ">=24 <25"`, scripts `dev`/`build`/`typecheck`/`test`/`test:sim`/`simulate`. Exact-version pins. |
| `pnpm-lock.yaml` | Lockfile (lockfileVersion 9). Must stay unmodified by `pnpm install --frozen-lockfile`. |
| `.nvmrc` | `24` |
| `tsconfig.json` | `strict`, `noEmit`, `moduleResolution: bundler`, `jsx: react-jsx`, `paths: { "@/*": ["./*"] }`, Next TS plugin; `include` covers `next-env.d.ts`, `app/**`, `src/**`, `tests/**/*.ts`, `scripts/**/*.ts`, root `*.ts`, `.next/types/**`, `.next/dev/types/**`. |
| `next.config.ts` | `agentRules: false` only (stops `next dev` writing `AGENTS.md`). |
| `app/layout.tsx` | Root layout: `<html lang="es"><body>`; metadata title `La Podrida`. |
| `app/page.tsx` | Home page: `<main><h1>La Podrida</h1></main>`. |
| `src/{domain,engine,score,players,state,storage,service}/.gitkeep` | Empty layer folders (the `.gitkeep` is their only content). |
| `vitest.config.ts` | Config for `pnpm test`: `include: ['tests/{unit,contract,api}/**/*.test.ts']`, `environment: 'node'`, `resolve.alias` `'@'` → project root. |
| `vitest.sim.config.ts` | Config for `pnpm test:sim`: `include: ['tests/sim/**/*.test.ts']`, `passWithNoTests: true`, same alias/environment. Standalone (D-005) — keep `resolve`/`environment` in sync with `vitest.config.ts`. |
| `tests/{unit,contract,sim,api}/.gitkeep` | Keep the four test folders tracked. |
| `tests/unit/smoke.test.ts` | Trivial passing test so `pnpm test` has something to run. |
| `scripts/simulate.ts` | CLI simulator stub: prints `simulate: not implemented until Phase 4`, exits 0. Implemented in Phase 4. |
| `.gitignore` | Original Python template kept; Node/Next block appended at the end. |
| `specs/00-project-scaffold-plan-artifacts/` | This artifact directory. |

## Public interfaces

None yet (no exported modules in `src/`). Routes: `GET /` → static page containing `La Podrida`.

## Conventions & invariants

- `@/` alias maps to the **project root**: imports read `@/src/engine/...`, `@/app/...`.
- App Router lives in root `app/` (not `src/app`), per architecture §4.2.
- `dependencies` must stay ⊆ {`next`, `react`, `react-dom`, `zod`, `@noble/hashes`} (NFR-004). Today exactly `next`, `react`, `react-dom`. Everything else is a devDependency. `@noble/hashes` is not installed in Phase 0.
- TypeScript is pinned to 6.0.x (not 7.x) — see D-002; do not upgrade past `typescript-eslint`'s peer range.
- `@types/node` is pinned to the 24 line to match the runtime.
- `next-env.d.ts`, `.next/`, `*.tsbuildinfo` are git-ignored and regenerated; never commit them.
- `typecheck` must keep working without `.next/` (CI runs it before `build`) — see D-001.
- Tests are `*.test.ts` files under `tests/<folder>/**`. Folder roles: `unit` (pure logic, lint-boundary fixtures, config), `contract` (cross-module contracts), `api` (route handlers), `sim` (long-running simulations; excluded from `pnpm test`, run by `pnpm test:sim`). Test files anywhere else (e.g. `src/**`) are never run.
- `@/` alias works in Vitest (`resolve.alias`) and in `tsx` (reads `tsconfig.json` `paths`); both verified with a temporary `@/src/...` import.
- Code style so far: single quotes, semicolons, 2-space indent, trailing commas (Prettier arrives in Iteration 3 and may reformat).

## Commands

| Command | What it does |
|---|---|
| `pnpm install --frozen-lockfile` | Install from lockfile (prints an "Unsupported engine" WARN on non-24 Node; not fatal). |
| `pnpm dev` | `next dev` (Turbopack) on http://localhost:3000. |
| `pnpm build` | `next build` (Turbopack; also runs its own TS check). |
| `pnpm typecheck` | `next typegen && tsc --noEmit` — generates `next-env.d.ts` + `.next/types` route types, then typechecks the whole project (incl. `tests/`, `scripts/`, root `vitest*.config.ts`). |
| `pnpm test` | `vitest run` — runs `tests/{unit,contract,api}/**/*.test.ts` (uses `vitest.config.ts`). |
| `pnpm test:sim` | `vitest run --config vitest.sim.config.ts` — runs `tests/sim/**/*.test.ts`; exits 0 when there are none. |
| `pnpm simulate` | `tsx scripts/simulate.ts` — prints `simulate: not implemented until Phase 4`, exit 0. |

## Known gaps

- No `lint`, `format` scripts yet (Iteration 3).
- pnpm reports "Ignored build scripts: esbuild" (tsx/vite dependency); the platform binary ships as an optional package, so `tsx` works without the postinstall. Not approved in `package.json`.
- No CI; Node 24 is only declared, local verification ran on Node 26.13.1 (engines are advisory in pnpm without `engine-strict`).
- No README / developer docs yet (Iteration 6).
