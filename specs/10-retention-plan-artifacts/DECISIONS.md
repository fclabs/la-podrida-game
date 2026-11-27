# Decisions

## D-001: Add `retention` to the node project's test include  (Iteration 1)

**Context**: The spec puts retention tests in `tests/retention/`, but the `node` project's `include` was `tests/{unit,contract,api}/**/*.test.ts`, so they would never run under `pnpm test` or CI.
**Decision**: `vitest.config.ts` `node` project `include` is now `['tests/{unit,contract,api,retention}/**/*.test.ts']`; the comment above names `tests/retention`.
**Rejected**: a separate vitest config or project for retention (a second command, and CI runs only `pnpm test`).
**Consequences**: `tests/retention/support/**` is not matched (no `.test.ts`). `pnpm test` collects 100 files plus the existing suites unchanged.

## D-002: `makeGameKeys` takes an optional `final` flag  (Iteration 1)

**Context**: The plan fixes `makeGameKeys(store, { id, day, keys })` but also wants `scores/final.json` optionally.
**Decision**: Extra optional field `final?: boolean`. Key order: `meta.json`, `head.json`, [`scores/final.json` if `final`], then `commits/00000000.json`…; the first `keys` of that list are written. Bodies are `{id}:{key}` strings (distinct per key, so byte comparison is meaningful).
**Rejected**: inferring the final-scores key from `keys` size (implicit, surprising).
**Consequences**: `keys: 0` writes only the marker (VC-1019).
