# CONTEXT — GameService (Phase 7)

Last updated by: Iteration 2 (`GameService` creation, authentication and updates). Next: Iteration 3 (`submitMove`, races, final scores, end-to-end checks).

## Current state

- Phases 0–6 are complete (domain, engine, score, players + `src/service/{player-view,ai-loop}.ts`, storage, game state). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`; target ES2022), pnpm 10.15.1, Node 24 declared (local Node may be newer: pnpm prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7. `package.json`/lockfile unchanged from `main` (NFR-703).
- **Iteration 1 shipped** `src/service/errors.ts` (seven service errors, P-1) and `src/service/replay.ts` (`replayGame`, P-9).
- **Iteration 2 shipped** `src/service/game-service.ts`: `GameService` with the constructor (FR-700), `createGame` (FR-701–FR-705) and `getUpdate` (FR-706–FR-711, FR-716), plus the private machinery `submitMove` will reuse. **`submitMove` is a stub** (`throw new Error('not implemented')`, lines ≈ 202–212); no test calls it.
- **Tests**: `tests/unit/service/` has 9 test files / 136 tests (≈ 0.7 s): Phase 4 `ai-loop.test.ts`, `player-view.test.ts` (never edit); Iteration 1 `errors.test.ts`, `replay.test.ts`; Iteration 2 `create.test.ts`, `create-preset-mock.test.ts`, `auth.test.ts`, `auth-crypto.test.ts`, `get-update.test.ts`.
- **Full gates (Iteration 2)**: `pnpm typecheck && pnpm lint && pnpm test` exit 0; `pnpm test` 57 passed + 1 skipped files / 1073 passed + 30 skipped tests (≈ 2.6 s).
- Docs are untouched until Iteration 4.

## File map

| Path | Contents |
|---|---|
| `src/service/errors.ts` | The seven service errors (P-1, D-001). |
| `src/service/replay.ts` | `replayGame(meta, commits)` (P-9, D-002). Pure; see purity grep below. |
| `src/service/game-service.ts` | `GameService`; types `GameServiceDeps`, `CreateGameRequest`, `CreateGameResult`, `SubmitMoveRequest`. Module-private: constants (`MAX_HUMAN_NAME` 40, `MIN/MAX_AI_COUNT` 2/5, `GAME_ID_BYTES` 16, `SEED_BYTES` 32, `SEAT_TOKEN_BYTES` 32, `MISSED_EVENTS_CONCURRENCY` 8), `base32Lower`, `seatTokenHash`, `isIntInRange`, `mapLimit`, interface `AuthenticatedGame`. |
| `src/service/player-view.ts`, `src/service/ai-loop.ts` | Phase 4 helpers `buildPlayerView`, `runAiLoop`, `AiLoopLimitError`. **Never modify.** |
| `tests/unit/service/errors.test.ts`, `replay.test.ts` | Iteration 1 (P-1 messages; VC-723 on a chain built without the service, VC-724). |
| `tests/unit/service/create.test.ts` | VC-701, VC-702, VC-703 (unmocked, 16 combos), VC-704 (100 real games + base32 literal), VC-705, VC-706 (50 scripted seeds), VC-707, VC-708 `createGame` order. |
| `tests/unit/service/create-preset-mock.test.ts` | Mocks `@/src/domain/presets` (`getPreset`). VC-703 mocked half (`players { min: 3, max: 4 }`). Iteration 3 adds VC-721 here. |
| `tests/unit/service/auth.test.ts` | VC-708 `getUpdate` order cases, VC-709, VC-710 (wrong / other game's token), VC-711 (`getUpdate` part). |
| `tests/unit/service/auth-crypto.test.ts` | Mocks `node:crypto` (`timingSafeEqual`, delegating). VC-710 call counts on a 3-seat, 2-human meta written with `GameStateManager.create`. |
| `tests/unit/service/get-update.test.ts` | VC-712 (incl. the race), NFR-702 `getUpdate` counts, VC-729 `getUpdate` 4-pending first round, a `barrierOnCommitPut` self-check. Local helpers `nextBody(prev)`, `gameAtTip(memory, tip)`, `recordedGameAtTip(tip)`. |
| `tests/unit/service/support/service-fixtures.ts` | `FIXED_NOW`, `ServiceOverrides`, `makeService`, `scriptedBytes`, `byteRange`, `firstLegalMoveId`. (`playToEnd` is added in Iteration 3.) |
| `tests/unit/service/support/gated-store.ts` | `GatedStore` (P-10). |
| `tests/unit/service/support/replay-fixtures.ts` | `chainSeats()`, `StoredChainOptions`, `buildStoredChain(opts)` (D-003). |
| `tests/unit/state/support/{fixtures,store-wrappers}.ts` | Phase 6 helpers (`GAME_ID`, `HUMAN_HASH`, `CREATED_AT`, `makeMeta`, …; `RecordingStore`, `StoreHooks`). **Never modify; import them.** |
| `tests/sim/harness.ts` | `replay` / `moveIdOf`: the reference algorithm `replayGame` follows. |

## Public interfaces

```ts
// src/service/errors.ts — each extends Error, sets this.name (P-1)
VersionConflict(update)            // `Version conflict: the game is at version <update.version>`
IllegalMove(moveId, reason)        // reason 'game-over' | 'unknown-move'; `Illegal move "<moveId>": <reason>`
NotYourTurn(seat)                  // `Not your turn (seat <seat>)`
Unauthorized()                     // `Unauthorized`
GameNotFound(gameId)               // field and message hold gameId.slice(0, 64)
InvalidRequest(reason)             // reason ∈ humanName | aiCount | rulesPreset | sinceVersion | version | moveId | clientRequestId
GameUnsupported(gameId, engineVersion)

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
  getUpdate(gameId, seatToken, sinceVersion?): Promise<PlayerUpdate>;
  submitMove(gameId, seatToken, req): Promise<PlayerUpdate>;  // STUB — Iteration 3
}
```

**Private helpers for Iteration 3 (reuse, do not duplicate):**
- `#validateIdAndToken(gameId, seatToken): void` — FR-706 steps 1–2. `assertValidGameId` failure (`InvalidGameIdError`) → `GameNotFound(gameId)` (non-string id → `String(gameId)`, D-009); token not a non-empty string → `Unauthorized`. Call it first, then the method's own checks (FR-713 for `submitMove`).
- `async #loadAndAuthenticate(gameId, seatToken): Promise<{ meta, tip, seat }>` — `Promise.all([state.loadMeta, state.loadLatest])`; state `GameNotFoundError` → `GameNotFound`, others propagate; then `#authenticate`; then `meta.engineVersion !== ENGINE_VERSION` → `GameUnsupported(gameId, meta.engineVersion)`. `tip` is the `Commit`; `tip.version` is the tip version `t`.
- `#authenticate(meta, seatToken): number` — P-3 loop over every non-null hash with `timingSafeEqual`, first match wins, no early exit; none → `Unauthorized`.
- `async #missedEvents(gameId, from, tip: Commit): Promise<GameEvent[]>` — P-5: `[]` when `from ≥ tip.version`; else `state.load` of `from+1 … tip.version−1` via `mapLimit(…, 8, …)`, then `tip.events`. `load` errors propagate. Each `load` = 2 store calls.
- `#update(commit, seat, events): PlayerUpdate` — P-6; the only builder of returned updates (use for `VersionConflict.update` too).
- `#validateCreate(req)` — FR-701 (createGame only).
- Module-level `mapLimit(items, limit, fn)`, `isIntInRange(value, min, max)` (use it for FR-713 `version`: `isIntInRange(v, 0, MAX_COMMIT_VERSION - 1)`).
- Imports already present: `createGame`, `ENGINE_VERSION`, `legalMoves` (engine); `GameNotFoundError`, `InvalidGameIdError` (state errors); `assertValidGameId`, `MAX_COMMIT_VERSION` (keys); `Commit`, `CommitBody`, `GameMeta` types; `runAiLoop` from `./ai-loop`; `createPlayers`; `evaluate`; `buildPlayerView`; `GameNotFound`, `GameUnsupported`, `InvalidRequest`, `Unauthorized`. Iteration 3 adds `applyMove`, `IllegalMoveError`, `CommitConflictError`, `CommitNotFoundError`, `VersionConflict`, `IllegalMove`, `NotYourTurn`.

