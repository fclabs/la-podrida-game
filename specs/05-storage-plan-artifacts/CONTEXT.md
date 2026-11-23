# CONTEXT — Storage (Phase 5)

Last updated by: Iteration 3 (Vercel Blob driver + factory). Next: Iteration 4 (storage documentation).

## Current state

- Phases 0–4 are complete (`specs/00-…-frozen.md` to `specs/04-players-frozen.md`). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`; target ES2022, so class fields are *defined* properties), pnpm 10.15.1, Node 24 declared (local Node may differ: pnpm prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, `@noble/hashes` 2.4.0, project-local layer-boundary lint rule, GitHub Actions CI (install, typecheck, lint, test, Simulation tests, build).
- `dependencies` = `@noble/hashes, @vercel/blob, next, react, react-dom, zod` (`@noble/hashes` 2.4.0, `@vercel/blob` 2.9.0 exact, NFR-502); `devDependencies` unchanged. The SDK is in `node_modules/@vercel/blob` (types in `dist/index.d.ts`).
- **Iteration 1 shipped** `src/storage/object-store.ts` (interface, errors, key/prefix validation, list helpers, `getJson`/`putJson`) and `src/storage/memory-store.ts` (`MemoryObjectStore`); the shared contract suite `tests/contract/object-store.contract.ts` and its memory run; unit tests in `tests/unit/storage/`. `src/storage/.gitkeep` and `tests/contract/.gitkeep` are deleted.
- **Iteration 2 shipped** `src/storage/file-store.ts` (`FileObjectStore`, FR-512), its contract run `tests/contract/file-store.contract.test.ts` and `tests/unit/storage/file-store.test.ts` (VC-513, P-11).
- **Iteration 3 shipped** `src/storage/vercel-blob-store.ts` (`VercelBlobObjectStore`, FR-513), `src/storage/index.ts` (`createObjectStore`, FR-514), the FR-515 wrapper `tests/contract/prefixed-store.ts`, the Blob contract run `tests/contract/blob-store.contract.test.ts` (skipped without `BLOB_READ_WRITE_TOKEN`), and unit tests `tests/unit/storage/vercel-blob-store.test.ts` (VC-514, mocked SDK) and `factory.test.ts` (VC-515). `@vercel/blob@2.9.0` added.
- All storage code is built. Not yet done: docs (Iteration 4: `docs/architecture.md` §6.1, `docs/development.md` "Storage" section). `src/state` still holds only `.gitkeep` (Phase 6).
- Tests: `tests/unit/storage/` 6 files / 106 tests; contract: memory 30 tests (~16 ms), file 30 tests (~970 ms), blob 30 skipped; full `pnpm test` 42 passed + 1 skipped files / 772 passed + 30 skipped tests. `pnpm build` green.
- NFR-503 local measure (Apple Silicon macOS, APFS): memory + file contract files ≈ 16 ms + 950 ms ≈ 1 s (budget 30 s; early-warning threshold 15 s).

## File map

| Path | Contents |
|---|---|
| `src/storage/object-store.ts` | Types `StoredObject`, `PutOptions`, `ListOptions`, `ListResult`, `ObjectStore`; `MAX_KEY_LENGTH` (512), `MAX_LIST_LIMIT` (1000); `ObjectExistsError`, `InvalidKeyError`, `CorruptObjectError`; `assertValidKey`, `assertValidPrefix`; list helpers `resolveListLimit`, `checkListArgs`, `pageKeys` (D-007); `putJson`, `getJson`. Private `KEY_SEGMENT` regex, `isValidKey`, `compareCodeUnits`. |
| `src/storage/memory-store.ts` | `MemoryObjectStore` (FR-511): private `#objects: Map<string, Uint8Array>`. |
| `src/storage/vercel-blob-store.ts` | `VercelBlobObjectStore` (FR-513): private `#auth` (`{ token }` or `{}`); imports `* as blob from '@vercel/blob'` and `./object-store`; module const `DELETE_BATCH_SIZE` (1000), private `compareCodeUnits`. |
| `src/storage/index.ts` | `createObjectStore(config)` (FR-514) — the only export; module-level `memoryStore` singleton. Imports `@/src/config`, `./file-store`, `./memory-store`, `./object-store` (type), `./vercel-blob-store`. |
| `src/storage/file-store.ts` | `FileObjectStore` (FR-512): private `#root` (`path.resolve(rootDir)`), `#pathOf(key)`, `#walk`; module helpers `errorCode`, `isMissing` (`ENOENT`/`ENOTDIR`), `unlinkIfPresent`, `syncFolder` (P-5, best effort). Imports `node:crypto`, `node:fs/promises`, `node:path`, `./object-store`. |
| `tests/contract/object-store.contract.ts` | `runObjectStoreContract` + types `ContractStore`, `ContractOptions` (P-13). Not collected by vitest (no `.test.ts`). Covers driver parts of VC-501/502 and VC-503 to VC-511. |
| `tests/contract/memory-store.contract.test.ts` | Calls the contract with a fresh `MemoryObjectStore` per test, `exactCursor: true`. |
| `tests/contract/file-store.contract.test.ts` | Calls the contract with a fresh `FileObjectStore` on `fs.mkdtemp(os.tmpdir()/lp-store-)` per test, removed in `cleanup`; `exactCursor: true`. |
| `tests/contract/prefixed-store.ts` | `PrefixedObjectStore(inner, namespace)` — FR-515 test-only wrapper (validates unprefixed, prepends namespace, strips it from `list` keys and rethrown `ObjectExistsError`). |
| `tests/contract/blob-store.contract.test.ts` | `describe.skipIf(!BLOB_READ_WRITE_TOKEN)`; one `VercelBlobObjectStore({ token })`, each test wrapped in `contract/<runId>/<testId>/` (`randomUUID`), `exactCursor: false`; `afterAll` lists every page under `contract/<runId>/`, then deletes page by page (120 s timeout). |
| `tests/unit/storage/vercel-blob-store.test.ts` | VC-514 with P-14 mocks: put options/Buffer/`already exists`/propagation, get/exists (uncached, stream bytes, cancel), list (sort, cursor iff `hasMore`, explicit limit, opaque cursor), delete (2,001 → 3 batches, dedupe, `BlobNotFoundError` swallowed), validation before SDK calls, token on every call / no token. |
| `tests/unit/storage/factory.test.ts` | VC-515 via `loadConfig(...)`: memory singleton, file, blob token/store-id/OIDC-only/nothing (`ConfigError`), SDK mocked. |
| `tests/unit/storage/file-store.test.ts` | VC-513 (nothing created before first put, on-disk path, relative root, missing root, no `.tmp-` after race/sequence, hand-made `.tmp-zzz` hidden, folder `a` → null, hidden folders, key below a file → missing, delete only key), cross-folder code-unit order, P-11 1,001-key paging (files written directly). |
| `tests/unit/storage/keys.test.ts` | VC-501/VC-502 tables, exact `InvalidKeyError` messages. |
| `tests/unit/storage/json.test.ts` | P-1 `CorruptObjectError` messages (incl. root `(root)`), nested `issuePath`, schema output (transforms), `putJson` arguments and `TypeError` cases (undefined, function, symbol). |
| `tests/unit/storage/memory-store.test.ts` | VC-512 copies (incl. subarray view), separate instances, VC-508 1,001-key default-limit paging, P-3 cursor rule + errors, P-2 validation order and "no synchronous throw". |

