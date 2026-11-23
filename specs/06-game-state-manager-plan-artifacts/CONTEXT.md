# CONTEXT — Game State Manager (Phase 6)

Last updated by: Iteration 1 (keys, errors, schemas). Next: Iteration 2 (`GameStateManager` create/load).

## Current state

- Phases 0–5 are complete (domain, engine, score, players + AI loop in `src/service/ai-loop.ts`, storage). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`; target ES2022), pnpm 10.15.1, Node 24 declared (local Node may be newer: pnpm prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7. `package.json` dependencies unchanged in this phase (NFR-603).
- **Shipped in Iteration 1**: `src/state/keys.ts`, `src/state/errors.ts`, `src/state/schemas.ts`; tests `tests/unit/state/keys.test.ts` (30 tests), `tests/unit/state/schemas.test.ts` (45 tests), `tests/unit/state/types.test-d.ts` (compile-time only). `src/state/.gitkeep` deleted.
- Not yet built: `src/state/game-state-manager.ts` (Iteration 2: `create`, `loadMeta`, `load`, `loadLatest`; Iteration 3: `commit`, `eventsSince`, `writeFinalScores`, `readFinalScores`), test support files, docs (Iteration 4).
- Full `pnpm test`: 44 passed + 1 skipped files / 847 passed + 30 skipped tests. State tests ≈ 0.5 s.

## File map

| Path | Contents |
|---|---|
| `src/state/keys.ts` | `MAX_COMMIT_VERSION`, `GAME_ID_PATTERN`, `assertValidGameId`, key builders, `indexCreatedPrefix`, `parseCommitKey`. Private regexes `COMMIT_FILE`, `DATE_PATTERN`, helper `isCalendarDate`. Imports `./errors`. |
| `src/state/errors.ts` | The six error classes (D-001). No imports. |
| `src/state/schemas.ts` | `ScoreBoardSchema`, `GameMetaSchema`, `CommitSchema`, `HeadSchema`, `FinalScoresSchema`, types, `firstIssuePath`. Private `isIsoTimestamp`, `SEAT_TOKEN_HASH`, `ISO_TIMESTAMP`. Imports `zod`, `@/src/domain/schemas`, `./keys`. |
| `tests/unit/state/keys.test.ts` | VC-601 (id part), VC-602: exact keys, `RangeError`s, leap day, `assertValidKey`/`assertValidPrefix` on every key/prefix, no key is a path prefix of another, `parseCommitKey`, code-unit sort order. |
| `tests/unit/state/schemas.test.ts` | Valid docs round-trip; VC-603 at schema level (via `putJson`/`getJson` on `MemoryObjectStore`, asserting `CorruptObjectError` `reason 'schema'` + exact `issuePath`); `firstIssuePath`; VC-604 per-preset full all-AI game. |
| `tests/unit/state/types.test-d.ts` | `Assert<Equals<z.infer<typeof ScoreBoardSchema>, ScoreBoard>>` (D-005). |

## Public interfaces

```ts
// src/state/keys.ts
export const MAX_COMMIT_VERSION = 99_999_999;
export const GAME_ID_PATTERN: RegExp;                 // /^[a-z2-7]{26}$/ (extra export, D-006)
export function assertValidGameId(id: string): void;  // InvalidGameIdError(id)
export function gameKeyPrefix(id: string): string;    // games/{id}/
export function metaKey(id: string): string;          // games/{id}/meta.json
export function commitsPrefix(id: string): string;    // games/{id}/commits/
export function commitKey(id: string, version: number): string;
//   games/{id}/commits/{8 digits}.json; RangeError `Invalid commit version <v>: version must be an integer from 0 to 99999999`
export function headKey(id: string): string;          // games/{id}/head.json
export function finalScoresKey(id: string): string;   // games/{id}/scores/final.json
export const indexCreatedPrefix = 'index/created/';
export function indexCreatedKey(date: string, id: string): string;
//   index/created/{date}/{id}; id checked first; RangeError `Invalid index date "<d>": date must be a UTC yyyy-mm-dd`
export function parseCommitKey(gameId: string, key: string): number | null;
//   version iff key === commitKey(gameId, v); null otherwise; InvalidGameIdError for a bad gameId

// src/state/errors.ts  (each sets this.name; messages per D-001)
export class InvalidGameIdError extends Error { readonly gameId: string; constructor(gameId: string) }
export class GameNotFoundError extends Error { readonly gameId: string; constructor(gameId: string) }
export class GameExistsError extends Error { readonly gameId: string; constructor(gameId: string) }
export class CommitNotFoundError extends Error { readonly gameId: string; readonly version: number; constructor(gameId: string, version: number) }
export class CommitConflictError extends Error { readonly gameId: string; readonly version: number; constructor(gameId: string, version: number) }
export class InvalidCommitError extends Error { readonly reason: string; constructor(reason: string) }

