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
