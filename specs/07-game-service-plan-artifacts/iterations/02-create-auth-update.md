# Iteration 2 — GameService creation, authentication and updates

- **Commit**: this commit (`Add game service creation, authentication and updates`).
- **Decisions**: D-004 (P-2), D-005 (P-3), D-006 (P-4 + edge cases), D-007 (P-5), D-008 (P-6), D-009 (P-7 + non-string id), D-010 (P-10, `GatedStore` semantics), D-011 (P-11), D-012 (stub shape).

## Criteria results

All commands run from the repository root with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed.

| Criterion | Command | Result |
|---|---|---|
| VC-701–VC-707 | `pnpm vitest run tests/unit/service/create.test.ts tests/unit/service/create-preset-mock.test.ts` | PASS (2 files, 44 tests): VC-701 (0 calls on construct; default `argentina-fidepo`; `defaultPresetId: 'gamerules'`), VC-702 (9 invalid cases with reason + 0 calls; boundaries 1/40 chars, `'  x  '`→`'x'`, aiCount 2/5), VC-703 (mocked `{min 3, max 4}`: aiCount 4 rejected with 0 calls, 3 succeeds; unmocked 16 combinations all succeed), VC-704 (100 real games; literal `aaaqeayeaudaocajbifqydiob4`; seed/token from scripted bytes), VC-705, VC-706 (50 scripted seeds, at least one AI-first deal), VC-707 |
| VC-708 (`createGame` order), VC-708 (`getUpdate`), VC-709, VC-710, VC-711 (`getUpdate`) | `pnpm vitest run tests/unit/service/auth.test.ts tests/unit/service/auth-crypto.test.ts` (+ `create.test.ts` above for the `createGame` order case) | PASS (2 files, 17 tests): token `''`/non-string → `Unauthorized`, `'ABC'` → `GameNotFound`, both with 0 calls; order cases; unknown id, deleted commit 0 → `GameNotFound`; generic `get` error propagates; wrong / other game's token → `Unauthorized`; mocked `timingSafeEqual` called exactly 2× for match (seat 0 and seat 1) and mismatch; `engineVersion + 1` → `GameUnsupported` with that version, no commit/put added |
| VC-712, NFR-702 `getUpdate`, VC-729 `getUpdate` | `pnpm vitest run tests/unit/service/get-update.test.ts` | PASS (24 tests): tip 2 → version 2, `[]`; since 0 → commits 1–2 events; since 1, 2, 99, `MAX_COMMIT_VERSION`; −1, 1.5, `MAX+1`, NaN, `'0'` → `InvalidRequest sinceVersion`, 0 calls; race (third commit lands on `get` of commit 1) → version 2, exactly commits 1–2 events; counts 6 (tips 0/2/4) and 6 + 2·(t − v − 1) for (2,0), (2,1), (4,0), (4,1), (4,3), 6 for since ≥ tip; `GatedStore` 4 pending before the first release |
| P-5 | `grep -n "eventsSince" src/service/game-service.ts` | PASS (no output, exit 1) |
| FR-708 imports | `grep -nE "from 'node:crypto'" src/service/game-service.ts`; `grep -nE "import (\* as\|crypto) .*node:crypto" src/service/game-service.ts` | PASS: one line `4:import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';`; second prints nothing (exit 1) |
| R-032 (early check, formally Iteration 3) | `grep -nE "(^\|[^.#[:alnum:]_])randomBytes\(\|new Date\(\|Math\.random" src/service/game-service.ts` | Only lines 140 (`this.#now = deps.now ?? (() => new Date());`) and 141 (`this.#randomBytes = deps.randomBytes ?? ((n: number) => randomBytes(n));`) |
| Protected paths | `git diff main --stat -- src/service/player-view.ts src/service/ai-loop.ts src/domain src/engine src/score src/players src/state src/storage tests/unit/state package.json pnpm-lock.yaml` | Empty |
| Gates | `pnpm typecheck && pnpm lint && pnpm test` | PASS (exit 0 each; `pnpm test` 57 passed + 1 skipped files, 1073 passed + 30 skipped tests, ≈ 2.6 s) |
| Service suite | `pnpm vitest run tests/unit/service` | 9 files, 136 tests, ≈ 0.7 s |
| Artifacts | — | PASS: `CONTEXT.md` rewritten (file map, interfaces, private helper list, mock/fixture conventions), D-004–D-012 appended, this record |

