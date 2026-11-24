# Spec 08 — HTTP API

> Version: 0.1 · Last updated: 2026-11-23 · Status: Draft · Owner: Federico Castañeda
> Source: [`docs/implementation.md`](../docs/implementation.md) §3 Phase 8. Context: [`docs/architecture.md`](../docs/architecture.md) §5, §6.3, §6.5, §7, §8, §9, §10, §11; [`docs/design.md`](../docs/design.md) §5.5, §9.
> Builds on: [`specs/07-game-service-frozen.md`](./07-game-service-frozen.md) (`GameService`, the seven service errors, `CreateGameRequest`, `SubmitMoveRequest`, BR-701 secrets), [`specs/06-game-state-manager-frozen.md`](./06-game-state-manager-frozen.md) (`GameStateManager`, `GameNotFoundError`, `CommitNotFoundError`, `MAX_COMMIT_VERSION`, `headKey`), [`specs/05-storage-frozen.md`](./05-storage-frozen.md) (`createObjectStore`, `MemoryObjectStore`), [`specs/01-domain-model-frozen.md`](./01-domain-model-frozen.md) (`PRESET_IDS`, `getPreset`, `PlayerUpdate`, `GameEventSchema`, `CardSchema`), [`specs/00-project-scaffold-frozen.md`](./00-project-scaffold-frozen.md) (`getConfig`, `ConfigError`, `Config`; `app/api/**` is unrestricted by the layer rule).
> Requirement IDs use the 8xx range.

## Purpose

`GameService` (Phase 7) can create, show and advance a game, but nothing reaches it over the network. This spec delivers the HTTP API from architecture §7 as Next.js Route Handlers: four routes, `Authorization: Bearer` seat auth, Zod-validated requests with limits, a single mapping from service errors to status codes, `Cache-Control: no-store`, one structured log line per request, and a config-wired service factory. It also proves, by test, that no response leaks another seat's hand, the stock or the seed. It ships a move-latency benchmark script that can run against any storage driver, so the preview Blob measurement (architecture open question 1) is one command once a preview store exists. It completes milestone M2: a game can be played end to end with `curl` against `pnpm dev`. It benefits the UI work in Phase 9, and the human tester, who can play a full game over HTTP.

## Scope

**In**
- Route files:
  - `app/api/games/route.ts` (POST)
  - `app/api/games/[id]/route.ts` (GET)
  - `app/api/games/[id]/moves/route.ts` (POST)
  - `app/api/presets/route.ts` (GET)
- Shared HTTP code in `app/api/_lib/` (Next ignores `_`-prefixed folders for routing):
  - `schemas.ts`: request and strict response Zod schemas
  - `errors.ts`: the error mapper
  - `auth.ts`: `Authorization` parsing
  - `body.ts`: JSON body reading with a size cap
  - `log.ts`: request logger
  - `service-factory.ts`: config-wired, memoised `GameService`
  - `presets.ts`: preset labels
  - `handlers.ts`: route logic with injectable deps
- `scripts/bench-moves.ts` and a `bench:moves` package script.
- API tests in `tests/api/`, run on `MemoryObjectStore`, plus a bench-script smoke test.
- Docs:
  - `docs/architecture.md`: §7 gains the 410 and 413 rows and the request rules; §10 gains the log levels; §11 notes that the preview benchmark is still pending.
  - `docs/development.md`: a new §16 "HTTP API" (Known limitations becomes §17, cross-references updated).
  - `docs/implementation.md`: the Phase 8 note that the preview run moved to Phase 5b/11.

**Out**
- Deploying to a Vercel preview and recording the preview p95 in architecture §11. This moves to Phase 5b/11 and architecture open question 1 stays open (see BR-806).
- `GET /api/cron/cleanup` and retention (Phase 10); UI (Phase 9).
- Rate limiting, CORS, accounts, multi-human lobby routes (architecture §12).
- Validating responses at runtime in handlers: the strict response schemas are used by tests only.
- Any change to `src/**` (domain, engine, score, players, state, storage, service, config) or to the ESLint layer table.