**Test support API:**
```ts
// tests/unit/service/support/service-fixtures.ts
export const FIXED_NOW: Date;  // 2026-11-23T14:05:00.000Z
export type ServiceOverrides = Partial<Omit<GameServiceDeps, 'state'>>;
export function makeService<S extends ObjectStore = RecordingStore>(store?: S, overrides?: ServiceOverrides)
  : { service: GameService; state: GameStateManager; store: S };
//   default store = new RecordingStore(new MemoryObjectStore()); now = () => FIXED_NOW; real randomness
export function scriptedBytes(seq: ReadonlyArray<Uint8Array | readonly number[]>): (n: number) => Uint8Array;
//   k-th call returns a copy of seq[k]; throws if exhausted or if n ≠ seq[k].length. Calls are 16, 32, 32 (P-2).
export function byteRange(start: number, n: number): Uint8Array;  // start, start+1, … mod 256
export function firstLegalMoveId(update: PlayerUpdate): string;

// tests/unit/service/support/gated-store.ts
export class GatedStore implements ObjectStore {
  constructor(inner: ObjectStore);    // starts CLOSED: every call is held
  readonly inner: ObjectStore;
  get pending(): number;              // calls currently held
  release(): void;                    // resumes held calls and OPENS the gate (later calls pass)
  barrierOnCommitPut(n: number): void;// opens the gate; holds only create-only puts whose key contains
                                      // '/commits/' until n are held, then resumes them together (one-shot)
  whenPending(n: number, maxTurns?: number): Promise<void>;  // waits (setImmediate turns) until ≥ n held
  settle(turns?: number): Promise<void>;                     // lets a few macrotask turns pass
}
```

