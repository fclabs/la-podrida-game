# CONTEXT — HTTP API (Phase 8)

Last updated by: Iteration 4 (no-leak, secrets, structure and header tests). Branch `spec/08-http-api`.

## Current state

- Phases 0–7 are complete (domain, engine, score, players, storage, game state, game service). Phase 8 is in progress.
- **Iteration 1 done**: the pure HTTP building blocks in `app/api/_lib/` (`errors`, `http`, `body`, `auth`, `schemas`, `presets`) and their unit tests.
- **Iteration 2 done**: `log.ts` (request/error logging), `service-factory.ts`, `default-deps.ts`, `handlers.ts` (`HandlerDeps`, `createGameHandler`, `presetsHandler`), the routes `POST /api/games` and `GET /api/presets`, and `tests/api/support/api-fixtures.ts`. `tests/api/`: 8 files, 197 tests, ≈ 0.35 s. `pnpm build` is a gate and lists `ƒ /api/games` and `ƒ /api/presets` (both dynamic).
- **Iteration 3 done**: `getGameHandler`, `submitMoveHandler` in `handlers.ts`; the routes `GET /api/games/[id]` and `POST /api/games/[id]/moves`. **All four routes are live.** `pnpm build` lists `ƒ /api/games`, `ƒ /api/games/[id]`, `ƒ /api/games/[id]/moves`, `ƒ /api/presets`. `tests/api/`: 11 files, 274 tests, ≈ 0.65 s.
- **Iteration 4 done** (tests only, no `app/api/**` change): `tests/api/support/leak-oracle.ts` (`assertNoLeak`, P-12) and `tests/api/{no-leak,secrets,structure,headers}.test.ts`. **The API is complete and proven**: BR-801–BR-805, FR-800/FR-801 over all 11 statuses. `tests/api/`: 15 files, 329 tests, Duration ≈ 8.2 s (≈ 7.7 s of it is the two VC-831 games).
- **Not built yet**: docs only (Iteration 5).
- Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (target ES2022, no `noUncheckedIndexedAccess`), pnpm 10.15.1, Node 24 declared (a newer local Node prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3 (single quotes, width 100, trailing commas), zod 4.6.7. `package.json`/lockfile unchanged.
- Full `pnpm test`: 78 passed + 1 skipped files, 1468 passed + 30 skipped tests (≈ 8.6 s).

## File map

| Path | Contents |
|---|---|
| `app/api/_lib/errors.ts` | `ERROR_CODES`, `ErrorCode`, `ERROR_MESSAGES`, `RequestError`, `ErrorBody`, `toErrorResponse` (P-1). The only HTTP module with statuses ≥ 400 in mapping logic. |
| `app/api/_lib/http.ts` | `jsonResponse(status, body)` (P-2). |
| `app/api/_lib/body.ts` | `MAX_BODY_BYTES`, `readJsonBody(request)` (P-3). |
| `app/api/_lib/auth.ts` | `parseBearer(headers)`, `assertGameIdFormat(id)` (P-6). Local regexes; no `src/state` import. |
| `app/api/_lib/schemas.ts` | Request schemas + `parseBody`, `parseSince` (P-4, P-5); strict response schemas + compile-time `Equal` check (P-10). Imports `@/src/domain/schemas`, `@/src/state/keys`, `@/src/state/schemas`. |
| `app/api/_lib/presets.ts` | `PRESET_LABELS` (P-9). |
| `app/api/_lib/log.ts` | `LogLevel`, `LogSink`, `consoleLog`, `RouteResult`, `RequestLogMeta`, `RequestLogDeps`, `withRequestLog` (P-7). Holds `500` only as the `errorMessage` clip length. |
| `app/api/_lib/service-factory.ts` | `getService()` (P-8). The only `_lib` module importing `src/state` + `src/storage` for wiring. |
| `app/api/_lib/default-deps.ts` | `defaultDeps: HandlerDeps` (P-8). |
| `app/api/_lib/handlers.ts` | `HandlerDeps`, `GameRouteContext`, `createGameHandler`, `presetsHandler`, `getGameHandler`, `submitMoveHandler`. Imports only `zod`, `src/config` (type), `src/domain/presets`, `src/service/game-service` (type) and `./*`. No 4xx/5xx number anywhere in the file, comments included (D-014). |
| `app/api/games/route.ts` | `export const POST = (req: Request) => createGameHandler(req, defaultDeps);` |
| `app/api/presets/route.ts` | `export const GET = (req: Request) => presetsHandler(req, defaultDeps);` |
| `app/api/games/[id]/route.ts` | `export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) => getGameHandler(req, ctx, defaultDeps);` |
| `app/api/games/[id]/moves/route.ts` | same shape, `POST` → `submitMoveHandler`. |
| `tests/api/support/api-fixtures.ts` | `makeApi`, `postJson`, `getReq`, `ctx`, `readJson`, `createGameVia`, `wrapService`, `BASE_URL`, `DEFAULT_CREATE_BODY` (P-11); `bearer`, `GameIds`, `playToEndVia` (Iteration 3). |
| `tests/api/errors.test.ts` | VC-814, VC-801 (mapper part), `RequestError` shape. |
| `tests/api/body.test.ts` | VC-802/803/804 at unit level. |
| `tests/api/auth.test.ts` | VC-811 at parser level; id format. |
| `tests/api/schemas.test.ts` | VC-805/806/808/809 at schema/parser level; response schemas; `PRESET_LABELS`. |
| `tests/api/create.test.ts` | VC-815, VC-802–VC-807 and VC-801 at handler level, VC-824 handler part, VC-800 (201/400/413/500), VC-826 games route keys. |
| `tests/api/presets.test.ts` | VC-825, VC-800 (200), VC-826 presets route keys. |
| `tests/api/factory.test.ts` | VC-824 factory part (`vi.resetModules` + `vi.stubEnv`). |
| `tests/api/get-update.test.ts` | VC-816, VC-809, VC-810, VC-811/VC-812 (GET), VC-822 (410), VC-823 (partial delete), VC-800 (200), VC-826 `[id]` route keys. Local `advance(api, ids, n)` helper. |
| `tests/api/submit-move.test.ts` | VC-817, VC-818 (422), VC-819 (403), VC-820 (409), VC-821 (retry), VC-805 move part + VC-808 + 413 and `text/plain` body cases at handler level, VC-811/VC-812 (POST), VC-800 (403/409/422/401), VC-826 moves route keys, `playToEndVia` smoke. |
| `tests/api/check-order.test.ts` | VC-813 on both routes (0 store calls, 0 `getService` calls), malformed ids → 404. |
| `tests/api/logging.test.ts` | VC-827 (all routes: create, presets, move 200 with `aiMoves`, GET 200 with/without `since`, 401, 422, 409, 400 since), VC-828, FR-815 error-line shape, clipping, non-`Error` values, BR-803 for create/GET/move, D-013 malformed id → `gameId: null`, `consoleLog`. |
| `tests/api/support/leak-oracle.ts` | `assertNoLeak(body, ctx)`, `isCardObject`, `LeakContext`, `LeakCheckResult` (P-12, D-016). Reads meta, tip and every commit's events through `GameStateManager` (commit events cached per store/game). |
| `tests/api/no-leak.test.ts` | VC-831: `argentina-fidepo` (3 AIs) and `spain-ludoteka` (2 AIs) to game over, oracle on 201, every move, GET and GET `?since=0` after every move, one 409, one 422 (603 and 582 bodies); exact body tallies; 60 s per-game timeout (D-017). `P-12` describe: 14 mutated bodies the oracle must reject. |
| `tests/api/secrets.test.ts` | VC-829 (full game + 401/409/422/400/500 at `debug`: no token, `Bearer`, hash, seed, `"hands"`, card in logs), VC-830 (`AiLoopLimitError` with the real tip state → fixed 500 body, no card/seed in body or logs). |
| `tests/api/structure.test.ts` | VC-832: `handlers.ts` + the four `route.ts` have no 4xx/5xx number token, `status:`/`status =` literal or `jsonResponse(4xx` call; no import (static, dynamic, re-export, `require`, aliased or relative) of `src/state|storage|engine`; positive controls for both scanners; `errors.ts` holds the statuses; `service-factory.ts` is the exception (D-018). |
| `tests/api/headers.test.ts` | VC-800 (one real response per status 200, 201, 400, 401, 403, 404, 409, 410, 413, 422, 500, plus presets 200: both headers) and VC-801 (each error body parses with `ErrorResponseSchema`, exact message, `: body` for the 400, only `error` key — `error`+`update` for 409 — no `stack`/`secret-xyz`). |
| `tests/api/.gitkeep` | Pre-existing placeholder (left in place). |

## Public interfaces

```ts
// errors.ts
export const ERROR_CODES: readonly ['invalid_request','unauthorized','not_your_turn','game_not_found',
  'version_conflict','game_unsupported','payload_too_large','illegal_move','internal'];
export type ErrorCode = (typeof ERROR_CODES)[number];
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>>;   // exact FR-807 texts
export class RequestError extends Error {                            // name 'RequestError'
  readonly status: 400 | 401 | 404 | 413;
  readonly code: 'invalid_request' | 'unauthorized' | 'game_not_found' | 'payload_too_large';
  readonly field?: string;                                           // '' is stored as undefined
  constructor(status, code, field?);                                 // ORDER: status, code, field
}                                                                    // message = FR-807 message (+ ': field')
export interface ErrorBody { error: { code: ErrorCode; message: string }; update?: PlayerUpdate }
export function toErrorResponse(err: unknown): { status: number; body: ErrorBody };

// http.ts
export function jsonResponse(status: number, body: unknown): Response; // content-type application/json, cache-control no-store

// body.ts
export const MAX_BODY_BYTES = 16384;
export async function readJsonBody(request: Request): Promise<Record<string, unknown>>;
//   type check → 400 'body'; >16384 raw bytes → 413; fatal UTF-8 decode + JSON.parse + plain object → else 400 'body'

// auth.ts
export function parseBearer(headers: Headers): string;     // /^bearer ([A-Za-z0-9_-]{1,256})$/i, else RequestError(401,'unauthorized')
export function assertGameIdFormat(id: string): void;      // /^[a-z2-7]{26}$/, else RequestError(404,'game_not_found')

// schemas.ts
export const CreateGameBodySchema;   // strict { humanName (1–40 after trim, raw passed on), aiCount int 2–5, rulesPreset?: PresetId }
export const SubmitMoveBodySchema;   // strict { version int 0…MAX_COMMIT_VERSION−1, moveId 1–32, clientRequestId 1–128 }
export function parseBody<S extends z.ZodType>(schema: S, value: unknown): z.infer<S>;  // else RequestError(400,'invalid_request', field)
export function parseSince(url: URL): number | undefined;  // getAll('since'); 0 values → undefined; else RequestError(400,…,'since')
export const PlayerUpdateResponseSchema;  // strict everywhere; z.infer === PlayerUpdate (compile-time check)
export const CreateGameResponseSchema;    // strict { gameId (GAME_ID_PATTERN), seat, seatToken (43 base64url), update }
export const ErrorResponseSchema;         // strict { error: strict { code: enum ERROR_CODES, message }, update?: PlayerUpdateResponseSchema }
export const PresetsResponseSchema;       // strict { defaultPresetId, presets: strict[{ id, name, description 1–200, players: {min,max}, deck }] }

// presets.ts
export const PRESET_LABELS: Readonly<Record<PresetId, { name: string; description: string }>>;
```

```ts
// log.ts
export type LogLevel = 'info' | 'error';
export type LogSink = (level: LogLevel, line: Record<string, unknown>) => void;
export function consoleLog(level: LogLevel, line: Record<string, unknown>): void;   // info→console.log, error→console.error, JSON.stringify
export interface RouteResult { status: number; body: unknown; gameId?: string | null; fromVersion?: number | null; update?: PlayerUpdate }
export interface RequestLogMeta { gameId?: string | null; fromVersion?: number | null }   // mutable, filled by fn before it may throw
export interface RequestLogDeps { getConfig: () => Config; now: () => number; log: LogSink }
export function withRequestLog(route: string, deps: RequestLogDeps,
  fn: (meta: RequestLogMeta) => Promise<RouteResult>): Promise<Response>;
//   start=now(); run fn (throw → toErrorResponse; update = body.update on 409); end=now();
//   seat = update?.view.you ?? null; aiMoves = bid-made/card-played with seat !== logged seat (null w/o update);
//   request line iff level debug|info (getConfig throws → 'info'); error line on any 500 from a throw, always.
//   Returned gameId/fromVersion override meta. Response always via jsonResponse.

// service-factory.ts
export function getService(): GameService;   // memoised; getConfig → createObjectStore → GameStateManager → GameService({state, defaultPresetId})

// default-deps.ts
export const defaultDeps: HandlerDeps;       // { getService, getConfig, now: () => performance.now(), log: consoleLog }

// handlers.ts
export interface HandlerDeps { getService: () => GameService; getConfig: () => Config; now: () => number; log: LogSink }
export function createGameHandler(req: Request, deps: HandlerDeps): Promise<Response>;  // route 'POST /api/games'; 201
export function presetsHandler(req: Request, deps: HandlerDeps): Promise<Response>;     // route 'GET /api/presets'; 200; never calls getService
export interface GameRouteContext { params: Promise<{ id: string }> }
export function getGameHandler(req: Request, ctx: GameRouteContext, deps: HandlerDeps): Promise<Response>;
//   'GET /api/games/[id]': id fmt → meta.gameId → bearer → parseSince → meta.fromVersion=since??null
//   → getUpdate(id, token, since) → since > update.version ⇒ 400 'since' (via parseBody, D-014) → 200 update
export function submitMoveHandler(req: Request, ctx: GameRouteContext, deps: HandlerDeps): Promise<Response>;
//   'POST /api/games/[id]/moves': id fmt → meta.gameId → bearer → readJsonBody+parseBody(SubmitMoveBodySchema)
//   → meta.fromVersion=version → submitMove(id, token, body) → 200 update (retry → original body)

// tests/api/support/api-fixtures.ts
export function makeApi(opts?: { store?: RecordingStore; service?: GameService; logLevel?: Config['logLevel']; defaultPreset?: PresetId }):
  { deps: HandlerDeps; store: RecordingStore; service: GameService; logs: { level: LogLevel; line: Record<string, unknown> }[] };
  // deps fields are plain properties: tests reassign api.deps.getService / getConfig / now to inject failures
export function postJson(path, body, opts?: { headers?: Record<string,string>; rawBody?: Uint8Array<ArrayBuffer>; contentType?: string | null }): Request;
  // body always sent as bytes; contentType default 'application/json', null = no Content-Type header
export function getReq(path, headers?: Record<string,string>): Request;
export function ctx(id: string): { params: Promise<{ id: string }> };
export async function readJson<T = unknown>(res: Response): Promise<T>;
export async function createGameVia(api, body = { humanName: 'Ana', aiCount: 3 }): Promise<{ gameId; seatToken; update }>;  // asserts 201 + schema
export function wrapService(service: GameService, overrides: Partial<Pick<GameService,'createGame'|'getUpdate'|'submitMove'>>): GameService;
export function bearer(token: string): Record<string, string>;      // { authorization: `Bearer ${token}` }
export interface GameIds { gameId: string; seatToken: string; update: PlayerUpdate }   // createGameVia result fits
export async function playToEndVia(api: Api, ids: GameIds): Promise<PlayerUpdate[]>;
  // submitMoveHandler with the first legal move at the latest version, clientRequestId `via-<n>`;
  // asserts 200 + PlayerUpdateResponseSchema per response; last element is the game-over update

// tests/api/support/leak-oracle.ts
export interface LeakContext { store: ObjectStore; gameId: string; seat: number; seatToken: string; allowToken: boolean }
export interface LeakCheckResult { kind: 'none' | 'in-progress' | 'game-over'; stockTrump: boolean; fullDeal: boolean }
export function isCardObject(value: unknown): value is Card;   // plain object, own keys exactly suit+rank, both strings
export async function assertNoLeak(body: unknown, ctx: LeakContext): Promise<LeakCheckResult>;
  // throws (Vitest expect) on a leak; the update is body.update (201/409), the body itself (200), or none (422 …)
  // must be called right after the response: it asserts update.version === the store's tip
```

Mapping (`toErrorResponse`): `RequestError` → its own status/code/field; `InvalidRequest` → 400 with `reason` as field; `Unauthorized` 401; `NotYourTurn` 403; `GameNotFound` / state `GameNotFoundError` / state `CommitNotFoundError` 404; `VersionConflict` 409 + `update: err.update`; `GameUnsupported` 410; `IllegalMove` 422; anything else 500 `internal` (no field of the thrown value is used).

## Conventions & invariants

- **Imports (BR-805, VC-832)**: `schemas.ts` and `errors.ts` may import `@/src/state/*`; `auth.ts`, `body.ts`, `http.ts`, `presets.ts` do not, and `handlers.ts` / `route.ts` must not (nor `src/storage`, `src/engine`). Only `service-factory.ts` wires store + state.
- **Error statuses (BR-804, VC-832)**: handlers and routes never write a numeric status ≥ 400; they throw (`RequestError` or let service errors propagate) and call `toErrorResponse`. Every response goes through `jsonResponse`.
- **Check order on `[id]` routes (P-6)**: `assertGameIdFormat` → `parseBearer` → `readJsonBody`+`parseBody` or `parseSince`, all before `deps.getService()`. `POST /api/games`: `readJsonBody` → `parseBody`.
- **FR-804 post-call check** (`since > update.version` → 400 `since`) is in `getGameHandler`, using only the returned update, expressed as `parseBody(z.strictObject({ since: z.int().max(update.version) }), { since })` so no status literal lives in `handlers.ts` (D-014).
- **Response schemas are test-only**: handlers never parse responses.
- **Handlers (P-7/P-8)**: every handler body runs inside `withRequestLog(route, deps, async (meta) => …)`; `[id]` handlers set `meta.gameId` right **after** `assertGameIdFormat` passes (a malformed id logs `gameId: null`, D-013) and `meta.fromVersion` from `version`/`since` once parsed, so error lines carry them. Handlers return `{ status: 200|201, body, gameId?, fromVersion?, update? }` — `update` is what drives `seat`/`toVersion`/`aiMoves`. Route strings: `POST /api/games`, `GET /api/games/[id]`, `POST /api/games/[id]/moves`, `GET /api/presets`.
- **Routes (P-8)**: each `route.ts` is two imports + one `export const METHOD = …` line binding `defaultDeps`; nothing else exported (VC-826 tests `Object.keys(await import(route))`).
- **Factory test isolation**: `vi.resetModules()` in `beforeEach`, every config env var stubbed to `''` (counts as unset), then the factory, `GameService` and `ConfigError` imported dynamically so `instanceof` uses the same module graph; `vi.unstubAllEnvs()` in `afterEach`.
- **No-leak rules (BR-801, P-12)**: public cards are `view.trumpCard` (the turned-up stock card, or with `trumpCardInDealerHand` the dealer's last card — then it is also in the dealer's hand), `currentTrick`, `lastTrick`, `card-played.card` and every hand's `hand-dealt.trumpCard` (a `?since=0` GET replays earlier hands' events, whose cards may be in a later hand or stock). Everything else in `view` must avoid other seats' hands and the stock. At game over `trumpCard` is `null` and `yourHand` `[]`.
- **Tests**: one `describe` per VC/P-decision, titled `VC-8xx …` / `P-n …`; reuse `makeService` from `../unit/service/support/service-fixtures` and `RecordingStore` from `../unit/state/support/store-wrappers` by relative import (never modify them).
- **Commits**: one per iteration, staged by explicit path, message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge. Never modify `src/**`, `tests/{unit,contract,sim}/**`, configs, `package.json`, lockfile.

