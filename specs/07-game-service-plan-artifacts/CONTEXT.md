# CONTEXT — GameService (Phase 7)

Last updated by: Iteration 4 (documentation). The phase is complete: code, tests and docs are shipped on branch `spec/07-game-service`. Remaining: push, CI (NFR-704 read from the CI "Test" step), verify-spec, PR — all done by the orchestrator.

## Current state

- Phases 0–7 are complete (domain, engine, score, players + `src/service/{player-view,ai-loop}.ts`, storage, game state, **game service**). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`; target ES2022), pnpm 10.15.1, Node 24 declared (local Node may be newer: pnpm prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7. `package.json`/lockfile unchanged from `main` (NFR-703).
- **Service code**: `src/service/errors.ts` (seven errors), `src/service/replay.ts` (`replayGame`), `src/service/game-service.ts` (`GameService`: `createGame`, `getUpdate`, `submitMove`). Every VC-701–VC-731 is covered: VC-701–VC-727, VC-729, VC-731 by tests and greps; VC-728 by the docs greps and the cross-reference check; VC-730 locally (gates, empty package diff) with NFR-704 to be read in CI.
- **Tests**: `tests/unit/service/` has 15 test files / 202 tests (≈ 0.9 s locally). Full `pnpm test`: 63 passed + 1 skipped files, 1139 passed + 30 skipped tests (≈ 2.8 s). `pnpm test:sim`: 5 files, 3,605 tests (≈ 45 s). `pnpm build` passes.
- **Docs (shipped)**: `docs/design.md` §9 (interface, deps, seven errors, `createGame` steps, auth, missed events, `submitMove` steps 1–9 with retry/race/final scores, `replayGame`), §7 replay pointer; `docs/architecture.md` §4.2 layout, §5 I/O counts, §6.3 item 5 step reference, §10 errors + server-only errors + replay debugging; `docs/development.md` new `## 15. Service` (§15.1–§15.11), `## 16. Known limitations` (renumbered), stale lines fixed in §2, §10.8, §12, §12.8, §14.12; `docs/implementation.md` Phase 7 tasks (seven errors, `getUpdate`/`since`, race reload, `replayGame`); `README.md` status paragraph.

## File map

| Path | Contents |
|---|---|
| `src/service/errors.ts` | `VersionConflict(update)`, `IllegalMove(moveId, reason)`, `NotYourTurn(seat)`, `Unauthorized()`, `GameNotFound(gameId)` (clipped to 64), `InvalidRequest(reason)`, `GameUnsupported(gameId, engineVersion)` (D-001). |
| `src/service/replay.ts` | `replayGame(meta, commits)` (D-002). Pure; see purity grep. |
| `src/service/game-service.ts` | `GameService`; types `GameServiceDeps`, `CreateGameRequest`, `CreateGameResult`, `SubmitMoveRequest`. Module-private constants (`MAX_HUMAN_NAME` 40, `MIN/MAX_AI_COUNT` 2/5, `GAME_ID_BYTES` 16, `SEED_BYTES` 32, `SEAT_TOKEN_BYTES` 32, `MAX_MOVE_ID` 32, `MAX_CLIENT_REQUEST_ID` 128, `MISSED_EVENTS_CONCURRENCY` 8), `base32Lower`, `seatTokenHash`, `isIntInRange`, `isStringOfLength`, `isSameRequest`, `mapLimit`. Private methods `#validateCreate`, `#validateIdAndToken`, `#validateSubmit`, `#applyHumanMove`, `#resolveRace`, `#loadAndAuthenticate`, `#authenticate`, `#missedEvents`, `#update`. |
| `src/service/player-view.ts`, `src/service/ai-loop.ts` | Phase 4 helpers `buildPlayerView`, `runAiLoop`, `AiLoopLimitError`. Never modified in this phase. |
| `tests/unit/service/*.test.ts` | `errors`, `replay`, `create`, `create-preset-mock` (mocks presets), `auth`, `auth-crypto` (mocks `node:crypto`), `get-update`, `submit`, `concurrency`, `full-game`, `ai-loop-mock` (mocks ai-loop), `secrets`, `io-budget`; plus Phase 4's `player-view`, `ai-loop`. VC → file map: `iterations/03-submit-move.md`. |
| `tests/unit/service/support/service-fixtures.ts` | `FIXED_NOW`, `ServiceOverrides`, `makeService`, `scriptedBytes`, `byteRange`, `firstLegalMoveId`, `playToEnd`, `sha256Hex`, `HandmadeGameOptions`, `storeHandmadeGame`. |
| `tests/unit/service/support/gated-store.ts` | `GatedStore` (D-010). |
| `tests/unit/service/support/replay-fixtures.ts` | `chainSeats()`, `StoredChainOptions`, `buildStoredChain(opts)` (D-003). |
| `tests/unit/state/support/{fixtures,store-wrappers}.ts` | Phase 6 helpers (`RecordingStore`, `StoreHooks`, `makeMeta`, …). Imported, never modified. |
| `docs/design.md` §9, `docs/architecture.md` §10, `docs/development.md` §15 | The shipped documentation of the service. |