## Conventions & invariants

- **Layer rule** (scaffold): `src/service` may import every layer, `src/config` and Node built-ins except `fs`; nothing outside `src/service` imports it. Enforced by `pnpm lint`.
- **`game-service.ts` greps** (must keep holding): `grep -n "eventsSince"` prints nothing (P-5); exactly one `from 'node:crypto'` line, named imports only (FR-708); R-032 `grep -nE "(^|[^.#[:alnum:]_])randomBytes\(|new Date\(|Math\.random"` matches only the two `deps` default lines in the constructor (`this.#now = …` and `this.#randomBytes = …`). Never write `new Date(` or a bare `randomBytes(` anywhere else in the file, comments included; call the private field as `this.#randomBytes(n)`.
- **Replay purity** (BR-705, P-9): `grep -nE "storage|config|node:|Date|Math\.random|crypto" src/service/replay.ts` prints nothing — comments count.
- **Error messages** (BR-701): only the values in P-1. Non-service errors (`AiLoopLimitError`, engine/state/storage errors) may carry secrets and are server-only.
- **Protected paths** (plan rule 8): never modify `src/service/player-view.ts`, `src/service/ai-loop.ts`, `src/domain`, `src/engine`, `src/score`, `src/players`, `src/state`, `src/storage`, `src/config.ts`, `tests/unit/state/**`, `tests/unit/service/{ai-loop,player-view}.test.ts`, `vitest*.config.ts`, `eslint.config.mjs`, `package.json`, the lockfile. Iteration 2 test files are edited by Iteration 3 only where the plan says (`create-preset-mock.test.ts` for VC-721; `service-fixtures.ts` for `playToEnd`).
- **Tests**: header comment names the spec FRs/VCs; one `describe` per VC, titled `VC-7xx …`. Reuse `RecordingStore`/`StoreHooks` and fixtures constants by relative import (`../../state/support/...` from `support/`, `../state/support/...` from a test file). A `RecordingStore` wrapping a plain `MemoryObjectStore` that already holds a game gives a clean call log; or call `store.reset()` after setup.
- **Mocked-module files (P-11)**: one mocked module per file, partial mock delegating to the original, then `vi.mocked(ns.fn)` from a namespace import of the same module:
  ```ts
  import * as presets from '@/src/domain/presets';
  vi.mock('@/src/domain/presets', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/src/domain/presets')>();
    return { ...actual, getPreset: vi.fn(actual.getPreset) };
  });
  const getPresetMock = vi.mocked(presets.getPreset);
  ```
  Per-test behaviour via `mockImplementation`; `mockReset()`/`mockClear()` in `afterEach`/`beforeEach`. Use `vi.importActual` to reach the real function inside an implementation. `node:crypto` mocking works the same way (`auth-crypto.test.ts`); it intercepts `game-service.ts`'s named imports.
