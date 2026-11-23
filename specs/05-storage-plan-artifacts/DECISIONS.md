# DECISIONS — Storage (Phase 5)

## D-001: Error classes and messages (P-1)  (Iteration 1)
**Context**: Spec fixes the error properties but not constructors or messages.
**Decision**: `ObjectExistsError(key)` → `Object already exists: <key>`; `InvalidKeyError(key, kind)` → `Invalid <kind>: "<key>"`; `CorruptObjectError(key, reason, issuePath?)` → `Corrupt object <key>: invalid JSON` | `…: schema mismatch at <path or (root)>`. Each sets `this.name`.
**Rejected**: putting Zod's issue message in the text (could echo body values).
**Consequences**: messages never contain a body (BR-504). With ES2022 class fields, `issuePath` is an own property even when `undefined` (`'issuePath' in err` is true); test with `=== undefined`. For `'schema'` with no path given, `issuePath` is `''`.

## D-002: Validation surfaces as rejections (P-2)  (Iteration 1)
**Context**: FR-500 says "throw (reject with)".
**Decision**: every `ObjectStore` method is `async`; order is keys/prefix → `limit` → cursor; `delete` validates all keys before deleting any.
**Consequences**: callers only need `await`/`.catch`; no driver throws synchronously.

## D-003: Memory/file cursor = last key of the page (P-3)  (Iteration 1)
**Context**: FR-507 leaves cursor format to the driver.
**Decision**: cursor = last returned key, present iff more matching keys remain; next page = keys `> cursor`. A cursor that is not a valid key or does not start with the prefix → `RangeError` naming `cursor`. Implemented once in `checkListArgs` + `pageKeys` (D-007).
**Consequences**: a page stays correct even if the cursor key was deleted meanwhile. Blob cursors are opaque and skip this check.

## D-004: Randomness via `crypto.randomUUID()` (P-4)  (Iteration 1)
**Decision**: temp-file names (`.tmp-<uuid>`) and contract test prefixes use `randomUUID` from `node:crypto`. Adopted now; first used in Iteration 2 (file store) and Iteration 3 (Blob wrapper).

## D-005: Imports inside `src/storage` (P-9)  (Iteration 1)
**Decision**: `./…` between storage files; `@/src/config` is the only `@/src` import; no `../`. Checked by `grep -rnE "from '(@/src|\.\./)" src/storage | grep -v "from '@/src/config'"`.

## D-006: Contract-suite shape (P-13)  (Iteration 1)
**Decision**: `tests/contract/object-store.contract.ts` exports `runObjectStoreContract(name, makeStore, { exactCursor })` plus types `ContractStore`, `ContractOptions`; `makeStore` runs in `beforeEach`, `cleanup` in `afterEach`. One `<driver>-store.contract.test.ts` per driver. Only Blob passes `exactCursor: false` (skips the VC-508 exact-boundary test via `it.runIf`).
**Consequences**: the file name has no `.test.ts`, so vitest does not collect it on its own.

