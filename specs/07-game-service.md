# Spec 07 — GameService

> Version: 0.2 · Last updated: 2026-11-23 · Status: Draft · Owner: Federico Castañeda
> Source: [`docs/implementation.md`](../docs/implementation.md) §3 Phase 7. Context: [`docs/design.md`](../docs/design.md) §5.5, §7, §9; [`docs/architecture.md`](../docs/architecture.md) §5, §6.2–§6.4, §8, §10, §11.
> Builds on: [`specs/06-game-state-manager-frozen.md`](./06-game-state-manager-frozen.md) (`GameStateManager`, `GameMeta`, `Commit`, `CommitBody`, the state errors, `MAX_COMMIT_VERSION`, `assertValidGameId`), [`specs/04-players-frozen.md`](./04-players-frozen.md) (`createPlayers`, `buildPlayerView`, `runAiLoop`, `AiLoopLimitError`), [`specs/03-score-engine-frozen.md`](./03-score-engine-frozen.md) (`evaluate`), [`specs/02-engine-frozen.md`](./02-engine-frozen.md) (`createGame`, `applyMove`, `legalMoves`, `currentActor`, `IllegalMoveError`, `ENGINE_VERSION`), [`specs/01-domain-model-frozen.md`](./01-domain-model-frozen.md) (`getPreset`, `UnknownPresetError`, `DEFAULT_PRESET_ID`, `PlayerUpdate`, `SeatInfo`), [`specs/00-project-scaffold-frozen.md`](./00-project-scaffold-frozen.md) (layer rule: `service` may import every layer, `src/config` and Node built-ins except `fs`).
> Requirement IDs use the 7xx range.

## Purpose

The game core plays and scores games, and the Game State Manager (Phase 6) persists them, but nothing yet joins the two into the operations a player performs: start a game, look at it, make a move. `GameService` is that orchestrator and the only module that combines engine, score, players and state. It generates the secrets (game id, seed, seat token), authenticates a seat, applies the human's move, lets the AIs play until a human must act, commits the result as one create-only write, and turns the state layer's commit races into either an idempotent replay of the request that already won or a `VersionConflict` carrying a fresh update. It also ships the persisted-replay function that proves a stored game can be rebuilt from its seed and events. It benefits the developers of Phases 8–10 (HTTP API, UI, retention), who get a service whose auth, retry, conflict and information-hiding behaviour is proven by tests on the memory store.

## Scope

**In**
- `src/service/errors.ts`, `src/service/game-service.ts`, `src/service/replay.ts`.
- Unit and concurrency tests in `tests/unit/service/` on `MemoryObjectStore` (plus a counting wrapper for NFR-702).
- Docs:
  - `docs/design.md` §9: the shipped `GameService` interface, errors and `submitMove` steps.
  - `docs/architecture.md` §10: the full list of service errors.
  - `docs/development.md`: a new "Service" section right after "Game state", with later sections and cross-references renumbered.

**Out**
- HTTP: route handlers, Zod request schemas, the `Authorization` header, mapping errors to status codes, `Cache-Control`, request logging, the service factory wired to `getConfig()` (all Phase 8).
- UI (Phase 9) and the retention job (Phase 10).
- Any AI strategy except `random`, and per-seat strategy choice in `createGame` (every AI seat is `random`).
- More than one human seat per game. `meta.json` and authentication already support several (design §12), but `createGame` creates exactly one, at seat 0.
- Rate limiting; a preset list endpoint (Phase 8).
- Running against a real Blob store (Phase 8 latency checks).
- Any change to `src/domain`, `src/engine`, `src/score`, `src/players`, `src/state`, `src/storage`, `src/service/player-view.ts` or `src/service/ai-loop.ts`.

## Actors

| Actor | Description | Permissions |
|---|---|---|
| Human player (via the API, Phase 8) | Holds a `gameId` and a seat token | `getUpdate` and `submitMove` for their own seat only |
| API route handlers (Phase 8) | The only production caller | Construct one `GameService` per request or process and call its three methods |
| AI players | Seats with `kind: 'ai'` | Act only inside `runAiLoop`, never through the public methods |
| Tests | Exercise the service | Inject a clock and a random-byte source; build over `MemoryObjectStore` |

