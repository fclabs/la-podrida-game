# Iteration 1 — Next.js app skeleton with pinned toolchain

- Record written before committing. Previous commit: `816f29e` (Add Phase 0 scaffold spec, review ledger and plan). This iteration's commit: `Scaffold Next.js app with pinned Node 24 / pnpm toolchain`.
- Environment: macOS, Node 26.13.1 (project declares 24), pnpm 10.15.1.

## Criteria results

All run in the repo root after the final change (full checklist re-run from the top after D-004). `$S` = session scratchpad directory (outside the repo).

| Criterion | Command | Result |
|---|---|---|
| VC-001 | `rm -rf node_modules && pnpm install --frozen-lockfile; git status --porcelain pnpm-lock.yaml` | PASS — exit 0; status `A ` (staged, no working-tree change; lockfile untouched by install) |
| VC-002 (partial) | `rm -rf .next next-env.d.ts && pnpm typecheck` | PASS — exit 0 |
| VC-002 (negative) | append `const x: number = 'a';` to `app/page.tsx`, `pnpm typecheck` | PASS — exit 2, `app/page.tsx(9,7): error TS2322`; file restored from backup, re-verified clean |
| VC-008 | `pnpm build` | PASS — exit 0, `/` prerendered static |
| VC-009 | `pnpm dev` (background), `curl -s -o $S/body -w '%{http_code}' http://localhost:3000/`; `grep -q 'La Podrida' $S/body` | PASS — `200`, grep exit 0; dev server killed, port 3000 free afterwards |
| VC-010 | `cat .nvmrc`; `node -e "const p=require('./package.json');console.log(p.engines.node,p.packageManager)"` | PASS — `24`; `>=24 <25 pnpm@10.15.1` |
| VC-029 | `git check-ignore -q <f>` for `.data/x .env.local .env.production.local node_modules/x .next/x coverage/x tsconfig.tsbuildinfo next-env.d.ts` | PASS — all exit 0 |
| NFR-004 | `node -e "console.log(Object.keys(require('./package.json').dependencies).join(','))"` | PASS — `next,react,react-dom` |
| Artifacts | this file, `CONTEXT.md`, `DECISIONS.md` (D-001 = typecheck decision) | PASS |

## Files

Added: `package.json`, `pnpm-lock.yaml`, `.nvmrc`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `src/{domain,engine,score,players,state,storage,service}/.gitkeep`, `specs/00-project-scaffold-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-next-skeleton.md}`.
Changed: `.gitignore` (Node/Next block appended: `node_modules/`, `.next/`, `out/`, `.data/`, `.env*.local`, `coverage/`, `*.tsbuildinfo`, `next-env.d.ts`).
Deleted: none.

## Deviations from the plan

- Project created by hand (no `create-next-app`), so nothing had to be removed.
- TypeScript 6.0.3 instead of the npm `latest` 7.0.2 — see D-002 (keeps Iteration 3's `typescript-eslint` working). Still satisfies "≥ 5.6".
- `next.config.ts` sets `agentRules: false` — see D-004. Not listed in Scope, but needed to keep the tree clean after `pnpm dev`.
- VC-009 body written to the session scratchpad instead of `/tmp/body` (same check).

## Gotchas

- Node 26 locally: pnpm prints `WARN Unsupported engine: wanted {"node":">=24 <25"}` on every script; it is advisory (no `engine-strict`), so everything runs. Spec was not loosened. CI (Iteration 6) runs Node 24.
- `next dev` in Next 16.4 auto-generates `AGENTS.md` (fixed by D-004). The generated file's text asks to be committed; ignored as out of scope.
- `next typegen` writes `next-env.d.ts` that imports `./.next/dev/types/routes.d.ts`; `tsconfig.json` includes `.next/dev/types/**/*.ts` for that reason.
- `tsconfig.json` has `incremental: true`, producing `tsconfig.tsbuildinfo` (git-ignored).
- `next build` did not rewrite `tsconfig.json` (diffed before/after).
- `VC-001`'s `git status --porcelain pnpm-lock.yaml` is only meaningful once the lockfile is tracked/staged; on an untracked file it prints `??`.

## For the next iteration

- `typecheck` script is `next typegen && tsc --noEmit` (D-001); it works with no `.next/`. Keep `tests/**/*.ts` and `scripts/**/*.ts` in `tsconfig.json` `include` (already there).
- `@/*` → project root (`tsconfig.json` `paths`); Vitest must mirror it (e.g. `resolve.alias` `'@'` → repo root, or `vite-tsconfig-paths`).
- `package.json` is `"type": "module"`, so `vitest.config.ts` and `scripts/simulate.ts` are ESM.
- Add devDependencies with explicit versions (D-003); `dependencies` must stay `next`, `react`, `react-dom` until Iteration 5 adds `zod`.
- `packageManager` is `pnpm@10.15.1`.
- `src/<layer>/` contains only `.gitkeep` files.
- Complete VC-002 with a temporary type error under `tests/unit`.
