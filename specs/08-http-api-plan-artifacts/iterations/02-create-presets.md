# Iteration 2 — Logging, service factory, create and presets routes

**Commit**: this commit — `Add create-game and presets routes with request logging and service factory`.

All commands prefixed with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN`.

## Criteria results

| Criterion | Result | Command / evidence |
|---|---|---|
| VC-815: valid create → 201, `seat` 0, 43-char base64url token, `update.version` 0, parses with `CreateGameResponseSchema` | PASS | `pnpm vitest run tests/api/create.test.ts` (`VC-815` describe) |
| VC-802–VC-806 over `createGameHandler`: 16,385 → 413, 16,384 → 201; `text/plain` / no type → 400 `body`; `Application/JSON; charset=utf-8` → 201; `{`, `null`, `[]`, `"x"`, `42`, invalid UTF-8 → 400 `body`; `seed`/`foo` → 400 named; `humanName` `''`/`'   '`/41 → 400, 40 after trim → 201; `aiCount` 1/6/2.5/`'3'` → 400, 2/5 → 201; `rulesPreset: 'nope'` → 400; each of the four `PRESET_IDS` with `aiCount: 2` → 201. Exact FR-807 messages, bodies parse with `ErrorResponseSchema` | PASS | same file |
| VC-807: `wrapService` `createGame` throws `InvalidRequest('aiCount')` → 400 `Invalid request: aiCount` | PASS | same file (`VC-807`) |
| VC-824 handler: `getService` throws `ConfigError` → 500 `internal`, exactly one `error` line with `errorName: 'ConfigError'` | PASS | same file (`VC-824 (handler part)`) |
| VC-824 factory: `STORAGE_DRIVER=bogus` → throws `ConfigError`; then `memory` → `GameService`; second call `toBe` the first; default preset wired; fresh module → new instance | PASS | `pnpm vitest run tests/api/factory.test.ts` → 3 passed |
| VC-825: presets 200, `PresetsResponseSchema`, `PRESET_IDS` order, `defaultPresetId` = configured `gamerules`, `players`/`deck` = `getPreset`, FR-811 names, descriptions 1–200, `getService` spy not called, no store call | PASS | `pnpm vitest run tests/api/presets.test.ts` → 4 passed |
| VC-827 (create part): one `info` line, exactly the nine keys; 201 → `seat` 0, `fromVersion` null, `toVersion` 0, `aiMoves` = AI bid/play count in the 201 events (also over 5 random 6-seat games); 400 → `seat` null, `errorCode: 'invalid_request'`; `durationMs` integer (and `Math.round` of the clock diff) | PASS | `pnpm vitest run tests/api/logging.test.ts` |
| VC-828: `warn` → 201 no line, 500 exactly one `error` line; `debug` → 201 one `info` line; `getConfig` throwing → 500 emits both lines | PASS | same file (`VC-828`) |
| VC-800 (partial): 201, 400, 413, 500 (and presets 200) have `content-type: application/json`, `cache-control: no-store` | PASS | `create.test.ts` `VC-800`, `presets.test.ts` |
| VC-826 (partial): `app/api/games/route.ts` keys `['POST']`, `app/api/presets/route.ts` keys `['GET']`; `pnpm build` passes | PASS | `create.test.ts`/`presets.test.ts` `VC-826`; `pnpm build` → `ƒ /api/games`, `ƒ /api/presets` |
| Gate | PASS | `sh -c 'pnpm typecheck && pnpm lint && pnpm test'` → 71 files passed + 1 skipped, 1336 tests passed + 30 skipped; `pnpm build` → compiled, 5 static pages, 2 dynamic routes |
| Scope | PASS | `git diff main -- package.json pnpm-lock.yaml src` → empty; `git status` shows only Touches paths + artifacts |
| Artifacts | PASS | `CONTEXT.md` rewritten; D-009–D-012 record P-7, P-8, P-9 (handler part), P-11; this record |

`pnpm vitest run tests/api` → 8 files, 197 tests, ≈ 0.35 s.

## Files

- Added: `app/api/_lib/{log,service-factory,default-deps,handlers}.ts`; `app/api/games/route.ts`; `app/api/presets/route.ts`; `tests/api/support/api-fixtures.ts`; `tests/api/{create,presets,factory,logging}.test.ts`; `specs/08-http-api-plan-artifacts/iterations/02-create-presets.md`.
- Changed: `specs/08-http-api-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.
- Deleted: none.

## Deviations

- `withRequestLog`'s `fn` receives a mutable `meta: { gameId?, fromVersion? }` (D-009). P-7 only says `fn` returns those fields or throws; without `meta` a thrown 409/500 on an `[id]` route could not log its `gameId`/`fromVersion` (FR-814). Returned fields still win. Not an ambiguity in what is built for this iteration's routes — create sets `gameId` from the result.
- Extras within the touched files: `log.ts` exports its types (`LogLevel`, `LogSink`, `RouteResult`, `RequestLogMeta`, `RequestLogDeps`); fixtures export `BASE_URL`, `DEFAULT_CREATE_BODY`, `ServiceMethods`, `CapturedLog`, `Api`. Extra tests: error-line shape/clipping/non-`Error`, BR-803 for create, `consoleLog`, factory preset wiring.

## Gotchas

- `GameService` has `#private` members: no object literal is assignable to it; `wrapService` casts. Do not use `Object.create(service)` to override.
- After `vi.resetModules()`, a statically imported class is a different identity from the one the dynamically imported factory uses — import `GameService`/`ConfigError` dynamically for `instanceof`.
- `loadConfig` treats `''` as unset; the factory test stubs every config env var to `''` so the host env (e.g. `VERCEL_ENV`) cannot interfere.
- `makeApi`'s fake clock starts at 0 and advances 1 per call, so a request line has `durationMs: 1` (two `now()` calls).
- `log.ts` contains the literal `500` (message clip length). VC-832 scans only `handlers.ts` and `route.ts` files, so this is fine; do not move it into `handlers.ts`.

## For the next iteration

- Write `getGameHandler(req, ctx, deps)` / `submitMoveHandler(req, ctx, deps)` as `withRequestLog('GET /api/games/[id]' | 'POST /api/games/[id]/moves', deps, async (meta) => { const { id } = await ctx.params; meta.gameId = id; assertGameIdFormat(id); const token = parseBearer(req.headers); … })`. Set `meta.fromVersion` right after parsing `since` / `version`. Return `{ status: 200, body: update, update }`. A 409's update is picked up from `toErrorResponse` automatically.
- Should `meta.gameId` be set before or after `assertGameIdFormat`? Spec FR-814: "`gameId`: the path id … or `null`". Setting it first logs the raw path id even for a 404 on a malformed id; decide and record (not covered by a Plan decision; the raw id is not a secret).
- New routes: `app/api/games/[id]/route.ts` → `export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) => getGameHandler(req, ctx, defaultDeps);` (same for moves with `POST`). `next typegen` checks the signature.
- Use `makeApi`, `createGameVia`, `ctx`, `getReq`, `postJson`, `wrapService` from `tests/api/support/api-fixtures.ts`; extend `tests/api/logging.test.ts` with the 401/422/409/move lines.
- The gate now includes `pnpm build`.