## Functional Requirements

### Construction

- **FR-700 (Must)** — `new GameService(deps)` takes `{ state: GameStateManager; defaultPresetId?: PresetId; now?: () => Date; randomBytes?: (n: number) => Uint8Array }`. The defaults are `DEFAULT_PRESET_ID`, `() => new Date()` and `node:crypto` `randomBytes`. The constructor does no I/O and does not read `src/config` (Phase 8 passes `config.defaultRulesPreset`).

### Create

- **FR-701 (Must)** — `createGame(req)` validates `req = { rulesPreset?: string; humanName: string; aiCount: number }` before any I/O and rejects with `InvalidRequest { reason }` when:
  - `humanName` is not a string, or has fewer than 1 or more than 40 characters after `trim()` (`reason: 'humanName'`);
  - `aiCount` is not an integer in 2–5 (`reason: 'aiCount'`);
  - `rulesPreset` is present and not a known preset id (`getPreset` throws `UnknownPresetError`) (`reason: 'rulesPreset'`);
  - `aiCount + 1` is outside the preset's `players.min…max` (`reason: 'aiCount'`).

  The checks run in the order listed, and the first failure wins. An absent `rulesPreset` selects `deps.defaultPresetId`. Every error from the engine, `runAiLoop` or `state.create` (including `GameExistsError`, `AiLoopLimitError` and storage errors) propagates unchanged, and the service writes nothing beyond what `state.create` wrote.
- **FR-702 (Must)** — `createGame` generates, from `deps.randomBytes`:
  - `gameId`: 16 bytes encoded as lowercase RFC 4648 base32 without padding (26 characters, matching `^[a-z2-7]{26}$`);
  - `seed`: 32 bytes as 64 lowercase hex characters;
  - `seatToken`: 32 bytes as base64url without padding (43 characters).

  The stored hash is the 64-character lowercase hex SHA-256 (`node:crypto`) of the UTF-8 seat-token string. `createGame` never accepts a seed, id or token from the caller.
- **FR-703 (Must)** — The seats are, in order: `{ seat: 0, playerId: 'human-0', name: <trimmed humanName>, kind: 'human' }` then, for `i` in `1…aiCount`, `{ seat: i, playerId: 'ai-<i>', name: 'AI <i>', kind: 'ai', strategy: 'random' }`.
- **FR-704 (Must)** — `createGame` calls engine `createGame({ gameId, rules: getPreset(presetId), seats, seed })`, then `runAiLoop` on its state with `createPlayers(seats)`. Commit 0 has: `version: 0`; `at` and `meta.createdAt` both equal to `now().toISOString()` (one call); `actorSeat: null`; `clientRequestId: null`; `events` = the engine's creation events followed by the loop's events; `state` = the loop's final state (`version: 0`); `scoreboard` = `evaluate(state)`. The meta has `presetId`, `engineVersion: ENGINE_VERSION`, the seats and `seatTokenHashes: [<hash>, null, …]`. Both are written with `state.create(meta, commit0)`.
- **FR-705 (Must)** — `createGame` resolves to `{ gameId, seat: 0, seatToken, update }`, where `update` is the PlayerUpdate (FR-716) of commit 0 for seat 0 with `events` = commit 0's events.

### Authentication and loading

- **FR-706 (Must)** — `getUpdate` and `submitMove` validate their arguments before any I/O, in this order, and the first failure wins:
  1. a `gameId` that fails `assertValidGameId` → `GameNotFound { gameId }`;
  2. a `seatToken` that is not a non-empty string → `Unauthorized`;
  3. the method's own checks (FR-711 for `getUpdate`; FR-713 for `submitMove`).
- **FR-707 (Must)** — They then call `state.loadMeta(gameId)` and `state.loadLatest(gameId)` in parallel. `GameNotFoundError` (state) from either rejects with `GameNotFound { gameId }`. Any other error propagates unchanged.
- **FR-708 (Must)** — The seat is the index `i` whose `meta.seatTokenHashes[i]` is non-null and equals the SHA-256 hex of `seatToken`, compared with `timingSafeEqual` on the 32-byte digests. Every non-null hash is compared, whatever the outcome. `game-service.ts` imports `node:crypto` by name only (`import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'`), never as a default or namespace import, so a partial module mock replaces them. No match rejects with `Unauthorized`.
- **FR-709 (Must)** — After authentication, `meta.engineVersion !== ENGINE_VERSION` rejects with `GameUnsupported { gameId, engineVersion }`. No move is applied and nothing is written.

