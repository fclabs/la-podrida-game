# CONTEXT — GameService (Phase 7)

Last updated by: Iteration 1 (service errors and persisted replay). Next: Iteration 2 (`GameService` creation, authentication and updates).

## Current state

- Phases 0–6 are complete (domain, engine, score, players + `src/service/{player-view,ai-loop}.ts`, storage, game state). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`; target ES2022), pnpm 10.15.1, Node 24 declared (local Node may be newer: pnpm prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7. `package.json`/lockfile unchanged from `main` (NFR-703).
- **Iteration 1 shipped**: `src/service/errors.ts` (the seven service errors, P-1) and `src/service/replay.ts` (`replayGame`, P-9). Nothing in `src/` uses them yet. `src/service/game-service.ts` does not exist yet (Iteration 2).
- **Tests**: `tests/unit/service/` now has `errors.test.ts` (15 tests), `replay.test.ts` (12 tests), and `support/replay-fixtures.ts`, next to the Phase 4 files `ai-loop.test.ts` and `player-view.test.ts` (unchanged, never edit them).
- **Full gates (Iteration 1)**: `pnpm typecheck && pnpm lint && pnpm test` exit 0; `pnpm test` 52 passed + 1 skipped files / 988 passed + 30 skipped tests (≈ 2.6 s).
- Docs are untouched until Iteration 4.

## File map

| Path | Contents |
|---|---|
| `src/service/errors.ts` | `VersionConflict`, `IllegalMove`, `NotYourTurn`, `Unauthorized`, `GameNotFound`, `InvalidRequest`, `GameUnsupported` (P-1, D-001). Private const `MAX_ECHOED_GAME_ID = 64`. Imports `PlayerUpdate` type from `@/src/domain/types` only. |
| `src/service/replay.ts` | `replayGame(meta, commits)` (P-9, D-002). Imports: `cardId` (`@/src/domain/cards`), type `GameState` (`@/src/domain/types`), `applyMove`, `createGame`, `ENGINE_VERSION` (`@/src/engine/engine`), types `Commit`, `GameMeta` (`@/src/state/schemas`, `import type`), `GameUnsupported` (`./errors`). |
| `src/service/player-view.ts`, `src/service/ai-loop.ts` | Phase 4 helpers `buildPlayerView`, `runAiLoop`, `AiLoopLimitError`. **Never modify.** |
| `tests/unit/service/errors.test.ts` | P-1: each class's `name`, fields, `instanceof Error`, exact message; `GameNotFound` clipping to 64 chars. |
| `tests/unit/service/replay.test.ts` | VC-723 on a chain built without the service (3 seeds to `game-over`, a partial chain, inputs not mutated); VC-724 (`GameUnsupported`; `[]`, `[0,2]`, `[1]`, `[1,0]` → `RangeError` /commits/; commits check before engine check); tampered `card-played` → `IllegalMoveError` `unknown-move`. |
| `tests/unit/service/support/replay-fixtures.ts` | `chainSeats()`, `StoredChainOptions`, `buildStoredChain(opts)` (D-003). |
| `tests/unit/state/support/{fixtures,store-wrappers}.ts` | Phase 6 helpers to reuse (`GAME_ID`, `HUMAN_HASH`, `CREATED_AT`, `makeMeta`, …; `RecordingStore`, `StoreHooks`). **Never modify; import them.** |
| `tests/sim/harness.ts` | `replay` / `moveIdOf`: the reference algorithm `replayGame` follows. |

## Public interfaces

```ts
// src/service/errors.ts — each extends Error, sets this.name to its class name (P-1)
export class VersionConflict extends Error { readonly update: PlayerUpdate; constructor(update: PlayerUpdate) }
//   `Version conflict: the game is at version <update.version>`
export class IllegalMove extends Error { readonly moveId: string; readonly reason: 'game-over' | 'unknown-move'; constructor(moveId, reason) }
//   `Illegal move "<moveId>": <reason>`
export class NotYourTurn extends Error { readonly seat: number; constructor(seat: number) }
//   `Not your turn (seat <seat>)`
export class Unauthorized extends Error { constructor() }
//   `Unauthorized`
export class GameNotFound extends Error { readonly gameId: string; constructor(gameId: string) }
//   `Game not found: <gameId>` — field and message hold gameId.slice(0, 64) (raw input allowed)
export class InvalidRequest extends Error { readonly reason: string; constructor(reason: string) }
//   `Invalid request: <reason>`; reason ∈ humanName | aiCount | rulesPreset | sinceVersion | version | moveId | clientRequestId
export class GameUnsupported extends Error { readonly gameId: string; readonly engineVersion: number; constructor(gameId, engineVersion) }
//   `Game <gameId> was created with engine version <engineVersion>, which this server does not support`

