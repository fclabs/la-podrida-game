# Iteration 3 — Vercel Blob driver and the store factory

Commit: this commit ("Add the Vercel Blob store and the store factory").

## Criteria results

Every command ran under `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` (checked: none of the three set); no test reached the network. Machine: macOS (Darwin 25.6), APFS, Node 26.13.1.

| Criterion | Command | Result |
|---|---|---|
| VC-514 | `pnpm vitest run tests/unit/storage/vercel-blob-store.test.ts` | PASS — 35 tests |
| VC-514 / BR-503 grep | `grep -nrE "access: 'public'\|useCache: true" src/storage` | PASS — no output |
| VC-515 | `pnpm vitest run tests/unit/storage/factory.test.ts` | PASS — 8 tests |
| VC-516 (local part) | `pnpm vitest run tests/contract` | PASS — `Test Files 2 passed \| 1 skipped (3)`, `Tests 60 passed \| 30 skipped (90)`; memory 30 tests 16 ms, file 30 tests 966 ms, `blob-store.contract.test.ts (30 tests \| 30 skipped)` |
| VC-518 imports | `grep -rnE "from '(@/src\|\.\./)" src/storage \| grep -v "from '@/src/config'"` | PASS — no output |
| VC-518 / NFR-502 deps | `node -e "…Object.keys(p.dependencies).sort()…"` (plan command) | PASS — `@noble/hashes,@vercel/blob,next,react,react-dom,zod 2.4.0 2.9.0` |
| VC-518 package.json diff | `git diff main -- package.json` | PASS — only `+    "@vercel/blob": "2.9.0",` |
| VC-519 / P-10 | `grep -rniwE "lock\|locking\|ifMatch\|compareAndSwap" src/storage` | PASS — no output |
| Gates | `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build` | PASS — exit 0; ESLint 0 warnings, prettier clean; `Test Files 42 passed \| 1 skipped (43)`, `Tests 772 passed \| 30 skipped (802)`; `next build` OK |
| Artifacts | `CONTEXT.md` updated, `DECISIONS.md` D-014…D-020, this record | PASS |

One failure on the way (fixed, then the whole checklist re-run from the top): `pnpm typecheck` rejected `new Response(bytes)` in the test helper because TS 6's lib types `Uint8Array<ArrayBufferLike>` as not a `BodyInit`; the helper parameter is now `Uint8Array<ArrayBuffer>`.

Extra check (not committed, outside Touches): a temporary `tests/contract/zz-scratch-prefixed.contract.test.ts` ran the full contract over `PrefixedObjectStore(sharedMemoryStore, 'contract/<run>/<test>/')` with `exactCursor: false` → 29 passed, 1 skipped; file deleted afterwards.

## Files

- Added: `src/storage/vercel-blob-store.ts`, `src/storage/index.ts`, `tests/contract/prefixed-store.ts`, `tests/contract/blob-store.contract.test.ts`, `tests/unit/storage/vercel-blob-store.test.ts`, `tests/unit/storage/factory.test.ts`, `specs/05-storage-plan-artifacts/iterations/03-blob-factory.md`.
- Changed: `package.json` (`@vercel/blob` 2.9.0), `pnpm-lock.yaml`, `specs/05-storage-plan-artifacts/CONTEXT.md`, `specs/05-storage-plan-artifacts/DECISIONS.md`.
- Nothing deleted. `object-store.ts`, `memory-store.ts`, `file-store.ts`, `src/config.ts` untouched.

## Deviations

- None from the Scope. Open choices recorded as D-014 (sequential batches; later batches stop on a real error), D-018 (ConfigError wording, `#auth` spread), D-019 (non-200 `get` → `Error`; `exists` ignores cancel errors), D-020 (cleanup lists all pages before deleting).
- `list` passes `cursor` to the SDK only when given (VC-514's `{ prefix, cursor, limit, mode }` holds; no `cursor: undefined` key).

## Gotchas

- `pnpm add` prints "Ignored build scripts: esbuild" — pre-existing pnpm policy, harmless.
- The SDK has no "already exists" error class: it arrives as a `BlobError` (`bad_request`) carrying the server message; the driver matches the message text (spec Assumption).
- The SDK `get` result is a union with a 304 branch (`stream: null`), reachable only with `ifNoneMatch`, which the driver never sends.
- `vi.mock` is hoisted; tests import `put/get/list/del` from `@vercel/blob` and use `vi.mocked(...)`. The real `BlobError`/`BlobNotFoundError` come through `importOriginal`.
- The memory singleton in `index.ts` persists across tests in one vitest worker file.

## For the next iteration

- **Final `src/storage` map**: `object-store.ts` (contract, errors, validation, list helpers, JSON helpers), `memory-store.ts` (`MemoryObjectStore`), `file-store.ts` (`FileObjectStore`), `vercel-blob-store.ts` (`VercelBlobObjectStore`), `index.ts` (`createObjectStore` only). Exports and behaviour: `CONTEXT.md` → Public interfaces.
- **Choosing a driver** (docs): `STORAGE_DRIVER` = `memory` | `file` | `blob` (default `file`, or `blob` when `VERCEL=1`); `FILE_STORE_DIR` (default `.data/`); Blob needs `BLOB_READ_WRITE_TOKEN` (wins) or `BLOB_STORE_ID` (+ the SDK's OIDC token, `VERCEL_OIDC_TOKEN` or request context), else `createObjectStore` throws `ConfigError` naming both variables.
- **Blob contract run (Phase 5b)**: `BLOB_READ_WRITE_TOKEN=… pnpm vitest run tests/contract/blob-store.contract.test.ts`. Keys live under `contract/<runId>/<testId>/`; `afterAll` deletes `contract/<runId>/`. Without the token the file is reported as skipped (30 tests).
- **Assumptions Phase 5b must verify**: the `already exists` message on a create-only conflict; `get` → `null` for a missing pathname; ascending cross-page `list` order and completeness; `del` with missing pathnames (succeeds or `BlobNotFoundError` after deleting the rest); the SDK-retry case.
- **Docs must say** (FR-516, P-12): §6.1 — interface, `InvalidKeyError`/`ObjectExistsError`/`CorruptObjectError`, key rule, list limit `1000`, `create-only` is the default mode, Blob reads/probes always `useCache: false` and writes `access: 'private'`, Blob `list` is a **hint** (architecture §6.3), and the **SDK-retry caveat**: the SDK retries network errors and 5xx (`VERCEL_BLOB_RETRIES`, default 10), so on Blob a create-only `ObjectExistsError` may mean the caller's own write succeeded and its retry collided — callers that care read back and compare (Phase 6 commits).
- Also worth a line in `development.md`: case-insensitive key collisions on the file store (Iteration 2), `.tmp-` temp files, the extra driver-author helpers `resolveListLimit`/`checkListArgs`/`pageKeys` (D-007), and that Blob `delete` across batches is not atomic (D-014).
