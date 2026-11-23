# Spec 05 — Storage

> Version: 0.2 · Last updated: 2026-11-23 · Status: Draft · Owner: Federico Castañeda
> Source: [`docs/implementation.md`](../docs/implementation.md) §3 Phase 5 (Milestone M2). Context: [`docs/architecture.md`](../docs/architecture.md) §1.1, §2, §6.1–§6.4, §9, §11, AD-3, AD-10.
> Builds on: [`specs/00-project-scaffold-frozen.md`](./00-project-scaffold-frozen.md) (layer rule: only `src/storage` imports `fs`/`node:fs`/`@vercel/blob`; `src/config.ts` importable from `storage`; `Config` fields `storageDriver`, `fileStoreDir`, `blobStoreId`, `vercelOidcToken`, `blobReadWriteToken`; `ConfigError`; `tests/contract` run by `pnpm test`). Phase 4 hand-off: [`specs/04-players-frozen.md`](./04-players-frozen.md) (nothing in this spec depends on it; Phase 7 joins the two tracks).
> Requirement IDs use the 5xx range.

## Purpose

The game core is complete, but nothing is persisted: every later backend phase (the Game State Manager, `GameService`, the HTTP API, retention) needs somewhere to keep games that behaves the same on a laptop, in tests and on Vercel. Vercel Blob is the only storage the deployment allows, and it has no transactions, so the system's single concurrency primitive is a create-only write that fails when the key already exists (architecture §6.3). This spec delivers the `ObjectStore` abstraction in `src/storage` with three drivers — in-memory, filesystem and Vercel Blob — that share one byte-level contract (create-only and overwrite puts, gets, existence probes, sorted paginated listing, idempotent deletes), JSON helpers that validate with Zod, a factory driven by `STORAGE_DRIVER`, and one contract test suite run against every driver. It benefits the developers of Phases 5b–11, who build the state manager, service, API and retention job on storage whose semantics are proven by tests rather than assumed.

## Scope

**In**
- `src/storage/object-store.ts`: the `ObjectStore` interface and its option/result types; `ObjectExistsError`, `InvalidKeyError`, `CorruptObjectError`; key and prefix validation (`assertValidKey`, `assertValidPrefix`); the `getJson` and `putJson` helpers.
- `src/storage/memory-store.ts`: `MemoryObjectStore`.
- `src/storage/file-store.ts`: `FileObjectStore`.
- `src/storage/vercel-blob-store.ts`: `VercelBlobObjectStore`.
- `src/storage/index.ts`: `createObjectStore(config)`.
- Adding `@vercel/blob` `2.9.0` (exact pin) to `dependencies`.
- `tests/contract/`: one storage contract suite run against memory, file and (only when `BLOB_READ_WRITE_TOKEN` is set) Blob; `tests/unit/storage/`: unit tests for validation, the JSON helpers, the factory and the Blob driver against a mocked SDK.
- Deleting `src/storage/.gitkeep`.
- Updating `docs/architecture.md` §6.1 and adding a "Storage" section to `docs/development.md`.

