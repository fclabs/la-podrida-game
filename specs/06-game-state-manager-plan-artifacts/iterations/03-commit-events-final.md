# Iteration 3 — Commits, events and final scores

Commit: this commit (`Add game state commits, events and final scores`).

## Criteria results

All commands run with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN`.

| Criterion | Result | Command → outcome |
|---|---|---|
| VC-615–VC-620, VC-624 | PASS | `pnpm vitest run tests/unit/state --reporter verbose` → exit 0, 8 files, 189 passed, 0 failed. One `it` per listed case. |
| VC-601 (all 8 methods) | PASS | Same run: `create.test.ts` (create, loadMeta, load, loadLatest) + `commit.test.ts` (commit with invalid body too, eventsSince, eventsSince with `-1` too, writeFinalScores, writeFinalScores with `-1` too, readFinalScores) → `InvalidGameIdError` `gameId 'BAD'`, `RecordingStore.calls` empty. |
| VC-614 (full) | PASS | Same run: `load`/`loadLatest` (load.test.ts) and `eventsSince(g, 2)` with a mismatched tip commit 3 → `CorruptObjectError` `issuePath 'version'` / `'state.gameId'`; plus a mismatched commit 2 inside the range. |
| VC-615 | PASS | commit v1 → equals `load(g,1)`, head 1; stored bytes === `JSON.stringify` in documented top-level order; 6 invalid bodies → `commit-version`, `state-version`, `state-game-id`, `commit-schema:actorSeat`, `commit-schema:clientRequestId`, `commit-schema:(root)`, 0 calls; v3 after tip 1 succeeds; orphan `commit(g2, v1)` resolves, `loadLatest(g2)`/`load(g2,1)` → `GameNotFoundError`. |
| VC-616 | PASS | 20 rounds on `MemoryObjectStore`, 20 on `FileObjectStore` (mkdtemp `lp-state-`): each exactly 1 fulfilled + 1 `CommitConflictError {gameId: g, version: 1}`; `load(g,1)` equals the winner. |
| VC-617 | PASS | Retry landed then `ObjectExistsError` → resolves, 1 re-read `get`, head 1, `loadLatest` = v1; stored v1 differing in `clientRequestId` → `CommitConflictError`, head stays 0; `ObjectExistsError` + `null` re-read → `CommitConflictError`. |
| VC-618 | PASS | Commit put `Error('net')` → same object (`toBe`); re-read `Error('net')` → same object; head put `Error('head')` → resolves, head stays 0, `loadLatest` = v1 by probing. |
| VC-619 | PASS | `[e1,e3a,e3b,e4]`, `[e4]`, `[]`, `[]`; `-1`/`1.5` → `RangeError` /version/, 0 calls; commit 2 deleted → `CommitNotFoundError {version: 2}`; unknown game → `GameNotFoundError`; 0…40 → 40 events in order, commit reads in flight ≤ 8 and exactly 8 reached, 40 commit gets. Bite check: limit set to 16 → test fails (`expected 16 to be less than or equal to 8`); reverted, `grep -n "EVENTS_READ_CONCURRENCY = " src/state/game-state-manager.ts` → `= 8`. |
| VC-620 | PASS | Exact document (`toStrictEqual`) and stored key order; second write with another board resolves, bytes unchanged; every put rejected → resolves; `totals: 'x'` → `board-schema:totals`; `-1`/`1.5` → `final-version` (0 calls); missing → `null`; `not json` → `CorruptObjectError invalid-json`. Extra: foreign `gameId` → `CorruptObjectError issuePath 'gameId'`. |
| VC-624 | PASS | `errors.test.ts` (10 tests): all six classes provoked on the secret game; `message`, `String(err)`, `reason` contain neither `SECRET-SEED-123` nor `'ab'.repeat(32)`. |
| VC-622 | PASS | `grep -rnE "mode: 'overwrite'" src/state` → only `src/state/game-state-manager.ts:447` (`#writeHead`, called by `create` and `commit`). `grep -rniwE "ifMatch\|lock\|locking" src/state` → no output. |
| VC-623 | PASS | `grep -rnE "from '@/src/(engine\|score\|players\|service\|config)" src/state` → no output; `grep -rnE "from '\.\./" src/state` → no output; `pnpm lint` exit 0. |
| VC-625 | PASS | `io-budget.test.ts`: `loadLatest` = 5 calls (3 then 2), 0 list; `eventsSince(g, 2)` = 7 calls, 0 list; `commit` v6 = exactly `[put create-only commit 6, put overwrite head]`. |
| NFR-604 (local proxy) | PASS | `pnpm vitest run tests/unit/state --reporter json --outputFile <scratch>/state.json` → per-file sum 2316 ms (commit 1763, schemas 330, create 100, events-final 46, load 36, errors 20, io-budget 13, keys 7) < 15 s. |
| Gates | PASS | `sh -c 'pnpm typecheck && pnpm lint && pnpm test'` → exit 0; 50 passed + 1 skipped files, 961 passed + 30 skipped tests. |
| Artifacts | PASS | `CONTEXT.md` rewritten, `DECISIONS.md` D-015…D-020 appended, this record. |