// src/service/replay.ts — synchronous, pure
export function replayGame(meta: GameMeta, commits: readonly Commit[]): GameState[];
//   Guard 1: commits.length === 0 → RangeError('Invalid commits: at least commit 0 is required');
//            commits[i].version !== i → RangeError('Invalid commits: commit at index <i> has version <v>, expected <i>')
//   Guard 2: meta.engineVersion !== ENGINE_VERSION → GameUnsupported(meta.gameId, meta.engineVersion)
//   Then createGame({ gameId: meta.gameId, rules: commits[0].state.rules, seats: meta.seats, seed: commits[0].state.seed })
//   (events discarded); per commit, apply bid-made → `bid:<tricks>`, card-played → `play:<cardId>` by event.seat;
//   push { ...state, version: commit.version }. Engine IllegalMoveError propagates.

// tests/unit/service/support/replay-fixtures.ts
export interface StoredChainOptions { maxCommits?: number; seed?: string /* 'replay-seed' */; gameId?: string /* GAME_ID */; presetId?: PresetId /* DEFAULT_PRESET_ID */ }
export function chainSeats(): SeatInfo[];  // seat 0 { playerId 'human-0', name 'Ana', kind 'human' }; seats 1–3 { 'ai-<i>', 'AI <i>', 'ai', strategy 'random' }
export function buildStoredChain(opts?: StoredChainOptions): { meta: GameMeta; commits: Commit[] };
//   commit 0 = createGame + runAiLoop (actorSeat null, clientRequestId null, events = creation + loop);
//   commit n = human's first legal move + runAiLoop (actorSeat 0, clientRequestId 'req-<n>');
//   at = CREATED_AT + n minutes; state.version = n; scoreboard = evaluate(state);
//   stops at game-over or maxCommits; meta/commits are the GameMetaSchema/CommitSchema-parsed copies.
//   meta: presetId, ENGINE_VERSION, CREATED_AT, chainSeats(), seatTokenHashes [HUMAN_HASH, null, null, null].
```

Dependencies Iteration 2+ will use (from frozen specs 01–06): `GameStateManager` (`create`, `loadMeta`, `load`, `loadLatest`, `commit`, `writeFinalScores`, `readFinalScores`; never `eventsSince` here, P-5), state errors (`GameNotFoundError`, `GameExistsError`, `CommitNotFoundError`, `CommitConflictError`, `InvalidCommitError`, `InvalidGameIdError`), `assertValidGameId`, `MAX_COMMIT_VERSION = 99_999_999`, `createPlayers` (`@/src/players/registry`), `buildPlayerView` (`./player-view`), `runAiLoop` (import as `./ai-loop`, P-11), `evaluate` (`@/src/score/score-engine`), engine `createGame`/`applyMove`/`legalMoves`/`currentActor`/`IllegalMoveError` (`reason`: `game-over` | `not-your-turn` | `unknown-move`), `getPreset` (import from `@/src/domain/presets`, P-4), `UnknownPresetError`, `DEFAULT_PRESET_ID = 'argentina-fidepo'`, `PRESET_IDS`.

## Conventions & invariants

- **Layer rule** (scaffold): `src/service` may import every layer, `src/config` and Node built-ins except `fs`; nothing outside `src/service` imports it. Enforced by `pnpm lint` (`tools/eslint-rules/layer-boundaries.mjs`, data in `eslint.config.mjs`).
- **Replay purity** (BR-705, P-9): `replay.ts` imports only what the file map lists; `grep -nE "storage|config|node:|Date|Math\.random|crypto" src/service/replay.ts` must print nothing — **comments count**, so never write those words (e.g. "Date") in that file.
- **Error messages** (BR-701): only the values in P-1; never a seed, token, hash, hand or `aiDecisionCount`. Non-service errors (`AiLoopLimitError`, engine/state/storage errors) may carry secrets and are server-only.
- **Protected paths** (plan rule 8): never modify `src/service/player-view.ts`, `src/service/ai-loop.ts`, `src/domain`, `src/engine`, `src/score`, `src/players`, `src/state`, `src/storage`, `src/config.ts`, `tests/unit/state/**`, `tests/unit/service/{ai-loop,player-view}.test.ts`, `vitest*.config.ts`, `eslint.config.mjs`, `package.json`, the lockfile.
- **Tests**: `tests/unit/service/*.test.ts`; header comment names the spec FRs/VCs; one `describe` per VC. Helpers go in `tests/unit/service/support/` (no `.test.ts` suffix). Reuse `RecordingStore`/`StoreHooks` from `tests/unit/state/support/store-wrappers.ts` and constants from `tests/unit/state/support/fixtures.ts` by relative import (`../../state/support/...` from `support/`, `../state/support/...` from a test file). Module mocks: partial `vi.mock(..., async (importOriginal) => ({ ...(await importOriginal()), fn: vi.fn() }))`, one mocked module per file (P-11).
- **State facts** (Phase 6 hand-off): validate a body with `CommitSchema.safeParse({ schemaVersion: 1, ...body })`; returned/parsed documents may have different nested key order than `evaluate()` output, so compare with `toEqual`, never bytes. `at`/`createdAt` must be exact `toISOString()` output. `meta.seats` must deep-equal `commit0.state.seats`; `seatTokenHashes` has one entry per seat (64-hex or `null`). `loadMeta` alone does not prove a game exists (`loadLatest` is authoritative). `writeFinalScores` never rejects on storage errors.
- **Storage facts**: `MemoryObjectStore` (`@/src/storage/memory-store`); `putJson`/`getJson` in `@/src/storage/object-store`; `ObjectExistsError` on create-only conflicts.
- **Formatting**: `pnpm exec prettier --write src/service tests/unit/service` before `pnpm lint`. `docs/` and `specs/` are prettier-ignored.
- **Commits**: one per iteration, staged by explicit path (never `git add -A`), message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge.

## Commands

All with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed (no network). In zsh, write the prefix literally; a `$E pnpm …` variable is not word-split and fails with "command not found".

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/service` | Service unit tests (4 files now, ≈ 0.7 s). |
| `pnpm vitest run tests/unit/service/errors.test.ts` | Service errors (15 tests). |
| `pnpm vitest run tests/unit/service/replay.test.ts` | Replay VC-723/VC-724 (12 tests). |
| `pnpm vitest run tests/unit/service --reporter json --outputFile <scratch>/service.json` | Per-file durations (NFR-704 proxy). Without `--outputFile` the JSON reporter writes `.vitest/json/output.json`, which breaks `prettier --check`: delete it. |
| `grep -nE "^import" src/service/replay.ts` / `grep -nE "storage\|config\|node:\|Date\|Math\.random\|crypto" src/service/replay.ts` | VC-727 replay part (second prints nothing). |
| `pnpm typecheck` | `next typegen && tsc --noEmit`. |
| `pnpm lint` | ESLint 0 warnings + `prettier --check .`. |
| `pnpm test` | Full unit/contract suite (Blob contract skipped without a token). |
| `pnpm test:sim` / `pnpm build` | Simulation suite (≈ 45 s) and production build; Final Verification only. |

## Known gaps

- `game-service.ts` and its tests (Iterations 2–3), docs (Iteration 4).
- VC-723 on a game played through the service is checked in Iteration 3 (`full-game.test.ts`).
- VC-727's `git diff main -- <protected paths>` check and the `game-service.ts` grep run in later iterations / Final Verification.
- NFR-704 (< 20 s for `tests/unit/service` in CI) is read from CI after the push.
