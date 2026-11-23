# Iteration 2 — Game state manager creation and loading

Commit: this commit (`Add game state manager creation and loading`).

## Criteria results

All commands run with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN`.

| Criterion | Result | Command → outcome |
|---|---|---|
| VC-601 (create, loadMeta, load, loadLatest) | PASS | `pnpm vitest run tests/unit/state/create.test.ts tests/unit/state/load.test.ts` → 2 files, 56 passed. 5 cases (create with `meta.gameId 'BAD'` + invalid body; loadMeta; load; load with bad version too; loadLatest) → `InvalidGameIdError` with `gameId 'BAD'`, `RecordingStore.calls` empty. |
| VC-603 (loadMeta) | PASS | Same run: stored meta with `schemaVersion: 2` → `CorruptObjectError` `reason 'schema'`, `issuePath 'schemaVersion'`. |
| VC-605 | PASS | Same run: `createdAt '2026-11-23T23:59:59.999Z'` → exactly the 4 keys; marker body length 0; head `{schemaVersion:1,version:0}`; returned commit equals `load(g,0)` and `loadLatest(g)`; puts in order marker/meta/commit0 create-only, head overwrite. Extra: stored key order of meta and commit. |
| VC-606 | PASS | Same run: 6 cases → `InvalidCommitError` reasons `meta-schema:seatTokenHashes.1`, `commit-schema:clientRequestId`, `initial-version`, `initial-state-version`, `state-game-id`, `seats-mismatch`; 0 store calls; store empty. |
| VC-607 | PASS | Same run: different `createdAt` → `GameExistsError`, stored meta/commit 0 bytes unchanged; identical args twice → both resolve, 4 keys; marker pre-existing → resolves, 4 keys; retried put that landed (meta, then commit 0) → resolves, `loadLatest` = commit 0; ObjectExistsError + null re-read → `GameExistsError`, no further puts. |
| VC-608 | PASS | Same run: N = 1, 2, 3 → `create` rejects with the same `Error('boom')`, `loadLatest` → `GameNotFoundError`, `loadMeta` → `GameNotFoundError` (N ≤ 2) / meta (N = 3); N = 4 → resolves, no head, `loadLatest` = commit 0. |
| VC-609 | PASS | Same run: returns the stored meta; missing → `GameNotFoundError`; `gameId` = `OTHER_GAME_ID` → `CorruptObjectError` `issuePath 'gameId'`. |
| VC-610 | PASS | Same run: (a)–(g) each → commit 5 with 0 puts and 0 deletes; head get `Error('net')` → rejects with that object; head 2 + commit 2 `not json` → `CorruptObjectError` (`invalid-json`, key commit 2). |
| VC-611 | PASS | Same run: list `{keys: []}` → commit 3; list `[commit 1, …/commits/x]` → commit 3 (probe starts at 1, commit 0 never read). Extra: two-page list, highest listed tried first. |
| VC-612 | PASS | Same run: meta missing → `GameNotFoundError`; commit 0 missing → `GameNotFoundError`; meta + commit 0 only → commit 0. |
| VC-613 | PASS | Same run: `load(g,3)` = commit 3; `load(g,4)` → `CommitNotFoundError {gameId, version: 4}`; `load(g,-1)` → `RangeError` with 0 calls; unknown game (v0 and v2) → `GameNotFoundError`. Extra: orphan commit 2 without commit 0 → `GameNotFoundError`; `load(g,0)` = 1 get. |
| VC-614 (load, loadLatest) | PASS | Same run: commit under key 3 with `version 4` → `issuePath 'version'`; `state.gameId` = other id → `issuePath 'state.gameId'`; both via `load(g,3)` and `loadLatest` (head 3). |
| VC-625 (loadLatest) | PASS | Same run: commits 0…5, head 5 → exactly 5 calls; first 3 = exists meta, exists commit 0, get head; last 2 = get commit 5, exists commit 6; 0 list. |
| VC-622 (partial) | PASS | `grep -rnE "mode: 'overwrite'" src/state` → only `src/state/game-state-manager.ts:300` (inside `#writeHead`, the head write used by `create`). `grep -rniwE "ifMatch\|lock\|locking" src/state` → no output. |
| BR-603 greps | PASS | `grep -rnE "from '@/src/(engine\|score\|players\|service\|config)" src/state` → no output; `grep -rnE "from '\.\./" src/state` → no output. |
| Gates | PASS | `sh -c 'pnpm typecheck && pnpm lint && pnpm test'` → exit 0; 46 passed + 1 skipped files, 903 passed + 30 skipped tests. `pnpm vitest run tests/unit/state` → 4 files, 131 tests, 510 ms. |
| Artifacts | PASS | `CONTEXT.md` rewritten, `DECISIONS.md` D-008…D-014 appended, this record. |

