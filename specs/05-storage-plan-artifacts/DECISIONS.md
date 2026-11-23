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