- **Multi-human meta** (VC-710/VC-719): engine `createGame({ gameId: GAME_ID, rules: getPreset(DEFAULT_PRESET_ID), seats, seed })` with seats `[human-0 'Ana' human, human-1 'Bea' human, ai-2 'AI 2' ai random]`; meta `{ schemaVersion: 1, gameId, presetId, engineVersion: ENGINE_VERSION, createdAt: CREATED_AT, seats, seatTokenHashes: [sha256hex(TOKEN_0), sha256hex(TOKEN_1), null] }`; write with `state.create(meta, { version: 0, at: CREATED_AT, actorSeat: null, clientRequestId: null, events, state, scoreboard: evaluate(state) })`. Human hashes must be 64-hex; AI hashes must be `null` (schema).
- **Advancing a game without `submitMove`** (`get-update.test.ts` `nextBody`): seat 0's first legal move with `applyMove`, then `runAiLoop(human.state, createPlayers(human.state.seats))`, `state = { ...loop.state, version: n }`, committed with `state.commit`.
- **State facts** (Phase 6): validate a body with `CommitSchema.safeParse({ schemaVersion: 1, ...body })`; parsed documents may differ in nested key order from fresh engine output — compare with `toEqual`. `at`/`createdAt` exact `toISOString()`. `writeFinalScores` never rejects on storage errors. `state.commit` treats identical bytes at the key as success, different bytes → `CommitConflictError`.
- **Store call counts** (head exact): `loadMeta` = 1 get; `loadLatest` = 3 (exists meta, exists commit 0, get head) + 2 (get tip, exists tip+1) = 5; `load(v>0)` = 2; `commit` = 1 put + 1 head put; `create` = 4 puts.
- **Formatting**: `pnpm exec prettier --write src/service tests/unit/service` before `pnpm lint`. `docs/` and `specs/` are prettier-ignored.
- **Commits**: one per iteration, staged by explicit path, message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge.

## Commands

All with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed (no network). In zsh, write the prefix literally; a `$E pnpm …` variable is not word-split and fails with "command not found".

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/service` | Service unit tests (9 files, 136 tests, ≈ 0.7 s). |
| `pnpm vitest run tests/unit/service/create.test.ts tests/unit/service/create-preset-mock.test.ts` | Create VCs (44 tests). |
| `pnpm vitest run tests/unit/service/auth.test.ts tests/unit/service/auth-crypto.test.ts` | Auth VCs (17 tests). |
| `pnpm vitest run tests/unit/service/get-update.test.ts` | `getUpdate` VCs and counts (24 tests). |
| `pnpm vitest run tests/unit/service --reporter json --outputFile <scratch>/service.json` | Per-file durations (NFR-704 proxy). Without `--outputFile` the JSON reporter writes `.vitest/json/output.json`, which breaks `prettier --check`: delete it. |
| `grep -n "eventsSince" src/service/game-service.ts` | P-5: prints nothing. |
| `grep -nE "from 'node:crypto'" src/service/game-service.ts` / `grep -nE "import (\* as\|crypto) .*node:crypto" src/service/game-service.ts` | FR-708: one named line / nothing. |
| `grep -nE "(^\|[^.#[:alnum:]_])randomBytes\(\|new Date\(\|Math\.random" src/service/game-service.ts` | R-032: only the `deps` default lines. |
| `grep -nE "storage\|config\|node:\|Date\|Math\.random\|crypto" src/service/replay.ts` | Replay purity: prints nothing. |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Gates. |
| `pnpm test:sim` / `pnpm build` | Simulation suite (≈ 45 s) and production build; Final Verification only. |

## Known gaps

- `submitMove` (FR-712–FR-722) is a stub; Iteration 3 replaces it and adds `playToEnd`.
- VC-711's `submitMove` half (`GameUnsupported` from `submitMove`, no commit added) is not tested yet, and the plan's Iteration 3 test list does not name it explicitly: add it to `submit.test.ts` (Iteration 3).
- VC-729 `submitMove` 4-pending check, the `submitMove`/stale-409/`createGame` NFR-702 counts (`io-budget.test.ts`) and `barrierOnCommitPut` in a real race are Iteration 3. `barrierOnCommitPut` has only a support self-check so far.
- VC-723 on a service-played game, VC-725–VC-727, VC-731: Iteration 3. Docs: Iteration 4.
- NFR-704 (< 20 s for `tests/unit/service` in CI) is read from CI after the push.