## Actors

| Actor | Description | Permissions |
|---|---|---|
| Browser / `curl` client | Anyone who can reach the deployment | `POST /api/games`, `GET /api/presets`; with a seat token, `GET /api/games/{id}` and `POST /api/games/{id}/moves` for that seat only |
| Route handlers | Next.js Route Handlers under `app/api` | The only HTTP entry to `GameService`; one service per function instance via the factory |
| Developer | Runs `pnpm dev`, `curl`, `pnpm bench:moves` | Local file store under `.data/`; Blob only with `BLOB_READ_WRITE_TOKEN` |
| Tests | Call the handler functions directly | Inject a service over `MemoryObjectStore`, a clock and a log sink |

## Functional Requirements

### Common response rules

- **FR-800 (Must)** — Every response from every route in this spec has `Content-Type: application/json` and `Cache-Control: no-store`, whatever its status.
- **FR-801 (Must)** — Every error response body is exactly `{ error: { code, message } }`. The single exception is 409, whose body is `{ error: { code, message }, update }` (FR-806). `message` is a fixed English sentence for each code (FR-806 table). For `invalid_request`, the message also names the offending field when one is known, e.g. `Invalid request: aiCount`. No error body contains a stack trace, an internal error's message, a seat token or any field of a non-service error.

### Request parsing

- **FR-802 (Must) — JSON bodies.** On the two POST routes, the body is read as text, capped at **16,384 bytes**.
  - A body over the cap → 413 `payload_too_large`.
  - A `Content-Type` whose media type is not `application/json` (parameters such as `charset` are allowed) → 400 `invalid_request`, field `body`.
  - Text that is not valid JSON, or JSON that is not an object (`null`, an array or a primitive) → 400 `invalid_request`, field `body`.
