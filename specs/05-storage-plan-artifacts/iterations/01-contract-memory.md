# Iteration 1 — Object store contract, validation, JSON helpers and the memory driver

Commit: this commit ("Add the object store contract, JSON helpers and memory store").

## Criteria results

All commands run with `BLOB_READ_WRITE_TOKEN` unset (`env -u BLOB_READ_WRITE_TOKEN …`), no network.

| Criterion | Command | Result |
|---|---|---|
| VC-501, VC-502 | `pnpm vitest run tests/unit/storage/keys.test.ts` | PASS — 1 file, 30 tests |
| VC-503 to VC-511 on memory | `pnpm vitest run tests/contract/memory-store.contract.test.ts` (and `--reporter verbose`) | PASS — 30 tests; verbose shows "VC-507 … 8 MiB create-only then overwrite" (7 ms, counter assertion ≥ 1 for both phases) and "VC-508 … a page ending exactly at the last key has no cursor" executing |
| VC-511, VC-512, 1,001-key paging, P-3 | `pnpm vitest run tests/unit/storage` | PASS — 3 files, 51 tests |
| BR-501 / P-9 | `grep -rnE "from '(@/src\|\.\./)" src/storage \| grep -v "from '@/src/config'"` | PASS — no output |
| (extra) P-10 | `grep -rniwE "lock\|locking\|ifMatch\|compareAndSwap" src/storage` | PASS — no output |
| `.gitkeep` removed | `test ! -e src/storage/.gitkeep && test ! -e tests/contract/.gitkeep` | PASS — exit 0 |
| Gates | `pnpm typecheck && pnpm lint && pnpm test` | PASS — exit 0; ESLint 0 warnings, prettier clean; 38 files / 687 tests |
| Artifacts | this record, `CONTEXT.md`, `DECISIONS.md` (D-001…D-008) | PASS |

One failure on the first run (fixed, then the whole checklist re-run from the top): `json.test.ts` asserted `'issuePath' in error === false`, but ES2022 class fields define the property even when unset. The assertion now checks `issuePath === undefined` (D-001).

## Files

- Added: `src/storage/object-store.ts`, `src/storage/memory-store.ts`, `tests/contract/object-store.contract.ts`, `tests/contract/memory-store.contract.test.ts`, `tests/unit/storage/keys.test.ts`, `tests/unit/storage/json.test.ts`, `tests/unit/storage/memory-store.test.ts`, `specs/05-storage-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-contract-memory.md}`.
- Deleted: `src/storage/.gitkeep`, `tests/contract/.gitkeep`.

## Deviations

- `object-store.ts` exports three helpers beyond the spec's export table: `resolveListLimit` (the plan's limit helper), `checkListArgs` and `pageKeys` (D-007), so Iteration 2 can reuse the P-3 paging without touching Iteration 1 files.

## Gotchas

- Class fields (`readonly issuePath?: string`) are own properties under the ES2022 target; check values, not `in`.
- `MemoryObjectStore.put` completes synchronously inside the call (no `await`), which is what makes concurrent create-only puts atomic; do not add an `await` before the `has`/`set` pair.
- `vi.spyOn(store, 'put')` works on `MemoryObjectStore` instances (class methods on the prototype).
- `docs/development.md` §2 still says `src/storage` holds a `.gitkeep`; docs change only in Iteration 4.

## For the next iteration

- **`object-store.ts` exports and signatures**: see `CONTEXT.md` → Public interfaces (types, `MAX_KEY_LENGTH`, `MAX_LIST_LIMIT`, three errors, `assertValidKey`, `assertValidPrefix`, `resolveListLimit`, `checkListArgs`, `pageKeys`, `putJson`, `getJson`).
- **Error constructors (P-1)**: `new ObjectExistsError(key)`, `new InvalidKeyError(key, 'key' | 'prefix')`, `new CorruptObjectError(key, reason, issuePath?)`.
- **Limit helper**: `resolveListLimit(limit: number | undefined): number`, exported (undefined → 1000; else `RangeError` containing `limit`).
- **P-3 cursor rule as implemented**: `checkListArgs(prefix, opts)` validates prefix → limit → cursor (cursor must be a valid key starting with `prefix`, else `RangeError` containing `cursor`) and returns `{ limit, cursor? }`; `pageKeys(allKeys, prefix, args)` filters `startsWith(prefix) && key > cursor`, sorts by code unit, returns `cursor` = last key iff more remain. The file store: call `checkListArgs` first (before walking the disk), walk, convert separators to `/`, then `return pageKeys(keys, prefix, args)`.
- **Contract suite**: `runObjectStoreContract(name, makeStore, { exactCursor })` from `./object-store.contract`; `makeStore()` returns `{ store, cleanup }` and is called once per test. For the file store pass `exactCursor: true` and a fresh `fs.mkdtemp(path.join(os.tmpdir(), 'lp-store-'))` per test, removed in `cleanup`. The contract's VC-507 test (8 MiB, 30 s timeout) is where the file store's temp-file + `link`/`rename` atomicity is exercised; contract keys never collide as path prefixes within one test.
- `delete` must validate every key with `assertValidKey` before touching the disk (contract VC-501 checks `delete(['ok', '../x'])` leaves `ok`).