### Get update

- **FR-710 (Must)** — `getUpdate(gameId, seatToken, sinceVersion?)` resolves to the PlayerUpdate (FR-716) of the tip for the authenticated seat.
- **FR-711 (Must)** — `events` is `[]` when `sinceVersion` is absent. Otherwise `sinceVersion` must be an integer in 0–`MAX_COMMIT_VERSION` (else `InvalidRequest { reason: 'sinceVersion' }`, before any I/O), and `events` is the missed events (FR-716) from `sinceVersion` to the tip.

### Submit move

- **FR-712 (Must)** — `submitMove(gameId, seatToken, req)` follows FR-706–FR-709, then FR-714–FR-722, in this order.
- **FR-713 (Must)** — `req = { version: number; moveId: string; clientRequestId: string }` is validated before any I/O. It rejects with `InvalidRequest` when:
  - `version` is not an integer in 0–`MAX_COMMIT_VERSION − 1` (`reason: 'version'`);
  - `moveId` is not a string of 1–32 characters (`reason: 'moveId'`);
  - `clientRequestId` is not a string of 1–128 characters (`reason: 'clientRequestId'`).

  The checks run in the order listed, after FR-706 steps 1–2.
- **FR-714 (Must) — Retry check.** When `req.version` ≠ the tip version `t`:
  - If `req.version < t`, the service loads commit `req.version + 1`. When its `clientRequestId === req.clientRequestId` and `actorSeat ===` the authenticated seat, `submitMove` resolves to that commit's PlayerUpdate for this seat (FR-716) with `events` = that commit's events. Nothing is written.
  - Otherwise (no match, or `req.version > t`) it rejects with `VersionConflict { update }`, where `update` is the tip's PlayerUpdate for this seat with `events` = the missed events (FR-716) from `req.version` to the tip.
- **FR-715 (Must) — Apply.** When `req.version === t`, the service calls `applyMove(tip.state, seat, req.moveId)`. An `IllegalMoveError` with `reason: 'not-your-turn'` rejects with `NotYourTurn { seat }`. One with `reason: 'game-over'` or `'unknown-move'` rejects with `IllegalMove { moveId, reason }`. Nothing is written in either case.
- **FR-716 (Must) — PlayerUpdate.** A PlayerUpdate for seat `s` built from a commit `c` is `{ version: c.version, events, view: buildPlayerView(c.state, s), legalMoves: legalMoves(c.state, s) }`, with `events` as each FR states. `buildPlayerView` is the only builder of the view. The **missed events** from a version `a` to an already-loaded tip commit `c` are the events of commits `a + 1 … c.version` concatenated in version order: `[]` when `a ≥ c.version`; otherwise commits `a + 1 … c.version − 1` are read with `state.load` (at most 8 in flight) and `c`'s own events are reused. The service never calls `state.eventsSince`, so the events always end exactly at `update.version`. A `load` error (e.g. `CommitNotFoundError` after an external delete) propagates unchanged.
- **FR-717 (Must) — AI loop.** After the human move, the service calls `runAiLoop(state, createPlayers(state.seats))`. The players are rebuilt from the stored `state.seats`; the rules and hand plan come from the stored state, never from the preset registry. `AiLoopLimitError`, and any `IllegalMoveError` or `RangeError` thrown from inside the loop, propagate unchanged and nothing is written.
- **FR-718 (Must) — Commit.** The service commits `{ version: req.version + 1, at: now().toISOString(), actorSeat: seat, clientRequestId: req.clientRequestId, events: [...human move events, ...loop events], state: { ...loopState, version: req.version + 1 }, scoreboard: evaluate(<that state>) }` with `state.commit(gameId, body)`.
- **FR-719 (Must) — Commit race.** When `state.commit` rejects with `CommitConflictError`, the service loads commit `req.version + 1` and applies the FR-714 match test to it. A match resolves to that commit's PlayerUpdate for this seat, with that commit's events. Otherwise, including when that load rejects with `CommitNotFoundError` (only possible after an external delete), the service calls `state.loadLatest(gameId)` and rejects with `VersionConflict`, whose update is the tip's PlayerUpdate with the missed events (FR-716) from `req.version` to the tip. When commit `req.version + 1` exists, the update's version is ≥ `req.version + 1`, even while `head.json` still says `req.version`.
- **FR-720 (Must)** — Any other error from `state.commit` propagates unchanged.
- **FR-721 (Must) — Final scores.** When the committed state's `phase` is `'game-over'`, the service awaits `state.writeFinalScores(gameId, version, scoreboard)` (best-effort; it never rejects) before resolving. A retried request that matches (FR-714/FR-719) does not write `final.json`.
- **FR-722 (Must)** — On success `submitMove` resolves to the committed PlayerUpdate for this seat (FR-716) with `events` = the commit's events. `view.finalRanking` is present iff `phase === 'game-over'` (by `buildPlayerView`).