## Public interfaces

```ts
// src/storage/object-store.ts
export interface StoredObject { body: Uint8Array }
export interface PutOptions { mode?: 'create-only' | 'overwrite'; contentType?: string } // default 'create-only'
export interface ListOptions { cursor?: string; limit?: number }                         // limit 1–1000, default 1000
export interface ListResult { keys: string[]; cursor?: string }
export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string, opts?: ListOptions): Promise<ListResult>;
  delete(keys: readonly string[]): Promise<void>;
}
export const MAX_KEY_LENGTH = 512;
export const MAX_LIST_LIMIT = 1000;

export class ObjectExistsError extends Error { readonly key: string; constructor(key: string) }
//   message `Object already exists: <key>`
export class InvalidKeyError extends Error { readonly key: string; constructor(key: string, kind: 'key' | 'prefix') }
//   message `Invalid <kind>: "<key>"`
export class CorruptObjectError extends Error {
  readonly key: string; readonly reason: 'invalid-json' | 'schema'; readonly issuePath?: string;
  constructor(key: string, reason: 'invalid-json' | 'schema', issuePath?: string)
}
//   `Corrupt object <key>: invalid JSON` | `Corrupt object <key>: schema mismatch at <issuePath or (root)>`
//   issuePath: undefined for 'invalid-json'; for 'schema' the given path, '' if omitted.

export function assertValidKey(key: string): void;       // throws InvalidKeyError(key, 'key')
export function assertValidPrefix(prefix: string): void; // '' ok; else prefix+'x' must be a valid key; InvalidKeyError(prefix, 'prefix')
export function resolveListLimit(limit: number | undefined): number;
//   undefined → 1000; non-integer / <1 / >1000 → RangeError `Invalid list limit <v>: limit must be an integer from 1 to 1000`
export function checkListArgs(prefix: string, opts: ListOptions | undefined): { limit: number; cursor?: string };
//   memory/file only. Order: assertValidPrefix → resolveListLimit → cursor (valid key AND startsWith(prefix),
//   else RangeError `Invalid list cursor for prefix "<p>": "<c>"`). Call before any I/O.
export function pageKeys(allKeys: Iterable<string>, prefix: string, args: { limit: number; cursor?: string }): ListResult;
//   filter startsWith(prefix) && key > cursor, sort by code unit, take limit;
//   cursor = last returned key iff more matching keys remain (exact boundary → no cursor).
export function putJson(store, key, value: unknown, opts?: { mode?: PutOptions['mode'] }): Promise<void>;
//   JSON.stringify(value) === undefined → TypeError before put; else
//   store.put(key, text, { mode: opts?.mode ?? 'create-only', contentType: 'application/json' })
export function getJson<S extends z.ZodType>(store, key, schema: S): Promise<z.output<S> | null>;
//   missing → null; TextDecoder('utf-8', { fatal: true }) + JSON.parse failure → CorruptObjectError 'invalid-json';
//   safeParse failure → CorruptObjectError 'schema', issuePath = issues[0].path.map(String).join('.')

// src/storage/memory-store.ts
export class MemoryObjectStore implements ObjectStore { constructor() }

// src/storage/file-store.ts
export class FileObjectStore implements ObjectStore { constructor(rootDir: string) } // rootDir resolved vs cwd
//   key a/b/c → <root>/a/b/c. put: mkdir -p parent; open `<parent>/.tmp-<randomUUID>` 'wx'; writeFile; sync; close;
//   create-only → fs.link(temp, target) (EEXIST → ObjectExistsError) | overwrite → fs.rename(temp, target);
//   finally unlink temp (ENOENT ignored); then fsync parent folder (any error ignored).
//   get: readFile; ENOENT/ENOTDIR/EISDIR → null. exists: stat().isFile(); ENOENT/ENOTDIR → false.
//   list: checkListArgs → walk root (missing root → []), skip names starting '.', files only, prune folders
//   that cannot match the prefix → pageKeys. delete: validate all, then unlink each (ENOENT/ENOTDIR ignored).

// src/storage/vercel-blob-store.ts
export class VercelBlobObjectStore implements ObjectStore { constructor(options?: { token?: string }) }
//   token given → `token` spread into EVERY SDK call's options; absent → no `token` property (SDK OIDC).
//   put: assertValidKey; blob.put(key, string | Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength),
//        { access: 'private', addRandomSuffix: false, allowOverwrite: mode === 'overwrite', [contentType], [token] });
//        Error whose message includes 'already exists' → ObjectExistsError(key); anything else rethrown as is.
//   get: blob.get(key, { access: 'private', useCache: false, [token] }); null → null; statusCode !== 200 → Error
//        (unreachable: no conditional reads); body = new Uint8Array(await new Response(stream).arrayBuffer()).
//   exists: same get; null → false; else stream.cancel() (cancel errors ignored) → true. Never head().
//   list: assertValidPrefix → resolveListLimit (NOT checkListArgs: cursor is opaque) →
//        blob.list({ prefix, [cursor], limit /* always explicit, default 1000 */, mode: 'expanded', [token] });
//        keys = pathnames sorted by code unit; cursor = SDK cursor iff hasMore (and defined).
//   delete: validate all → dedupe first-seen order → sequential del(chunk ≤ 1000, { [token] });
//        BlobNotFoundError swallowed per batch; other errors propagate (later batches not sent).

// src/storage/index.ts
export function createObjectStore(config: Config): ObjectStore;
//   'memory' → one MemoryObjectStore per process (module singleton); 'file' → new FileObjectStore(config.fileStoreDir);
//   'blob' → blobReadWriteToken ? new VercelBlobObjectStore({ token }) : blobStoreId ? new VercelBlobObjectStore()
//   : throw new ConfigError('Invalid configuration:\n  - BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID is required when STORAGE_DRIVER is blob').
```