## Files

- Added: `src/state/game-state-manager.ts`, `tests/unit/state/support/store-wrappers.ts`, `tests/unit/state/support/fixtures.ts`, `tests/unit/state/create.test.ts`, `tests/unit/state/load.test.ts`, `specs/06-game-state-manager-plan-artifacts/iterations/02-create-load.md`.
- Changed: `specs/06-game-state-manager-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.
- Deleted: none.

## Plan decisions applied

P-4 (D-008), P-5 (D-009), P-7 (D-010), P-10 (D-011), P-11 (D-012); P-2 reasons now used in `create`. Own: D-013 (tip discovery edges), D-014 (validation order, `jsonEqual` seats compare).

## Deviations

- `schemas.test.ts` fixture not moved into `support/fixtures.ts` (optional per Iteration 1 hand-off); `schemas.test.ts` untouched.
- Extra fixture exports and `RecordingStore.callsOf`/`reset` beyond P-10 (D-011); additive.
- Extra tests beyond the VCs (stored key order, file-store round-trip, multi-page list, orphan `load`, single read for `load(g,0)`); additive.

## Gotchas

- `ObjectStore.list('')` on `MemoryObjectStore` lists every key — handy for "exactly these keys" assertions.
- `RecordingStore` records a call before running the hook, so a hook that throws is still counted; `mode` is the effective mode (`'create-only'` when omitted).
- Prettier reflowed the `#writeHead` `putJson` call over several lines; the `mode: 'overwrite'` grep still hits exactly one line.
- `create` writes and returns the Zod-parsed documents, not the caller's objects (equal content, schema key order).

## For the next iteration

- **Probe**: private `#findTip(gameId): Promise<Tip>`, `Tip = { version: number; commit: Commit }`; it validates the id itself and runs FR-608 steps 1–3. `eventsSince` reuses `tip.commit` for version `t`. `#probeFrom(gameId, start)` returns `null` iff commit `start` is missing.
- **Serialization**: module-private `serializeCommit(commit): Uint8Array` with key order `schemaVersion, version, at, actorSeat, clientRequestId, events, state, scoreboard` (`serializeMeta` likewise). Serialize the parsed `CommitSchema.safeParse({ schemaVersion: 1, ...next }).data` once.
- **`bytesEqual(a, b)`**: module-private. `#createOrMatch` throws `GameExistsError`, so `commit` needs its own create-only + re-read path that throws `CommitConflictError` (also on a `null` re-read). Reuse `#writeHead(gameId, version)` for the head overwrite (keeps one `mode: 'overwrite'` site).
- **Commit reads**: `#readCommit(gameId, v): Promise<Commit | null>` (FR-610 checks included).
- **`RecordingStore` API**: `new RecordingStore(inner, hooks?)`; `calls: RecordedCall[]` (`{ method, key?, prefix?, keys?, mode? }`), `maxConcurrentGets`, `callsOf(method?)`, `reset()`; hooks `get({key}, inner)`, `put({key, body, opts}, inner)`, `exists({key}, inner)`, `list({prefix, opts}, inner)`, `delete({keys}, inner)`. For VC-619's concurrency count, a `get` hook can `await` a short delay before delegating so reads overlap.
- **Fixtures**: `makeMeta(overrides?)`, `makeInitial(gameId?)`, `makeCommitBody(prev, n, events?)`, `toCommit(body)`, `makeChain(upTo, gameId?)`, constants `GAME_ID`, `OTHER_GAME_ID`, `HUMAN_HASH`, `CREATED_AT`, `SEED`. For VC-619 events, pass valid `GameEvent`s (e.g. `{ type: 'bid-made', seat: 0, tricks: n }`) to `makeCommitBody`.
- **Storing commits 0…n directly**: `await storeGame(memory, { upTo: n, head: h, skip: [k], meta: false, gameId })` (all `putJson`, create-only); returns the `Commit[]` by version. To corrupt one: `skip: [k]` then `memory.put(commitKey(g, k), 'not json')` or `putJson` of a mutated doc.
- VC-624 seed `SECRET-SEED-123`: `makeInitial` uses `SEED`; build a custom body via `createGame` or `{ ...body, state: { ...body.state, seed: 'SECRET-SEED-123' } }`.