### Replay

- **FR-723 (Must)** — `replayGame(meta, commits)` rebuilds a stored game. `commits` must be non-empty and hold versions `0, 1, …, n` in order (else `RangeError` naming `commits`). `meta.engineVersion !== ENGINE_VERSION` throws `GameUnsupported` before any engine call. `replayGame` is synchronous.
- **FR-724 (Must)** — Replay starts with engine `createGame({ gameId: meta.gameId, rules: commits[0].state.rules, seats: meta.seats, seed: commits[0].state.seed })`. Then, for each commit in order, it applies, via `applyMove` only (no players, no AI loop), every `bid-made` event as `bid:<tricks>` and every `card-played` event as `play:<cardId>` by its `seat`. Before the first commit's events, it skips the events of engine `createGame` itself. It returns one `GameState` per commit: the replayed state after that commit's events, with `version` set to the commit's version. A move that the engine rejects propagates as `IllegalMoveError`.

### Docs

- **FR-725 (Must)** — Update the docs as follows:
  - `docs/design.md` §9 shows the shipped `GameService` constructor and methods, the seven errors, and the `submitMove` steps with the retry and race paths (FR-714, FR-719).
  - `docs/architecture.md` §10 lists all seven service errors.
  - `docs/development.md` gains a "Service" section numbered right after "Game state" (later sections and cross-references renumbered). It covers the module map, how to construct the service in tests (clock and random-byte injection), auth, the retry and conflict paths, the errors and their intended HTTP status (for Phase 8), and replay.

## Business Rules

- **BR-701 — Secrets stay on the server.** The seed, the seat-token hashes, other seats' hands and `aiDecisionCount` never appear in any value the service returns, nor in any of the seven service errors (fields or message, including `VersionConflict.update`). The seat token appears only in `createGame`'s result. *Rationale:* architecture §8, design §5.5. *Exceptions:* the dealer's publicly shown trump card (design §4.5). Errors that are not service errors (`AiLoopLimitError`, whose `state` holds the full game; engine, state and storage errors) may carry such data. They are server-only: Phase 8 must log them and answer `500 internal`, never serialize them to a client (architecture §10).
- **BR-702 — One request, at most one commit.** Each `createGame` writes exactly one game (meta + commit 0). Each `submitMove` writes at most one commit and never retries a commit. A matching retry writes nothing. *Rationale:* architecture §5 and §6.3. *Exceptions:* none.
- **BR-703 — Stored rules are frozen.** After creation the service never reads the preset registry for a game. Rules, hand plan and seats come from the stored state. *Rationale:* design §4.5, architecture §6.4. *Exceptions:* none.
- **BR-704 — Every move goes through the engine.** The human's move and every AI move are applied with `applyMove` on moves listed by `legalMoves`. The service never edits `GameState` except to set `version`. *Rationale:* design §5, players BR-403. *Exceptions:* none.
- **BR-705 — Pure helpers stay pure.** `player-view.ts` and `ai-loop.ts` are unchanged. `replay.ts` imports no storage, state, config, I/O, time or randomness. All I/O, time and randomness in `game-service.ts` go through `deps`. *Rationale:* players BR-404; deterministic tests. *Exceptions:* none.

