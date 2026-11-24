# Frozen: Spec 07 — GameService

Source: specs/07-game-service.md (plan + build record: specs/07-game-service-plan.md, specs/07-game-service-plan-artifacts/; review: specs/07-game-service.review.md)
Status: SHIPPED
Frozen: 2026-11-23
PR / commit: https://github.com/fclabs/la-podrida-game/pull/9 — squash commit a84979a

## Purpose
The game core plays and scores games, and the Game State Manager (Phase 6) persists them, but nothing yet joins the two into the operations a player performs: start a game, look at it, make a move. `GameService` is that orchestrator and the only module that combines engine, score, players and state. It generates the secrets (game id, seed, seat token), authenticates a seat, applies the human's move, lets the AIs play until a human must act, commits the result as one create-only write, and turns the state layer's commit races into either an idempotent replay of the request that already won or a `VersionConflict` carrying a fresh update. It also ships the persisted-replay function that proves a stored game can be rebuilt from its seed and events. It benefits the developers of Phases 8–10 (HTTP API, UI, retention), who get a service whose auth, retry, conflict and information-hiding behaviour is proven by tests on the memory store.

## What it does
- **Construction.** `new GameService({ state, defaultPresetId?, now?, randomBytes? })` does no I/O and never reads `src/config`; Phase 8 passes `config.defaultRulesPreset`. All time and randomness go through `deps`.
- **Input checks.** Every method checks its input before any I/O, and the first failure wins.
  - `createGame` checks: `humanName` (1–40 chars after trim) → `aiCount` (integer 2–5) → `rulesPreset` (known id) → `aiCount + 1` within the preset's player range. Each failure is `InvalidRequest { reason: <field> }`.
  - `getUpdate`/`submitMove` check: bad gameId → `GameNotFound`; empty/non-string token → `Unauthorized`; then `sinceVersion` (integer 0–`MAX_COMMIT_VERSION`) or `req` (`version` integer 0–`MAX_COMMIT_VERSION − 1`, `moveId` 1–32 chars, `clientRequestId` 1–128 chars).
- **createGame** generates its secrets from `randomBytes`:
  - `gameId`: 16 bytes, lowercase base32, 26 chars;
  - seed: 32 bytes, 64 hex chars;
  - seat token: 32 bytes, base64url, 43 chars. Only its SHA-256 hex is stored.

  Seat 0 is the human (`human-0`, trimmed name); seats 1…n are `ai-<i>` / `AI <i>`, strategy `random`. It runs the AI loop, so commit 0 already holds the AIs' opening bids. Meta and commit 0 are written with one `state.create`. Engine, AI-loop and state errors (`GameExistsError`, `AiLoopLimitError`, storage) propagate unchanged. It returns `{ gameId, seat: 0, seatToken, update }`.
- **Loading and auth.** `loadMeta` and `loadLatest` run in parallel. State `GameNotFoundError` becomes `GameNotFound`, and other errors propagate. The seat is found with `timingSafeEqual` over every non-null token hash; no match → `Unauthorized`. `meta.engineVersion !== ENGINE_VERSION` → `GameUnsupported`, and nothing is applied.
- **PlayerUpdate** = `{ version, events, view: buildPlayerView(state, seat), legalMoves }`, built from a stored commit.
  - Missed events from `a` to the loaded tip come from `state.load` (at most 8 in flight) plus the tip's own events. They end exactly at `update.version`; `state.eventsSince` is never used.