- **FR-803 (Must) — Strict request schemas.** Request bodies are validated with strict Zod objects. Any unknown field, `seed` included, gives 400 `invalid_request` naming that field.
  - `POST /api/games`: `{ humanName: string, aiCount: number, rulesPreset?: string }`.
    - `humanName`: 1–40 characters after `trim()`.
    - `aiCount`: an integer, 2–5.
    - `rulesPreset`: one of `PRESET_IDS`.
  - `POST /api/games/{id}/moves`: `{ version: number, moveId: string, clientRequestId: string }`.
    - `version`: an integer, 0–`MAX_COMMIT_VERSION − 1`.
    - `moveId`: 1–32 characters.
    - `clientRequestId`: 1–128 characters.

  The field named in the message is the first Zod issue's top-level path segment. These limits equal the service's own (spec 07 FR-701, FR-713). The service checks them again and still owns the cross-field check (`aiCount + 1` within the preset's player range), which reaches the client as `InvalidRequest` → 400.
- **FR-804 (Must) — `?since`.** On `GET /api/games/{id}`, the query parameter `since` is optional.
  - When present, it must appear once and match `^(0|[1-9][0-9]{0,7})$` with a value ≤ `MAX_COMMIT_VERSION`. Otherwise → 400 `invalid_request`, field `since`. This includes an empty value, `-1`, `1.5`, `abc`, a leading zero and a repeated parameter.
  - After the service returns, a `since` greater than the returned `update.version` → 400 `invalid_request`, field `since`.
  - Other query parameters are ignored.
- **FR-805 (Must) — Seat auth.** On the two seat-token routes, the `Authorization` header must match `^Bearer ([A-Za-z0-9_-]{1,256})$`, with the scheme matched case-insensitively and exactly one space. A missing header or one that doesn't match → 401 `unauthorized`, before any storage I/O. The captured token is passed to the service. A well-formed but wrong token → 401 via the service's `Unauthorized`.
- **FR-806 (Must) — Check order.** On `GET /api/games/{id}` and `POST /api/games/{id}/moves`, checks run in this order and the first failure wins:
  1. the `id` path segment must match `^[a-z2-7]{26}$` → else 404 `game_not_found`;
  2. the `Authorization` header (FR-805) → 401;
  3. the body (FR-802, FR-803) or `since` syntax (FR-804) → 413/400.

  The service is called only after all three pass. `POST /api/games` runs FR-802, then FR-803.

### Error mapping

- **FR-807 (Must)** — One function, `toErrorResponse(err)` in `app/api/_lib/errors.ts`, maps every thrown value to a response with this table:

| Thrown | Status | `code` | `message` |
|---|---|---|---|
| `InvalidRequest` (service) or a request-parse failure (FR-802–FR-804) | 400 | `invalid_request` | `Invalid request` or `Invalid request: <field>` |
| `Unauthorized` (service) or FR-805 failure | 401 | `unauthorized` | `Missing or invalid seat token` |
| `NotYourTurn` | 403 | `not_your_turn` | `It is not your turn` |
| `GameNotFound` (service), FR-806 step 1, state `GameNotFoundError`, state `CommitNotFoundError` | 404 | `game_not_found` | `Game not found` |
| `VersionConflict` | 409 | `version_conflict` | `The game has moved on; see update` — body also carries `update` (the error's `PlayerUpdate`) |
| `GameUnsupported` | 410 | `game_unsupported` | `This game was created by an older version and can no longer be played` |
| Body over 16 KB (FR-802) | 413 | `payload_too_large` | `Request body too large` |
| `IllegalMove` | 422 | `illegal_move` | `That move is not legal now` |
| Anything else (engine, state, storage, `AiLoopLimitError`, `ConfigError`, non-`Error` values) | 500 | `internal` | `Internal error` |

  The state errors are mapped to 404 because a game deleted partway by retention (architecture §6.5) surfaces as one of them, and such a game must answer 404.

### Routes

- **FR-808 (Must) — `POST /api/games`.** On a valid body, the route calls `service.createGame({ humanName, aiCount, rulesPreset })` and responds **201** with `{ gameId, seat, seatToken, update }`, exactly the service result.
- **FR-809 (Must) — `GET /api/games/{id}`.** The route calls `service.getUpdate(id, token, since)` and responds 200 with the `PlayerUpdate` (FR-804 for `since`).
- **FR-810 (Must) — `POST /api/games/{id}/moves`.** The route calls `service.submitMove(id, token, { version, moveId, clientRequestId })` and responds 200 with the `PlayerUpdate`. An idempotent retry (same `clientRequestId`, same seat; spec 07 FR-714/FR-719) also responds 200, with a body equal to the original response.
- **FR-811 (Must) — `GET /api/presets`.** The route responds 200 with `{ defaultPresetId, presets }`. `defaultPresetId` is `config.defaultRulesPreset`. `presets` is one entry per id in `PRESET_IDS` order: `{ id, name, description, players: { min, max }, deck }`.
  - `players` comes from `getPreset(id).players`.
  - `deck` is `getPreset(id).deck.id`.
  - `name` and `description` come from a static table in `app/api/_lib/presets.ts` keyed by every `PresetId`, with a compile-time exhaustiveness check:

| id | name |
|---|---|
| `argentina-fidepo` | `Argentina (F.I.DE.PO.)` |
| `spain-ludoteka` | `Spain (Ludoteka)` |
| `gamerules` | `GameRules` |
| `mexico-bazas` | `Mexico (Bazas)` |

  Each `description` is a single sentence of 1–200 characters that names the deck and the hand-sequence shape (design §4.3). It makes no storage call.

### Service factory and handlers

- **FR-812 (Must)** — `getService()` in `app/api/_lib/service-factory.ts` builds `getConfig()` → `createObjectStore(config)` → `new GameStateManager(store)` → `new GameService({ state, defaultPresetId: config.defaultRulesPreset })` on its first successful call and returns the same instance on later calls in the same module instance. A failure (e.g. `ConfigError`, missing Blob credentials) is thrown to the caller and not cached, so the next call tries again. The handler maps it to 500 `internal` (FR-807) and logs it (FR-814).
- **FR-813 (Must)** — The route logic lives in `app/api/_lib/handlers.ts` as functions `(request, context, deps)`, where `deps = { getService, getConfig, now, log }`. `now` returns milliseconds for durations and `log` is a sink taking a level and a JSON-serialisable object. Each `route.ts` exports only the Next.js method names (`GET`/`POST`) and binds them to the default deps (the real factory, `getConfig`, `performance.now`, a console sink). Tests call the handler functions with injected deps.

### Logging

- **FR-814 (Must) — Request line.** Every request emits exactly one request line with the fields `{ route, gameId, seat, fromVersion, toVersion, aiMoves, status, durationMs, errorCode }`. It is written with `console.log` as one JSON line at level `info`. Fields:
  - `route`: the route pattern, e.g. `POST /api/games/[id]/moves`.
  - `gameId`: the path id or created id, or `null`.
  - `seat`: the responding seat (`0` for create), or `null` when unauthenticated or unknown.
  - `fromVersion`: the request `version` or `since`, or `null`.
  - `toVersion`: the response update's version (including the 409 update), or `null`.
  - `aiMoves`: the number of `bid-made` and `card-played` events in the response's `events` whose `seat` ≠ the responding seat, or `null` without an update.
  - `status`: the HTTP status.
  - `durationMs`: an integer ≥ 0, measured with `deps.now`.
  - `errorCode`: the error `code`, or `null`.
- **FR-815 (Must) — Error line.** A 500 additionally emits one line at level `error` (`console.error`) with `{ route, gameId, errorName, errorMessage, stack }` taken from the thrown value.
- **FR-816 (Must) — Level gating.** `config.logLevel` gates both lines: the request line is emitted iff the level is `debug` or `info`; the error line always is (its level is `error`). When `getConfig()` itself throws, both lines are emitted, defaulting to `info`.

### Benchmark

- **FR-817 (Must)** — `pnpm bench:moves` runs `tsx scripts/bench-moves.ts`, which builds a `GameService` in-process over `createObjectStore(getConfig())` (so `STORAGE_DRIVER`/`BLOB_READ_WRITE_TOKEN` choose the store). Options: `--samples N` (default 50, integer 1–10,000) and `--ai N` (default 3, 2–5). An invalid option exits with code 2 and a usage message on stderr.
- **FR-818 (Must)** — For each sample it creates a game and times `submitMove` (first legal move, `clientRequestId` unique per call) in three cases:
  - **cold:** the first `submitMove` after a new `ObjectStore`, `GameStateManager` and `GameService` are built for that sample;
  - **warm:** a second `submitMove` on the same instances;
  - **stale-hint:** a third `submitMove`, made after `head.json` for that game is overwritten with a version 2 below the tip (or 0 when the tip is below 2), using `headKey` and `putJson(..., { mode: 'overwrite' })` with the `HeadSchema` shape.

  A sample whose game is over before all three moves is replaced by a new game.
- **FR-819 (Must)** — It prints one JSON object to stdout: `{ driver, samples, cases: { cold, warm, staleHint } }`, each case `{ n, p50Ms, p95Ms, maxMs }`. Percentiles use the nearest-rank method, and all numbers are rounded to 0.1 ms. It exits 0. Errors go to stderr with exit code 1, and no seat token or state is printed.

### Docs

- **FR-820 (Must)** — Update the docs as follows:
  - `docs/architecture.md` §7: add the 410 `game_unsupported` and 413 `payload_too_large` rows, the 201 for create, the strict-body, size-cap and check-order rules, and `GET /api/presets`'s response shape.
  - `docs/architecture.md` §10: add the log levels (FR-816) and the error line.
  - `docs/architecture.md` §11: a "Pending" note that the preview benchmark is to be run with `pnpm bench:moves`.
  - `docs/development.md` §16 "HTTP API" (Known limitations renumbered to §17): routes, request rules, the error table, the handler/deps test pattern, the factory, logging, a worked `curl` session against `pnpm dev`, and how to run `pnpm bench:moves` against file or Blob.
  - `docs/implementation.md` Phase 8: note that the preview deploy and §11 record moved to Phase 5b/11.

## Business Rules

- **BR-801 — No leaks.** No response body contains the game seed, a seat-token hash, any card in another seat's current hand, or any undealt stock card. The one exception is the dealer's shown trump card (`trumpCard` when `trumpCardInDealerHand`). No body contains a key named `seed`. Cards that were played (`events`, `currentTrick`, `lastTrick`) are allowed. The seat token appears only in the 201 body of `POST /api/games`. *Rationale:* architecture §8, design §5.5. *Exceptions:* the trump card above.
- **BR-802 — Server-only errors stay on the server.** Non-service errors are logged (FR-815) and answered with the fixed 500 body. They are never serialized into a response. *Rationale:* `AiLoopLimitError.state` holds every hand and the seed (spec 07). *Exceptions:* none.
- **BR-803 — Never log secrets.** No log line contains a seat token, the `Authorization` header, a seat-token hash, a seed, a hand or a request/response body. The error line's `errorMessage`/`stack` come from errors whose messages are secret-free by specs 05–07; `AiLoopLimitError.state` is not logged. *Rationale:* architecture §10. *Exceptions:* none.
- **BR-804 — One mapping.** `toErrorResponse` is the only place that turns an error into a status code; handlers never set an error status themselves. *Rationale:* architecture §10. *Exceptions:* none.
- **BR-805 — Handlers are thin.** Handlers parse, call one service method (or none, for presets), and serialize. They do not touch storage, the engine or the state manager directly (the factory and the bench script excepted). *Rationale:* AD-7, one owner of game logic. *Exceptions:* `service-factory.ts`; `scripts/bench-moves.ts`, which writes `head.json` to build the stale-hint case.
- **BR-806 — The benchmark has not closed OQ 1.** Until a preview run is recorded, the docs must not claim that the 500 ms p95 target is met. *Rationale:* the user's decision to defer the preview run. *Exceptions:* none.

## Non-Functional Requirements

- **NFR-801 — Overhead.** On `MemoryObjectStore`, the API layer adds < 5 ms p95 over a direct `service.submitMove` call. This is measured over 200 moves in one API test.
- **NFR-802 — Test time.** All `tests/api/**` together run in < 20 s in the CI "Test" step.
- **NFR-803 — Gates.** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass. No new runtime dependency (`dependencies` stay `@noble/hashes, @vercel/blob, next, react, react-dom, zod`).

## Data & Interfaces

### Routes

| Method & path | Auth | Request | 2xx response |
|---|---|---|---|
| `POST /api/games` | – | `{ humanName, aiCount, rulesPreset? }` | 201 `{ gameId, seat, seatToken, update }` |
| `GET /api/games/{id}[?since=v]` | Bearer seat token | – | 200 `PlayerUpdate` |
| `POST /api/games/{id}/moves` | Bearer seat token | `{ version, moveId, clientRequestId }` | 200 `PlayerUpdate` |
| `GET /api/presets` | – | – | 200 `{ defaultPresetId, presets: [{ id, name, description, players: { min, max }, deck }] }` |

### `app/api/_lib` exports (in-repo contract for tests and Phase 9)

```ts
// schemas.ts
export const CreateGameBodySchema;      // strict, FR-803
export const SubmitMoveBodySchema;      // strict, FR-803
export const PlayerUpdateResponseSchema; // strict at every object level: version, events (GameEventSchema), view (all TableView + PlayerView fields), legalMoves
export const CreateGameResponseSchema;   // strict { gameId, seat, seatToken, update }
export const ErrorResponseSchema;        // strict { error: { code, message } }, plus `update` for 409
export const PresetsResponseSchema;      // strict
// errors.ts
export function toErrorResponse(err: unknown): { status: number; body: unknown };
// service-factory.ts
export function getService(): GameService;
// handlers.ts
export interface HandlerDeps {
  getService: () => GameService;
  getConfig: () => Config;
  now: () => number;
  log: (level: 'info' | 'error', line: Record<string, unknown>) => void;
}
export function createGameHandler(req: Request, deps: HandlerDeps): Promise<Response>;
export function getGameHandler(req: Request, ctx: { params: Promise<{ id: string }> }, deps: HandlerDeps): Promise<Response>;
export function submitMoveHandler(req: Request, ctx: { params: Promise<{ id: string }> }, deps: HandlerDeps): Promise<Response>;
export function presetsHandler(req: Request, deps: HandlerDeps): Promise<Response>;
```

`PlayerUpdateResponseSchema` mirrors the domain `PlayerUpdate`/`PlayerView`/`TableView` types exactly (spec 01), with a compile-time check that its inferred type equals `PlayerUpdate`. `seed`, `hands`, `stock`, `aiDecisionCount`, `seatTokenHashes` are therefore rejected wherever they appear.

### Error codes

`invalid_request` 400 · `unauthorized` 401 · `not_your_turn` 403 · `game_not_found` 404 · `version_conflict` 409 · `game_unsupported` 410 · `payload_too_large` 413 · `illegal_move` 422 · `internal` 500.

## Verification Criteria

All API VCs call the handler functions with `deps.getService` returning a `GameService` over a fresh `MemoryObjectStore`, unless they say otherwise. Every 2xx and 409 body is parsed with its strict response schema.

### Common rules
- **VC-800:** a response of every status this spec defines (200, 201, 400, 401, 403, 404, 409, 410, 413, 422, 500) → `Content-Type` is `application/json` and `Cache-Control` is `no-store`. *(FR-800)*
- **VC-801:** every non-2xx body in the suite parses with `ErrorResponseSchema`, and its `message` equals the FR-807 text for its code; a 500 caused by `new Error('secret-xyz')` → `message` is `Internal error` and the body contains neither `secret-xyz` nor `stack`. *(FR-801, BR-802)*

### Parsing
- **VC-802:** POST create with a body of 16,385 bytes → 413 `payload_too_large`; with exactly 16,384 bytes of valid JSON (long whitespace padding) → not 413. *(FR-802)*
- **VC-803:** POST create with `Content-Type: text/plain` → 400 `Invalid request: body`; with `application/json; charset=utf-8` and a valid body → 201. *(FR-802)*
- **VC-804:** POST create with bodies `{`, `null`, `[]`, `"x"`, `42` → each 400 `Invalid request: body`. *(FR-802)*
- **VC-805:** POST create with `{ humanName: 'A', aiCount: 3, seed: 'x' }` → 400 naming `seed`; with an extra `foo` field → 400 naming `foo`; POST move with an extra field → 400. *(FR-803)*
- **VC-806:** POST create boundaries → `humanName` `''`, `'   '`, 41 chars → 400 `humanName`; 40 chars (after trim) → 201; `aiCount` 1, 6, 2.5, `'3'` → 400 `aiCount`; 2 and 5 → 201; `rulesPreset: 'nope'` → 400 `rulesPreset`; each of the four `PRESET_IDS` with a fitting `aiCount` → 201. *(FR-803, FR-808)*
- **VC-807:** POST create with a valid body and a `getService` returning a wrapper whose `createGame` throws `new InvalidRequest('aiCount')` (the service's cross-field check) → 400 `Invalid request: aiCount`. *(FR-803, FR-807)*
- **VC-808:** POST move boundaries → `version` −1, 1.5, `MAX_COMMIT_VERSION` → 400 `version`; `moveId` `''` and 33 chars → 400 `moveId`; `clientRequestId` `''` and 129 chars → 400 `clientRequestId`; `moveId` 32 chars and `clientRequestId` 128 chars → not 400. *(FR-803)*
- **VC-809:** GET with `since` = `''`, `-1`, `1.5`, `abc`, `01`, `100000000`, and `since=0&since=0` → each 400 `Invalid request: since`; `since=0` → 200 with the events of commits 1…tip. *(FR-804)*
- **VC-810:** GET with `since` = tip → 200 with `events: []`; `since` = tip + 1 → 400 `Invalid request: since`. *(FR-804)*
- **VC-811:** GET and POST move with no `Authorization`, `Bearer` (no token), `Basic abc`, `Bearer  two-spaces`, `Bearer a b`, `Bearer ` + 257 chars → each 401 `unauthorized`, and a counting `ObjectStore` wrapper records 0 calls; `bearer <valid token>` (lower-case scheme) → 200. *(FR-805)*
- **VC-812:** a well-formed token that is not this game's → 401; the token of a different game → 401. *(FR-805)*
- **VC-813:** check order → an id `BAD` with no auth header and a bad body → 404; a valid-format unknown id with no header → 401; a valid-format id, a valid header and an invalid body → 400; the counting store records 0 calls in all three. *(FR-806)*

### Errors and routes
- **VC-814:** a unit test of `toErrorResponse` with one instance of each row's thrown type (including state `GameNotFoundError`, `CommitNotFoundError`, `AiLoopLimitError`, `ConfigError`, a string and `undefined`) → the FR-807 status and code. *(FR-807)*
- **VC-815:** POST create valid → 201; `seat` 0; `seatToken` 43 base64url chars; `update.version` 0; body parses with `CreateGameResponseSchema`. *(FR-808)*
- **VC-816:** GET with the creator's token → 200, `PlayerUpdate` with `version` = tip and `events: []`. *(FR-809)*
- **VC-817:** POST move with the first legal move at the current version → 200 with `version` + 1. *(FR-810)*
- **VC-818:** POST move with a `moveId` not in the legal moves → 422 `illegal_move`; nothing written (tip unchanged). *(FR-807, FR-810)*
- **VC-819:** POST move through a `getService` wrapper whose `submitMove` throws `new NotYourTurn(0)` → 403 `not_your_turn`. *(FR-807)*
- **VC-820:** POST move with a stale `version` and a new `clientRequestId` → 409 `version_conflict`, the body has `update` parsing with `PlayerUpdateResponseSchema` and `update.version` = tip. *(FR-807, FR-810)*
- **VC-821:** idempotent retry → the same POST move body sent twice → both 200 with deep-equal bodies, and the tip advanced by exactly 1; the same body sent again after a later move landed → 200 with the original body. *(FR-810)*
- **VC-822:** a game whose `meta.json` is rewritten (overwrite) with `engineVersion: ENGINE_VERSION + 1` → GET → 410 `game_unsupported`. *(FR-807)*
- **VC-823:** partial delete → after deleting `meta.json` → GET 404; after deleting commit 0 only → GET 404; after deleting commit 1 of a game at tip ≥ 3 and requesting `since=0` → 404 `game_not_found`. *(FR-807)*
- **VC-824:** `deps.getService` throws a `ConfigError` → POST create answers 500 `internal`, and one `error` line is logged with `errorName: 'ConfigError'`; the factory test: `getService()` with an invalid env throws, then with a fixed env returns a service, and a second call returns the same instance. *(FR-812, FR-815)*
- **VC-825:** GET presets → 200; parses with `PresetsResponseSchema`; ids in `PRESET_IDS` order; `defaultPresetId` = `deps.getConfig().defaultRulesPreset`; each `players` and `deck` equal `getPreset(id).players` and `.deck.id`; each `name` matches the FR-811 table; each `description` is 1–200 chars; `getService` is not called. *(FR-811)*
- **VC-826:** route files export only `GET`/`POST` (checked by importing each module and listing its keys), and `pnpm build` succeeds. *(FR-813)*

### Logging
- **VC-827:** each scripted request in VC-815–VC-823 produces exactly one `info` line with all nine FR-814 keys; for a POST move whose response has 4 AI `bid-made`/`card-played` events → `aiMoves: 4`, `fromVersion` = request version, `toVersion` = response version; for a 401 → `seat: null`, `toVersion: null`, `errorCode: 'unauthorized'`. *(FR-814)*
- **VC-828:** with `logLevel` `warn` → a 200 emits no line and a 500 emits exactly one `error` line; with `debug` → a 200 emits one `info` line. *(FR-816)*
- **VC-829:** across the whole API suite, no captured log line (serialized) contains any issued seat token, the string `Bearer`, any `seatTokenHashes` entry, any game's seed, or the key `hands`. *(BR-803)*
- **VC-830:** a test service wrapper throws `AiLoopLimitError` with a real state → 500 body contains no card of any hand and no seed; the `error` line contains no seed. *(BR-802, BR-803)*

### No leak
- **VC-831: No-leak scripted game**
  - Scenario: play full games over the handlers to `game-over` for `argentina-fidepo` with 4 seats (a full-deck deal: 4 × 13), and for `spain-ludoteka` with 3 seats. Every response is collected, including the 201, every GET with and without `since`, a provoked 409 and a provoked 422.
  - Input/State: at each response, the server's current state read directly from the store (`loadLatest`).
  - Expected Result: for each serialized body, no card held at that moment in another seat's hand appears as a `{suit, rank}` object anywhere in it (the `trumpCard` when `trumpCardInDealerHand` excepted), no undealt stock card appears, no key `seed`, `seatTokenHashes` or `aiDecisionCount` exists, and the seat token string appears only in the 201 body.
  - Failure Mode Covered: a view, event or error that serializes raw state.
  *(BR-801)*

### Benchmark and NFRs
- **VC-832:** `bench-moves` smoke test (spawned with `STORAGE_DRIVER=memory`, `--samples 3 --ai 2`) → exit 0; stdout is one JSON object with `driver: 'memory'`, `samples: 3`, and `cold`, `warm`, `staleHint` each with `n: 3` and numbers `p50Ms ≤ p95Ms ≤ maxMs`; stdout contains no seat token. `--samples 0` → exit 2 with usage on stderr. *(FR-817–FR-819)*
- **VC-833:** stale-hint case → a unit test of the bench's case runner over a recording `MemoryObjectStore` wrapper observes an overwrite `put` of `head.json` with `version` = tip − 2 (or 0) before the third `submitMove`, and that `submitMove` resolves with `version` = tip + 1. *(FR-818)*
- **VC-834:** NFR check → the 200-move API test reports API-layer p95 overhead < 5 ms vs direct service calls; CI "Test" step time for `tests/api` < 20 s; `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass; `package.json` `dependencies` unchanged. *(NFR-801–NFR-803)*

### Manual and docs
- **VC-835: Manual curl session**
  - Scenario: `pnpm dev` with the default env (file store), then the `curl` session from development.md §16: presets → create → GET → moves until game over → GET with `since`.
  - Expected Result: every call returns the documented status; `.data/games/<id>/commits/` holds one file per version; the last GET shows `phase: 'game-over'` and `finalRanking`.
  - Failure Mode Covered: Next.js wiring that only fails under the real server (params, body reading, headers).
  *(FR-808–FR-811, FR-813)*
- **VC-836:** docs → architecture §7 contains the 410 and 413 rows and the presets shape; §10 the log levels; §11 a pending-benchmark note and open question 1 still open; development.md has §16 "HTTP API" and §17 "Known limitations" with no stale `§16` cross-reference; implementation.md Phase 8 notes the deferral. *(FR-820, BR-806)*

## Open Questions

None.

## Assumptions

- `POST /api/games` answers **201** (resource created); the other success responses are 200.
- Strict response schemas are a test-time contract only; handlers do not parse responses at runtime (no latency cost, no runtime 500 on a schema drift).
- `params` in Next.js 16 Route Handlers is a `Promise`, so handlers `await ctx.params`.
- The request line uses `console.log` and the error line `console.error`, as architecture §10 prescribes; there is no logging library.
- `deck` in the presets response is the deck id (`french-52` / `spanish-40`), enough for the Phase 9 new-game form.
- The stale-hint case in the benchmark writes `head.json` directly; this is a benchmark-only exception to BR-805 and never runs in the app.
