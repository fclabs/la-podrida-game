# Review ledger — 05-storage.md

Original line count: 202 · After pass 1: 204 · After pass 2: 204 · Readiness (pass 3): READY, 0 MUST

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 0 | DECISION | FR-513, BR-503 | Blob reads cached or uncached | decided | Operator: always uncached (`useCache: false`); interface stays `get(key)` |
| R-002 | 0 | DECISION | FR-500, FR-501 | Key validation | decided | Operator: strict rule on every driver; `InvalidKeyError` |
| R-003 | 0 | DECISION | FR-514 | Missing Blob credentials | decided | Operator: `createObjectStore` throws `ConfigError`; `loadConfig` unchanged |
| R-004 | 0 | DECISION | FR-514 | Memory driver from the factory | decided | Operator: one instance per process |
| R-005 | 0 | DECISION | FR-510 | Bad JSON or schema in `getJson` | decided | Operator: `CorruptObjectError` (key, reason, issuePath), never the body |
| R-006 | 0 | DECISION | FR-507, FR-508 | list order/limit, delete semantics | decided | Operator: sorted on every driver, limit 1–1000 default 1000; delete idempotent |
| R-007 | 0 | DECISION | FR-515 | Real Blob contract run in Phase 5 | decided | Operator: no; first real run in Phase 5b |
| R-008 | 0 | DECISION | NFR-502 | `@vercel/blob` version | decided | Operator: 2.9.0 exact |
| R-009 | 1 | MUST | FR-512 | Create-only put onto a folder: `EEXIST`→`ObjectExistsError` vs "underlying fs error" | fixed | Folder/parent collisions unspecified and untested (out of scope); VC-513 case removed |
| R-010 | 1 | MUST | FR-515, VC-508 | Blob run's `contract/<random>/` prefix vs `list('')` expectations; no isolation mechanism | fixed | Per-test prefixing wrapper in `tests/contract/`; `afterAll` cleanup; VC-516 updated |
| R-011 | 1 | SHOULD | FR-507, FR-516 | Blob `list` guarantees vs architecture "hint only" | fixed | FR-513: Blob order/completeness assumed until 5b, list stays a hint; FR-516 keeps the caveat |
| R-012 | 1 | SHOULD | VC-508 | 2,500-key case too heavy for every driver | fixed | Moved to a memory-only unit test with 1,001 keys |
| R-013 | 1 | SHOULD | FR-507 | Cursor at the exact page boundary undefined | fixed | Memory/file: iff another key exists; Blob: iff `hasMore`; boundary case in VC-508 |
| R-014 | 1 | SHOULD | FR-513 | Blob `del` with missing keys may be partial | fixed | Assumption added, verified in 5b |
| R-015 | 1 | SHOULD | VC-518 | Purity grep rejects `../config` | fixed | BR-501 requires `@/src/config`; grep filters that form |
| R-016 | 1 | SHOULD | VC-507 | Slow-write test may never read during the put | fixed | At least one `get` before the put settles, asserted |
| R-017 | 1 | SHOULD | VC-514 | Blob validation-before-I/O untested in Phase 5 | fixed | Mocked-SDK checks: invalid key/prefix/limit/delete → no SDK call |
| R-018 | 1 | SHOULD | FR-503, FR-513 | SDK retries can turn a won create-only put into `ObjectExistsError` | decided | Operator: document in FR-513 + docs; Phase 6 re-reads commits; storage contract stays generic |
| R-019 | 1 | SHOULD | FR-513 | SDK `PutBody` excludes `Uint8Array` | fixed | `Buffer.from(buffer, byteOffset, byteLength)`; VC-514 checks bytes |
| R-020 | 1 | SHOULD | FR-514 | OIDC token may come from request context, not env | decided | Operator: OIDC branch needs only `BLOB_STORE_ID`; VC-515 updated |
| R-021 | 1 | COULD | VC-519 | `lock` grep matches `block`; "outside comments" not mechanical | deferred | COULD |
| R-022 | 1 | COULD | FR-513 | "distinct" in `del` batching is extra | deferred | COULD |
| R-023 | 1 | COULD | Data | `contentType` write-only and barely used | deferred | COULD |
| R-024 | 1 | COULD | NFR-504 | "durable" overstated without parent-dir fsync; test doesn't simulate crash | deferred | COULD |
| R-025 | 1 | COULD | FR-513 | `exists` rationale vs `head()` | fixed | One sentence added alongside R-019 edit |
| R-026 | 1 | COULD | VC-514 | `BlobAccessError` example misleading for `get` | fixed | Example now a `BlobError` from `get` (same edit as R-017) |
| R-027 | 2 | MUST | FR-503 vs FR-513 | "exactly one resolves" on every driver vs Blob retry caveat (reviewer: SHOULD; upgraded — two parts contradict) | fixed | FR-503 states the Blob retry exception |
| R-028 | 2 | MUST | FR-515 | Wrapper leaves prefixed `ObjectExistsError.key`; VC-504 cannot pass on Blob (reviewer: SHOULD; upgraded) | fixed | Wrapper validates unprefixed, strips prefix from error keys; `contract/<runId>/<testId>/`, cleanup under `<runId>` |
| R-029 | 2 | COULD | FR-515 | Cleanup could delete other runs' keys | fixed | Same edit as R-028 (`<runId>` scope) |
| R-030 | 2 | COULD | VC-517 | New FR-516 docs caveats not checked | deferred | Delta COULD |
| R-031 | 2 | COULD | BR-501 | Intra-storage imports should be `./` for the VC-518 grep | deferred | Delta COULD |
| R-032 | 2 | COULD | VC-508 | File store default limit > 1000 untested | deferred | Follows R-012 |