## Public interfaces

```ts
// src/service/game-service.ts
export interface GameServiceDeps { state: GameStateManager; defaultPresetId?: PresetId; now?: () => Date; randomBytes?: (n: number) => Uint8Array }
export interface CreateGameRequest { rulesPreset?: string; humanName: string; aiCount: number }
export interface CreateGameResult { gameId: string; seat: number; seatToken: string; update: PlayerUpdate }
export interface SubmitMoveRequest { version: number; moveId: string; clientRequestId: string }
export class GameService {
  constructor(deps: GameServiceDeps);           // stores deps; no I/O, no config read
  createGame(req): Promise<CreateGameResult>;   // 4 puts, 0 reads
  getUpdate(gameId, seatToken, sinceVersion?): Promise<PlayerUpdate>;  // 6 calls (+2 per commit strictly between since and tip)
  submitMove(gameId, seatToken, req): Promise<PlayerUpdate>;           // 8 calls (+1 put at game over); stale 409: 8 + 2·(t − v − 1)
}

// src/service/errors.ts — each extends Error, sets this.name; messages hold only these fields
VersionConflict(update) · IllegalMove(moveId, 'game-over' | 'unknown-move') · NotYourTurn(seat) · Unauthorized()
GameNotFound(gameId /* ≤ 64 chars */) · InvalidRequest(reason) · GameUnsupported(gameId, engineVersion)
// InvalidRequest.reason ∈ humanName | aiCount | rulesPreset | sinceVersion | version | moveId | clientRequestId

// src/service/replay.ts
export function replayGame(meta: GameMeta, commits: readonly Commit[]): GameState[];  // RangeError('Invalid commits: …'), then GameUnsupported
```