## Non-Functional Requirements

- **NFR-701** — `pnpm typecheck`, `pnpm lint` (0 warnings), `pnpm test`, `pnpm test:sim` and `pnpm build` pass, locally and in CI.
- **NFR-702** — With `head.json` exact, measured with a counting `ObjectStore` wrapper that also records which calls are in flight together:
  - successful `submitMove` = 8 store calls (1 meta read, 5 for `loadLatest`, 2 `put`s for the commit), plus 1 `put` when the game ends. The meta read and `loadLatest`'s first round (3 calls) are in flight together, so the first round has 4 calls;
  - `getUpdate` without `sinceVersion` = 6 calls, with the same 4-call first round; with `sinceVersion` `v` < tip `t` = 6 + 2·(t − v − 1) calls (each `state.load` is 2 calls);
  - a `VersionConflict` from a stale `req.version` `v` < tip `t` (no match) = 8 + 2·(t − v − 1) calls (6, plus 2 for the retry-check load of commit `v + 1`, plus the missed-events loads);
  - `createGame` = 4 `put` calls and 0 reads.
- **NFR-703** — `package.json` `dependencies` and `devDependencies` are unchanged (`node:crypto` is a built-in).
- **NFR-704** — The `tests/unit/service` files complete in < 20 s in total, as reported by vitest in the CI "Test" step.

## Data & Interfaces

### Module exports

| Module | Exports |
|---|---|
| `src/service/errors.ts` | `VersionConflict`, `IllegalMove`, `NotYourTurn`, `Unauthorized`, `GameNotFound`, `InvalidRequest`, `GameUnsupported` |
| `src/service/game-service.ts` | `GameService`; types `GameServiceDeps`, `CreateGameRequest`, `CreateGameResult`, `SubmitMoveRequest` |
| `src/service/replay.ts` | `replayGame` |

No barrel `index.ts`. `player-view.ts` and `ai-loop.ts` (Phase 4) are reused as they are.

### Service

```ts
export interface GameServiceDeps {
  state: GameStateManager;
  defaultPresetId?: PresetId;                     // default DEFAULT_PRESET_ID
  now?: () => Date;                               // default () => new Date()
  randomBytes?: (n: number) => Uint8Array;        // default node:crypto randomBytes
}
export interface CreateGameRequest { rulesPreset?: string; humanName: string; aiCount: number }
export interface CreateGameResult { gameId: string; seat: number; seatToken: string; update: PlayerUpdate }
export interface SubmitMoveRequest { version: number; moveId: string; clientRequestId: string }

export class GameService {
  constructor(deps: GameServiceDeps);
  createGame(req: CreateGameRequest): Promise<CreateGameResult>;
  getUpdate(gameId: string, seatToken: string, sinceVersion?: number): Promise<PlayerUpdate>;
  submitMove(gameId: string, seatToken: string, req: SubmitMoveRequest): Promise<PlayerUpdate>;
}
```

`PlayerUpdate = { version, events, view, legalMoves }` (spec 01).

### Errors

```ts
export class VersionConflict extends Error { readonly update: PlayerUpdate }                   // → 409 version_conflict
export class IllegalMove extends Error { readonly moveId: string; readonly reason: 'game-over' | 'unknown-move' } // → 422 illegal_move
export class NotYourTurn extends Error { readonly seat: number }                               // → 403 not_your_turn
export class Unauthorized extends Error {}                                                     // → 401 unauthorized
export class GameNotFound extends Error { readonly gameId: string }                            // → 404 game_not_found
export class InvalidRequest extends Error { readonly reason: string }                          // → 400 invalid_request; names the field
export class GameUnsupported extends Error { readonly gameId: string; readonly engineVersion: number } // → Phase 8 decides (proposed 410)
```

Each sets `this.name`. The HTTP column is guidance for Phase 8, not behaviour of this spec. `moveId` in `IllegalMove` is the caller's own input, at most 32 characters (FR-713).

### Replay

```ts
export function replayGame(meta: GameMeta, commits: readonly Commit[]): GameState[];  // one state per commit
```

