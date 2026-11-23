# Iteration 3 — submitMove, races, final scores and end-to-end checks

- **Commit**: this commit (`Add submitMove with retry, conflict and final-score handling`).
- **Decisions**: D-013 (P-8 flow), D-014 (race resolution, P-7 on the race-path `loadLatest`), D-015 (shared test helpers), D-016 (VC-725 method).

## Criteria results

All commands run from the repository root with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed.

| Criterion | Command | Result |
|---|---|---|
| Service suite; every VC-701–VC-726, VC-729, VC-731 named | `pnpm vitest run tests/unit/service --reporter verbose`; then `grep -c "VC-7NN"` on its output for each ID | PASS: 15 files, 202 tests, exit 0; every ID appears (map below) |
| VC-727 protected diff | `git diff main -- src/service/player-view.ts src/service/ai-loop.ts src/domain src/engine src/score src/players src/state src/storage` | PASS: empty |
| VC-727 replay purity | `grep -nE "storage\|config\|node:\|Date\|Math\.random\|crypto" src/service/replay.ts` | PASS: no output (exit 1) |
| VC-727 R-032 | `grep -nE "(^\|[^.#[:alnum:]_])randomBytes\(\|new Date\(\|Math\.random" src/service/game-service.ts` | PASS: only the `deps` defaults, line 172 `this.#now = deps.now ?? (() => new Date());` and line 173 `this.#randomBytes = deps.randomBytes ?? ((n: number) => randomBytes(n));` |
| BR-704 no `GameState` mutation | `grep -nE "^\s*(state\|\w+)\.version\s*=\|\.hand\b.*=" src/service/game-service.ts` | PASS: no output (exit 1). The only version assignment is `const state = { ...loop.state, version };` (line 262) |
| P-5 / FR-708 (still hold) | `grep -n "eventsSince" …`; `grep -nE "from 'node:crypto'" …`; `grep -nE "import (\* as\|crypto) .*node:crypto" …` | PASS: nothing; one named line (4); nothing |
| Local NFR-704 | `pnpm vitest run tests/unit/service` summary | PASS: Duration 895 ms (< 20 s) |
| Gates | `pnpm typecheck && pnpm lint && pnpm test` | PASS: exit 0 each; `pnpm test` 63 passed + 1 skipped files, 1139 passed + 30 skipped tests (≈ 2.8 s) |
| Protected tests/config | `git diff main --stat -- tests/unit/state package.json pnpm-lock.yaml vitest.config.ts eslint.config.mjs src/config.ts tests/unit/service/ai-loop.test.ts tests/unit/service/player-view.test.ts` | PASS: empty |
| Artifacts | — | PASS: `CONTEXT.md` rewritten (whole service, flow, Known gaps), D-013–D-016 appended, this record |

## VC → file map

| VC | File(s) |
|---|---|
| VC-701, VC-702, VC-704, VC-705, VC-706, VC-707 | `create.test.ts` |
| VC-703 | `create.test.ts` (unmocked), `create-preset-mock.test.ts` (mocked) |
| VC-708 | `create.test.ts` (createGame order), `auth.test.ts` (getUpdate), `submit.test.ts` (submitMove) |
| VC-709 | `auth.test.ts` |
| VC-710 | `auth.test.ts`, `auth-crypto.test.ts` |
| VC-711 | `auth.test.ts` (getUpdate), `submit.test.ts` (submitMove, carry-over) |
| VC-712 | `get-update.test.ts` |
| VC-713, VC-716, VC-717, VC-718, VC-719, VC-726 | `submit.test.ts` (VC-716–VC-718 also feed `secrets.test.ts`) |
| VC-714, VC-715 | `full-game.test.ts` |
| VC-720 | `concurrency.test.ts` (a race conflict also feeds `secrets.test.ts`) |
| VC-721 | `create-preset-mock.test.ts` |
| VC-722, VC-731 | `ai-loop-mock.test.ts` |
| VC-723 | `full-game.test.ts` (service game), `replay.test.ts` (chain built without the service) |
| VC-724 | `replay.test.ts` |
| VC-725 (+ R-033) | `secrets.test.ts` |
| VC-729 | `get-update.test.ts` (getUpdate), `io-budget.test.ts` (submitMove, stale 409, createGame) |
| VC-727 | greps above (no test file) |

## Files

- Added: `tests/unit/service/{submit,concurrency,full-game,secrets,io-budget,ai-loop-mock}.test.ts`, `specs/07-game-service-plan-artifacts/iterations/03-submit-move.md`.
- Changed: `src/service/game-service.ts` (stub replaced; `#validateSubmit`, `#applyHumanMove`, `#resolveRace`, `isStringOfLength`, `isSameRequest`, two constants, imports), `tests/unit/service/support/service-fixtures.ts` (`playToEnd`, `sha256Hex`, `storeHandmadeGame`), `tests/unit/service/create-preset-mock.test.ts` (VC-721), `specs/07-game-service-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.
- Deleted: none.

## Deviations

- `service-fixtures.ts` gains `sha256Hex` and `storeHandmadeGame` besides `playToEnd` (D-015): both `submit.test.ts` and `secrets.test.ts` need an AI-to-act tip, and VC-719 needs a two-human meta.
- VC-711's `submitMove` half added to `submit.test.ts` (carry-over, as instructed).
- Extra cases: `moveId` non-string, `version '0'`, `version MAX_COMMIT_VERSION − 1` passes validation; stale-by-one; the VC-719 committing seat still gets its retry; an FR-719 match race (same request, different clocks); per-move counts over a whole game; secrets also cover `getUpdate(since 0)` at game over.
- Behaviour choice covered by P-7 (not new): the race-path `loadLatest` maps `GameNotFoundError` → `GameNotFound` (D-014).

## Gotchas

- Two copies of the same request write identical bytes (fixed clock, deterministic AI), so `state.commit` succeeds for both and the FR-719 match path is not reached; use two services with different `now` to reach it.
- In `ai-loop-mock.test.ts`, `createGame` also calls the mocked `runAiLoop`: `mockClear()` after setup before counting calls.
- TypeScript rejects `{ name: e.name, message: e.message, ...e }` (TS2783, own fields overwrite); write `{ ...e, name: e.name, message: e.message }`.
- The head-write-failing race still needs `barrierOnCommitPut(2)`: without it the loser's `loadLatest` probes past the stale head and takes the stale (FR-714) path instead of the race path.
- With fewer than 2 legal moves for seat 0 (e.g. a restricted 1-card bid), "different moves" races are impossible: the race tests advance the game until there are ≥ 2.

## For the next iteration

- Iteration 4 is docs only (`docs/design.md` §9, `docs/architecture.md` §10, `docs/development.md` new `## 15. Service`, renumber §15 → §16 and cross-references; `docs/implementation.md` stale lines; README only if false). The `submitMove` flow, error table (with intended HTTP status) and test patterns are in `CONTEXT.md`.
- Judge D-001–D-016 as reflected/internal. Server-only errors: `AiLoopLimitError` (full state) and engine/state/storage errors → Phase 8 logs and answers 500.
- Verify-spec commands: the Commands table in `CONTEXT.md` plus `pnpm test:sim && pnpm build` and the plan's Final acceptance test.
- NFR-704 remains to read from CI after the push.