**Behaviour summary** (full text: `docs/design.md` §9, `docs/development.md` §15):
- Input checks before any I/O, first failure wins. `createGame`: `humanName` (trim, 1–40 UTF-16 units) → `aiCount` (int 2–5) → `rulesPreset` (present: string + known) → `aiCount + 1` in preset range. `getUpdate`/`submitMove`: malformed id → `GameNotFound`; empty/non-string token → `Unauthorized`; then `sinceVersion` (int 0…`MAX_COMMIT_VERSION`) or `version` (int 0…`MAX_COMMIT_VERSION − 1`) → `moveId` (1–32) → `clientRequestId` (1–128).
- `Promise.all([loadMeta, loadLatest])` → constant-time auth over every non-null hash → `engineVersion` check (`GameUnsupported`).
- `submitMove`: stale → retry check on commit `v + 1` (same `clientRequestId` and `actorSeat`) → original result, else `VersionConflict(tip, missed events from v)`; apply (`NotYourTurn` / `IllegalMove`); `runAiLoop(createPlayers(state.seats))`; commit `v + 1`; `CommitConflictError` → `#resolveRace` (re-read `v + 1`: match → winner's result; else `loadLatest` → `VersionConflict`; `GameNotFoundError` there → `GameNotFound`, D-014); game over → `writeFinalScores`; return.
- Missed events: commits `from+1 … tip−1` via `state.load` (≤ 8 in flight) + tip's own events; never `eventsSince`.

## Conventions & invariants

- **Layer rule** (scaffold): `src/service` may import every layer, `src/config` and Node built-ins except `fs`; nothing in `src/` imports it. The service does not read config: the caller passes `defaultPresetId`.
- **Greps that must keep holding**: `grep -n "eventsSince" src/service/game-service.ts` → nothing; exactly one named `from 'node:crypto'` import line; R-032 `grep -nE "(^|[^.#[:alnum:]_])randomBytes\(|new Date\(|Math\.random" src/service/game-service.ts` → only lines 172–173 (the `deps` defaults); `grep -nE "storage|config|node:|Date|Math\.random|crypto" src/service/replay.ts` → nothing (comments count).
- **Secrets (BR-701)**: seed, token hashes, other hands, stock and `aiDecisionCount` never in a returned value or a service error; the token only in `createGame`'s result. Non-service errors (`AiLoopLimitError` carries the full state; engine/state/storage errors) are server-only.
- **Tests**: one `describe` per VC, titled `VC-7xx …`; reuse `RecordingStore`/`StoreHooks` by relative import; one mocked module per file (partial mock delegating to the original, `vi.mocked(ns.fn)`, `mockClear()` after setup when counting).
- **Races**: build on a plain `MemoryObjectStore`, then `GatedStore(RecordingStore(memory))` + `barrierOnCommitPut(2)`. Identical requests with the same clock write identical bytes (both succeed in the state layer); different clocks reach the FR-719 match path. The head-write-failing race needs the barrier too.
- **Docs**: `docs/` and `specs/` are prettier-ignored; `README.md` is not (run `pnpm exec prettier --check README.md`). Docs never reference specs, plans, VCs, iterations or SHAs.
- **Commits**: one per iteration, staged by explicit path, message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge.

## Commands

All with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed (no network). In zsh, write the prefix literally (a variable holding it is not word-split).

| Command | What it does |
|---|---|
| `sh -c 'pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm test:sim && pnpm build'` | Full gates (≈ 1.5 min; sim ≈ 45 s). |
| `pnpm vitest run tests/unit/service --reporter verbose` | Service tests (15 files, 202 tests, ≈ 0.9 s). |
| `pnpm vitest run tests/unit/service --reporter json --outputFile <scratch>/service.json` | Per-file durations (never let it write `.vitest/json/output.json` into the repo: breaks `prettier --check`). |
| `git diff main -- src/service/player-view.ts src/service/ai-loop.ts src/domain src/engine src/score src/players src/state src/storage` | VC-727: empty. |
| `git diff main -- package.json pnpm-lock.yaml` | NFR-703: empty. |
| `grep -n "GameUnsupported" docs/design.md docs/architecture.md docs/development.md` | VC-728: matches in all three. |
| `grep -n "^## " docs/development.md \| sed -n '/14\./,/16\./p'` | VC-728: 14 Game state, 15 Service, 16 Known limitations. |

## Known gaps

- **NFR-704** is read from CI after the push: the `tests/unit/service` file durations in the "Test" step must sum to < 20 s (locally ≈ 0.9 s).
- **External deletes mid-request** (retention only): the FR-714 retry-check `load` and the FR-719 re-read propagate state errors (`CommitNotFoundError`/`GameNotFoundError` → 500); only the race-path `loadLatest` maps to `GameNotFound` (D-014). Documented in `development.md` §15.11.
- **One human seat** from `createGame`; multi-human games work in auth and retries but are only built by tests. Only the `random` AI.
- An invalid *configured* default preset propagates `UnknownPresetError` (D-006); the config schema prevents it.
- `docs/implementation.md` Phase 8 "Done when" still says `?since` ahead of the current version → 400, while the service answers `events: []` for `since ≥ tip` (spec FR-711). Phase 8 must decide (see hand-off); the line was left as Phase 8's plan.

## Hand-off to Phase 8

**Constructing the service from config** (once per function instance, no I/O in the constructor):

```ts
const config = getConfig();
const service = new GameService({
  state: new GameStateManager(createObjectStore(config)),
  defaultPresetId: config.defaultRulesPreset,   // same union as PresetId
});
```
This is also the first caller of `getConfig()`, which closes the "configuration not validated at startup" limitation (`development.md` §16).

**Error → status** (one mapping function; body `{ error: { code, message } }`, `Cache-Control: no-store`):

| Service error | Status | `code` | Body extras |
|---|---|---|---|
| `InvalidRequest` | 400 | `invalid_request` | `reason` may be exposed (a field name) |
| `Unauthorized` | 401 | `unauthorized` | – |
| `NotYourTurn` | 403 | `not_your_turn` | – |
| `GameNotFound` | 404 | `game_not_found` | – |
| `VersionConflict` | 409 | `version_conflict` | `update` (already safe: built by `buildPlayerView`) |
| `IllegalMove` | 422 | `illegal_move` | – |
| `GameUnsupported` | **to decide** (proposed 410, code e.g. `game_unsupported`); add the row to `architecture.md` §7 | – |
| anything else | 500 | `internal` | nothing from the error |

**Server-only errors**: `AiLoopLimitError` (its `state` is the full game: every hand and the seed), `GameExistsError`, engine `IllegalMoveError`/`RangeError` from inside the loop, state errors (`CommitNotFoundError`, `InvalidCommitError`, `CorruptObjectError`, …) and storage errors. Log them (with stack, never tokens or hands), answer 500, never serialize message or fields.

**What the API still validates with Zod** (the service re-checks as a second line of defence):
- `Authorization: Bearer <seatToken>`: missing/malformed → 401 before calling the service (the service only sees the raw token string).
- `POST /api/games`: `{ rulesPreset?: string, humanName: string (≤ 40 after trim), aiCount: int 2–5 }`, strict (reject any `seed` or unknown field).
- `GET /api/games/{id}`: `id` format (`^[a-z2-7]{26}$`; else 404 like the service); `?since` a non-negative integer string → number. Decide whether `since` > current version stays `events: []` (service behaviour) or becomes 400 as `implementation.md` Phase 8 currently says — 400 would need the tip version, i.e. a check after the service call.
- `POST /api/games/{id}/moves`: `{ version: int ≥ 0, moveId: string 1–32, clientRequestId: string 1–128 }`, strict.
- Strict response schemas for `PlayerUpdate` and the create result.

**Retry semantics for clients**: resend a move with the same `clientRequestId` after a timeout → original result (200) even after later commits; a new `clientRequestId` from an old version → 409 with the fresh update.
