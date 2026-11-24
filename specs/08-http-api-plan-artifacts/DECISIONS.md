# DECISIONS — HTTP API (Phase 8)

## D-001: Request errors and the single mapper (P-1)  (Iteration 1)
- **Context**: FR-801, FR-807, BR-802, BR-804 require one mapping from thrown values to status/body.
- **Decision**: `app/api/_lib/errors.ts` holds `ERROR_CODES`, `ERROR_MESSAGES` (exact FR-807 texts), `RequestError(status, code, field?)` and `toErrorResponse`. `instanceof` checks cover `RequestError`, the seven service errors and state `GameNotFoundError`/`CommitNotFoundError`; everything else is 500 `internal`. `VersionConflict` adds `update: err.update`. `RequestError.code` is narrowed to the four request codes; an empty `field` is stored as `undefined`.
- **Rejected**: mapping by `err.name` (spoofable by any error); passing service error messages through (they echo ids).
- **Consequences**: handlers throw and never build error statuses (VC-832). `toErrorResponse` returns `body: ErrorBody`, a narrower type than the spec's `unknown`.

## D-002: JSON responses (P-2)  (Iteration 1)
- **Context**: FR-800 — every response has `application/json` and `no-store`.
- **Decision**: `jsonResponse(status, body)` in `http.ts` builds every response with exactly those two headers.
- **Rejected**: `Response.json` (sets the type but not `cache-control`; easy to forget per call).
- **Consequences**: handlers and the logging wrapper must route success and error bodies through `jsonResponse`.

## D-003: Body reading order and strict UTF-8 (P-3)  (Iteration 1)
- **Context**: FR-802 order (type → size → JSON object); ledger R-022 (invalid UTF-8).
- **Decision**: `readJsonBody` checks the media type (before `;`, trimmed, lower-cased) = `application/json`, then reads the whole body and caps at `MAX_BODY_BYTES = 16384` raw bytes (ignoring `Content-Length`), then decodes with a fatal `TextDecoder` and `JSON.parse`, and requires a non-null, non-array object.
- **Rejected**: trusting `Content-Length`; lossy decoding (replacement chars); `request.json()` (no byte cap, no strict UTF-8).
- **Consequences**: `application/json-patch+json` and other `+json` types are rejected as `body`.

## D-004: Strict request schemas and field naming (P-4)  (Iteration 1)
- **Context**: FR-803; ledger R-023 (which field to name when several issues exist).
- **Decision**: `CreateGameBodySchema`/`SubmitMoveBodySchema` are `z.strictObject`s with the service's limits; `humanName` is a refined `z.string()` (trim length 1–40) passed on untrimmed. `parseBody` names `issues[0].keys[0]` for `unrecognized_keys`, else `String(issues[0].path[0] ?? '')`; empty → no field.
- **Rejected**: sorting issues; transforming `humanName` (the service owns trimming).
- **Consequences**: with both an unknown key and a bad known field, the field Zod lists first wins; tests assert single-error bodies only.

## D-005: `since` parsing (P-5)  (Iteration 1)
- **Context**: FR-804, ledger R-021 (repeated parameter).
- **Decision**: `parseSince(url)` in `schemas.ts` uses `searchParams.getAll('since')`: none → `undefined`; more than one, a non-canonical decimal (`/^(0|[1-9][0-9]{0,7})$/`) or > `MAX_COMMIT_VERSION` → `RequestError(400,'invalid_request','since')`.
- **Rejected**: `searchParams.get` (silently takes the first of several); `Number()` coercion (accepts `1e3`, ` 1`).
- **Consequences**: the post-call `since > update.version` check is left to `handlers.ts` (Iteration 3).

## D-006: Bearer and id format (P-6)  (Iteration 1)
- **Context**: FR-805, FR-806 — reject before any storage I/O.
- **Decision**: `parseBearer(headers)` applies `/^bearer ([A-Za-z0-9_-]{1,256})$/i` to the raw header (missing → `''`), else `RequestError(401,'unauthorized')`. `assertGameIdFormat(id)` applies `/^[a-z2-7]{26}$/`, else `RequestError(404,'game_not_found')`. Both regexes are local to `auth.ts` (a test cross-checks `GAME_ID_PATTERN`).
- **Rejected**: importing `GAME_ID_PATTERN` into `auth.ts` (keeps `src/state` imports to `schemas.ts`/`errors.ts`).
- **Consequences**: `[id]` handlers call id check → bearer → body/`since` before `deps.getService()`.

## D-007: Preset labels (P-9)  (Iteration 1)
- **Context**: FR-811 — names from the table, one-sentence descriptions, compile-time exhaustiveness.
- **Decision**: `PRESET_LABELS: Readonly<Record<PresetId, { name; description }>>`, frozen. Descriptions summarise deck and hand sequence from design §4.3, each 1–200 chars ending in a period.
- **Rejected**: deriving descriptions from rule data at runtime (unreadable, no benefit).
- **Consequences**: adding a `PresetId` fails typecheck until a label is added.

