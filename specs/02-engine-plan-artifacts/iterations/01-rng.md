# Iteration 1 — Seeded RNG and stream derivation

**Commit**: this commit ("Add seeded xoshiro128** RNG and SHA-256 stream derivation").

## Criteria results

| Criterion | Result | Command / evidence |
|---|---|---|
| VC-201 | PASS | `pnpm vitest run tests/unit/engine/rng.test.ts --reporter=verbose` — `createXoshiro128ss([1,2,3,4])` gives `11520, 0, 5927040, 70819200, 2031721883, 1637235492`; all-zero state equals the replacement state (20 outputs); argument not mutated. |
| VC-202 | PASS | same command — 10,000 × `int(1,6)` in range, each face within 1,500–1,850; `int(5,5)` = 5; `int(-3,-1)` in range; stub `2**32−1, 0` → `int(0,2)` = 0 after exactly 2 draws. |
| VC-203 | PASS | same command — `int(1.5,3)`, `int(3,1)`, `int(0,2**32)` throw `RangeError`. |
| VC-204 | PASS | same command — `[0..51]` permutation, input unchanged; stub-0 `[a,b,c,d]` → `[b,c,d,a]`; `[]`, `[x]` → new arrays `[]`, `[x]`. |
| VC-205 | PASS | same command — identical first 100 outputs for equal inputs; 4 inputs pairwise different first outputs; golden 8 outputs of `deriveRng('golden-seed','deal',0)` equal an in-test computation (`sha256`/`utf8ToBytes` called directly, words assembled byte-by-byte, BigInt reference xoshiro). |
| NFR-202 (partial) | PASS | `node -e "const d=require('./package.json').dependencies;console.log(Object.keys(d).join(','), d['@noble/hashes'])"` → `@noble/hashes,next,react,react-dom,zod 2.4.0`. |
| rng test file | PASS | `pnpm vitest run tests/unit/engine/rng.test.ts` → 1 file, 17 tests passed. |
| Full gate | PASS | `pnpm typecheck` exit 0; `pnpm lint` exit 0 (0 warnings, Prettier clean); `pnpm test` exit 0 (11 files, 232 tests). |
| Purity grep | PASS | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/score\|\.\./score' src/engine` → no matches. Imports: `@noble/hashes/sha2.js`, `@noble/hashes/utils.js`, `import type` from `@/src/domain/types`. |
| Artifacts | PASS | This record lists each criterion with its command; `CONTEXT.md` File map and Public interfaces list `rng.ts`'s three exports with signatures. |

Golden values (for reference; the test computes them itself): `1610793976, 333462975, 1658162046, 2737170619, 3645462708, 2685186142, 3513667637, 568283462`.

## Files

- Added: `src/engine/rng.ts`, `tests/unit/engine/rng.test.ts`, `specs/02-engine-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-rng.md}`.
- Changed: `package.json` (`"@noble/hashes": "2.4.0"` in `dependencies`), `pnpm-lock.yaml`.
- Deleted: `src/engine/.gitkeep`.

## Deviations

- None from the plan's Scope. One small implementation choice recorded as D-001: `int` reads draws as `next() >>> 0` (identity for valid uint32).
- Tests go slightly beyond the VCs: the words argument of `createXoshiro128ss` is checked unmodified (plan Scope requires it), the BigInt reference is also checked against the pinned (1,2,3,4) outputs, and the VC-202 stub asserts exactly 2 draws.

## Gotchas

- `@noble/hashes` 2.4.0 only exports `.js` subpaths (`@noble/hashes/sha2.js`, `@noble/hashes/utils.js`); bare `@noble/hashes/sha2` does not resolve.
- `createXoshiro128ss` keeps state in a `Uint32Array`, so assignments wrap mod 2^32 automatically; `s[1] << 9` may be negative as a JS number but is stored correctly.
- The purity grep matches `crypto.` and `process.` anywhere in `src/engine`, comments included.
- `int(0, 2**32 − 1)` never rejects, so it exposes raw generator outputs.

## For the next iteration

- Import RNG as `import { deriveRng } from './rng'` inside `src/engine`; tests use `@/src/engine/rng`.
- `rngFromSource(() => 0)` and similar stubs give fully predictable `int`/`shuffle` for unit tests.
- Engine tests go in `tests/unit/engine/<topic>.test.ts`; shared helpers in `tests/unit/engine/helpers.ts`.
- Decisions so far: D-001 only.