// src/state/schemas.ts
export const ScoreBoardSchema;   // strict at every level; live optional; z.infer ≡ domain ScoreBoard
export const GameMetaSchema;     // { schemaVersion: 1, gameId, presetId, engineVersion ≥ 1, createdAt, seats, seatTokenHashes } + superRefine
export const CommitSchema;       // { schemaVersion: 1, version, at, actorSeat, clientRequestId, events, state, scoreboard } + superRefine
export const HeadSchema;         // { schemaVersion: 1, version 0–MAX_COMMIT_VERSION }
export const FinalScoresSchema;  // { schemaVersion: 1, gameId, version ≥ 0, ranking, totals, madeCount, missedCount }
export type GameMeta = z.infer<typeof GameMetaSchema>;
export type Commit = z.infer<typeof CommitSchema>;
export type CommitBody = Omit<Commit, 'schemaVersion'>;
export type Head = z.infer<typeof HeadSchema>;
export type FinalScores = z.infer<typeof FinalScoresSchema>;
export function firstIssuePath(error: z.ZodError): string; // 'a.0.b' or '(root)' (extra export, D-002)
```

Issue paths produced by the rules (what `getJson` puts in `CorruptObjectError.issuePath`): `schemaVersion`; `''` for an extra top-level key (nested: the object's path, e.g. `scoreboard.ranking.0`); `gameId`; `createdAt` / `at`; `seats.<i>.seat`; `seatTokenHashes` (count); `seatTokenHashes.<i>` (kind/format); `actorSeat`; `clientRequestId`; `version`.

## Conventions & invariants

- **Layer purity** (BR-603, P-8, D-004): `src/state` imports only `zod`, `@/src/domain/<module>`, `@/src/storage/object-store` (from Iteration 2) and `./…`. Greps that must print nothing:
  - `grep -rnE "from '@/src/(engine|score|players|service|config)" src/state`
  - `grep -rnE "from '\.\./" src/state`
  - `grep -rniwE "ifMatch|lock|locking" src/state` (P-9: keep these words out of comments too)
- **Validation first**: every builder validates the gameId before anything else (all compose through `gameKeyPrefix`).
- **Schemas**: `z.strictObject` + `schemaVersion: z.literal(1)`; single-field rules on the field, cross-field rules in `.superRefine` (runs only when the shape parsed). Validate a `CommitBody` with `CommitSchema.safeParse({ schemaVersion: 1, ...next })` (there is no body schema). Timestamps must be exact `Date#toISOString` output.
- **Errors**: messages carry only gameId / version / reason token (BR-604). `InvalidCommitError.reason` per D-002; never a Zod message.
- **Tests**: `tests/unit/state/*.test.ts`; header comment names the spec FRs/VCs; one `describe` per VC. Shared helpers (Iteration 2) go in `tests/unit/state/support/` (no `.test.ts` suffix). Tests may import any layer. File-store tests: `fs.mkdtemp(path.join(os.tmpdir(), 'lp-state-'))`, removed in `afterEach`; never write under `.data/`.
- **Formatting**: `pnpm exec prettier --write src/state tests/unit/state` before `pnpm lint`. `docs/` and `specs/` are prettier-ignored.
- **Commits**: one per iteration, staged by explicit path (never `git add -A`), message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge. Never modify `src/storage`, `src/domain`, `src/engine`, `src/score`, `src/players`, `src/service`, `src/config.ts`, `vitest*.config.ts`, `eslint.config.mjs`, `package.json`, the lockfile.
- **Storage facts** (Phase 5): `putJson(store, key, value, { mode })` (create-only default, `application/json`); `getJson(store, key, schema)` → `null` if missing, `CorruptObjectError('invalid-json')` for bad UTF-8/JSON, `CorruptObjectError('schema', issuePath)` for a schema failure. `CorruptObjectError.issuePath` is always a defined property (value `undefined` for invalid-json). `ObjectExistsError` on create-only conflicts. On Blob, an `ObjectExistsError` may mean the caller's own SDK-retried write landed (the reason for the FR-605/FR-613 byte compare). Keys: one letter case, zero-padded numbers, no key a path prefix of another (file store).

## Commands

All with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed (no network).

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/state` | State unit tests (≈ 0.5 s). |
| `pnpm vitest run tests/unit/state/keys.test.ts` | Keys only (30 tests). |
| `pnpm vitest run tests/unit/state/schemas.test.ts` | Schemas + VC-604 (45 tests). |
| `pnpm typecheck` | `next typegen && tsc --noEmit`; also checks `tests/unit/state/types.test-d.ts`. |
| `pnpm lint` | ESLint 0 warnings + `prettier --check .`. |
| `pnpm test` | Full unit/contract suite (Blob contract skipped without a token). |
| `pnpm test:sim` / `pnpm build` | Final Verification only (sim ≈ 46 s). |

## Known gaps

- `GameStateManager` does not exist yet (Iterations 2–3); VC-601's manager part, VC-603's `loadMeta` part and VC-605 onward are untested.
- Test support (`RecordingStore`, fixtures) not yet written (Iteration 2, P-10).
- Docs not updated (Iteration 4).
- NFR-604 CI timing to be read after the push.
