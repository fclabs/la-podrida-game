# CONTEXT — GameService (Phase 7)

Last updated by: Iteration 3 (`submitMove`, races, final scores, end-to-end checks). Next: Iteration 4 (documentation only: `docs/design.md` §9, `docs/architecture.md` §10, `docs/development.md` new §15 "Service").

## Current state

- Phases 0–6 are complete (domain, engine, score, players + `src/service/{player-view,ai-loop}.ts`, storage, game state). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`; target ES2022), pnpm 10.15.1, Node 24 declared (local Node may be newer: pnpm prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7. `package.json`/lockfile unchanged from `main` (NFR-703).
- **The service code is complete.** `src/service/errors.ts` (Iteration 1), `src/service/replay.ts` (Iteration 1), `src/service/game-service.ts` with `createGame`, `getUpdate` (Iteration 2) and `submitMove` (Iteration 3). Every VC-701–VC-727, VC-729 and VC-731 is covered by tests; VC-728 (docs) and VC-730 (CI) remain.
- **Tests**: `tests/unit/service/` has 15 test files / 202 tests (vitest duration ≈ 0.9 s locally).
- **Full gates (Iteration 3)**: `pnpm typecheck && pnpm lint && pnpm test` exit 0; `pnpm test` 63 passed + 1 skipped files / 1139 passed + 30 skipped tests (≈ 2.8 s).
- Docs (`docs/`) are untouched: Iteration 4 writes them.

## File map

| Path | Contents |
|---|---|
| `src/service/errors.ts` | The seven service errors (P-1, D-001). |
| `src/service/replay.ts` | `replayGame(meta, commits)` (P-9, D-002). Pure; see purity grep below. |
| `src/service/game-service.ts` | `GameService`; types `GameServiceDeps`, `CreateGameRequest`, `CreateGameResult`, `SubmitMoveRequest`. Module-private: constants (`MAX_HUMAN_NAME` 40, `MIN/MAX_AI_COUNT` 2/5, `GAME_ID_BYTES` 16, `SEED_BYTES` 32, `SEAT_TOKEN_BYTES` 32, `MAX_MOVE_ID` 32, `MAX_CLIENT_REQUEST_ID` 128, `MISSED_EVENTS_CONCURRENCY` 8), `base32Lower`, `seatTokenHash`, `isIntInRange`, `isStringOfLength`, `isSameRequest`, `mapLimit`, interface `AuthenticatedGame`. |
| `src/service/player-view.ts`, `src/service/ai-loop.ts` | Phase 4 helpers `buildPlayerView`, `runAiLoop`, `AiLoopLimitError`. **Never modify.** |
| `tests/unit/service/errors.test.ts`, `replay.test.ts` | P-1 messages; VC-723 on a chain built without the service; VC-724. |
| `tests/unit/service/create.test.ts` | VC-701, VC-702, VC-703 (unmocked, 16 combos), VC-704, VC-705, VC-706, VC-707, VC-708 `createGame` order. |
| `tests/unit/service/create-preset-mock.test.ts` | Mocks `@/src/domain/presets`. VC-703 mocked half; VC-721 (switched `getPreset` after creation; `submitMove` keeps stored rules/handPlan and never calls `getPreset`). |
| `tests/unit/service/auth.test.ts` | VC-708 `getUpdate` cases, VC-709, VC-710 (wrong / other game's token), VC-711 `getUpdate` part. |
| `tests/unit/service/auth-crypto.test.ts` | Mocks `node:crypto`. VC-710 `timingSafeEqual` call counts on a 2-human meta. |
| `tests/unit/service/get-update.test.ts` | VC-712 (incl. race), NFR-702 `getUpdate` counts, VC-729 `getUpdate` first round, `barrierOnCommitPut` self-check. |
| `tests/unit/service/submit.test.ts` | VC-708 `submitMove` order cases, VC-711 `submitMove` part, VC-713, VC-716, VC-717, VC-718, VC-719, VC-726. |
| `tests/unit/service/concurrency.test.ts` | VC-720: different moves raced, same request raced, same request with different bytes (FR-719 match), head write failing, phantom `CommitConflictError`, generic put error. |
| `tests/unit/service/full-game.test.ts` | VC-714, VC-715 (incl. failing `final.json` put), VC-723 on a service-played game. |
| `tests/unit/service/ai-loop-mock.test.ts` | Mocks `@/src/service/ai-loop`. VC-722, VC-731 (loop throws on create; `GameExistsError` on id collision). |
| `tests/unit/service/secrets.test.ts` | VC-725 (a), (b) and R-033 over a full game, the VC-716 rejections, VC-717 conflicts, a VC-718 retry and a VC-720 race conflict. |
| `tests/unit/service/io-budget.test.ts` | VC-729 `submitMove` (8; final move 9), stale 409 (8 + 2·(t − v − 1)), `createGame` (4 puts, 0 reads), `submitMove` 4-pending first round. |
| `tests/unit/service/support/service-fixtures.ts` | `FIXED_NOW`, `ServiceOverrides`, `makeService`, `scriptedBytes`, `byteRange`, `firstLegalMoveId`, `playToEnd`, `sha256Hex`, `HandmadeGameOptions`, `storeHandmadeGame`. |
| `tests/unit/service/support/gated-store.ts` | `GatedStore` (P-10, D-010). |
| `tests/unit/service/support/replay-fixtures.ts` | `chainSeats()`, `StoredChainOptions`, `buildStoredChain(opts)` (D-003). |
| `tests/unit/state/support/{fixtures,store-wrappers}.ts` | Phase 6 helpers (`GAME_ID`, `CREATED_AT`, `makeMeta`, …; `RecordingStore`, `StoreHooks`). **Never modify; import them.** |
| `tests/sim/harness.ts` | `replay` / `moveIdOf`: the reference algorithm `replayGame` follows. |

## Public interfaces

```ts
// src/service/errors.ts — each extends Error, sets this.name (P-1)
VersionConflict(update)            // → 409; `Version conflict: the game is at version <update.version>`
IllegalMove(moveId, reason)        // → 422; reason 'game-over' | 'unknown-move'; `Illegal move "<moveId>": <reason>`
NotYourTurn(seat)                  // → 403; `Not your turn (seat <seat>)`
Unauthorized()                     // → 401; `Unauthorized`
GameNotFound(gameId)               // → 404; field and message hold gameId.slice(0, 64)
InvalidRequest(reason)             // → 400; reason ∈ humanName | aiCount | rulesPreset | sinceVersion | version | moveId | clientRequestId
GameUnsupported(gameId, engineVersion) // → Phase 8 decides (proposed 410)

