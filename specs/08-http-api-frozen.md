# Frozen: Spec 08 — HTTP API

Source: specs/08-http-api.md (plan + build record: specs/08-http-api-plan.md, specs/08-http-api-plan-artifacts/; review: specs/08-http-api.review.md)
Status: SHIPPED
Frozen: 2026-11-24
PR / commit: https://github.com/fclabs/la-podrida-game/pull/10 — squash commit 7eb81ae

## Purpose
`GameService` (Phase 7) can create, show and advance a game, but nothing reaches it over the network. This spec delivers the HTTP API from architecture §7 as Next.js Route Handlers: four routes, `Authorization: Bearer` seat auth, Zod-validated requests with limits, a single mapping from service errors to status codes, `Cache-Control: no-store`, one structured log line per request, and a config-wired service factory. It also proves, by test, that no response leaks another seat's hand, the stock or the seed. It completes the local part of milestone M2: a game can be played end to end with `curl` against `pnpm dev`. The preview Blob measurements of M2, including the move benchmark, move to Phase 5b/11. It benefits the UI work in Phase 9, and the human tester, who can play a full game over HTTP.

## What it does
- **Every response** is JSON with `Cache-Control: no-store`. Errors are `{ error: { code, message } }`; a 409 also carries `update`. Messages are fixed per code; `invalid_request` names the field (`Invalid request: aiCount`). No body contains a stack, an internal error message, a seat token or a non-service error's fields.
- **POST bodies** are checked in this order, and the first failure wins:
  1. The media type must be `application/json` (case-insensitive, parameters allowed), else 400 field `body`.
  2. More than 16,384 raw bytes → 413. `Content-Length` is ignored.
  3. The bytes must be strict UTF-8 JSON that parses to an object, else 400 field `body`.
- **Strict request schemas** reject any unknown key, `seed` included. The service's limits apply: `humanName` 1–40 chars after trim; `aiCount` an integer 2–5; `rulesPreset` in `PRESET_IDS`; `version` 0–`MAX_COMMIT_VERSION − 1`; `moveId` 1–32 chars; `clientRequestId` 1–128 chars. The field named is `issue.keys[0]` for unknown keys, else the top-level path segment. The service still owns the cross-field check (`aiCount + 1` within the preset's player range), which also answers 400.
- **`?since`** is optional. When present it must appear once, match `^(0|[1-9][0-9]{0,7})$` and be ≤ `MAX_COMMIT_VERSION`, else 400 `since`. A value above the returned `update.version` → 400. Other query parameters are ignored.
- **Seat auth** requires `Authorization` to match `^Bearer ([A-Za-z0-9_-]{1,256})$` (scheme case-insensitive, one space), else 401 before any storage I/O. A wrong token → 401 via the service.
- **Check order** on the `[id]` routes: id `^[a-z2-7]{26}$` (else 404) → auth (401) → body or `since` (413/400) → service call. Create runs the body checks, then the schema.
- **Routes:**
  - Create answers 201 with exactly the service result.
  - GET answers 200 with the `PlayerUpdate`.
  - A move answers 200. An idempotent retry also answers 200, with a body equal to the original.
  - Presets answer 200 with `{ defaultPresetId: config.defaultRulesPreset, presets }`, in `PRESET_IDS` order. `players` and `deck` (the deck id) come from `getPreset`. `name` and `description` come from an exhaustive table (`Argentina (F.I.DE.PO.)`, `Spain (Ludoteka)`, `GameRules`, `Mexico (Bazas)`). This route makes no storage call.
- **`getService()`** builds config → store → `GameStateManager` → `GameService` on its first successful call and memoises it. A failure such as `ConfigError` or missing Blob credentials is thrown, not cached, and becomes a 500.
- **Handlers** live in `app/api/_lib/handlers.ts` and take injected `deps = { getService, getConfig, now, log }`. Each `route.ts` only exports `GET`/`POST` bound to the default deps.
- **Logging:**
  - Every request logs one `info` JSON line: `{ route, gameId, seat, fromVersion, toVersion, aiMoves, status, durationMs, errorCode }`.
    - `seat` is set only when the response carries an update (201, 200, 409); otherwise it is null, including for 403, 410 and 422.
    - `aiMoves` counts other seats' `bid-made`/`card-played` events in the response.
    - A malformed path id is logged as `gameId: null`.
  - A 500 also logs one `error` line: `{ route, gameId, errorName, errorMessage, stack }`.
  - The request line is emitted only at `logLevel` `debug`/`info`; the error line always is. If `getConfig()` throws, both are emitted.
