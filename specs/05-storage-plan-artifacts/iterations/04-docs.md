# Iteration 4 — Storage documentation

Commit: this commit ("Document the storage layer").

## Criteria results

Every command ran with `BLOB_READ_WRITE_TOKEN` unset (`env -u BLOB_READ_WRITE_TOKEN …`; the full gate also unset `BLOB_STORE_ID` and `VERCEL_OIDC_TOKEN`); no network, no real Blob call, nothing written under `.data/` (`ls -d .data` → no such file). Machine: macOS (Darwin 25.6), APFS.

| Criterion | Command | Result |
|---|---|---|
| VC-517 (+P-12) architecture | §6.1 = `docs/architecture.md` lines 169–235 (`### 6.2` at 236). `grep -n "InvalidKeyError\|CorruptObjectError\|useCache: false\|1000\|create-only\|VERCEL_BLOB_RETRIES\|hint" docs/architecture.md`, filtered to 169–235, then a per-term count over `sed -n 169,235p` | PASS — every term inside §6.1 (InvalidKeyError 1, CorruptObjectError 2, `useCache: false` 1, 1000 4, create-only 11, VERCEL_BLOB_RETRIES 1, hint 2). Default stated: "**`put` is create-only by default.**" |
| VC-517 headings | `grep -n "## 13. Storage\|## 14. Known limitations" docs/development.md` | PASS — lines 885 and 1119 |
| VC-517 terms in §13 | per-term `grep -c` over `sed -n 885,1118p docs/development.md` for `STORAGE_DRIVER FILE_STORE_DIR BLOB_READ_WRITE_TOKEN getJson CorruptObjectError \.tmp-` | PASS — 5, 2, 8, 8, 5, 5 |
| VC-517 cross-references | `grep -on "§1[34][.0-9]*" docs/development.md` | PASS — 16 refs, each checked: §13 (lines 22, 24, 52, 1125 → Storage); §13.2 (1112 → Keys); §13.3 (166, 905, 1026, 1122 → Choosing a driver / credentials); §13.5 (903 → file store on disk); §13.6 (106, 208, 901 → Storage tests, incl. Blob skip and driver-author helpers); §13.7 (1021, 1123, 1126 → Gotchas). No `§14` references exist besides the heading. Other docs: only `README.md` links `development.md#5-configuration` (unchanged); `docs/design.md` "`architecture.md` §13" is the architecture's own §13 (unchanged). |
| No plan/spec/artifact references | `grep -niE "05-storage\|specs/\|plan-artifacts\|FR-5\|VC-5\|D-0[0-9]\|Iteration [0-9]\|Phase 5" docs/development.md docs/architecture.md` | PASS — no output |
| Decisions coverage | manual, table below | PASS — D-001…D-021 each reflected or marked internal |
| Usage example compiles and runs | temporary `tests/unit/storage/doc-example.test.ts` (the §13.4 example verbatim on `MemoryObjectStore` + assertions on every commented value; plus the `createObjectStore(getConfig())` snippet and the §13.6 `list` driver snippet as type-checked declarations): `env -u BLOB_READ_WRITE_TOKEN pnpm vitest run tests/unit/storage/doc-example.test.ts` and `pnpm exec tsc --noEmit` | PASS — 1 test passed; tsc exit 0. File deleted before committing (`git status --porcelain` showed only the two docs). |
| Local gates | `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN sh -c 'pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm test:sim && pnpm build'` | PASS — exit 0; `Test Files 42 passed \| 1 skipped (43)`, `Tests 772 passed \| 30 skipped (802)`; sim `5 passed`, `3605 passed`; `next build` compiled |
| Contract run | `env -u BLOB_READ_WRITE_TOKEN pnpm vitest run tests/contract` | PASS — `Test Files 2 passed \| 1 skipped (3)`, `Tests 60 passed \| 30 skipped (90)`; memory 15 ms, file 985 ms, blob 30 skipped |
| Documented commands | `pnpm vitest run tests/unit/storage` (6 files / 106 passed); `pnpm vitest run tests/contract/memory-store.contract.test.ts --reporter verbose` (30 passed, one line per check) | PASS. The Blob command was not run (real store). |
| VC-518 imports | `grep -rnE "from '(@/src\|\.\./)" src/storage \| grep -v "from '@/src/config'"` | PASS — no output |
| VC-519 (P-10) | `grep -rniwE "lock\|locking\|ifMatch\|compareAndSwap" src/storage` | PASS — no output |
| BR-503 | `grep -rnE "access: 'public'\|useCache: true" src/storage` | PASS — no output |
| NFR-502 | plan's `node -e …` dependency check; `git diff main -- package.json` | PASS — `@noble/hashes,@vercel/blob,next,react,react-dom,zod 2.4.0 2.9.0`; diff only `+ "@vercel/blob": "2.9.0",`; `test ! -e src/storage/.gitkeep` ok |
| Artifacts | `CONTEXT.md` rewritten (final state + "Hand-off to Phase 5b and 6"), `DECISIONS.md` D-021, this record | PASS |

