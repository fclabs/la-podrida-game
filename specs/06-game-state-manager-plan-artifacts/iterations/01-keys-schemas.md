# Iteration 1 — Keys, errors and persisted document schemas

Commit: this commit (`Add state keys, errors and persisted document schemas`).

## Criteria results

All commands run with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN`.

| Criterion | Result | Command → outcome |
|---|---|---|
| VC-601 (key part) | PASS | `pnpm vitest run tests/unit/state/keys.test.ts` → 30 passed. 3 accepted ids; 10 rejected (`''`, 25, 27, uppercase, `0`, `1`, `8`, `/`, `..`-prefixed, bare `..`) each `InvalidGameIdError` with `gameId === input`; every builder + `parseCommitKey` rejects `'BAD'`. |
| VC-602 | PASS | Same file: exact keys incl. `commitKey(g, 99999999)`; `RangeError` /version/ for `-1`, `1.5`, `100000000`, NaN, Infinity; `RangeError` /date/ for `2026-02-30`, `2026-1-5`, `2026-13-01`, others; leap day; every key `assertValidKey`, every prefix `assertValidPrefix`; no key a path prefix of another; `parseCommitKey` round-trip and `null` cases; code-unit sort of 9, 10, 100 = version order. |
| VC-603 (schema level) | PASS | `pnpm vitest run tests/unit/state/schemas.test.ts` → 45 passed. `schemaVersion: 2` / extra key / missing field for all four schemas (12 tests); meta: `seats[1].seat = 2`, hash on AI seat, null on human seat, uppercase hash, one hash too few, `createdAt` without ms, `2026-02-30…`, plus bad gameId and engineVersion 0; commit: v1 `actorSeat: null`, v1 `clientRequestId: null`, v0 with `clientRequestId`, v0 with `actorSeat`, 129 chars, `''`, version 1e8, non-Z `at`; head `version 100000000` and `1.5`; final `totals: 'x'`, `version -1`. Each asserts `CorruptObjectError`, `reason 'schema'`, exact `issuePath`. |
| VC-604 | PASS | Same file: one seeded 3-seat all-AI game per preset (4), `ScoreBoardSchema.parse(evaluate(s))` equals the board for every state; `pnpm typecheck` exit 0 with `types.test-d.ts`. **Bite check**: temporarily added `bogus: z.string()` to `ScoreBoardSchema` → `pnpm typecheck` exit 2 with `types.test-d.ts(11,41): error TS2344: Type 'false' does not satisfy the constraint 'true'`; reverted (verified `grep -c bogus src/state/schemas.ts` → 0). |
| BR-603 (partial) | PASS | `grep -rnE "from '@/src/(engine\|score\|players\|service\|config)" src/state` → no output; `grep -rnE "from '\.\./" src/state` → no output. Also P-9 `grep -rniwE "ifMatch\|lock\|locking" src/state` → no output. |
| Gates | PASS | `pnpm typecheck && pnpm lint && pnpm test` → exit 0; test: 44 passed + 1 skipped files, 847 passed + 30 skipped tests. |
| Artifacts | PASS | `CONTEXT.md`, `DECISIONS.md` (D-001…D-007), this record. |

## Files

- Added: `src/state/keys.ts`, `src/state/errors.ts`, `src/state/schemas.ts`, `tests/unit/state/keys.test.ts`, `tests/unit/state/schemas.test.ts`, `tests/unit/state/types.test-d.ts`, `specs/06-game-state-manager-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-keys-schemas.md}`.
- Deleted: `src/state/.gitkeep`.
- Changed: none.

## Plan decisions applied

P-1 (D-001), P-2 (D-002, helper only; reasons are used from Iteration 2), P-3 (D-003), P-8 (D-004), P-12 (D-005, strict `Equals` kept). Own decisions: D-006 (extra export `GAME_ID_PATTERN`; `parseCommitKey` validates the id), D-007 (numeric typing).

## Deviations

- Two exports beyond the spec's module table: `GAME_ID_PATTERN` (keys.ts) and `firstIssuePath` (schemas.ts). Both are allowed by the plan's hand-off wording; listed in CONTEXT.md.
- VC-603 tests also cover a few extra cases (bad gameId, engineVersion 0, v0 `actorSeat`, non-Z `at`, head 1.5, final totals/version) — additive only.

## Gotchas

- Zod 4 `unrecognized_keys` has the object's own path, so an extra top-level key gives `issuePath ''` (message `(root)`).
- Zod 4 `.superRefine` on an object does not run when the shape already failed: only one issue class shows at a time.
- `new Date('2026-02-30T00:00:00.000Z')` is valid (rolls over to March 2); `'2026-13-01…'` is `NaN`. Both checks (round-trip and NaN guard) are needed.
- `runAiLoop` defaults to `maxMoves: 1000`; VC-604 passes `maxMoves: 100_000` so a long preset never hits `AiLoopLimitError` (whether 1000 suffices was not checked).
- `types.test-d.ts` exports its alias so ESLint's unused-vars rule stays quiet.

## For the next iteration

- **Exports and signatures**: see CONTEXT.md "Public interfaces" (keys.ts, errors.ts, schemas.ts are final unless a later decision says otherwise).
- **Zod failure → P-2 reason**: `` `meta-schema:${firstIssuePath(result.error)}` `` (likewise `commit-schema:`, `board-schema:`), with `firstIssuePath` from `./schemas`. Never put `issue.message` in a reason.
- **`CommitSchema` validates the full document including `schemaVersion`**: validate a `CommitBody` by `CommitSchema.safeParse({ schemaVersion: 1, ...next })`. The FR-602 cross-field rules (actorSeat/clientRequestId null iff v0) are in the schema, so a `commit-schema:actorSeat` reason covers VC-615's "actorSeat null at v1".
- **Per-preset game states (VC-604)**, reusable for fixtures: seats `{ seat: i, playerId: 'ai-<i>', name: 'AI <i>', kind: 'ai' }` × 3; `createGame({ gameId: g, rules: getPreset(id), seats, seed })` from `@/src/engine/engine`; `runAiLoop(start.state, createPlayers(seats), { maxMoves: 100_000, onTransition: (_prev, t) => states.push(t.state) })` from `@/src/service/ai-loop` and `@/src/players/registry`; `evaluate(state)` from `@/src/score/score-engine`. A valid meta + commit pair for game `g` is built at the top of `schemas.test.ts` (human seat 0 with hash `'ab'.repeat(32)`, AI seats 1–2, preset `argentina-fidepo`, seed `'test-seed'`, `at`/`createdAt` `'2026-11-23T14:05:00.000Z'`, `ENGINE_VERSION`) — copy it into `support/fixtures.ts` (P-10).
- The marker date for `create` is `meta.createdAt.slice(0, 10)` (P-7): safe because `GameMetaSchema` guarantees the `toISOString` form.