**Out**
- Game key layout, persisted document schemas, `meta.json`/commit/`head.json` logic, `CommitConflictError`, `GameNotFoundError` (Phase 6).
- Creating the Vercel project or the preview Blob store, CI secrets, and any run against a real Blob store, including `scripts/blob-checks.ts` (Phase 5b).
- Retention (Phase 10); any change to `src/config.ts` or `loadConfig`.
- ETag-conditional writes (`ifMatch`), cached Blob reads, content types on reads, object metadata (size, timestamps), streaming bodies.
- Keys where one key is a path prefix of another (`a` and `a/b`): callers must never create them (the state layer's key builders in Phase 6 follow this), and the file store cannot hold both (FR-512).

## Actors

| Actor | Description | Permissions |
|---|---|---|
| Game State Manager (Phase 6) and retention job (Phase 10) | The only production callers of an `ObjectStore` | All `ObjectStore` methods, `getJson`, `putJson`, `createObjectStore` |
| Developer | Runs the app locally with the `file` (default) or `memory` driver | Sets `STORAGE_DRIVER`, `FILE_STORE_DIR` |
| Vercel runtime | Runs the app with the `blob` driver against a private store | Provides `BLOB_STORE_ID` + `VERCEL_OIDC_TOKEN`, or `BLOB_READ_WRITE_TOKEN` |
| Contract and unit tests | Exercise every driver through the same suite | Create their own stores (temp folders, fresh `MemoryObjectStore`, a unique Blob prefix) |

## Functional Requirements

### Keys

- **FR-500 (Must)** — Given a string `key`, when any `ObjectStore` method receives it as a key, then it is valid iff its length is 1–512 and it is one or more segments joined by `/`, each segment matching `^[A-Za-z0-9_-][A-Za-z0-9._-]*$` (so no empty segment, no leading or trailing `/`, no segment `.` or `..`, and no segment starting with `.`). An invalid key makes the method throw (reject with) `InvalidKeyError` whose `key` property and message contain the key, before any I/O. For `delete`, every key is validated before any key is deleted.
- **FR-501 (Must)** — Given a `prefix` for `list`, then it is valid iff it is `''` or `prefix + 'x'` is a valid key under FR-500 (so `games/`, `games/ab` and `index/created/2026-` are valid; `/games`, `games//x`, `../` and `games/.t` are not). An invalid prefix rejects with `InvalidKeyError` naming it.

### Object store contract (every driver)

- **FR-502 (Must)** — Given a key that does not exist, when `put(key, body, { mode: 'create-only' })` is called (`mode` defaults to `'create-only'`), then the object is stored; a later `get(key)` returns `{ body }` whose bytes equal `body` (a `string` body is stored as its UTF-8 encoding; an empty body is allowed).
- **FR-503 (Must)** — Given a key that already exists, when `put(key, body, { mode: 'create-only' })` is called, then it rejects with `ObjectExistsError` whose `key` is the key, and the stored body is unchanged. Given N concurrent create-only puts to the same missing key from one process, exactly one resolves and the other N − 1 reject with `ObjectExistsError`; the stored body is the winner's. On Blob this holds except for the SDK-retry case of FR-513, where the winner may also reject (the stored body is then one of the rejected bodies).
- **FR-504 (Must)** — Given any key, when `put(key, body, { mode: 'overwrite' })` is called, then the key holds `body` afterwards, whether or not it existed.
- **FR-505 (Must)** — Given a missing key, then `get(key)` resolves to `null` and `exists(key)` to `false`; given an existing key, `exists(key)` resolves to `true`.
- **FR-506 (Must)** — Given a create-only or overwrite put in progress, when the same key is read concurrently, then every `get` returns either `null` (create-only, not yet published), the previous body (overwrite) or the complete new body — never a partial body.
- **FR-507 (Must)** — Given `list(prefix, { cursor?, limit? })`, then it resolves to `{ keys, cursor? }` where `keys` are the stored keys that start with `prefix` (plain string prefix, not only whole segments), in ascending code-unit order, at most `limit` of them (`limit` defaults to `1000`; a value that is not an integer in 1–1000 rejects with `RangeError` naming `limit`). For memory and file, `cursor` is present iff at least one more matching key exists after the page; for Blob, iff the SDK reports `hasMore`. Passing it back (with the same prefix) returns the next page, starting after the last key of the previous page. Concatenating all pages of a store not modified meanwhile gives every matching key exactly once, in order. A prefix matching nothing resolves to `{ keys: [] }` with no `cursor`.
- **FR-508 (Must)** — Given `delete(keys)`, then every listed key is missing afterwards; keys that were already missing are not an error, duplicates are allowed, and `delete([])` resolves without doing anything.

### JSON helpers

- **FR-509 (Must)** — Given `putJson(store, key, value, opts?)`, then it calls `store.put(key, JSON.stringify(value), { mode: opts?.mode ?? 'create-only', contentType: 'application/json' })`; a `value` for which `JSON.stringify` returns `undefined` (e.g. `undefined`, a function) rejects with `TypeError` before calling `put`.
- **FR-510 (Must)** — Given `getJson(store, key, schema)`, then: a missing key resolves to `null`; otherwise the body is decoded as UTF-8 (invalid UTF-8 counts as invalid JSON), parsed with `JSON.parse` and validated with `schema.safeParse`, resolving to the parsed `data`. Invalid JSON rejects with `CorruptObjectError` (`key`, `reason: 'invalid-json'`); a schema failure (including an unknown `schemaVersion`) rejects with `CorruptObjectError` (`key`, `reason: 'schema'`, `issuePath` = the first Zod issue's path joined with `.`). The error message contains the key and the reason (and the path for `'schema'`), and never the body.

### Drivers

- **FR-511 (Must)** — `MemoryObjectStore` keeps objects in a `Map` owned by the instance; it stores a copy of each body and `get` returns a fresh copy, so mutating a passed or returned `Uint8Array` never changes the stored object. Each `new MemoryObjectStore()` starts empty.
- **FR-512 (Must)** — `FileObjectStore(rootDir)` maps key `a/b/c` to `<rootDir>/a/b/c` (`rootDir` resolved against the current working directory; parent folders created on demand; nothing is created until the first put).
  - create-only: write the body to a temp file named `.tmp-<random>` in the target's folder, fsync and close it, then `fs.link(temp, target)`; `EEXIST` → `ObjectExistsError`; the temp file is unlinked in every outcome.
  - overwrite: write a temp file the same way, fsync and close it, then `fs.rename(temp, target)`; on failure the temp file is unlinked.
  - `get`/`exists`: a missing path, or a path that is a folder, counts as missing.
  - `list`: walks `rootDir` (a missing `rootDir` lists nothing), ignores every file or folder whose name starts with `.` and every folder as a key, then applies FR-507; the cursor is the last key returned.
  - `delete`: unlinks each file, ignoring `ENOENT`; emptied folders may remain and never appear in `list`.
  - A put whose key is an existing folder, or whose parent path is an existing file, has unspecified behaviour (such keys are out of scope) and is not tested.
- **FR-513 (Must)** — `VercelBlobObjectStore({ token? })` uses `@vercel/blob`, passing `token` to every SDK call when given (otherwise the SDK's own OIDC authentication applies):
  - `put` → `put(key, body, { access: 'private', addRandomSuffix: false, allowOverwrite: mode === 'overwrite', contentType })` (`contentType` only when given; a `Uint8Array` body is passed as `Buffer.from(body.buffer, body.byteOffset, body.byteLength)`, since the SDK's `PutBody` type excludes plain `Uint8Array`); an SDK error whose message contains `already exists` → `ObjectExistsError`. The SDK retries failed requests (network errors and 5xx, `VERCEL_BLOB_RETRIES`, default 10), so on Blob a create-only `ObjectExistsError` may also mean the caller's own write succeeded and its retry collided; callers that need to tell the two apart read the object back and compare (Phase 6, for commits, whose bodies are unique per request).
  - `get` → `get(key, { access: 'private', useCache: false })`; `null` → `null`; otherwise the stream is read fully into the returned body.
  - `exists` → the same uncached `get`; `true` iff it is not `null` (the stream is cancelled unread). Not `head()`, which throws `BlobNotFoundError` for a missing key and has no uncached option.
  - `list` → `list({ prefix, cursor, limit, mode: 'expanded' })`; `keys` = the page's pathnames sorted per FR-507; `cursor` = the SDK cursor when `hasMore`, else absent. On Blob, FR-507's cross-page order and completeness are assumptions until Phase 5b verifies them, and callers keep treating a Blob listing as a hint (architecture §6.3).
  - `delete` → `del(keys)` in batches of at most 1000 distinct keys; an SDK `BlobNotFoundError` is ignored.
  - Every other SDK error propagates unchanged. No call ever uses `access: 'public'` or a cached read.
- **FR-514 (Must)** — Given a `Config`, when `createObjectStore(config)` is called, then: `memory` → the same `MemoryObjectStore` instance on every call in the process; `file` → `new FileObjectStore(config.fileStoreDir)`; `blob` → `new VercelBlobObjectStore({ token: config.blobReadWriteToken })` when `blobReadWriteToken` is set, else `new VercelBlobObjectStore()` when `blobStoreId` is set (the SDK obtains the OIDC token itself, from the environment or the request context, and reports a missing one on first use), else it throws `ConfigError` whose message names `BLOB_READ_WRITE_TOKEN` and `BLOB_STORE_ID` and contains no variable values.

### Contract suite, docs

- **FR-515 (Must)** — `tests/contract/` holds one storage contract suite (FR-500 to FR-510) parameterised by a store factory, and runs it for `MemoryObjectStore` (a fresh store per test), `FileObjectStore` (a fresh `fs.mkdtemp` folder under `os.tmpdir()` per test, removed afterwards) and `VercelBlobObjectStore`. The Blob run is skipped (reported as skipped, not passed) unless `BLOB_READ_WRITE_TOKEN` is set. When it runs, each test gets a test-only wrapper store (in `tests/contract/`) over one `VercelBlobObjectStore` that validates the unprefixed key or prefix (`assertValidKey`/`assertValidPrefix`), prepends `contract/<runId>/<testId>/` (both random) to every key and prefix, strips it from the keys `list` returns and from the `key` of any `ObjectExistsError` it rethrows, and passes `cursor`, `limit`, `mode` and `contentType` through unchanged; so `list('')` sees only that test's keys. An `afterAll` lists and deletes every key under `contract/<runId>/`.
- **FR-516 (Must)** — `docs/architecture.md` §6.1 describes the shipped interface, errors, key rule, list limits and per-driver behaviour (uncached Blob reads everywhere, create-only default, Blob `list` still a hint, the SDK-retry caveat of FR-513); `docs/development.md` gains a section "Storage" numbered right after "Players, views and simulation" (later sections and cross-references renumbered) with the module map, the key rule, how to choose a driver, the JSON helpers and their errors, how to run the contract suite (including against Blob with `BLOB_READ_WRITE_TOKEN`), and the file store's on-disk format.

## Business Rules

- **BR-501 — Storage is generic.** `src/storage` stores bytes under keys and knows nothing about games: it imports from `src` only `src/config.ts` (for `Config` and `ConfigError`, always written `@/src/config`), plus `zod` types, Node built-ins and `@vercel/blob`. *Rationale:* the key layout and document schemas belong to the state layer (Phase 6), so drivers stay swappable and testable on their own (AD-3). *Exceptions:* none.
- **BR-502 — Create-only is the only lock.** No driver offers locking, compare-and-swap or transactions; every concurrency guarantee above the store is built on FR-503. *Rationale:* architecture §6.3 — Blob offers nothing else that the memory and file stores can match. *Exceptions:* none.
- **BR-503 — Blob is private and uncached.** Every Blob write uses `access: 'private'` and every Blob read or probe uses `useCache: false`. *Rationale:* AD-10 (game state holds every hand) and §6.3 (a cached or negative-cached read could hide a newer commit). *Exceptions:* none; cached reads of immutable keys are deferred until measured (Phase 5b, Phase 8).
- **BR-504 — Errors never leak data.** `InvalidKeyError`, `ObjectExistsError` and `CorruptObjectError` messages contain the key and a reason but never a body or a credential. *Rationale:* stored state holds the secret seed and every hand (architecture §8). *Exceptions:* none.

## Non-Functional Requirements

- **NFR-501** — `pnpm typecheck`, `pnpm lint` (0 warnings), `pnpm test` and `pnpm test:sim` pass, locally and in CI.
- **NFR-502** — `package.json` `dependencies` are exactly `@noble/hashes, @vercel/blob, next, react, react-dom, zod`, with `@noble/hashes` at `2.4.0` and `@vercel/blob` at `2.9.0`; `devDependencies` are unchanged.
- **NFR-503** — The memory and file contract runs together complete in < 30 s as reported by vitest in the CI "Test" step. *Why:* they run on every PR inside `pnpm test`; the slow-write test (FR-506) must stay bounded.
- **NFR-504** — The file store is durable against a crash at any point of a put: a reader afterwards sees either no object (create-only), the previous body (overwrite) or the complete new body — guaranteed by fsync-before-publish and atomic `link`/`rename` (FR-512), checked by FR-506's test and by code review of FR-512.

## Data & Interfaces

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

## Verification Criteria

### Keys
- **VC-501** (FR-500): `assertValidKey` accepts `a`, `games/abc/meta.json`, `index/created/2026-11-23/x_y-z`, a 512-char key; rejects `''`, `/a`, `a/`, `a//b`, `.`, `a/..`, `a/.tmp-1`, `a b`, `a\b`, `é`, a 513-char key — each with `InvalidKeyError` whose `key` equals the input; for every driver, `get`, `put`, `exists` and `delete` with `../x` reject with `InvalidKeyError`, and `delete(['ok', '../x'])` leaves an existing `ok` in place.
- **VC-502** (FR-501): `assertValidPrefix` accepts `''`, `games/`, `games/ab`, `index/created/2026-`; rejects `/games`, `games//x`, `../`, `games/.t`; `list('../')` rejects with `InvalidKeyError` on every driver.

### Contract (run for memory and file; for Blob only with a token)
- **VC-503** (FR-502): create-only put of `'héllo'`, of a 256-byte `Uint8Array` with every byte value, and of an empty body → `get` returns those exact bytes (`'héllo'` as its UTF-8 encoding).
- **VC-504** (FR-503): a second create-only put to an existing key → `ObjectExistsError` with that `key`, body unchanged; 10 concurrent create-only puts with distinct bodies to one missing key → exactly 1 fulfilled, 9 `ObjectExistsError`, stored body = the fulfilled one's.
- **VC-505** (FR-504): overwrite on a missing key creates it; overwrite on an existing key replaces the body; a put with no options on an existing key → `ObjectExistsError` (default is create-only).
- **VC-506** (FR-505): `get`/`exists` on a missing key → `null`/`false`; after a put → body/`true`; after `delete` → `null`/`false`.
- **VC-507** (FR-506): while one 8 MiB create-only put and then one 8 MiB overwrite (different bytes) run, a loop of `get` calls on the key, started before the put is awaited and run until it settles (at least one `get` is issued before the put settles, asserted by a counter), sees only `null` or the full 8 MiB body (create-only), and only the old or the new full body (overwrite).
- **VC-508** (FR-507): with keys `b/2`, `a/1`, `a/10`, `a/2`, `ab`, `c` stored: `list('a/')` → `['a/1', 'a/10', 'a/2']` with no cursor; `list('a')` → `['a/1', 'a/10', 'a/2', 'ab']`; `list('')` → all six sorted; `list('zz')` → `{ keys: [] }` without `cursor`; paging `list('', { limit: 4 })` then with the returned cursor → 4 + 2 keys, concatenation equals `list('')`, second page has no cursor; on memory and file, `list('a/', { limit: 3 })` → 3 keys and no cursor (exact page boundary); `limit` `0`, `1001`, `1.5` → `RangeError`. Outside the contract suite (a unit test on `MemoryObjectStore` only): 1,001 keys with the default limit → pages of 1000 and 1, covering every key once in order.
- **VC-509** (FR-508): `delete(['x', 'x', 'missing'])` with `x` stored → resolves and `x` is gone; `delete([])` resolves and the store is unchanged.
- **VC-510** (FR-509): `putJson(store, 'k', { a: 1 })` → `get('k')` bytes decode to `{"a":1}`; a second `putJson` to `k` → `ObjectExistsError`; with `{ mode: 'overwrite' }` it replaces it; `putJson(store, 'u', undefined)` → `TypeError` and `exists('u')` is `false`.
- **VC-511** (FR-510): `getJson` on a missing key → `null`; on a stored `{"schemaVersion":1,"n":2}` with schema `z.object({ schemaVersion: z.literal(1), n: z.number() })` → the object; on body `{"schemaVersion":2,"n":2}` → `CorruptObjectError` with `reason 'schema'` and `issuePath 'schemaVersion'`; on body `not json` and on bytes `[0xff, 0xfe]` → `reason 'invalid-json'`; on a body containing `SECRET-SEED-123` that fails the schema, the error message contains the key and does not contain `SECRET-SEED-123`.

### Drivers
- **VC-512** (FR-511): mutating the `Uint8Array` passed to `put` and the one returned by `get` leaves a later `get` unchanged; two `new MemoryObjectStore()` instances do not share keys.
- **VC-513** (FR-512): for a temp root: `new FileObjectStore(root)` creates nothing until the first put; `put('a/b/c', 'x')` creates `<root>/a/b/c` containing `x`; after the VC-504 race and a sequence of successful and conflicting puts, no file under `root` has a name starting with `.tmp-`; a file `<root>/a/.tmp-zzz` created by hand is not listed and `get('a')` (a folder) → `null`; a store on a missing root lists `{ keys: [] }`; deleting the only key in `a/b/` leaves `list('')` without it.
- **VC-514** (FR-513, BR-503): with `@vercel/blob` mocked (`vi.mock`): `put(k, b)` calls the SDK `put` with `{ access: 'private', addRandomSuffix: false, allowOverwrite: false }` and `put(k, b, { mode: 'overwrite', contentType: 'application/json' })` with `allowOverwrite: true, contentType: 'application/json'`; a `Uint8Array` body reaches the SDK as a `Buffer` with the same bytes; an SDK rejection `new Error('This blob already exists, …')` → `ObjectExistsError`; any other SDK error (e.g. a `BlobError` from `get`) propagates as the same object; an invalid key, an invalid prefix, `limit: 0` and `delete(['ok', '../x'])` reject with `InvalidKeyError`/`RangeError` and no SDK function is called; `get` and `exists` call SDK `get(k, { access: 'private', useCache: false })` and map `null` → `null`/`false`; a mocked stream body is returned as bytes; `list` maps an unsorted page `['b', 'a']` with `hasMore: true, cursor: 'c1'` → `{ keys: ['a', 'b'], cursor: 'c1' }` and `hasMore: false` → no cursor, passing `{ prefix, cursor, limit, mode: 'expanded' }`; `delete` of 2,001 distinct keys calls `del` 3 times (1000, 1000, 1); a `BlobNotFoundError` from `del` is swallowed; with `{ token: 't' }` every SDK call receives `token: 't'`; `grep -nE "access: 'public'|useCache: true" src/storage` finds nothing.
- **VC-515** (FR-514): `createObjectStore` with `storageDriver 'memory'` twice → the same instance (`===`), an instance of `MemoryObjectStore`; `'file'` with `fileStoreDir 'x'` → a `FileObjectStore`; `'blob'` with `blobReadWriteToken 'tok'` → a `VercelBlobObjectStore` whose SDK calls receive `token: 'tok'` (mocked SDK); `'blob'` with only `blobStoreId` (no `vercelOidcToken`) → a `VercelBlobObjectStore` whose SDK calls receive no `token`; `'blob'` with only `vercelOidcToken 'oidc-123'` or nothing → `ConfigError` whose message contains `BLOB_READ_WRITE_TOKEN` and `BLOB_STORE_ID` and not `oidc-123`.

### Contract suite, docs, purity, NFRs
- **VC-516** (FR-515, NFR-501, NFR-503): `pnpm test` without `BLOB_READ_WRITE_TOKEN` runs the contract suite for memory and file (all pass) and reports the Blob run as skipped; locally and in CI; the memory + file contract files' vitest durations sum to < 30 s in the CI "Test" step; the Blob contract file runs every test through the FR-515 prefixing wrapper with a fresh `contract/<runId>/<testId>/` per test and deletes everything under `contract/<runId>/` in an `afterAll`.
- **VC-517** (FR-516): `docs/architecture.md` §6.1 contains `InvalidKeyError`, `CorruptObjectError`, `useCache: false`, `1000` and states that `create-only` is the default mode; `docs/development.md` has a "Storage" section numbered right after "Players, views and simulation", mentioning `STORAGE_DRIVER`, `FILE_STORE_DIR`, `BLOB_READ_WRITE_TOKEN`, `getJson`, `CorruptObjectError` and `.tmp-`, with no stale section cross-reference.
- **VC-518** (BR-501, BR-504, NFR-502): `grep -rnE "from '(@/src|\.\./)" src/storage | grep -v "from '@/src/config'"` finds nothing; error-message tests in VC-501, VC-504 and VC-511 show the key and no body; `package.json` `dependencies` are exactly `@noble/hashes,@vercel/blob,next,react,react-dom,zod` with versions `2.4.0` and `2.9.0`, `devDependencies` unchanged; `src/storage/.gitkeep` no longer exists.
- **VC-519** (BR-502): `grep -rniE "lock|ifMatch|compare.?and.?swap" src/storage` finds nothing outside comments.

## Open Questions

None.

## Assumptions

- `@vercel/blob` 2.9.0 rejects a `put` with `allowOverwrite: false` on an existing pathname with an error whose message contains `already exists` (the SDK exports no dedicated error class), and returns `null` from `get` for a missing pathname. Both are verified against a real store in Phase 5b; if either is wrong, FR-513's mapping changes in a new spec.
- Vercel Blob `list` returns pathnames in ascending order across pages, as FR-507 requires; the Blob contract run in Phase 5b verifies it.
- `@vercel/blob` `del` on a batch containing missing pathnames either succeeds or throws `BlobNotFoundError` after deleting the existing ones; Phase 5b verifies it (FR-508 on Blob depends on it).
- `fs.link` and `fs.rename` are atomic on the local filesystems used for development and CI (APFS, ext4); the file store is not used on network filesystems.
- `tests/` is outside the layer rule, so the contract suite may read `process.env` and import `node:os`/`node:fs`.

## Changelog

- 0.2 (2026-11-23): review passes 1–2 — FR-503 Blob retry exception; contract wrapper unprefixes error keys and uses `contract/<runId>/<testId>/` (FR-515, VC-516); folder/key collisions on the file store unspecified (FR-512, VC-513); Blob contract run isolated by a per-test prefixing wrapper (FR-515, VC-516); cursor defined at the exact page boundary, 1,001-key default-limit check moved to a memory unit test (FR-507, VC-508); slow-write test must read during the put (VC-507); Blob driver: `Uint8Array` → `Buffer`, SDK-retry caveat on create-only (operator), `exists` rationale, Blob `list` stays a hint, validation before SDK calls (FR-513, VC-514); OIDC branch needs only `BLOB_STORE_ID` (operator; FR-514, VC-515); `del` assumption; `@/src/config` import form (BR-501, VC-518); docs carry the Blob caveats (FR-516).
- 0.1 (2026-11-23): initial draft from implementation.md Phase 5, architecture §6, and discovery answers (Blob reads always uncached; strict key validation on every driver; missing Blob credentials fail in `createObjectStore`; one memory store per process; `CorruptObjectError` for bad JSON or schema; lists sorted on every driver with limit ≤ 1000; idempotent deletes; Blob contract run deferred to Phase 5b; `@vercel/blob` 2.9.0).