How a driver implements `list` with the shared helpers (memory does exactly this; the file store should too):

```ts
async list(prefix: string, opts?: ListOptions): Promise<ListResult> {
  const args = checkListArgs(prefix, opts);   // validation first, before any I/O
  const all = /* every stored key, any order */;
  return pageKeys(all, prefix, args);
}
```

### Contract suite (`tests/contract/object-store.contract.ts`)

```ts
export interface ContractStore { store: ObjectStore; cleanup(): Promise<void> }
export interface ContractOptions { exactCursor: boolean } // false only for Blob: skips the VC-508 exact-boundary test
export function runObjectStoreContract(
  name: string,
  makeStore: () => Promise<ContractStore>,
  opts: ContractOptions,
): void; // describe(`ObjectStore contract: ${name}`); beforeEach → makeStore(); afterEach → cleanup()
```

The Blob run wraps each test's store: `new PrefixedObjectStore(blobStore, `contract/${runId}/${randomUUID()}/`)` (see `blob-store.contract.test.ts`). A plain driver file is just (this is exactly `file-store.contract.test.ts`):

```ts
import { runObjectStoreContract } from './object-store.contract';
runObjectStoreContract('file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lp-store-'));
  return { store: new FileObjectStore(root), cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}, { exactCursor: true });
```

