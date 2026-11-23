# Frozen: Spec 05 — Storage

Source: specs/05-storage.md (plan + build record: specs/05-storage-plan.md, specs/05-storage-plan-artifacts/; review: specs/05-storage.review.md)
Status: SHIPPED
Frozen: 2026-11-23
PR / commit: https://github.com/fclabs/la-podrida-game/pull/6 — squash commit f536d11

## Purpose
The game core is complete, but nothing is persisted: every later backend phase (the Game State Manager, `GameService`, the HTTP API, retention) needs somewhere to keep games that behaves the same on a laptop, in tests and on Vercel. Vercel Blob is the only storage the deployment allows, and it has no transactions, so the system's single concurrency primitive is a create-only write that fails when the key already exists (architecture §6.3). This spec delivers the `ObjectStore` abstraction in `src/storage` with three drivers — in-memory, filesystem and Vercel Blob — that share one byte-level contract (create-only and overwrite puts, gets, existence probes, sorted paginated listing, idempotent deletes), JSON helpers that validate with Zod, a factory driven by `STORAGE_DRIVER`, and one contract test suite run against every driver. It benefits the developers of Phases 5b–11, who build the state manager, service, API and retention job on storage whose semantics are proven by tests rather than assumed.

## What it does
- **Keys.** A key is 1–512 chars of `/`-joined segments, each matching `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` (no empty, `.`, `..` or dot-leading segment). A `list` prefix is valid iff it is `''` or `prefix + 'x'` is a valid key. An invalid key or prefix rejects with `InvalidKeyError` (naming it) before any I/O; `delete` validates every key before deleting any. All methods are `async` and never throw synchronously; validation order is key/prefix → `limit` → cursor.
- **Create-only put** (the default `mode`) stores the body (a `string` as UTF-8; empty allowed). On an existing key it rejects with `ObjectExistsError` (`key`) and leaves the body unchanged; of N concurrent create-only puts to one missing key, exactly one wins.
- **Overwrite put** (`mode: 'overwrite'`) leaves the key holding the new body whether or not it existed.
- `get` returns `{ body }` or `null`; `exists` returns a boolean. A concurrent reader never sees a partial body: only `null`/previous body/complete new body.
- `list(prefix, { cursor?, limit? })` returns keys starting with `prefix` (plain string prefix) in ascending code-unit order, at most `limit` (1–1000, default 1000; otherwise `RangeError`). On memory and file, `cursor` is the last returned key and is present iff more keys remain; a bad cursor → `RangeError`. On Blob, the cursor is the SDK's opaque cursor, present iff `hasMore`.
- `delete(keys)` is idempotent: missing keys and duplicates are fine, `delete([])` does nothing.
- `putJson` writes `JSON.stringify(value)` with `contentType: 'application/json'`, create-only unless told otherwise; a value that stringifies to `undefined` → `TypeError` before any write.
- `getJson` returns `null` for a missing key, else UTF-8-decodes, parses and `schema.safeParse`s. Bad JSON or bad UTF-8 → `CorruptObjectError` `reason: 'invalid-json'`; a schema failure (including an unknown `schemaVersion`) → `reason: 'schema'` with `issuePath` (first Zod issue path joined by `.`, `''` at the root).
- `MemoryObjectStore` keeps a per-instance `Map` and copies bodies in and out.
- `FileObjectStore(rootDir)` maps key `a/b/c` to `<rootDir>/a/b/c` and creates nothing before the first put. Writes go to `.tmp-<uuid>` in the target folder, then fsync + close, then `link` (create-only, `EEXIST` → `ObjectExistsError`) or `rename` (overwrite), then a best-effort fsync of the folder. The temp file is always unlinked. `list` walks the tree, skipping dot-names and folders. A folder or a path under a file counts as missing.
- `VercelBlobObjectStore({ token? })` always uses `access: 'private'`, `addRandomSuffix: false` and `allowOverwrite: mode === 'overwrite'`. Reads and `exists` use uncached `get(..., { useCache: false })`, never `head()`. An SDK error containing `already exists` → `ObjectExistsError`. `del` runs in sequential batches of ≤ 1000 distinct keys, and `BlobNotFoundError` is swallowed. Every other SDK error propagates unchanged.
- `createObjectStore(config)`:
  - `memory` → one `MemoryObjectStore` per process.
  - `file` → a `FileObjectStore(fileStoreDir)`.
  - `blob` → a store with the token when `BLOB_READ_WRITE_TOKEN` is set, else a tokenless store (SDK OIDC) when `BLOB_STORE_ID` is set, else `ConfigError` naming both variables and no values.
- `tests/contract/` runs one contract suite against memory and file on every `pnpm test`. The Blob run is skipped without `BLOB_READ_WRITE_TOKEN`. With a token, each test is isolated by `PrefixedObjectStore` under `contract/<runId>/<testId>/`, and an `afterAll` deletes the run.
- Docs: `docs/architecture.md` §6.1 (shipped interface, Blob caveats); `docs/development.md` §13 "Storage" (Known limitations is now §14).
- **Business rules.**
  - Storage is generic: it knows nothing about games and imports only `@/src/config` from `src` (BR-501).
  - Create-only is the only lock: no locking, CAS, transactions or `ifMatch` (BR-502).
  - Blob is always private and uncached (BR-503).
  - Error messages carry the key and a reason, never a body or credential (BR-504).

## Public interfaces / data

### Module exports

