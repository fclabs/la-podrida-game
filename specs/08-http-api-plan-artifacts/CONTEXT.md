# CONTEXT — HTTP API (Phase 8)

Last updated by: Iteration 1 (request parsing, error mapping and response schemas). Branch `spec/08-http-api`.

## Current state

- Phases 0–7 are complete (domain, engine, score, players, storage, game state, game service). Phase 8 is in progress.
- **Iteration 1 done**: the pure HTTP building blocks in `app/api/_lib/` (`errors`, `http`, `body`, `auth`, `schemas`, `presets`) and their unit tests in `tests/api/` (4 files, 133 tests, ≈ 0.3 s).
- **Not built yet**: `log.ts`, `service-factory.ts`, `default-deps.ts`, `handlers.ts`, any `route.ts` (Iterations 2–3); the leak oracle and structure tests (Iteration 4); docs (Iteration 5). `pnpm build` is not yet a gate (no routes exist).
- Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (target ES2022, no `noUncheckedIndexedAccess`), pnpm 10.15.1, Node 24 declared (a newer local Node prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3 (single quotes, width 100, trailing commas), zod 4.6.7. `package.json`/lockfile unchanged.
- Full `pnpm test`: 67 passed + 1 skipped files, 1272 passed + 30 skipped tests (≈ 2.9 s).

## File map

| Path | Contents |
|---|---|
| `app/api/_lib/errors.ts` | `ERROR_CODES`, `ErrorCode`, `ERROR_MESSAGES`, `RequestError`, `ErrorBody`, `toErrorResponse` (P-1). The only HTTP module with statuses ≥ 400 in mapping logic. |
| `app/api/_lib/http.ts` | `jsonResponse(status, body)` (P-2). |
| `app/api/_lib/body.ts` | `MAX_BODY_BYTES`, `readJsonBody(request)` (P-3). |
| `app/api/_lib/auth.ts` | `parseBearer(headers)`, `assertGameIdFormat(id)` (P-6). Local regexes; no `src/state` import. |
| `app/api/_lib/schemas.ts` | Request schemas + `parseBody`, `parseSince` (P-4, P-5); strict response schemas + compile-time `Equal` check (P-10). Imports `@/src/domain/schemas`, `@/src/state/keys`, `@/src/state/schemas`. |
| `app/api/_lib/presets.ts` | `PRESET_LABELS` (P-9). |
| `tests/api/errors.test.ts` | VC-814, VC-801 (mapper part), `RequestError` shape. |
| `tests/api/body.test.ts` | VC-802/803/804 at unit level. |
| `tests/api/auth.test.ts` | VC-811 at parser level; id format. |
| `tests/api/schemas.test.ts` | VC-805/806/808/809 at schema/parser level; response schemas; `PRESET_LABELS`. |
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

Mapping (`toErrorResponse`): `RequestError` → its own status/code/field; `InvalidRequest` → 400 with `reason` as field; `Unauthorized` 401; `NotYourTurn` 403; `GameNotFound` / state `GameNotFoundError` / state `CommitNotFoundError` 404; `VersionConflict` 409 + `update: err.update`; `GameUnsupported` 410; `IllegalMove` 422; anything else 500 `internal` (no field of the thrown value is used).

## Conventions & invariants

- **Imports (BR-805, VC-832)**: `schemas.ts` and `errors.ts` may import `@/src/state/*`; `auth.ts`, `body.ts`, `http.ts`, `presets.ts` do not, and `handlers.ts` / `route.ts` must not (nor `src/storage`, `src/engine`). Only `service-factory.ts` wires store + state.
- **Error statuses (BR-804, VC-832)**: handlers and routes never write a numeric status ≥ 400; they throw (`RequestError` or let service errors propagate) and call `toErrorResponse`. Every response goes through `jsonResponse`.
- **Check order on `[id]` routes (P-6)**: `assertGameIdFormat` → `parseBearer` → `readJsonBody`+`parseBody` or `parseSince`, all before `deps.getService()`. `POST /api/games`: `readJsonBody` → `parseBody`.
- **FR-804 post-call check** (`since > update.version` → `RequestError(400,'invalid_request','since')`) belongs in `handlers.ts`, using only the returned update.
- **Response schemas are test-only**: handlers never parse responses.
- **Tests**: one `describe` per VC/P-decision, titled `VC-8xx …` / `P-n …`; reuse `makeService` from `../unit/service/support/service-fixtures` and `RecordingStore` from `../unit/state/support/store-wrappers` by relative import (never modify them).
- **Commits**: one per iteration, staged by explicit path, message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge. Never modify `src/**`, `tests/{unit,contract,sim}/**`, configs, `package.json`, lockfile.

## Commands

All with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed (no network). In zsh, write the prefix literally.

| Command | What it does |
|---|---|
| `sh -c 'pnpm typecheck && pnpm lint && pnpm test'` | Iteration gate (≈ 20 s). `lint` = `eslint . --max-warnings 0 && prettier --check .`. |
| `pnpm build` | Required from Iteration 2 on. |
| `pnpm test:sim` | Final Verification only (≈ 45 s). |
| `pnpm vitest run tests/api` | API tests (Iteration 1: 4 files, 133 tests, ≈ 0.3 s). |
| `pnpm exec prettier --write app/api tests/api` | Format before lint. |
| `git diff main -- package.json pnpm-lock.yaml src` | Must be empty (NFR-803, scope). |

## Known gaps

- No handlers, routes, logger or factory yet (Iterations 2–3). VC-800, VC-807, VC-810, VC-812, VC-813, VC-815–VC-830 are not covered yet; VC-802–VC-809/VC-811 are covered at unit level only and need handler-level tests.
- `ErrorBody.update` is typed `PlayerUpdate`; the spec's `toErrorResponse` signature says `body: unknown` — `ErrorBody` is a narrower, compatible type.
- A service `InvalidRequest('sinceVersion')` would surface as `Invalid request: sinceVersion`; in practice `parseSince` rejects bad values first.