- **BR-801 No leaks.** No body contains the seed, a token hash, a card in another seat's current hand or an undealt stock card, nor a key named `seed`.
  - The exception is the public trump card, whether it is the turned-up stock card or the dealer's last card.
  - Already-revealed cards are allowed even if the same card is dealt again later.
  - The seat token appears only in the create 201 body.
- **BR-802/803** Non-service errors are logged, never serialized. No log line contains a token, the `Authorization` header, a hash, a seed, a hand or a request/response body.
- **BR-804/805** `toErrorResponse` is the only place that sets an error status. Handlers parse, call one service method and serialize; they never import `src/state`, `src/storage` or `src/engine`. `service-factory.ts` is the one exception.
- **BR-806** No doc may claim the 500 ms p95 target is met until a preview benchmark is recorded.

## Public interfaces / data

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

Mapping: `InvalidRequest`/parse failures → 400; `Unauthorized`/bad header → 401; `NotYourTurn` → 403; `GameNotFound`, bad id format, state `GameNotFoundError`/`CommitNotFoundError` → 404; `VersionConflict` → 409 + `update`; `GameUnsupported` → 410; body > 16 KB → 413; `IllegalMove` → 422; anything else (engine, state, storage, `AiLoopLimitError`, `ConfigError`, non-`Error`) → 500.

Other shipped `_lib` modules (internal): `http.ts` (`jsonResponse`), `body.ts` (`readJsonBody`, `MAX_BODY_BYTES`), `auth.ts` (`parseBearer`, `assertGameIdFormat`), `log.ts` (`withRequestLog`), `presets.ts` (`PRESET_LABELS`), `default-deps.ts`.

## Key decisions
- **Create returns 201**; everything else succeeds with 200. `GameUnsupported` maps to 410: the game is gone for good, not missing.
- **State `GameNotFoundError`/`CommitNotFoundError` map to 404**, because a game that retention deletes partway through must answer 404.
- **Unknown request keys are rejected**, not stripped, so a client can't smuggle in `seed` or misspell a field without noticing.
- **The size cap counts raw bytes** before decoding (16 KB ≫ the largest valid body), and the type check runs first.
- **Response schemas are a test-time contract only.** Handlers never parse their own responses, so there is no latency cost and schema drift never causes a runtime 500.
- **The factory is lazy and doesn't cache failures.** Bad config answers 500 per request instead of crashing at import, and recovers once fixed.
- **Request line at `info`, 500 line at `error`**, with no logging library (architecture §10).
- **Preset names and descriptions** live in an API-side label table with an exhaustiveness check; `src/domain` is unchanged.
- **The post-call `since` check** throws from `schemas.ts` through `parseBody`, so handlers stay free of status literals. A static test (VC-832) enforces this and the import ban.

## Known limits (still true at freeze)
- **Architecture open question 1 (500 ms p95 move on Blob) is still open.** The benchmark script, preview deploy and §11 record moved to Phase 5b/11.
- **Tests run only on `MemoryObjectStore`.** The file store is exercised only by the manual curl session, and Blob not at all.
- **The service's I/O budget per request** (spec 07) still applies; HTTP adds no store calls.
- **No rate limiting, CORS, accounts or multi-human lobby.** There is one human seat (seat 0).
- **Server-only `src/state` imports.** `schemas.ts` imports from `src/state` (`ScoreBoardSchema`). Phase 9 client code should use `import type` from `@/src/domain/types`, not from `app/api/_lib`.
- **The Vercel project's deployment check fails** with `No Output Directory named "dist"` (a project-settings issue; the Next.js build itself succeeds). It also failed on PR #9.

## Deliberately excluded
- The benchmark and preview deploy (Phase 5b/11), cron cleanup and retention (Phase 10), UI (Phase 9), rate limiting, CORS and accounts.
- No changes to `src/**` or to the ESLint layer table.