| Module | Exports |
|---|---|
| `src/storage/object-store.ts` | types `ObjectStore`, `StoredObject`, `PutOptions`, `ListOptions`, `ListResult`; `ObjectExistsError`; `InvalidKeyError`; `CorruptObjectError`; `MAX_KEY_LENGTH` (512); `MAX_LIST_LIMIT` (1000); `assertValidKey(key: string): void`; `assertValidPrefix(prefix: string): void`; `getJson`; `putJson` |
| `src/storage/memory-store.ts` | `MemoryObjectStore` |
| `src/storage/file-store.ts` | `FileObjectStore` |
| `src/storage/vercel-blob-store.ts` | `VercelBlobObjectStore` |
| `src/storage/index.ts` | `createObjectStore(config: Config): ObjectStore` |

No barrel beyond `index.ts`, which exports only `createObjectStore`. Callers import types and helpers from `@/src/storage/object-store`.

### `object-store.ts`

```ts
export interface StoredObject { body: Uint8Array }
export interface PutOptions { mode?: 'create-only' | 'overwrite'; contentType?: string } // mode default 'create-only'
export interface ListOptions { cursor?: string; limit?: number }                         // limit 1–1000, default 1000
export interface ListResult { keys: string[]; cursor?: string }

export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string, opts?: ListOptions): Promise<ListResult>;
  delete(keys: readonly string[]): Promise<void>;
}

export class ObjectExistsError extends Error { readonly key: string }
export class InvalidKeyError extends Error { readonly key: string }
export class CorruptObjectError extends Error {
  readonly key: string;
  readonly reason: 'invalid-json' | 'schema';
  readonly issuePath?: string; // only for 'schema'
}

export function getJson<S extends z.ZodType>(store: ObjectStore, key: string, schema: S): Promise<z.output<S> | null>;
export function putJson(store: ObjectStore, key: string, value: unknown, opts?: { mode?: PutOptions['mode'] }): Promise<void>;
```

`contentType` is a write-only hint: only the Blob driver forwards it; no driver returns it.

### Driver constructors

```ts
export class MemoryObjectStore implements ObjectStore { constructor() }
export class FileObjectStore implements ObjectStore { constructor(rootDir: string) }
export class VercelBlobObjectStore implements ObjectStore { constructor(options?: { token?: string }) }
```

### File store on disk

```
<FILE_STORE_DIR>/games/abc/meta.json      ← key games/abc/meta.json
<FILE_STORE_DIR>/games/abc/.tmp-k3x9…    ← in-flight temp file, never a key
```

*Shipped beyond the spec table (D-007):* `object-store.ts` also exports the driver-author helpers `resolveListLimit`, `checkListArgs` and `pageKeys`. These are not for callers.

## Key decisions
- **Create-only put is the one concurrency primitive.** Blob offers nothing the memory and file stores can match (architecture §6.3). `ifMatch` is not offered; `head.json` is written with a plain overwrite.
- **Blob reads are always uncached.** A cached or negatively cached read could hide a newer commit. Cached reads of immutable keys are deferred until measured (5b/8).
- **Strict key validation on every driver** (a key that works locally works on Blob); **one factory memory store per process** (tests use `new MemoryObjectStore()`); **the factory, not `loadConfig`, checks Blob credentials**.
- **Blob deletes are sequential batches**: not atomic across batches; callers retry (idempotent).
- **`getJson` maps bad JSON and schema failures to `CorruptObjectError`.** Error messages never include the body, so they are safe to log; stored state holds the seed and every hand.

## Known limits (still true at freeze)
- **Blob retry caveat (Phase 6 must handle it):** the SDK retries network errors and 5xx (`VERCEL_BLOB_RETRIES`, default 10). On Blob, a create-only `ObjectExistsError` may mean the caller's own write landed. Before reporting `CommitConflictError`, re-read commit `v+1` and compare it with the body just written; commit bodies are unique per request.
- **Blob behaviour is unverified against a real store until Phase 5b:**
  - the `already exists` message;
  - `get` returning `null` for a missing key;
  - cross-page `list` order and completeness;
  - `del` with missing keys;
  - the retry case.
  If the first or second is wrong, a new spec changes the mapping. A Blob listing is a hint: confirm with an uncached `get`/`exists`.
- **Key-builder rules for Phase 6:**
  - Satisfy the key rule; check every builder with `assertValidKey` in tests.
  - Use one letter case: macOS/Windows file stores collide on case.
  - Zero-pad numbers that must sort.
  - Never create both `a` and `a/b`: the file store cannot hold both.
- Every persisted schema must carry `schemaVersion` (e.g. `z.literal(1)`), so an unknown version surfaces as `CorruptObjectError` `reason: 'schema'`, `issuePath: 'schemaVersion'`.
- NFR-503: memory + file contract runs must stay < 30 s in the CI "Test" step. At freeze the whole step took 6 s; locally the contract runs take about 1 s.
- `dependencies` are exactly `@noble/hashes 2.4.0, @vercel/blob 2.9.0, next, react, react-dom, zod`. Only `src/storage` may import `fs` or `@vercel/blob`.
- `PrefixedObjectStore` has no committed test of its own; the first real Blob run exercises it. After 5b, update architecture §6.1 "Blob caveats" and development.md §13.7/§14.

## Deliberately excluded
- Game key layout, persisted schemas, `meta.json`/commit/`head.json` logic, `CommitConflictError` and `GameNotFoundError` (all Phase 6). Real Blob runs and `scripts/blob-checks.ts` (Phase 5b). Retention (Phase 10). Changes to `src/config.ts`.
- `ifMatch`, cached reads, content types on read, object metadata, streaming bodies, and keys that are path prefixes of other keys.
