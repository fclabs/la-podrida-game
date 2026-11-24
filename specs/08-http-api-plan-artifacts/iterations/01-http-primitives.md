# Iteration 1 — Request parsing, error mapping and response schemas

**Commit**: this commit — `Add HTTP request parsing, error mapping and response schemas`.

All commands prefixed with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN`.

## Criteria results

| Criterion | Result | Command / evidence |
|---|---|---|
| VC-814 mapper over every FR-807 row (incl. state errors, `VersionConflict` body `update`, `RequestError` 400/401/404/413, `AiLoopLimitError`, `ConfigError`, `Error('secret-xyz')`, `'str'`, `undefined`); messages = `ERROR_MESSAGES[code]`, `: aiCount` for `InvalidRequest` | PASS | `pnpm vitest run tests/api/errors.test.ts` → 25 passed |
| VC-801 (mapper part): 500 body has neither `secret-xyz` nor `stack` | PASS | same file, `VC-801 (mapper part)` describe |
| VC-802/803/804 unit: 16,385 → 413; 16,384 padded → parsed; 8,193 × `é` → 413; `text/plain` → 400 `body`; no header (Uint8Array) → 400 `body`; `text/plain` 20,000 bytes → 400; `Application/JSON; charset=utf-8` → parsed; `{`, `null`, `[]`, `"x"`, `42`, `[0x22,0xff,0x22]` → 400 `body` | PASS | `pnpm vitest run tests/api/body.test.ts` → 19 passed |
| VC-805/806/808 schema level: unknown `seed`/`foo`/`bar` named; `humanName` `''`/`'   '`/41 → `humanName`, 40 after trim ok; `aiCount` 1/6/2.5/`'3'` → `aiCount`, 2/5 ok; `rulesPreset: 'nope'`; `version` −1/1.5/`MAX_COMMIT_VERSION`; `moveId` `''`/33, `clientRequestId` `''`/129; 32/128 ok | PASS | `pnpm vitest run tests/api/schemas.test.ts` → 60 passed |
| VC-809 parser: `''`, `-1`, `1.5`, `abc`, `01`, `100000000`, `since=0&since=0` → field `since`; `0`, `99999999` → numbers; absent → `undefined` | PASS | same file, `VC-809` describe |
| VC-811 parser: missing, `Bearer`, `Basic abc`, `Bearer  two-spaces`, `Bearer a b`, `Bearer `+257 → 401; `bearer <43-char>` → token | PASS | `pnpm vitest run tests/api/auth.test.ts` → 29 passed |
| Response schemas: real create update parses; `seed` at top / `view` / `view.seats[0]` rejected; compile-time `Equal` check present | PASS | `schemas.test.ts` `P-10` describe; `pnpm typecheck` passes; drift check: adding `extra: z.string().optional()` to the view schema → `TS2344: Type 'false' does not satisfy the constraint 'true'` (reverted) |
| `PRESET_LABELS` keys = `PRESET_IDS`; FR-811 names; descriptions 1–200 | PASS | `schemas.test.ts` `P-9` describe |
| Gate | PASS | `sh -c 'pnpm typecheck && pnpm lint && pnpm test'` → 67 files passed + 1 skipped, 1272 tests passed + 30 skipped |
| Artifacts | PASS | this file; `CONTEXT.md` File map/Public interfaces match the code; D-001–D-008 record P-1–P-6, P-9, P-10 |

## Files

- Added: `app/api/_lib/{errors,http,body,auth,schemas,presets}.ts`; `tests/api/{errors,body,auth,schemas}.test.ts`; `specs/08-http-api-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-http-primitives.md}`.
- Changed / deleted: none (`tests/api/.gitkeep` left in place).

## Deviations

- None in scope. Small additions within the touched files: `ERROR_CODES`/`ErrorCode`/`ErrorBody` exports in `errors.ts` (used by `ErrorResponseSchema`); `RequestError.code` narrowed to the four request codes; extra test cases (lying `Content-Length`, `+json` types, 256-char token, `null`, game-over update parse).

## Gotchas

- TS 6 DOM typings: `new Request(url, { body })` needs `Uint8Array<ArrayBuffer>`, not `Uint8Array` (= `Uint8Array<ArrayBufferLike>`). `TextEncoder.encode` and `Uint8Array.from` already return the right type.
- `Headers` trims header values: `'Bearer '` reaches `parseBearer` as `'Bearer'`.
- A `Uint8Array` request body gets no default `Content-Type`; a string body gets `text/plain;charset=UTF-8`.
- The `_Check` type alias needs `// eslint-disable-next-line @typescript-eslint/no-unused-vars`.
- Run `pnpm exec prettier --write app/api tests/api` before `pnpm lint`.

## For the next iteration

- Use `RequestError(status, code, field?)` — argument order status, code, field. Never write a numeric status ≥ 400 in `handlers.ts`/`route.ts`; wrap with `toErrorResponse` + `jsonResponse`.
- `readJsonBody` returns `Record<string, unknown>`; feed it to `parseBody(CreateGameBodySchema, …)` / `parseBody(SubmitMoveBodySchema, …)`. The parsed create body is directly assignable to `CreateGameRequest`.
- `PRESET_LABELS` + `getPreset` build the presets body exactly as P-9 shows; validate it in tests with `PresetsResponseSchema`.
- `handlers.ts` must not import `@/src/state/*` (VC-832); get `MAX_COMMIT_VERSION`-dependent checks via `schemas.ts`.
- `makeService` (from `../unit/service/support/service-fixtures`) gives a real `PlayerUpdate` cheaply for fixtures.
