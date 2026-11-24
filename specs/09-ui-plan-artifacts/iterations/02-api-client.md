# Iteration 2: API client and response shapes

Parallel group A (reduced protocol): `CONTEXT.md` and `DECISIONS.md` NOT edited; proposals below.

## Criteria results

All run from the worktree root.
- VC-926 client part (move: reject, 503, 200 non-JSON, 200 `{version:9}`, 409 w/o update, 409 `update:{}`, 302 -> transport; valid 200 -> ok; valid 409 -> conflict; 400/401/403/404/410/413/422 -> error with status+code; fake-timer abort at 20,000 ms): PASS. `pnpm vitest run --project ui tests/ui/api.test.ts`
- FR-936 per call (load 403/409/422 -> transport, 401/404/410 -> error; create 401 -> transport, 400 -> error; presets 400 -> transport; presets without matching `defaultPresetId` -> transport): PASS. same command.
- Authorization Bearer on game routes, token never in URL, `cache: 'no-store'`, `?since=<n>` (0 included), Content-Type only on POSTs: PASS. same command.
- `tests/ui/shape.test.ts` covers each required field of the three shapes: PASS. `pnpm vitest run --project ui tests/ui/shape.test.ts` (api + shape = 100 tests)
- `pnpm typecheck`: PASS. `pnpm lint`: PASS. `pnpm test`: PASS (87 files + 1 skipped, 1596 tests + 30 skipped).
- Artifact record with both proposal sections: PASS (this file).

## Commit

this commit

## Files

Added: `app/_client/api.ts`, `app/_client/shape.ts`, `app/_client/api-types.ts`, `tests/ui/api.test.ts`, `tests/ui/shape.test.ts`, this record. Changed/deleted: none.

## Deviations

- The worktree started at 7eb81ae (not 02d69f9); it was reset (no work lost) to `spec/09-ui` 02d69f9 before coding.
- Handled 4xx whose body is not `{ error: { code } }` yields `error` with `code: ''` (spec silent; the status is still reported). Not stopped for, because the plan's required cases all carry a code.
- `ApiDeps.clearTimeout` is typed `(id: never) => void` so both DOM (`number`) and Node (`Timeout`) timer ids fit without globals.

## Gotchas

- `call()` races the request against the abort signal, so a `fetch` or `json()` that ignores the signal still ends at 20 s as `transport` (tested with both behaviours).
- `redirect` is left to fetch's default; a 302 only reaches us from a stub (-> transport). A 204 or any unhandled 2xx is transport.
- `rulesPreset` is optional in `CreateGameRequest` (spec 08: `rulesPreset?`).
- Tests build minimal inline updates (shape-only); `tests/ui/support/fixtures.ts` belongs to Iteration 3 and was not used.
- `app/_client/api.ts` has a `API_TIMEOUT_MS = 20_000` export.

## For the next iteration

- Callers build `ApiDeps` as `{ fetch: (...a) => globalThis.fetch(...a), setTimeout: (h, ms) => window.setTimeout(h, ms), clearTimeout: (id) => window.clearTimeout(id as number) }` (wrap, do not pass bare `fetch`, to avoid illegal-invocation errors). Put it in `deps.tsx` (Iteration 4).
- `error.code` strings are spec 08 codes (`invalid_request`, `unauthorized`, `not_your_turn`, `game_not_found`, `game_unsupported`, `payload_too_large`, `illegal_move`); map UI behaviour by `status`.
- Move 400 and 413 come back as `error`; FR-918 decides the notice. `conflict` carries the validated `update`.
- Recovery GET (`getUpdate` with `since`) maps 403/422/400/413 to transport per FR-936; callers need no special case.

## Proposed CONTEXT.md changes

File map additions:
- `app/_client/api.ts`: `ApiResult<T>`, `ApiDeps`, `API_TIMEOUT_MS`, `getPresets`, `createGame`, `getUpdate`, `submitMove`.
- `app/_client/shape.ts`: `isPlayerUpdate`, `isCreateBody`, `isPresetsBody` (FR-936 top-level checks, P-8).
- `app/_client/api-types.ts`: `PresetEntry`, `PresetsBody`, `CreateGameRequest`, `CreateGameBody`, `MoveRequest`, `ErrorBody`.
- `tests/ui/api.test.ts`, `tests/ui/shape.test.ts`: stub-fetch and shape tests (100 tests).

Public interfaces:
```ts
interface ApiDeps { fetch: typeof fetch; setTimeout: (h: () => void, ms: number) => unknown; clearTimeout: (id: never) => void }
getPresets(deps): Promise<ApiResult<PresetsBody>>;           // GET /api/presets, 200
createGame(deps, body: CreateGameRequest): Promise<ApiResult<CreateGameBody>>; // 201, 400
getUpdate(deps, gameId, token, since?: number): Promise<ApiResult<PlayerUpdate>>; // 200, 401, 404, 410
submitMove(deps, gameId, token, body: MoveRequest): Promise<ApiResult<PlayerUpdate>>; // 200, 409+update -> conflict, 400/401/403/404/410/413/422 -> error
```
Conventions: client calls never throw; every unhandled outcome is `transport`; the token only travels in `Authorization`; every call is aborted at 20,000 ms. Known gap: a handled 4xx without an error body gives `code: ''`. Test totals after Iteration 2 (without Iteration 3): 87 files + 1 skipped, 1596 tests + 30 skipped.

## Proposed decisions

## D-?: Client calls race the abort signal  (Iteration 2)
**Context**: FR-936 requires a 20 s abort; a fetch or `json()` may ignore the signal and hang.
**Decision**: `call()` aborts an `AbortController` at 20,000 ms and also races the request against that abort, mapping any throw to `transport`.
**Rejected**: Relying on `fetch` honouring the signal (a hang would never resolve).
**Consequences**: A hung call always settles at 20 s; the timer is cleared on every settle.

## D-?: Handled 4xx without an error body keeps its status  (Iteration 2)
**Context**: FR-936 lists handled statuses but not what an unparsable error body means.
**Decision**: Return `error` with the status and `code: ''`.
**Rejected**: Mapping to `transport` (it would retry a definitive 4xx) and stopping.
**Consequences**: Callers must decide by `status`, never by a non-empty `code`.

## D-?: Timer deps typed with `clearTimeout(id: never)`  (Iteration 2)
**Context**: `deps` must be pure and accept both browser and Node timer ids (tests use fake timers).
**Decision**: `setTimeout` returns `unknown`; `clearTimeout` takes `never`, so any matching timer pair is assignable.
**Rejected**: Typing ids as `number` (breaks Node typings) or importing globals.
**Consequences**: Callers pass wrapper functions; the client never touches `window`.