No criterion failed; the checklist ran once.

## Files

- Changed: `docs/architecture.md` (§6.1 rewritten: intro, interface block, "Semantics (every driver)", "Keys", "Errors" table, "JSON helpers", "Drivers" table, "Blob credentials", "Blob caveats", contract-suite paragraph; §6.3 item 3: one clause on `ifMatch`).
- Changed: `docs/development.md` — new `## 13. Storage` with `### 13.1 Module map`, `### 13.2 Keys`, `### 13.3 Choosing a driver`, `### 13.4 Using a store`, `### 13.5 The file store on disk`, `### 13.6 Storage tests`, `### 13.7 Gotchas and limitations`; `## 13. Known limitations` renumbered to `## 14. Known limitations` (credentials bullet rewritten, new "Blob not run against a real store" bullet, "no persistence" bullet updated, §13.7 pointer added); stale lines fixed in §1 (`@vercel/blob` row and dependency list), §2 (storage built, only `src/state` empty), §4 (contract row: Blob skipped without token), §5 (new rule: credentials checked by `createObjectStore`), §7 (CI: Blob contract run skipped).
- Changed: `specs/05-storage-plan-artifacts/CONTEXT.md`, `DECISIONS.md`; added this record.
- Not changed: `README.md` (D-021), anything under `src/` or `tests/`.

## Deviations

- Edits beyond the plan's named sections, all to remove now-false or contradictory text (D-021): architecture §6.3 item 3 clause; development.md §1 and §5. README deliberately untouched.
- Record named `04-docs.md` per the plan's Touches.

## Decisions coverage

| Decision | Where in the docs / internal |
|---|---|
| D-001 errors and messages | arch §6.1 Errors; dev §13.4 error table + message formats; dev §13.7 `issuePath` own-property gotcha |
| D-002 validation as rejections | arch §6.1 "Validation comes first"; dev §13.4 last paragraph |
| D-003 memory/file cursor | dev §13.4 `RangeError` row; dev §13.7 "Cursors differ by driver"; dev §13.6 `pageKeys` comment |
| D-004 `randomUUID` | reflected as `.tmp-<uuid>` (arch §6.1, dev §13.5) and random Blob test ids (dev §13.6); source of randomness itself internal |
| D-005 storage imports | dev §13 intro + grep block |
| D-006 contract-suite shape | dev §13.6 table + "Adding a driver" |
| D-007 exported list helpers | dev §13.1, dev §13.6 "Adding a driver" |
| D-008 VC-507 read-during-write technique | internal (dev §13.6 only says reads during an 8 MiB write never see a partial body) |
| D-009 temp files | arch §6.1 file row; dev §13.5 |
| D-010 best-effort folder fsync | arch §6.1 file row ("best effort"); dev §13.5 |
| D-011 "missing" on the file store | arch §6.1, dev §13.5 (folder = missing); `ENOTDIR` details internal |
| D-012 list walk | arch §6.1 (walks, skips dot names, sorts); pruning and symlink handling internal |
| D-013 many-key tests write files directly | dev §13.5 "Cost" |
| D-014 Blob delete batching | arch §6.1 Blob row + caveats; dev §13.7 |
| D-015 `contentType` only on Blob | arch §6.1 "Nothing else"; dev §13.7 |
| D-016 explicit limit, opaque Blob cursor | dev §13.6 (Blob uses `assertValidPrefix` + `resolveListLimit`), dev §13.7; always-explicit `limit` internal |
| D-017 SDK mocking | dev §13.6 "Mocking the SDK" |
| D-018 token passing, ConfigError | arch §6.1 "Blob credentials"; dev §13.3 (exact message) |
| D-019 Blob `get`/`exists` edges | arch §6.1 (`exists` cancels the body unread, not `head()`); non-200 handling internal |
| D-020 Blob contract wrapper/cleanup | dev §13.6 (per-test namespace, `afterAll` cleanup, interrupted runs) |
| D-021 doc scope choices | this iteration |

## Gotchas

- `docs/` and `specs/` are prettier-ignored, so long code lines in doc examples are fine; the example still has to type-check when pasted into a test (it did, unchanged).
- An exported `BLOB_READ_WRITE_TOKEN` silently turns on the real-store Blob run inside `pnpm test`; documented in dev §13.6.
- The example's paging uses `limit: 2` over four keys, which on memory ends exactly at a page boundary with no cursor (exact-cursor drivers), so the loop stops after two pages.

## For the next iteration

Phase 5 is complete. Next: the orchestrator's verify-spec, the push of `spec/05-storage` (with user approval), and the NFR-503 CI check (memory + file contract durations in the "Test" step < 30 s). Phase 5b and Phase 6 start from `CONTEXT.md` → "Hand-off to Phase 5b and 6".