First gate run failed `prettier --check` on `.vitest/json/output.json` (left by a JSON-reporter run without `--outputFile`); deleted it and re-ran the whole checklist → all PASS as above.

## Files

- Added: `tests/unit/state/commit.test.ts`, `tests/unit/state/events-final.test.ts`, `tests/unit/state/errors.test.ts`, `tests/unit/state/io-budget.test.ts`, this record.
- Changed: `src/state/game-state-manager.ts`, `specs/06-game-state-manager-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.
- Deleted: none. Support files unchanged.

## Plan decisions applied

P-2 (reasons for `commit`, `writeFinalScores`), P-4 (reused for `commit`), P-5 (`#readCommit` in `eventsSince`), P-6 (D-016), P-9, P-11 (D-019). Own: D-015, D-017, D-018, D-019, D-020.

## Deviations

- `create` changed: it now serializes the caller's `meta`/`initial` instead of the parsed copies (D-017). The documented top-level order is unchanged and all Iteration 2 tests pass. Reason: VC-615 asks for the stored bytes to equal `JSON.stringify` of the document, and Zod re-orders nested keys.
- `readFinalScores` also rejects a `final.json` whose `gameId` is another game (D-018); FR-617 does not mention this.
- Extra tests (additive): re-read error propagation, mismatched commit inside the `eventsSince` range, stored key order of `final.json`, foreign-gameId `final.json`, extra VC-624 provocations.

## Gotchas

- Zod 4 parse output follows schema key order for nested objects (`ScoreBoard`: `live` before `ranking`; `evaluate()` emits `ranking` first). Never byte-compare parsed re-serializations with the caller's JSON.
- A v1 body relabelled as v0 fails `CommitSchema` (`actorSeat`) before the `commit-version` check; use a real commit-0 body to reach `commit-version`.
- The JSON reporter without `--outputFile` writes `.vitest/json/output.json`, which `prettier --check .` flags. Delete it.
- `TextEncoder` needed no special typing under TS 6 (it was already used in Iteration 2).
- File-store races are reliable (`link` EEXIST is atomic) but cost about 45 ms per round (fsync).

## For the next iteration

- **Final public interface**: exactly spec Data & Interfaces (see CONTEXT.md "Public interfaces"). Extra exports: `GAME_ID_PATTERN` (keys.ts), `firstIssuePath` (schemas.ts). `EVENTS_READ_CONCURRENCY` and `mapLimit` are module-private.
- **Behaviour to document**: the error table (CONTEXT.md lists which errors each method rejects with and the `InvalidCommitError` reasons). `commit` = 2 puts and makes no existence or tip + 1 check (orphans). `eventsSince` makes at most 8 reads at once and reuses the tip. `final.json` is create-only and best-effort, and `readFinalScores` checks its gameId. Stored bytes follow D-017.
- **Measured durations**: `tests/unit/state` per-file sum 2316 ms locally (189 tests). NFR-604 CI check after the push.
- **Full DECISIONS.md list**: D-001 error classes/messages; D-002 reasons + `firstIssuePath`; D-003 schema construction; D-004 imports in `src/state`; D-005 strict `Equals` type check; D-006 extra `keys.ts` exports; D-007 numeric typing; D-008 serialization and byte compare; D-009 commit/meta reads; D-010 index marker date; D-011 test support files; D-012 file-store temp folder; D-013 tip discovery details; D-014 seats compare + create validation order; D-015 commit write path; D-016 bounded parallel reads (`mapLimit`); D-017 stored bytes from caller input; D-018 final scores write/read; D-019 race and concurrency tests; D-020 secret-leak tests.
- Final Verification still to run: `pnpm install --frozen-lockfile`, `pnpm test:sim`, `pnpm build`, `git diff main -- package.json pnpm-lock.yaml`.
