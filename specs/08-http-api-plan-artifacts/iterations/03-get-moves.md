# Iteration 3 — Get-update and submit-move routes

**Commit**: this commit — `Add get-update and submit-move routes with check order and error mapping`.

All commands prefixed with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN`.

## Criteria results

| Criterion | Result | Command / evidence |
|---|---|---|
| VC-809: `since` `''`, `-1`, `1.5`, `abc`, `01`, `100000000`, `since=0&since=0` → 400 `Invalid request: since` (0 store calls); `since=0` → 200, `events` = concat of `GameStateManager.load` commits 1…3 | PASS | `pnpm vitest run tests/api/get-update.test.ts` → 28 passed |
| VC-810: `since` = tip (2) → 200 `events: []`; tip + 1 → 400 `since`; `99999999` on a fresh game → 400 | PASS | same file |
| VC-811: both routes, 6 malformed headers → 401, `store.callsOf().length === 0`; `bearer <token>` → 200 | PASS | `get-update.test.ts`, `submit-move.test.ts` |
| VC-812: foreign 43-char token → 401; second game's token → 401 (both routes; POST writes nothing) | PASS | same files |
| VC-813: `BAD` + no auth + bad body → 404; valid-format unknown id + no header → 401; valid id + header + `{` → 400; 0 store calls and 0 `getService` calls in all (POST, and GET with `since`) | PASS | `pnpm vitest run tests/api/check-order.test.ts` → 13 passed |
| VC-816: creator token → 200, `version` = tip, `events: []`, parses with `PlayerUpdateResponseSchema` | PASS | `get-update.test.ts` |
| VC-817: first legal move → 200, version + 1 | PASS | `pnpm vitest run tests/api/submit-move.test.ts` → 27 passed |
| VC-818: `play:ZZ` → 422 `illegal_move`, tip unchanged | PASS | same file |
| VC-819: `wrapService` `submitMove` rejects `new NotYourTurn(0)` → 403 `not_your_turn` | PASS | same file |
| VC-820: stale version + new `clientRequestId` → 409, `ErrorResponseSchema`, `update.version` = tip (1) | PASS | same file |
| VC-821: same body twice → both 200, deep-equal, tip + 1; after another move, original body → 200 equal to the first | PASS | same file |
| VC-822: meta overwritten with `engineVersion: ENGINE_VERSION + 1` → GET 410 `game_unsupported` | PASS | `get-update.test.ts` |
| VC-823: meta deleted → 404; commit 0 deleted (fresh) → 404; commit 1 deleted at tip 3, `?since=0` → 404 `game_not_found` | PASS | same file |
| VC-827 (rest): move 200 → `aiMoves` = k (6 moves, at least one k > 0), `fromVersion`/`toVersion`; GET 200 with/without `since`; 401 → `seat`/`toVersion` null, `unauthorized`; 422 → `seat` null, `illegal_move`; 409 → `seat` = `update.view.you`, `toVersion` = `update.version`; integer `durationMs` and exactly the nine keys in every line; D-013 malformed id → `gameId: null` | PASS | `pnpm vitest run tests/api/logging.test.ts` → 28 passed |
| VC-826 (rest): `[id]/route.ts` keys `['GET']`, `[id]/moves/route.ts` keys `['POST']`; `pnpm build` passes | PASS | `get-update.test.ts`/`submit-move.test.ts`; build lists `ƒ /api/games/[id]`, `ƒ /api/games/[id]/moves` |
| Gate | PASS | `sh -c 'pnpm typecheck && pnpm lint && pnpm test && pnpm build'` → exit 0; 74 files passed + 1 skipped, 1413 tests passed + 30 skipped; 4 dynamic routes |
| Scope | PASS | `git diff main -- package.json pnpm-lock.yaml src` → empty; `git status` shows only Touches paths + artifacts. `grep -cE '\b(4[0-9][0-9]\|5[0-9][0-9])\b'` on `handlers.ts` and the two new routes → 0 |
| Artifacts | PASS | `CONTEXT.md` rewritten; D-013–D-015 appended; this record |

`pnpm vitest run tests/api` → 11 files, 274 tests, ≈ 0.63 s.

## Files

- Added: `app/api/games/[id]/route.ts`, `app/api/games/[id]/moves/route.ts`, `tests/api/{get-update,submit-move,check-order}.test.ts`, this record.
- Changed: `app/api/_lib/handlers.ts`, `tests/api/logging.test.ts`, `tests/api/support/api-fixtures.ts` (`bearer`, `GameIds`, `playToEndVia`), `CONTEXT.md`, `DECISIONS.md`.
- Deleted: none.

## Deviations

- **FR-804 post-call check (D-014)**: the Scope says `throw RequestError(400, 'invalid_request', 'since')` in `handlers.ts`, which would break spec VC-832/P-1 (no numeric status ≥ 400 in `handlers.ts`). Same error, built through `parseBody(z.strictObject({ since: z.int().max(update.version) }), { since })`. Behaviour identical.
- **D-013 (user decision)**: `meta.gameId` set after the format check.
- Fixture extras beyond `playToEndVia`: `bearer(token)` and the `GameIds` type. Extra tests beyond the VCs: VC-808 boundaries + 413/`text/plain` at the move handler, other query params ignored, malformed-id list → 404 on both routes, BR-803 for GET/move logs, `getService` call count in check-order.

## Gotchas

- A default parameter swallows an explicit `undefined`: to send *no* auth header through a helper whose `headers` defaults to `bearer(...)`, pass `{}`.
- `api.store.reset()` after `createGameVia` before asserting `callsOf().length === 0`.
- Prettier does not rewrap comments; keep doc comments ≤ 100 chars by hand.
- Do not put 4xx/5xx numbers even in comments in `handlers.ts` / route files — Iteration 4's `\b(4\d\d|5\d\d)\b` scan would see them.
- `api.service.getUpdate(id, token)` is a cheap way to read the tip version in tests (no events).

## For the next iteration

How to provoke each case over the handlers (all with `const api = makeApi(); const ids = await createGameVia(api, body?)`):
- **Full game**: `await playToEndVia(api, ids)` → every 200 `PlayerUpdate` in order (last is game-over). For the no-leak run you need the raw bodies too: replicate its loop (`submitMoveHandler(postJson(`/api/games/${id}/moves`, { version, moveId: firstLegalMoveId(update), clientRequestId }, { headers: bearer(token) }), ctx(id), api.deps)`) and call `assertNoLeak` on each body, plus `getGameHandler(getReq(`/api/games/${id}`, bearer(token)), ctx(id), api.deps)` and `…?since=0` after every move.
- **409**: after any move landed at version v → v+1, POST `{ version: v, moveId: <any>, clientRequestId: '<new>' }` → 409 with `update` (the tip, with events since v). Reusing the *same* `clientRequestId` gives the idempotent 200 instead.
- **422**: POST `{ version: tip, moveId: 'play:ZZ', clientRequestId: '<new>' }` → 422, nothing written.
- **403**: `api.deps.getService = () => wrapService(api.service, { submitMove: () => Promise.reject(new NotYourTurn(0)) })`.
- **410**: `const s = await api.store.get(metaKey(id))`; `JSON.parse(new TextDecoder().decode(s.body))`; `api.store.put(metaKey(id), JSON.stringify({ ...meta, engineVersion: ENGINE_VERSION + 1 }), { mode: 'overwrite' })` → GET 410.
- **404 partial delete**: `api.store.delete([metaKey(id)])` or `[commitKey(id, 0)]`; or advance to tip ≥ 3, delete `commitKey(id, 1)`, GET `?since=0`. Malformed id `ctx('BAD')` → 404 without storage.
- **401**: no header / `bearer('A'.repeat(43))`. **413**: `postJson(path, null, { headers, rawBody: <16,385+ bytes> })`. **500**: `api.deps.getService = () => { throw new Error('x') }`, or a `wrapService` override that rejects.
- `submit-move.test.ts` and `get-update.test.ts` each define a local `MALFORMED_AUTH` list and `expectErrorBody`; the structure test should scan `handlers.ts` + the four `route.ts` files (`app/api/games/route.ts`, `app/api/games/[id]/route.ts`, `app/api/games/[id]/moves/route.ts`, `app/api/presets/route.ts`). `handlers.ts` now imports `zod` (not a forbidden layer).
