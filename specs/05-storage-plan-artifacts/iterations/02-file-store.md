# Iteration 2 — File store

Commit: this commit ("Add the file object store").

## Criteria results

All commands run with `BLOB_READ_WRITE_TOKEN` unset (`env -u BLOB_READ_WRITE_TOKEN …`), no network. Machine: macOS (Darwin 25.6), APFS, Node 26.13.1.

| Criterion | Command | Result |
|---|---|---|
| VC-503 to VC-511 on file | `pnpm vitest run tests/contract/file-store.contract.test.ts` | PASS — 30 tests (verbose run shows VC-507 8 MiB ~90 ms with counter assertions, VC-508 exact-boundary case executing) |
| VC-513, P-11 | `pnpm vitest run tests/unit/storage/file-store.test.ts` | PASS — 12 tests, ~0.5 s |
| NFR-503 early warning | `pnpm vitest run tests/contract` (3 runs) | PASS — memory 15/16/16 ms + file 963/937/943 ms ≈ 1.0 s (< 15 s threshold, < 30 s budget); summary `Test Files 2 passed (2) · Tests 60 passed (60)` |
| BR-501 / P-9 | `grep -rnE "from '(@/src\|\.\./)" src/storage \| grep -v "from '@/src/config'"` | PASS — no output |
| (extra) P-10 | `grep -rniwE "lock\|locking\|ifMatch\|compareAndSwap" src/storage` | PASS — no output |
| Gates | `pnpm typecheck && pnpm lint && pnpm test` | PASS — exit 0; ESLint 0 warnings, prettier clean; 40 files / 729 tests |
| No `.data` writes | `git status --porcelain .data` | PASS — no output |
| Artifacts | `CONTEXT.md` rewritten, `DECISIONS.md` D-009…D-013, this record | PASS |

Failures on the way (each fixed, then the whole checklist re-run from the top):
1. A cross-folder ordering test stored both `A/1` and `a/1`; on case-insensitive APFS they are the same file, so the second put failed with `ObjectExistsError`. The test now uses lowercase keys only; the limitation is recorded in `CONTEXT.md` Known gaps.
2. The P-11 test first used 1,001 `put`s and took ~14 s (two fsyncs per put). It now writes 1,000 files directly (D-013) and takes ~0.1 s. It is a unit test, so it never counted toward NFR-503, but it slowed `pnpm test`.

## Files

- Added: `src/storage/file-store.ts`, `tests/contract/file-store.contract.test.ts`, `tests/unit/storage/file-store.test.ts`, `specs/05-storage-plan-artifacts/iterations/02-file-store.md`.
- Changed: `specs/05-storage-plan-artifacts/CONTEXT.md`, `specs/05-storage-plan-artifacts/DECISIONS.md`.
- Nothing deleted. `object-store.ts` and `memory-store.ts` untouched.

## Deviations

- None from the plan's Scope. Choices the plan left open are D-010 (ignore every error of the folder fsync step, not only the fsync call), D-011 (`ENOTDIR` counts as missing) and D-012 (walk pruned by prefix; non-regular files ignored).

## Gotchas

- **Case-insensitive filesystems**: keys differing only in case collide on the file store (macOS default APFS, Windows). Not in the spec; Phase 6 key builders should stick to one case.
- `fs.link` on APFS returns `EEXIST` reliably under the 10-way race; folder `fsync` (open read-only + `sync()`) works on macOS without error.
- `fs.readFile` of a folder on macOS rejects with `EISDIR`; a path below a file rejects with `ENOTDIR`. Both map to "missing".
- `get` returns a `Uint8Array` view over the `Buffer` from `readFile` (not the `Buffer` itself), so `toEqual` against plain `Uint8Array`s works.
- Each put costs ~14 ms on APFS (two fsyncs). Keep many-key file tests off `put`.

## For the next iteration

- **Constructor**: `new FileObjectStore(rootDir: string)`; `rootDir` goes through `path.resolve` (relative → against `process.cwd()`); nothing is created until the first put. The factory (FR-514) calls `new FileObjectStore(config.fileStoreDir)`.
- **Temp files**: `.tmp-<crypto.randomUUID()>` in the target's own folder, opened `'wx'`, always unlinked in a `finally`; hidden from `list` because names starting with `.` are skipped.
- **Measured contract durations** (local, macOS APFS): memory ≈ 16 ms, file ≈ 950 ms, sum ≈ 1 s. Blob will be skipped and add ~0 s.
- **Platform gotchas**: case-insensitive key collisions on the file store; folder fsync errors are swallowed by design (D-010). Document both in Iteration 4 (development.md §13 "gotchas").
- The Blob driver must not use `checkListArgs` (cursor is opaque): use `assertValidPrefix` + `resolveListLimit` (unchanged from Iteration 1).