Contract keys used: `../x`, `ok`, `s`, `bytes`, `empty`, `k`, `race`, `o`, `m`, `big` (8 MiB, 30 s timeout), `b/2 a/1 a/10 a/2 ab c`, `x`, `y`, `missing`, `u`, `doc`, `secret/doc`. None is a path prefix of another inside one test (FR-512 safe).

## Conventions & invariants

- **Storage purity** (BR-501, P-9): files in `src/storage` import each other with `./…`, config only as `@/src/config`, plus `zod` (types), Node built-ins and `@vercel/blob` (only `vercel-blob-store.ts`). Greps that must print nothing:
  - `grep -rnE "from '(@/src|\.\./)" src/storage | grep -v "from '@/src/config'"`
  - `grep -rniwE "lock|locking|ifMatch|compareAndSwap" src/storage` (P-10: keep these words out of comments too)
  - `grep -rnE "access: 'public'|useCache: true" src/storage` (BR-503)
- **Async validation** (P-2): every `ObjectStore` method is `async`; validation (keys/prefix → limit → cursor) runs before any I/O; `delete` validates every key before deleting any.
- **Error convention**: `this.name = '<ClassName>'`; messages hold the key and a fixed reason, never a body or credential (BR-504).
- **Code-unit order**: sort with `<`/`>` comparison (`pageKeys` does it); never `localeCompare`.
- **Randomness** (P-4): use `crypto.randomUUID()` from `node:crypto` for temp names and test prefixes.
- No barrel except `src/storage/index.ts` (exports only `createObjectStore`; import it as `@/src/storage`). Callers import from `@/src/storage/object-store`, `@/src/storage/memory-store`, …
- **Tests**: unit tests in `tests/unit/storage/*.test.ts`; contract runs in `tests/contract/<driver>-store.contract.test.ts`; header comment names spec FRs/VCs; one `describe` per VC. File-store tests use `fs.mkdtemp(path.join(os.tmpdir(), 'lp-store-'))` and remove the folder; never write under `.data/`. Run everything with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN`; no network. SDK unit tests mock `@vercel/blob` with P-14 (`vi.mock(..., async (importOriginal) => ({ ...(await importOriginal<typeof import('@vercel/blob')>()), put: vi.fn(), get: vi.fn(), list: vi.fn(), del: vi.fn() }))`) and `vi.resetAllMocks()` in `beforeEach`. A `Uint8Array` passed to `new Response(...)` must be typed `Uint8Array<ArrayBuffer>` (TS 6 lib).
- **Formatting**: `pnpm exec prettier --write src/storage tests/contract tests/unit/storage` before linting; `docs/` and `specs/` are prettier-ignored.
- **Commits**: one per iteration, staged by explicit path (never `git add -A`), message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge. Never modify `src/config.ts`, `src/domain`, `src/engine`, `src/score`, `src/players`, `src/service`, `vitest*.config.ts`, `eslint.config.mjs`.

## Commands

| Command | What it does |
|---|---|
| `env -u BLOB_READ_WRITE_TOKEN pnpm vitest run tests/unit/storage` | Storage unit tests (~0.2 s). |
| `env -u BLOB_READ_WRITE_TOKEN pnpm vitest run tests/contract` | Every contract run: memory + file pass, Blob reported skipped (`Test Files 2 passed \| 1 skipped (3)`, `Tests 60 passed \| 30 skipped (90)`). |
| `BLOB_READ_WRITE_TOKEN=… pnpm vitest run tests/contract/blob-store.contract.test.ts` | Blob contract run against a real store (Phase 5b only; never in this phase). |
| `pnpm vitest run tests/contract/memory-store.contract.test.ts --reporter verbose` | Shows each VC test (VC-507, VC-508 boundary case). |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Required before every commit (lint = ESLint 0 warnings + `prettier --check .`). |
| `pnpm test:sim` | Not affected by this phase; run once in Final Verification (~46 s). |
| `pnpm build` | `next build` (green after Iteration 3; final gate). |
| `pnpm install --frozen-lockfile` | Lockfile matches `package.json` (CI install step). |
| `node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).sort().join(','),p.dependencies['@noble/hashes'],p.dependencies['@vercel/blob'])"` | NFR-502 check: prints `@noble/hashes,@vercel/blob,next,react,react-dom,zod 2.4.0 2.9.0`. |