## D-007: Shared list helpers exported from `object-store.ts`  (Iteration 1)
**Context**: The plan allows an exported limit helper; Iteration 2 needs the same P-3 paging but may not edit `object-store.ts` or `memory-store.ts`.
**Decision**: export `resolveListLimit(limit)`, `checkListArgs(prefix, opts)` (prefix → limit → cursor validation) and `pageKeys(allKeys, prefix, args)` (filter, code-unit sort, page, cursor) in addition to the spec's export table.
**Rejected**: keeping them private (would force the file store to duplicate the paging logic); putting them in a new module (not in Iteration 1's Touches).
**Consequences**: three extra exports beyond spec Data & Interfaces; the docs (Iteration 4) may mention them as driver-author helpers. The Blob driver uses only `assertValidPrefix` + `resolveListLimit`.

## D-008: VC-507 "read during the write" technique  (Iteration 1)
**Context**: VC-507 requires proof that at least one `get` is issued before the put settles.
**Decision**: start `put` without awaiting, attach `.finally(() => settled = true)`, then loop `get` in a `do … while (!settled)`, counting reads issued while `!settled`; assert the count ≥ 1 and zero bad reads. Bodies are 8 MiB filled with `0xa5` (old) / `0x5a` (new), compared with `Buffer.equals`. Test timeout 30 s.
**Consequences**: the first `get` is always issued synchronously before the put's promise can settle, so the counter assertion holds on every driver.

## D-009: File store temp files (P-4 applied)  (Iteration 2)
**Context**: P-4 fixes the randomness source; FR-512 fixes the temp-file location.
**Decision**: temp file = `<target folder>/.tmp-<randomUUID()>`, opened with flag `'wx'` (fails instead of reusing an existing file), written with `handle.writeFile`, `handle.sync()`, closed, then published. It is unlinked in a `finally` (ENOENT ignored), so it never survives success, `EEXIST` or an I/O error.
**Consequences**: temp names start with `.`, so `list` never sees them; a crash can leave a stray `.tmp-*` that is harmless (hidden) and never cleaned up automatically.

## D-010: Parent-folder fsync is best effort (P-5 applied)  (Iteration 2)
**Context**: P-5 says to fsync the parent folder after `link`/`rename` and ignore an fsync error.
**Decision**: `syncFolder(dir)` opens the folder read-only, `sync()`s and closes it, ignoring *any* error from open or sync (and from close). It runs only after a successful publish.
**Rejected**: propagating an `open` error — the object is already published, so a rejection would make a successful create-only look like a failure.
**Consequences**: durability where the OS supports folder fsync (macOS and Linux both accept it); no behavioural difference elsewhere.

## D-011: What counts as "missing" on the file store  (Iteration 2)
**Context**: FR-512 says a missing path or a folder counts as missing; it says nothing about a key whose parent path is a file.
**Decision**: `get` → `null` on `ENOENT`, `ENOTDIR` or `EISDIR`; `exists` → `stat().isFile()`, `false` on `ENOENT`/`ENOTDIR`; `delete` ignores `ENOENT`/`ENOTDIR`. Other errors propagate. Unlinking a key that is a folder is unspecified (FR-512) and propagates the OS error.
**Consequences**: reads and probes never throw for prefix-colliding keys, which the spec puts out of scope anyway.

## D-012: File-store list walk  (Iteration 2)
**Decision**: `list` validates with `checkListArgs` first, then walks recursively with `readdir({ withFileTypes: true })`, skipping names starting with `.`, keeping only regular files (symlinks and other types are ignored), and descending only into folders `d/` where `d/` starts with the prefix or the prefix starts with `d/`; then `pageKeys`. A missing root (or a folder vanishing mid-walk) lists nothing for that subtree.
**Consequences**: every page re-walks the matching subtree (O(matching keys) per page); acceptable for local dev.

## D-013: P-11 test writes its 1,001 files directly  (Iteration 2)
**Context**: 1,001 `put`s with two fsyncs each took ~14 s on macOS APFS, slowing `pnpm test`.
**Decision**: the P-11 unit test creates one key with `put` (which creates the folder) and writes the other 1,000 files with `fs.writeFile`; it then pages with the default limit (1000 + 1) as VC-508 requires.
**Consequences**: the test exercises the listing/paging path on real files in ~0.1 s; `put` itself is covered by the contract run and the other VC-513 tests.

## D-014: Blob delete batching (P-6 applied)  (Iteration 3)
**Context**: FR-513 caps `del` at 1000 distinct keys per call; ledger R-022.
**Decision**: validate every key, dedupe with `new Set` (first-seen order), then call `del` sequentially on chunks of ≤ 1000. A `BlobNotFoundError` is swallowed per batch and the next batch still runs; any other error propagates and later batches are not sent.
**Rejected**: parallel batches (more load, harder to reason about partial failure).
**Consequences**: a multi-batch delete is not atomic; callers retry (idempotent).

## D-015: `contentType` forwarded only by Blob (P-7 applied)  (Iteration 3)
**Decision**: `put` spreads `contentType` into the SDK options only when given; memory and file ignore it; no driver returns it.

## D-016: Blob list always sends an explicit limit; opaque cursor (P-8 applied)  (Iteration 3)
**Decision**: `list` validates with `assertValidPrefix` then `resolveListLimit` (default 1000) and always passes `limit`; `cursor` is passed only when given and is never checked (no `checkListArgs`). Result `cursor` = SDK cursor iff `hasMore` and the cursor is defined; keys are sorted by code unit.
**Consequences**: a bad cursor surfaces as whatever the SDK throws.

## D-017: SDK mocking pattern (P-14 applied)  (Iteration 3)
**Decision**: both SDK unit tests use P-14's `vi.mock('@vercel/blob', async (importOriginal) => ({ ...original, put/get/list/del: vi.fn() }))`, `vi.resetAllMocks()` plus default resolutions in `beforeEach`, and assert on `vi.mocked(fn).mock.calls`. The driver imports the SDK as a namespace (`import * as blob`), which the module mock covers.

## D-018: Token passing and the factory's ConfigError  (Iteration 3)
**Context**: FR-513 "pass `token` only when given"; FR-514's message must name both variables and no values.
**Decision**: the driver keeps `#auth = token !== undefined ? { token } : {}` and spreads it into every SDK call (so without a token the options have no `token` key). `createObjectStore` throws `new ConfigError('Invalid configuration:\n  - BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID is required when STORAGE_DRIVER is blob')`, mirroring `loadConfig`'s format. The memory singleton is a module-level `let`.
**Consequences**: the memory singleton lives for the process (tests sharing it must use distinct keys).

## D-019: Blob `get`/`exists` edge handling  (Iteration 3)
**Decision**: `get` reads the stream with `new Response(stream).arrayBuffer()`; a non-200 result (only possible for a conditional read, which the driver never sends) throws a plain `Error` naming status and key. `exists` cancels the stream and ignores a cancel error (the object exists either way).
**Rejected**: treating a 304 as an empty body (would silently fabricate data).

## D-020: Blob contract wrapper and cleanup  (Iteration 3)
**Decision**: `PrefixedObjectStore(inner, namespace)` in `tests/contract/prefixed-store.ts` (validates the namespace as a prefix in the constructor). The Blob file's `afterAll` first lists every page under `contract/<runId>/`, then deletes page by page, so deletions never disturb an open cursor. Each test's `cleanup` is a no-op.
**Consequences**: verified ad hoc over a shared `MemoryObjectStore` (not committed; outside Touches).