## D-008: Strict response schemas with a compile-time equality check (P-10)  (Iteration 1)
- **Context**: Data & Interfaces — response schemas strict at every level, mirroring `PlayerUpdate` exactly.
- **Decision**: `schemas.ts` defines a strict `PlayerViewSchema` (all `TableView` + `PlayerView` fields), reusing `CardSchema`, `TrickPlaySchema`, `GameEventSchema` (domain) and `ScoreBoardSchema` (state); `LegalMove`/`Move` are local strict schemas. `type _Check = Expect<Equal<z.infer<typeof PlayerUpdateResponseSchema>, PlayerUpdate>>` fails typecheck on drift (verified by adding a field: TS2344). `CreateGameResponseSchema` pins `gameId` to `GAME_ID_PATTERN` and `seatToken` to 43 base64url chars; `ErrorResponseSchema.error.code` is `z.enum(ERROR_CODES)`; `PresetsResponseSchema` caps descriptions at 200.
- **Rejected**: runtime response validation in handlers (spec Scope Out).
- **Consequences**: tests parse every 2xx/409 body with these; a domain type change forces a schema update.

## D-009: Request logging wrapper with a mutable meta (P-7)  (Iteration 2)
- **Context**: FR-814–FR-816, BR-803, ledger R-024. P-7 has `fn` return `{ status, body, gameId?, fromVersion?, update? }` or throw; a throw would lose the path id and request version that the `[id]` routes know before failing (e.g. a 409 needs `fromVersion`).
- **Decision**: `withRequestLog(route, deps, fn)` passes `fn` a mutable `RequestLogMeta { gameId?, fromVersion? }`; fields `fn` returns override it. A throw goes through `toErrorResponse`; the logged update is the result's `update` or the 409 body's `update`. `seat = update?.view.you ?? null`; `aiMoves` counts `bid-made`/`card-played` with `seat !==` the logged seat; `durationMs = Math.round(end − start)`. Level from `deps.getConfig().logLevel` (a throw → `info`); request line iff `debug`/`info`; on a thrown 500 the error line `{ route, gameId, errorName, errorMessage (≤ 500 chars), stack }` is always emitted. `consoleLog` writes `JSON.stringify(line)` to `console.log`/`console.error`.
- **Rejected**: attaching ids to thrown errors (mutates service errors); logging any error property beyond name/message/stack (`AiLoopLimitError.state`).
- **Consequences**: Iteration 3 handlers set `meta.gameId` first thing and `meta.fromVersion` once `version`/`since` is parsed.

## D-010: Memoised service factory and default deps (P-8)  (Iteration 2)
- **Context**: FR-812, FR-813, BR-805 exception.
- **Decision**: `service-factory.ts` keeps `let cached: GameService | undefined`; `getService()` builds `getConfig()` → `createObjectStore` → `GameStateManager` → `GameService({ state, defaultPresetId })` and assigns only on success. `default-deps.ts` exports `defaultDeps = { getService, getConfig, now: () => performance.now(), log: consoleLog }`. Each `route.ts` is two imports + one `export const POST|GET = (req: Request) => handler(req, defaultDeps)`.
- **Rejected**: building the service at module load (a bad env would break the import and `next build`).
- **Consequences**: the factory test isolates module state with `vi.resetModules()`, stubs every config env var to `''`, and imports factory, `GameService` and `ConfigError` dynamically. `next build` marks both routes dynamic (`ƒ`).

## D-011: Presets handler body (P-9)  (Iteration 2)
- **Context**: FR-811 — no service and no storage call.
- **Decision**: `presetsHandler` returns `{ defaultPresetId: deps.getConfig().defaultRulesPreset, presets: PRESET_IDS.map(id => ({ id, ...PRESET_LABELS[id], players: { ...getPreset(id).players }, deck: getPreset(id).deck.id })) }` with 200, inside `withRequestLog('GET /api/presets', …)`.
- **Rejected**: a static, build-time body (the default preset is runtime config).
- **Consequences**: a throwing `getConfig` makes presets a 500 with both log lines (VC-828 variant tested).

## D-012: API test fixtures (P-11)  (Iteration 2)
- **Context**: P-11; ledger R-027 (sending no `Content-Type`).
- **Decision**: `tests/api/support/api-fixtures.ts` per P-11. `makeApi` passes `defaultPreset` both to `makeService` (`defaultPresetId`) and to `loadConfig` (`DEFAULT_RULES_PRESET`); its `deps` are plain mutable properties so tests swap `getService`/`getConfig`/`now`. `postJson` always sends bytes; `contentType` defaults to `application/json` and `null` sends none. `wrapService` builds a delegating object and casts it `as unknown as GameService` (the class has `#private` members, so no structural object is assignable).
- **Rejected**: `Object.create(service)` overrides (prototype methods would hit `#private` on the wrong receiver).
- **Consequences**: `createGameVia` asserts 201 and parses with `CreateGameResponseSchema`; Iteration 3/4 tests reuse it.
