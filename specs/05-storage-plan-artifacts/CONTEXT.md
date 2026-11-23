# CONTEXT — Storage (Phase 5)

Last updated by: Iteration 1 (contract + memory). Next: Iteration 2 (file store).

## Current state

- Phases 0–4 are complete (`specs/00-…-frozen.md` to `specs/04-players-frozen.md`). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`; target ES2022, so class fields are *defined* properties), pnpm 10.15.1, Node 24 declared (local Node may differ: pnpm prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7, `@noble/hashes` 2.4.0, project-local layer-boundary lint rule, GitHub Actions CI (install, typecheck, lint, test, Simulation tests, build).
- `dependencies` = `@noble/hashes, next, react, react-dom, zod` — `@vercel/blob@2.9.0` is added in Iteration 3, not before.
- **Iteration 1 shipped** `src/storage/object-store.ts` (interface, errors, key/prefix validation, list helpers, `getJson`/`putJson`) and `src/storage/memory-store.ts` (`MemoryObjectStore`); the shared contract suite `tests/contract/object-store.contract.ts` and its memory run; unit tests in `tests/unit/storage/`. `src/storage/.gitkeep` and `tests/contract/.gitkeep` are deleted.
- Not yet built: `file-store.ts` (Iteration 2), `vercel-blob-store.ts`, `index.ts` (`createObjectStore`), `tests/contract/prefixed-store.ts`, Blob contract file (Iteration 3), docs (Iteration 4). `src/state` still holds only `.gitkeep` (Phase 6).
- Tests: `tests/unit/storage/` 3 files / 51 tests; `tests/contract/memory-store.contract.test.ts` 30 tests (~10 ms, the 8 MiB VC-507 test ~7 ms); full `pnpm test` 38 files / 687 tests green.

## File map

| Path | Contents |
|---|---|
| `src/storage/object-store.ts` | Types `StoredObject`, `PutOptions`, `ListOptions`, `ListResult`, `ObjectStore`; `MAX_KEY_LENGTH` (512), `MAX_LIST_LIMIT` (1000); `ObjectExistsError`, `InvalidKeyError`, `CorruptObjectError`; `assertValidKey`, `assertValidPrefix`; list helpers `resolveListLimit`, `checkListArgs`, `pageKeys` (D-007); `putJson`, `getJson`. Private `KEY_SEGMENT` regex, `isValidKey`, `compareCodeUnits`. |
| `src/storage/memory-store.ts` | `MemoryObjectStore` (FR-511): private `#objects: Map<string, Uint8Array>`. |
| `tests/contract/object-store.contract.ts` | `runObjectStoreContract` + types `ContractStore`, `ContractOptions` (P-13). Not collected by vitest (no `.test.ts`). Covers driver parts of VC-501/502 and VC-503 to VC-511. |
| `tests/contract/memory-store.contract.test.ts` | Calls the contract with a fresh `MemoryObjectStore` per test, `exactCursor: true`. |
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

A driver file is just:

```ts
import { runObjectStoreContract } from './object-store.contract';
runObjectStoreContract('file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lp-store-'));
  return { store: new FileObjectStore(root), cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}, { exactCursor: true });
```

Contract keys used: `../x`, `ok`, `s`, `bytes`, `empty`, `k`, `race`, `o`, `m`, `big` (8 MiB, 30 s timeout), `b/2 a/1 a/10 a/2 ab c`, `x`, `y`, `missing`, `u`, `doc`, `secret/doc`. None is a path prefix of another inside one test (FR-512 safe).

## Conventions & invariants

- **Storage purity** (BR-501, P-9): files in `src/storage` import each other with `./…`, config only as `@/src/config`, plus `zod` (types), Node built-ins and (Iteration 3) `@vercel/blob`. Greps that must print nothing:
  - `grep -rnE "from '(@/src|\.\./)" src/storage | grep -v "from '@/src/config'"`
  - `grep -rniwE "lock|locking|ifMatch|compareAndSwap" src/storage` (P-10: keep these words out of comments too)
  - `grep -rnE "access: 'public'|useCache: true" src/storage` (Iteration 3)
- **Async validation** (P-2): every `ObjectStore` method is `async`; validation (keys/prefix → limit → cursor) runs before any I/O; `delete` validates every key before deleting any.
- **Error convention**: `this.name = '<ClassName>'`; messages hold the key and a fixed reason, never a body or credential (BR-504).
- **Code-unit order**: sort with `<`/`>` comparison (`pageKeys` does it); never `localeCompare`.
- **Randomness** (P-4): use `crypto.randomUUID()` from `node:crypto` for temp names and test prefixes.
- No barrel except `src/storage/index.ts` (Iteration 3, exports only `createObjectStore`). Callers import from `@/src/storage/object-store`, `@/src/storage/memory-store`, …
- **Tests**: unit tests in `tests/unit/storage/*.test.ts`; contract runs in `tests/contract/<driver>-store.contract.test.ts`; header comment names spec FRs/VCs; one `describe` per VC. File-store tests use `fs.mkdtemp(path.join(os.tmpdir(), 'lp-store-'))` and remove the folder; never write under `.data/`. Run everything with `env -u BLOB_READ_WRITE_TOKEN`; no network.
- **Formatting**: `pnpm exec prettier --write src/storage tests/contract tests/unit/storage` before linting; `docs/` and `specs/` are prettier-ignored.
- **Commits**: one per iteration, staged by explicit path (never `git add -A`), message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge. Never modify `src/config.ts`, `src/domain`, `src/engine`, `src/score`, `src/players`, `src/service`, `vitest*.config.ts`, `eslint.config.mjs`.

## Commands

| Command | What it does |
|---|---|
| `env -u BLOB_READ_WRITE_TOKEN pnpm vitest run tests/unit/storage` | Storage unit tests (~0.2 s). |
| `env -u BLOB_READ_WRITE_TOKEN pnpm vitest run tests/contract` | Every contract run (memory now; file from Iteration 2; Blob skipped without a token from Iteration 3). |
| `pnpm vitest run tests/contract/memory-store.contract.test.ts --reporter verbose` | Shows each VC test (VC-507, VC-508 boundary case). |
| `pnpm typecheck` / `pnpm lint` / `pnpm test` | Required before every commit (lint = ESLint 0 warnings + `prettier --check .`). |
| `pnpm test:sim` | Not affected by this phase; run once in Final Verification (~46 s). |
| `pnpm build` | `next build` (Iteration 3 and final gates). |
| `node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).sort().join(','),p.dependencies['@noble/hashes'],p.dependencies['@vercel/blob'])"` | NFR-502 check (expects `@vercel/blob` 2.9.0 after Iteration 3). |

## Known gaps

- `FileObjectStore`, `VercelBlobObjectStore`, `createObjectStore`, the Blob contract wrapper and the docs are not built yet (Iterations 2–4).
- The P-3 cursor rule is implemented in the shared `checkListArgs`/`pageKeys`; Blob cursors are opaque SDK strings and must NOT go through `checkListArgs` (Blob uses `assertValidPrefix` + `resolveListLimit` directly).
- The 8 MiB VC-507 test on memory is trivially satisfied (the memory put completes synchronously inside the call); the counter still proves one read was issued before the put settled. The file store is where it is meaningful.
- `MemoryObjectStore.put` does not validate `opts.mode` values outside the type (anything other than `'create-only'`/undefined behaves as overwrite); TypeScript callers cannot pass one.
