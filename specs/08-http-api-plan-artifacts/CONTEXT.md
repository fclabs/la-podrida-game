# CONTEXT — HTTP API (Phase 8)

Last updated by: Iteration 2 (logging, service factory, create and presets routes). Branch `spec/08-http-api`.

## Current state

- Phases 0–7 are complete (domain, engine, score, players, storage, game state, game service). Phase 8 is in progress.
- **Iteration 1 done**: the pure HTTP building blocks in `app/api/_lib/` (`errors`, `http`, `body`, `auth`, `schemas`, `presets`) and their unit tests.
- **Iteration 2 done**: `log.ts` (request/error logging), `service-factory.ts`, `default-deps.ts`, `handlers.ts` (`HandlerDeps`, `createGameHandler`, `presetsHandler`), the routes `POST /api/games` and `GET /api/presets`, and `tests/api/support/api-fixtures.ts`. `tests/api/`: 8 files, 197 tests, ≈ 0.35 s. `pnpm build` is a gate and lists `ƒ /api/games` and `ƒ /api/presets` (both dynamic).
- **Not built yet**: `getGameHandler`, `submitMoveHandler`, `app/api/games/[id]/route.ts`, `app/api/games/[id]/moves/route.ts` (Iteration 3); the leak oracle and structure/secrets/headers tests (Iteration 4); docs (Iteration 5).
- Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (target ES2022, no `noUncheckedIndexedAccess`), pnpm 10.15.1, Node 24 declared (a newer local Node prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3 (single quotes, width 100, trailing commas), zod 4.6.7. `package.json`/lockfile unchanged.
- Full `pnpm test`: 71 passed + 1 skipped files, 1336 passed + 30 skipped tests (≈ 3 s).

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
| `app/api/_lib/handlers.ts` | `HandlerDeps`, `createGameHandler`, `presetsHandler` (Iteration 3 adds `getGameHandler`, `submitMoveHandler`). Imports only `src/config` (type), `src/domain/presets`, `src/service/game-service` (type) and `./*`. |
| `app/api/games/route.ts` | `export const POST = (req: Request) => createGameHandler(req, defaultDeps);` |
| `app/api/presets/route.ts` | `export const GET = (req: Request) => presetsHandler(req, defaultDeps);` |
| `tests/api/support/api-fixtures.ts` | `makeApi`, `postJson`, `getReq`, `ctx`, `readJson`, `createGameVia`, `wrapService`, `BASE_URL`, `DEFAULT_CREATE_BODY` (P-11). |
| `tests/api/errors.test.ts` | VC-814, VC-801 (mapper part), `RequestError` shape. |
| `tests/api/body.test.ts` | VC-802/803/804 at unit level. |
| `tests/api/auth.test.ts` | VC-811 at parser level; id format. |
| `tests/api/schemas.test.ts` | VC-805/806/808/809 at schema/parser level; response schemas; `PRESET_LABELS`. |
| `tests/api/create.test.ts` | VC-815, VC-802–VC-807 and VC-801 at handler level, VC-824 handler part, VC-800 (201/400/413/500), VC-826 games route keys. |
| `tests/api/presets.test.ts` | VC-825, VC-800 (200), VC-826 presets route keys. |
| `tests/api/factory.test.ts` | VC-824 factory part (`vi.resetModules` + `vi.stubEnv`). |
| `tests/api/logging.test.ts` | VC-827 (create/presets part), VC-828, FR-815 error-line shape, clipping, non-`Error` values, BR-803 for create, `consoleLog`. Iteration 3 extends it. |
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
```

Mapping (`toErrorResponse`): `RequestError` → its own status/code/field; `InvalidRequest` → 400 with `reason` as field; `Unauthorized` 401; `NotYourTurn` 403; `GameNotFound` / state `GameNotFoundError` / state `CommitNotFoundError` 404; `VersionConflict` 409 + `update: err.update`; `GameUnsupported` 410; `IllegalMove` 422; anything else 500 `internal` (no field of the thrown value is used).

## Conventions & invariants

- **Imports (BR-805, VC-832)**: `schemas.ts` and `errors.ts` may import `@/src/state/*`; `auth.ts`, `body.ts`, `http.ts`, `presets.ts` do not, and `handlers.ts` / `route.ts` must not (nor `src/storage`, `src/engine`). Only `service-factory.ts` wires store + state.
- **Error statuses (BR-804, VC-832)**: handlers and routes never write a numeric status ≥ 400; they throw (`RequestError` or let service errors propagate) and call `toErrorResponse`. Every response goes through `jsonResponse`.
- **Check order on `[id]` routes (P-6)**: `assertGameIdFormat` → `parseBearer` → `readJsonBody`+`parseBody` or `parseSince`, all before `deps.getService()`. `POST /api/games`: `readJsonBody` → `parseBody`.
- **FR-804 post-call check** (`since > update.version` → `RequestError(400,'invalid_request','since')`) belongs in `handlers.ts`, using only the returned update.
- **Response schemas are test-only**: handlers never parse responses.
- **Handlers (P-7/P-8)**: every handler body runs inside `withRequestLog(route, deps, async (meta) => …)`; `[id]` handlers set `meta.gameId` (and `meta.fromVersion` from `version`/`since`) as soon as known, so error lines carry them. Handlers return `{ status: 200|201, body, gameId?, fromVersion?, update? }` — `update` is what drives `seat`/`toVersion`/`aiMoves`. Route strings: `POST /api/games`, `GET /api/games/[id]`, `POST /api/games/[id]/moves`, `GET /api/presets`.
- **Routes (P-8)**: each `route.ts` is two imports + one `export const METHOD = …` line binding `defaultDeps`; nothing else exported (VC-826 tests `Object.keys(await import(route))`).
- **Factory test isolation**: `vi.resetModules()` in `beforeEach`, every config env var stubbed to `''` (counts as unset), then the factory, `GameService` and `ConfigError` imported dynamically so `instanceof` uses the same module graph; `vi.unstubAllEnvs()` in `afterEach`.
- **Tests**: one `describe` per VC/P-decision, titled `VC-8xx …` / `P-n …`; reuse `makeService` from `../unit/service/support/service-fixtures` and `RecordingStore` from `../unit/state/support/store-wrappers` by relative import (never modify them).
- **Commits**: one per iteration, staged by explicit path, message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge. Never modify `src/**`, `tests/{unit,contract,sim}/**`, configs, `package.json`, lockfile.

## Commands

All with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed (no network). In zsh, write the prefix literally.

| Command | What it does |
|---|---|
| `sh -c 'pnpm typecheck && pnpm lint && pnpm test && pnpm build'` | Iteration gate (≈ 30 s). `lint` = `eslint . --max-warnings 0 && prettier --check .`. |
| `pnpm build` | Gate from Iteration 2 on (≈ 10 s). Writes only `.next/` (gitignored) and `next-env.d.ts` (gitignored). |
| `pnpm test:sim` | Final Verification only (≈ 45 s). |
| `pnpm vitest run tests/api` | API tests (Iteration 2: 8 files, 197 tests, ≈ 0.35 s). |
| `pnpm exec prettier --write app/api tests/api` | Format before lint. |
| `git diff main -- package.json pnpm-lock.yaml src` | Must be empty (NFR-803, scope). |

## Known gaps

- The GET and moves routes are pending (Iteration 3): `getGameHandler`, `submitMoveHandler`, `app/api/games/[id]/route.ts`, `app/api/games/[id]/moves/route.ts`. Not covered yet: VC-808–VC-813, VC-816–VC-823, VC-827 for GET/moves (401/422/409 lines), VC-800 for 200 update/401/403/404/409/410/422, VC-826 for the `[id]` routes; VC-829–VC-832 (Iteration 4).
- VC-802–VC-807 and VC-815 are covered at handler level for create only; the moves body cases (VC-808) still need handler-level tests.
- `ErrorBody.update` is typed `PlayerUpdate`; the spec's `toErrorResponse` signature says `body: unknown` — `ErrorBody` is a narrower, compatible type.
- A service `InvalidRequest('sinceVersion')` would surface as `Invalid request: sinceVersion`; in practice `parseSince` rejects bad values first.