## Files

- Added: `src/service/game-service.ts`, `tests/unit/service/support/service-fixtures.ts`, `tests/unit/service/support/gated-store.ts`, `tests/unit/service/create.test.ts`, `tests/unit/service/create-preset-mock.test.ts`, `tests/unit/service/auth.test.ts`, `tests/unit/service/auth-crypto.test.ts`, `tests/unit/service/get-update.test.ts`, `specs/07-game-service-plan-artifacts/iterations/02-create-auth-update.md`.
- Changed: `specs/07-game-service-plan-artifacts/CONTEXT.md`, `specs/07-game-service-plan-artifacts/DECISIONS.md`.
- Deleted: none.

## Deviations

- None from scope. Additions inside the listed files: `byteRange` helper in `service-fixtures.ts`; `GatedStore.whenPending`/`settle`; a `barrierOnCommitPut` self-check in `get-update.test.ts` (so the helper Iteration 3 depends on is exercised); extra cases (non-string token/`rulesPreset`, seat-1 auth, auth-before-engine-version, more `since` values and count pairs).
- Own decisions on edges the spec leaves open, none changing specified behaviour: D-006 (non-string `rulesPreset`; an invalid configured default propagates `UnknownPresetError`), D-009 (non-string `gameId` stringified for `GameNotFound`).

## Gotchas

- `@typescript-eslint/no-unused-vars` flags the stub's unused parameters; the stub uses `void x;` (D-012).
- Prettier rewraps long lines (e.g. `vi.importActual<…>(…)`, template-literal errors); run `pnpm exec prettier --write src/service tests/unit/service` before `pnpm lint`.
- `GatedStore` starts **closed**: building the game on it would hang. Build the game on the plain `MemoryObjectStore`, then wrap it.
- In the race test, the hook commits through a second `GameStateManager` on `inner` (the unwrapped store), so the hook's own calls are not recorded or re-hooked.
- `vi.mocked(ns.fn)` works on a namespace import of the mocked specifier; `mockReset()` in `afterEach` keeps tests independent.
- `getUpdate` counts assume `head.json` exact; `state.commit` writes it, so games advanced with `state.commit` qualify.

## For the next iteration

- Replace the `submitMove` stub (`src/service/game-service.ts`, ≈ lines 201–211) per P-8. Order: `#validateIdAndToken` → FR-713 checks (`isIntInRange(version, 0, MAX_COMMIT_VERSION - 1)`, `moveId` string 1–32, `clientRequestId` string 1–128) → `#loadAndAuthenticate` → retry check / apply / loop / commit / race / final scores. Use `#update` and `#missedEvents`; in the stale path do **not** reuse the retry-check `load(req.version + 1)` for missed events (NFR-702 counts).
- Add `playToEnd(service, created)` to `service-fixtures.ts` (use `firstLegalMoveId`, a fresh `clientRequestId` per call).
- VC-711's `submitMove` half is not named in the plan's Iteration 3 test list; cover it in `submit.test.ts` (rewrite meta `engineVersion + 1`; `submitMove` → `GameUnsupported`; no commit added). The recipe is in `auth.test.ts`.
- For the VC-720 different-moves race use `GatedStore.barrierOnCommitPut(2)` on a store that already holds the game; for the VC-729 `submitMove` round use `whenPending(4)` + `settle()` + `pending === 4` + `release()` (see `get-update.test.ts`).
- Two-human meta recipe: `auth-crypto.test.ts` `twoHumanGame()` (also in `CONTEXT.md`).
- VC-721 goes into `create-preset-mock.test.ts` (the `getPreset` mock and `narrowPreset` pattern are there).