## Verification Criteria

All tests use `MemoryObjectStore`, a fixed `now` and, where ids must be known, a scripted `randomBytes`. Where a VC replaces a module function (`getPreset`, `runAiLoop`, `node:crypto` `timingSafeEqual`), it uses a partial module mock: `vi.mock('<module>', async (importOriginal) => ({ ...(await importOriginal()), <fn>: vi.fn(<impl>) }))`, never `vi.spyOn` on an ESM namespace.

### Create

- **VC-701** (FR-700): constructing the service with only `{ state }` performs 0 store calls; `createGame` without `rulesPreset` creates a game whose meta has `presetId` `argentina-fidepo`; with `defaultPresetId: 'gamerules'` it is `gamerules`.
- **VC-702** (FR-701): each invalid input → `InvalidRequest` with the stated `reason` and 0 store calls: `humanName` `''`, `'   '`, 41 non-space characters, `42`; `aiCount` 1, 6, 2.5, `'3'`; `rulesPreset` `'nope'`. Boundaries `humanName` of 1 and 40 characters (after trimming `'  x  '` → `'x'`) and `aiCount` 2 and 5 succeed.
- **VC-703** (FR-701): with `getPreset` mocked to return a preset whose `players` is `{ min: 3, max: 4 }`, `aiCount` 4 → `InvalidRequest { reason: 'aiCount' }` with 0 store calls, and `aiCount` 3 succeeds. Without the mock, for every preset in `PRESET_IDS` and every `aiCount` in 2–5, `createGame` succeeds iff `aiCount + 1` is within that preset's `players` range (all 16 combinations succeed with the current presets, which proves no valid combination is rejected).
- **VC-704** (FR-702): with real randomness, 100 games have distinct `gameId`s matching `^[a-z2-7]{26}$`, seeds matching `^[0-9a-f]{64}$`, tokens matching `^[A-Za-z0-9_-]{43}$`, and `meta.seatTokenHashes[0]` equal to `sha256(token)` hex. With a scripted `randomBytes` returning bytes `0x00…0x0f` for the id, the id is the known base32 literal.
- **VC-705** (FR-703, FR-704): a created 4-player game's meta and commit 0 match the expected seats, `engineVersion` `ENGINE_VERSION`, `createdAt === at === now().toISOString()`, `actorSeat`/`clientRequestId` `null`, `events[0..1]` = `game-started`, `hand-dealt`, `state.version` 0, and `scoreboard` deep-equal to `evaluate(state)`.
- **VC-706** (FR-704): over 50 seeds with argentina-fidepo and 3 AIs, whenever an AI must bid first, commit 0 contains its `bid-made` events and `currentActor(state)` is 0.
- **VC-707** (FR-705): the returned `update` has `version` 0, `events` deep-equal to commit 0's events, `view` deep-equal to `buildPlayerView(state, 0)` and `legalMoves` deep-equal to `legalMoves(state, 0)`.

### Authentication and loading