- **getUpdate** returns the tip's update. `events` is `[]` without `sinceVersion`, otherwise the missed events since that version.
- **submitMove**
  - **Stale `req.version`:** if commit `req.version + 1` has the same `clientRequestId` and seat, it returns that commit's update (idempotent retry, no write). Otherwise → `VersionConflict { update }`, carrying the tip plus the events since `req.version`.
  - **Current version:** `applyMove` runs; `not-your-turn` → `NotYourTurn`, `game-over`/`unknown-move` → `IllegalMove`. Then `runAiLoop` runs with players rebuilt from the stored seats, and one commit `{ version + 1, at, actorSeat, clientRequestId, events, state, scoreboard: evaluate(state) }` is written.
  - **Commit race:** a `CommitConflictError` re-reads commit `v + 1`. A match returns the winner's update; otherwise (including `CommitNotFoundError`) it reloads the tip and throws `VersionConflict`, whose version is ≥ `v + 1`. Other commit errors propagate.
  - **Game over:** `final.json` is written best-effort before resolving, never on a matched retry. `view.finalRanking` is present only at game over.
- **replayGame(meta, commits)** is synchronous and pure. It requires versions `0…n` in order (else `RangeError`) and throws `GameUnsupported` on an engine-version mismatch. It re-runs engine `createGame` from commit 0's rules and seed, then applies each `bid-made`/`card-played` event with `applyMove`. It returns one state per commit; an engine rejection propagates as `IllegalMoveError`.
- **BR-701 Secrets stay on the server.** No returned value or service error contains the seed, token hashes, other seats' hands or `aiDecisionCount`; the shown trump card is the one exception. The seat token appears only in `createGame`'s result. Non-service errors (e.g. `AiLoopLimitError.state`) are server-only.
- **BR-702** One request writes at most one commit (`createGame`: one game), with no commit retries; a matched retry writes nothing.
- **BR-703** After creation, rules, hand plan and seats come from stored state, never from the preset registry.
- **BR-704** Every move goes through `applyMove`; the service only sets `version` on a `GameState`.
- **BR-705** `player-view.ts` and `ai-loop.ts` are unchanged; `replay.ts` has no I/O, time, randomness, config or storage imports.

## Public interfaces / data

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

## Key decisions
- Errors carry no `Error` suffix and set `this.name`; `GameNotFound.gameId` is clipped to 64 chars. The HTTP statuses are guidance for Phase 8.
- Missed events come from `state.load` up to the already-loaded tip, never `eventsSince`, so a commit that lands mid-request never leaks into the events.
- A present but non-string `rulesPreset` → `InvalidRequest('rulesPreset')`. An unknown configured default is a server misconfiguration and propagates unmapped.
- Only state `GameNotFoundError` (and the race-path `CommitNotFoundError`, treated as no match) are translated; corrupt or storage errors propagate, so Phase 8 should answer 500. A game deleted mid-race answers `GameNotFound`.
- The retry/race match test is the same for FR-714 and FR-719 (same `clientRequestId` and same `actorSeat`); a different seat with the same id is a conflict.
- An `ENGINE_VERSION` bump abandons games in progress (`GameUnsupported`); retention removes them.
- `node:crypto` is imported by name only, so tests can partially mock it. Tests use `vi.mock` with `importOriginal`, never `vi.spyOn` on ESM namespaces.

## Known limits (still true at freeze)
- I/O budget with an exact `head.json`:
  - successful `submitMove`: 8 store calls (+1 at game over);
  - `getUpdate`: 6, or 6 + 2·(t − v − 1) with `since`;
  - stale 409: 8 + 2·(t − v − 1);
  - `createGame`: 4 puts, 0 reads;
  - the first round puts 4 calls in flight together.
- One human seat (seat 0) per game. Auth already supports several human seats, so multi-user needs no auth change.
- Only the `random` AI strategy exists, with no per-seat strategy choice.
- `AiLoopLimitError` and engine/state/storage errors may carry secrets: log them, never serialize them to clients.
- Tested only on `MemoryObjectStore`; real Blob latency is unverified until Phase 8.

## Deliberately excluded
- HTTP (routes, Zod schemas, `Authorization` header, status mapping, `Cache-Control`, logging, config-wired factory), rate limiting and the preset list endpoint all go to Phase 8. UI goes to Phase 9 and retention to Phase 10.
- No changes to `src/domain`, `src/engine`, `src/score`, `src/players`, `src/state`, `src/storage`.
