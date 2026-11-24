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

## D-013: Log the path id only after the id format check  (Iteration 3)
- **Context**: FR-814 says `gameId` is "the path id … or `null`"; the Iteration 2 record left open whether a malformed path id is logged. The path segment is untrusted and unbounded.
- **Decision** (user): the `[id]` handlers set `meta.gameId = id` only after `assertGameIdFormat(id)` passes. A malformed id answers 404 with `gameId: null` in the request line. A valid-format id is logged even when the request then fails (401, 404 from the service, 400 …).
- **Rejected**: setting `meta.gameId` first (arbitrary-length, attacker-chosen text in the logs); truncating the raw id.
- **Consequences**: tested in `logging.test.ts` (`D-013` describe: a 5,000-char `BAD-…` id on both routes → `gameId: null`, the text never logged; a valid-format unknown id's 401 carries the id).

## D-014: FR-804 post-call `since` check without a status literal  (Iteration 3)
- **Context**: the plan's Iteration 3 Scope writes `throw new RequestError(400, 'invalid_request', 'since')` in `handlers.ts`, but spec VC-832 and P-1 forbid any numeric status ≥ 400 in `handlers.ts` (Iteration 4's static scan).
- **Decision**: `getGameHandler` runs `parseBody(sinceAtMost(update.version), { since })`, where `sinceAtMost(v) = z.strictObject({ since: z.int().max(v) })`. `parseBody` throws `RequestError(400, 'invalid_request', 'since')` — the same error, built in `schemas.ts`. It still uses only the returned update (P-5). Comments in `handlers.ts` also avoid 4xx/5xx numbers.
- **Rejected**: the literal `RequestError(400, …)` (fails VC-832); a new helper in `schemas.ts`/`errors.ts` (outside Iteration 3's Touches).
- **Consequences**: `handlers.ts` imports `z` from `zod`. Behaviour is identical (VC-810 tip + 1 → `Invalid request: since`).

## D-015: `[id]` handler shape, route context and test helpers (P-6, P-7, P-8, P-11)  (Iteration 3)
- **Context**: FR-806 check order, FR-813 route files, Iteration 3 hands-off (`playToEndVia`).
- **Decision**: `getGameHandler(req, ctx, deps)` / `submitMoveHandler(req, ctx, deps)` with `ctx: GameRouteContext = { params: Promise<{ id: string }> }`, each inside `withRequestLog`: `await ctx.params` → `assertGameIdFormat` → `meta.gameId` → `parseBearer` → `parseSince` / `readJsonBody`+`parseBody(SubmitMoveBodySchema)` → `meta.fromVersion` → `deps.getService()` call → `{ status: 200, body: update, update }`. Route files type `ctx` inline (`{ params: Promise<{ id: string }> }`), two imports + one export. `api-fixtures.ts` gains `bearer(token)`, `GameIds` and `playToEndVia(api, ids)`.
- **Rejected**: importing `GameRouteContext` into the route files (keeps them at exactly two imports, the P-8 shape).
- **Consequences**: `deps.getService()` is not called at all when a pre-check fails (check-order tests count it). Iteration 4 drives full games with `playToEndVia`.

## D-016: The no-leak oracle as applied (P-12)  (Iteration 4)
- **Context**: P-12 defines `assertNoLeak`; VC-831 checks ~1,200 bodies over two ~200-move games, and each body needs every commit's events `0…tip`.
- **Decision**: `tests/api/support/leak-oracle.ts` applies P-12 as written, plus: it returns `LeakCheckResult { kind, stockTrump, fullDeal }` so the test can count cases; it asserts `update.version === tip` (the comparison is only valid against the state behind the body), `view.you === seat`, the stock size (`deck − N × cardsPerPlayer`) and that the trump is in the stock iff not `trumpCardInDealerHand`; every body is also checked for the seed and each seat-token hash as substrings (BR-801). Commit events are loaded with `GameStateManager.load` once per (store, game, version) and cached in a `WeakMap` — commits are create-only and immutable.
- **Rejected**: re-loading all commits per body (O(n²) schema parses, seconds per game); reading only the tip's events (misses card plays from earlier commits of the current hand).
- **Consequences**: call it right after the response it checks. A `P-12` describe feeds it 14 mutated bodies (one per leak kind) that must throw.

## D-017: No-leak game timeout  (Iteration 4)
- **Context**: each VC-831 game takes ≈ 3.5–4.8 s; Vitest's default timeout is 5 s, and one full-suite run timed out. Profiling: without the `?since=0` GETs a game takes ≈ 0.6 s — the service re-reads every commit per `since=0` call (O(n²) over the game). The plan requires that GET after every move.
- **Decision**: the two VC-831 cases get an explicit 60 s timeout (`GAME_TIMEOUT_MS`). `tests/api` Duration stays ≈ 8.2 s (< 20 s, NFR-802).
- **Rejected**: GET `?since=0` only every k moves (weaker than the plan); splitting presets into two files (outside Touches); changing the service (Scope Out).
- **Consequences**: on a slow CI runner the suite has ~2.4× headroom under NFR-802.

## D-018: Structure scan is stricter than "status position" (VC-832)  (Iteration 4)
- **Context**: VC-832 forbids numeric statuses ≥ 400 in `handlers.ts` and the four `route.ts`; D-014 already keeps those files free of any 4xx/5xx number, comments included.
- **Decision**: `structure.test.ts` fails on any `\b[45]\d\d\b` token, on `status:`/`status =` 4xx/5xx literals and on `jsonResponse(`/`Response(` 4xx/5xx calls; imports are found in static `import`/`export … from`, side-effect imports, `import()` and `require()`, resolved (`@/` alias or relative) against the repo root and rejected under `src/state|storage|engine`. Both scanners have positive controls. Mutation check: appending `export const _teapot = { status: 418 };` to `handlers.ts` fails the test; reverted.
- **Rejected**: a status-position-only regex (a constant like `const S = 404` would slip through).
- **Consequences**: no 4xx/5xx number may appear in those five files, even in comments.