## Commands

All with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed (no network). In zsh, write the prefix literally.

| Command | What it does |
|---|---|
| `sh -c 'pnpm typecheck && pnpm lint && pnpm test && pnpm build'` | Iteration gate (≈ 30 s). `lint` = `eslint . --max-warnings 0 && prettier --check .`. |
| `pnpm build` | Gate from Iteration 2 on (≈ 10 s). Writes only `.next/` (gitignored) and `next-env.d.ts` (gitignored). |
| `pnpm test:sim` | Final Verification only (≈ 45 s). |
| `pnpm vitest run tests/api` | API tests (Iteration 4: 15 files, 329 tests, Duration ≈ 8.2 s; NFR-802 budget 20 s). |
| `pnpm exec prettier --write app/api tests/api` | Format before lint. |
| `git diff main -- package.json pnpm-lock.yaml src` | Must be empty (NFR-803, scope). |

## Known gaps

- Docs (Iteration 5): `docs/architecture.md` §7/§10/§11, `docs/development.md` §16 (+ §17 renumber), `docs/implementation.md` deferral notes.
- `ErrorBody.update` is typed `PlayerUpdate`; the spec's `toErrorResponse` signature says `body: unknown` — `ErrorBody` is a narrower, compatible type.
- A service `InvalidRequest('sinceVersion')` would surface as `Invalid request: sinceVersion`; in practice `parseSince` rejects bad values first.
- `GET ?since=0` re-reads every commit (service `eventsSince`), so it costs O(tip) reads; a ~200-move game read that way after every move dominates `tests/api` time (D-017). Not an API change; worth a line in the docs.