- **VC-708** (FR-706, FR-701, FR-713): `getUpdate` with token `''` → `Unauthorized`, 0 store calls; gameId `'ABC'` → `GameNotFound`, 0 store calls. Order when several inputs are invalid: gameId `'ABC'` + token `''` + `sinceVersion` −1 → `GameNotFound`; valid id + token `''` + bad `req` → `Unauthorized`; `req` with bad `version` and bad `clientRequestId` → `reason: 'version'`; `createGame` with bad `humanName` and bad `aiCount` → `reason: 'humanName'`.
- **VC-731** (FR-701): with `runAiLoop` mocked to throw `AiLoopLimitError`, `createGame` rejects with that error and the store holds no `meta.json`; with `state.create` made to reject with `GameExistsError` (a scripted `randomBytes` that repeats only an existing game's 16 id bytes, with different seed and token bytes, so the stored `meta.json` differs), `createGame` rejects with `GameExistsError`.
- **VC-709** (FR-707): an unknown valid gameId → `GameNotFound`; a game whose commit 0 was deleted (meta present) → `GameNotFound`; a store whose `get` throws a non-storage error → that error propagates.
- **VC-710** (FR-708): a wrong token, and the token of another game → `Unauthorized`. On a meta built in the test with 3 seats, 2 of them human, where the token matches the first human hash, a mocked `timingSafeEqual` is called exactly 2 times for the match and 2 times for a mismatch.
- **VC-711** (FR-709): a game whose `meta.json` is rewritten with `engineVersion: ENGINE_VERSION + 1` → `getUpdate` and `submitMove` reject with `GameUnsupported` (with that version); no commit is added.

### Get update

- **VC-712** (FR-710, FR-711, FR-716): after two moves (tip 2), `getUpdate` → version 2 and `events` `[]`; with `since` 0 → the events of commits 1–2 in order; `since` 2 and 99 → `[]`; `since` −1, 1.5 → `InvalidRequest { reason: 'sinceVersion' }`, 0 store calls. With a store wrapper that lets a third commit land after the service's `loadLatest` resolves, `getUpdate(since 0)` returns `version` 2 and exactly the events of commits 1–2.

### Submit move

- **VC-713** (FR-713): each invalid `req` → `InvalidRequest` with its `reason` and 0 store calls: `version` −1, 1.5, `MAX_COMMIT_VERSION`; `moveId` `''`, 33 characters; `clientRequestId` `''`, 129 characters. Boundaries `moveId` 32 characters → passes validation (then `IllegalMove`); `clientRequestId` 128 characters → accepted.
- **VC-714** (FR-712, FR-718, FR-722): a full argentina-fidepo game with 3 AIs played to `game-over` through `submitMove` (the human always plays its first legal move): every response has `version` = previous + 1, `events` = that commit's events, and `view.finalRanking` absent until the last response, where it equals `scoreboard.ranking`. Each commit has `actorSeat` 0, the request's `clientRequestId`, `state.version === version`, and `scoreboard` deep-equal to `evaluate(state)`.
- **VC-715** (FR-721): after VC-714, `readFinalScores` returns the terminal commit's version and ranking. A store whose `final.json` put throws still lets the last `submitMove` resolve normally.
- **VC-716** (FR-715): a move by seat 0 while an AI must act (constructed state) → `NotYourTurn { seat: 0 }`; `moveId` `'bid:99'` → `IllegalMove { reason: 'unknown-move' }`; any move after game over → `IllegalMove { reason: 'game-over' }`. None adds a commit.
- **VC-717** (FR-714): stale version with a different `clientRequestId` → `VersionConflict` whose `update.version` is the tip and `update.events` the events of commits `req.version+1…tip`; `req.version` = tip + 5 → `VersionConflict` with `events` `[]`. No commit is added.
- **VC-718** (FR-714): retry after a lost response: the same request sent again after it committed v+1 → resolves deep-equal to the first response; also after a further commit v+2 has landed. No commit is added.
- **VC-719** (FR-714): a request whose `clientRequestId` matches commit v+1 but from a different seat (meta with two human seats, built in the test) → `VersionConflict`.
- **VC-720** (FR-719, FR-720): two different moves from the same version raced with `Promise.all` → exactly one resolves, the other rejects with `VersionConflict`; one commit added. Two copies of the same request raced → both resolve deep-equal; one commit added. A collision while `head.json` still says `v` (head write made to fail) → the `VersionConflict.update.version ≥ v + 1`. With `state.commit` made to reject with `CommitConflictError` while commit `v + 1` does not exist → `VersionConflict` with `update.version` `v`. A store whose commit `put` throws a generic error → that error propagates.
- **VC-721** (FR-717, BR-703): after creating a game, the test switches the mocked `getPreset` to return rules with different scoring; the next `submitMove` produces a state whose `rules` deep-equal the stored ones and the stored `handPlan` is unchanged.
- **VC-722** (FR-717): with `runAiLoop` mocked to throw `AiLoopLimitError`, `submitMove` rejects with it and no commit is added.

### Replay

- **VC-723** (FR-723, FR-724): the VC-714 game, loaded with `load(0…tip)`, replays with `replayGame` to states deep-equal to every stored commit's `state` (including `aiDecisionCount`), and `evaluate` of each equals the stored `scoreboard`.
- **VC-724** (FR-723): `engineVersion` mismatch → `GameUnsupported`; `[]`, versions `[0, 2]` and `[1]` → `RangeError` naming `commits`.

### Docs, secrets, purity, NFRs

- **VC-725** (BR-701): over VC-714's game, the VC-716 rejections and the VC-717/VC-720 conflicts, two checks hold:
  - (a) for every returned `PlayerUpdate` and every `VersionConflict.update`, `view` deep-equals `buildPlayerView(<stored state of commit update.version>, <the request's seat>)`, and `JSON.stringify` of the update **without its `events`** contains no card of another seat's hand in that stored state, except the shown trump card;
  - (b) `JSON.stringify` of every returned value and every service error (`message` plus own fields) contains neither the stored seed, nor `seatTokenHashes[0]`, nor the substring `aiDecisionCount`; and every event in it carries cards only in `card-played.card` and `hand-dealt.trumpCard`.

  The seat token appears only in `createGame`'s result.
- **VC-726** (BR-702): a counting store shows each `createGame` makes exactly one create of `meta.json` and of commit 0, and each `submitMove` at most one commit `put` (0 on every rejected or matched-retry path in VC-716–VC-720).
- **VC-727** (BR-704, BR-705): `git diff main -- src/service/player-view.ts src/service/ai-loop.ts src/domain src/engine src/score src/players src/state src/storage` is empty. `grep -nE "storage|state/|config|node:|Date|Math.random|crypto" src/service/replay.ts` finds no import. `grep -nE "new Date\(|Math.random|randomBytes\(" src/service/game-service.ts` matches only the `deps` defaults.
- **VC-728** (FR-725): `grep -n "GameUnsupported" docs/design.md docs/architecture.md docs/development.md` finds each file; `grep -n "^## .*Service" docs/development.md` finds the section right after "Game state".
- **VC-729** (NFR-702): a counting wrapper shows the call counts stated in NFR-702. A gated wrapper, which holds every call until released, shows 4 calls pending at once before the first is released, for both `submitMove` and `getUpdate`.
- **VC-730** (NFR-701, NFR-703, NFR-704): local and CI gates are green; `package.json` dependency lists are unchanged from `main`; the CI "Test" step reports the `tests/unit/service` files' durations summing to < 20 s.

## Open Questions

None.

## Assumptions

- The API (Phase 8) passes the raw bearer token string and the parsed JSON body; it also validates shapes with Zod, so `InvalidRequest` from the service is a second line of defence.
- One human seat per game (seat 0). Authentication already handles several human seats, so multi-user games (architecture §12) need no change here.
- `random` is the only strategy; `createPlayers` maps `strategy: 'random'` to `randomStrategy`.
- An `ENGINE_VERSION` bump abandons games in progress (architecture §6.4): they fail with `GameUnsupported` and are removed by retention.

## Changelog

- 0.2 (2026-11-23): review pass 1:
  - operator: BR-701 covers returned values and service errors only; non-service errors are server-only (Phase 8 logs them and answers 500);
  - operator: missed events are read with `state.load` up to the already-loaded tip, never `eventsSince` (FR-716);
  - operator: `CommitNotFoundError` on the post-conflict re-read counts as no match (FR-719);
  - input-check order (FR-701, FR-706, FR-713); `createGame` error propagation (FR-701);
  - NFR-702 call counts for the `since` and 409 paths and the 4-call first round; partial-module mocking for VCs; `replayGame` throws (FR-723).
- 0.1 (2026-11-23): initial draft from implementation.md Phase 7, design §9, architecture §5/§6.3/§8/§10/§11, and discovery answers:
  - `engineVersion` mismatch → `GameUnsupported`, no move applied;
  - the service validates inputs and throws `InvalidRequest { reason }`;
  - `humanName` trimmed to 1–40 characters; AIs named `AI <seat>` with `playerId` `ai-<seat>`, human `human-0`;
  - `replayGame` is production code in `src/service/replay.ts`;
  - seat token is 43-char base64url, seed 64-char hex;
  - `getUpdate` events: `[]` without `since`, `[]` when `since ≥` tip;
  - the 409 body is the tip with the events since `req.version`;
  - error class names as in the docs (no `Error` suffix).