## Known gaps

- Docs not written yet (Iteration 4).
- **Blob behaviour is unverified against a real store** (Phase 5b): the `already exists` message on a create-only conflict, `get` → `null` for a missing pathname, cross-page `list` order/completeness, `del` with missing pathnames, and the SDK-retry case (FR-503/FR-513: `VERCEL_BLOB_RETRIES`, default 10 — a create-only `ObjectExistsError` may mean the caller's own retried write won). Blob `list` stays a hint (architecture §6.3).
- Blob `delete` with several batches is not atomic: a non-`BlobNotFoundError` failure stops later batches; earlier batches are already deleted. Callers retry (deletes are idempotent).
- The prefixing wrapper was verified only ad hoc (a temporary, uncommitted contract run over `PrefixedObjectStore(MemoryObjectStore)` passed 29 + 1 skipped); there is no committed test of it without a token.
- **Case-insensitive filesystems** (macOS APFS default, Windows): on the file store, keys differing only in letter case (`A/1` vs `a/1`) map to the same file, so the second create-only put fails with `ObjectExistsError`. The spec does not cover it; the contract keys are all lowercase. Phase 6 key builders should use one case (worth a line in the Iteration 4 docs).
- File store `put` costs two fsyncs (file + folder): ~14 ms per put on macOS APFS. Fine for dev; tests needing many keys should write files directly (as the P-11 test does) or keep counts small.
- A key whose path is an existing folder, or whose parent is an existing file, has unspecified behaviour on the file store (FR-512); not tested. `get`/`exists` treat both as missing.
- The P-3 cursor rule is implemented in the shared `checkListArgs`/`pageKeys`; Blob cursors are opaque SDK strings and must NOT go through `checkListArgs` (Blob uses `assertValidPrefix` + `resolveListLimit` directly).
- The 8 MiB VC-507 test on memory is trivially satisfied (the memory put completes synchronously inside the call); the counter still proves one read was issued before the put settled. The file store is where it is meaningful.
- `MemoryObjectStore.put` does not validate `opts.mode` values outside the type (anything other than `'create-only'`/undefined behaves as overwrite); TypeScript callers cannot pass one.