// src/service/replay.ts
export function replayGame(meta: GameMeta, commits: readonly Commit[]): GameState[];

// src/service/game-service.ts
export interface GameServiceDeps { state: GameStateManager; defaultPresetId?: PresetId; now?: () => Date; randomBytes?: (n: number) => Uint8Array }
export interface CreateGameRequest { rulesPreset?: string; humanName: string; aiCount: number }
export interface CreateGameResult { gameId: string; seat: number; seatToken: string; update: PlayerUpdate }
export interface SubmitMoveRequest { version: number; moveId: string; clientRequestId: string }
export class GameService {
  constructor(deps: GameServiceDeps);           // stores deps; no I/O
  createGame(req): Promise<CreateGameResult>;   // 4 puts (marker, meta, commit 0, head), 0 reads
  getUpdate(gameId, seatToken, sinceVersion?): Promise<PlayerUpdate>;  // 6 calls (+2 per missed commit before the tip)
  submitMove(gameId, seatToken, req): Promise<PlayerUpdate>;           // 8 calls (+1 put at game over)
}
```

**`submitMove` flow (P-8, D-013, D-014):**
1. `#validateIdAndToken` (FR-706 steps 1–2), then `#validateSubmit(req)` (FR-713: `version` int 0…`MAX_COMMIT_VERSION − 1`, `moveId` string 1–32, `clientRequestId` string 1–128; first failure wins).
2. `#loadAndAuthenticate` → `{ tip, seat }` (FR-707–FR-709).
3. `req.version !== tip.version` → if `req.version < t`, `state.load(req.version + 1)`; `isSameRequest` (same `clientRequestId` and `actorSeat === seat`) → that commit's update with its events (no write). Otherwise `VersionConflict(#update(tip, seat, #missedEvents(req.version, tip)))`. The retry-check load is not reused for missed events (NFR-702). Its errors propagate.
4. `#applyHumanMove` (engine `IllegalMoveError` `not-your-turn` → `NotYourTurn(seat)`; `game-over`/`unknown-move` → `IllegalMove(moveId, reason)`), `runAiLoop(human.state, createPlayers(human.state.seats))` (its errors propagate), body with `state = { ...loop.state, version }` and `scoreboard = evaluate(state)`.
5. `state.commit`: `CommitConflictError` → `#resolveRace` (load `v + 1`; `CommitNotFoundError` = no match; match → winner's update, no `final.json`; else `loadLatest` (state `GameNotFoundError` → `GameNotFound`) and `VersionConflict` with missed events from `req.version`). Other errors propagate.
6. `phase === 'game-over'` → `await state.writeFinalScores(gameId, version, scoreboard)` (never rejects on storage errors). Return `#update(committed, seat, committed.events)`.

**Test support API:**
```ts
// tests/unit/service/support/service-fixtures.ts
export const FIXED_NOW: Date;  // 2026-11-23T14:05:00.000Z
export type ServiceOverrides = Partial<Omit<GameServiceDeps, 'state'>>;
export function makeService<S extends ObjectStore = RecordingStore>(store?: S, overrides?: ServiceOverrides)
  : { service: GameService; state: GameStateManager; store: S };
//   default store = new RecordingStore(new MemoryObjectStore()); now = () => FIXED_NOW; real randomness
export function scriptedBytes(seq): (n: number) => Uint8Array;  // by call order; draws are 16, 32, 32 (P-2)
export function byteRange(start: number, n: number): Uint8Array;
export function firstLegalMoveId(update: PlayerUpdate): string;
export function playToEnd(service, created): Promise<PlayerUpdate[]>;  // first legal move each time; clientRequestId `play-<n>` (n = commit version)
export function sha256Hex(text: string): string;
export function storeHandmadeGame(state: GameStateManager, opts: { gameId; seats; tokens: (string|null)[]; seed; runLoop?: boolean })
  : Promise<{ meta: GameMeta; commit0: Commit }>;  // default preset, FIXED_NOW; runLoop false keeps an AI to act at the tip

// tests/unit/service/support/gated-store.ts
export class GatedStore implements ObjectStore {
  constructor(inner: ObjectStore);    // starts CLOSED: every call is held
  get pending(): number;  release(): void;  barrierOnCommitPut(n: number): void;
  whenPending(n: number, maxTurns?: number): Promise<void>;  settle(turns?: number): Promise<void>;
}
```

## Conventions & invariants

- **Layer rule** (scaffold): `src/service` may import every layer, `src/config` and Node built-ins except `fs`; nothing outside `src/service` imports it. Enforced by `pnpm lint`.
- **`game-service.ts` greps** (must keep holding): `grep -n "eventsSince"` prints nothing (P-5); exactly one `from 'node:crypto'` line, named imports only (FR-708); R-032 `grep -nE "(^|[^.#[:alnum:]_])randomBytes\(|new Date\(|Math\.random"` matches only the two `deps` default lines (`this.#now = …`, `this.#randomBytes = …`); BR-704 `grep -nE "^\s*(state|\w+)\.version\s*=|\.hand\b.*=" ` prints nothing (the only version assignment is the spread `{ ...loop.state, version }`).
- **Replay purity** (BR-705, P-9): `grep -nE "storage|config|node:|Date|Math\.random|crypto" src/service/replay.ts` prints nothing — comments count.
- **Error messages** (BR-701): only the values in P-1. Non-service errors (`AiLoopLimitError` carries the full state; engine/state/storage errors) are server-only: Phase 8 logs them and answers 500.
- **Protected paths** (plan rule 8): never modify `src/service/player-view.ts`, `src/service/ai-loop.ts`, `src/domain`, `src/engine`, `src/score`, `src/players`, `src/state`, `src/storage`, `src/config.ts`, `tests/unit/state/**`, `tests/unit/service/{ai-loop,player-view}.test.ts`, `vitest*.config.ts`, `eslint.config.mjs`, `package.json`, the lockfile. Iteration 4 touches only `docs/`, `README.md` (only if false) and the artifacts.
- **Tests**: header comment names the spec FRs/VCs; one `describe` per VC, titled `VC-7xx …`. Reuse `RecordingStore`/`StoreHooks` and fixtures by relative import. A `RecordingStore` over a plain `MemoryObjectStore` that already holds a game gives a clean call log; or call `store.reset()` after setup.
- **Mocked-module files (P-11)**: one mocked module per file, partial mock delegating to the original, `vi.mocked(ns.fn)` from a namespace import of the same specifier; `mockImplementationOnce` for a one-off failure; `mockClear()` after setup when a test counts calls (setup calls count too).
- **Races** (VC-720): build the game on a plain `MemoryObjectStore`, then wrap it as `GatedStore(RecordingStore(memory, hooks))` and call `barrierOnCommitPut(2)` so both racers load the same tip. Two copies of the same request write identical bytes (fixed `now`, same request, deterministic AI), so `state.commit` treats both as success; to reach the FR-719 match path, give the two services different clocks.
- **Hand-built games**: `storeHandmadeGame` for an AI-to-act tip (`runLoop: false` + a seed where `currentActor !== 0`; tests scan `ai-first-<i>` seeds) and for multi-human metas (VC-719: seats human-0, human-1, ai-2).
- **State facts** (Phase 6): stored (Zod-parsed) documents may differ in nested key order from fresh engine output — compare with `toEqual`. `writeFinalScores` never rejects on storage errors. `state.commit` treats identical bytes at the key as success, different bytes → `CommitConflictError`; a refused put whose key then reads `null` → `CommitConflictError` too.
- **Store call counts** (head exact): `loadMeta` = 1 get; `loadLatest` = 5; `load(v>0)` = 2; `commit` = 1 put + 1 head put; `create` = 4 puts; `writeFinalScores` = 1 put.
- **Formatting**: `pnpm exec prettier --write src/service tests/unit/service` before `pnpm lint`. `docs/` and `specs/` are prettier-ignored.
- **Commits**: one per iteration, staged by explicit path, message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge.

## Commands

All with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed (no network). In zsh, write the prefix literally; a `$E pnpm …` variable is not word-split and fails with "command not found".

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/service --reporter verbose` | Service unit tests (15 files, 202 tests, ≈ 0.9 s). |
| `pnpm vitest run tests/unit/service/submit.test.ts tests/unit/service/concurrency.test.ts` | `submitMove` paths and races. |
| `pnpm vitest run tests/unit/service/full-game.test.ts tests/unit/service/secrets.test.ts tests/unit/service/io-budget.test.ts` | End-to-end, secrets, call budgets. |
| `pnpm vitest run tests/unit/service --reporter json --outputFile <scratch>/service.json` | Per-file durations. Without `--outputFile` the JSON reporter writes `.vitest/json/output.json`, which breaks `prettier --check`: delete it. |
| `git diff main -- src/service/player-view.ts src/service/ai-loop.ts src/domain src/engine src/score src/players src/state src/storage` | VC-727: empty. |
| `grep -nE "storage\|config\|node:\|Date\|Math\.random\|crypto" src/service/replay.ts` | Replay purity: prints nothing. |
| `grep -nE "(^\|[^.#[:alnum:]_])randomBytes\(\|new Date\(\|Math\.random" src/service/game-service.ts` | R-032: only the `deps` default lines. |
| `grep -n "eventsSince" src/service/game-service.ts` | P-5: prints nothing. |
| `git diff main -- package.json pnpm-lock.yaml` | NFR-703: empty. |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Gates. |
| `pnpm test:sim` / `pnpm build` | Simulation suite (≈ 45 s) and production build; Final Verification only. |

## Known gaps

- Docs (FR-725, VC-728) are Iteration 4: `docs/design.md` §9, `docs/architecture.md` §10, `docs/development.md` `## 15. Service` (renumber Known limitations to §16 and every `§15` cross-reference).
- NFR-704 (< 20 s for `tests/unit/service` in CI) is read from CI after the push; locally ≈ 0.9 s.
- `pnpm test:sim` and `pnpm build` have not been run in this phase yet (Final Verification).
- Edges the spec leaves to propagation (by P-7): a `CommitNotFoundError`/`GameNotFoundError` from the FR-714 retry-check `load` (only after an external delete) and a `GameNotFoundError` from the FR-719 `load` propagate as state errors (Phase 8 → 500). Only the race-path `loadLatest` maps `GameNotFoundError` → `GameNotFound` (D-014).
- One human seat per game from `createGame`; multi-human games work in auth and retries (VC-710, VC-719) but are only built by tests.
