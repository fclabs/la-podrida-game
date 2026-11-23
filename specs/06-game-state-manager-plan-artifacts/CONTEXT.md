# CONTEXT — Game State Manager (Phase 6)

Last updated by: Iteration 3 (`commit`, `eventsSince`, final scores). Next: Iteration 4 (docs only).

## Current state

- Phases 0–5 are complete (domain, engine, score, players + AI loop in `src/service/ai-loop.ts`, storage). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`; target ES2022), pnpm 10.15.1, Node 24 declared (local Node may be newer: pnpm prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7. `package.json` dependencies unchanged in this phase (NFR-603).
- **Shipped in Iteration 1**: `src/state/keys.ts`, `src/state/errors.ts`, `src/state/schemas.ts`; tests `tests/unit/state/keys.test.ts` (30 tests), `tests/unit/state/schemas.test.ts` (45 tests), `tests/unit/state/types.test-d.ts` (compile-time only). `src/state/.gitkeep` deleted.
- **Shipped in Iteration 2**: `src/state/game-state-manager.ts` (`GameStateManager` with `constructor`, `create`, `loadMeta`, `load`, `loadLatest`); test support `tests/unit/state/support/{store-wrappers,fixtures}.ts`; tests `tests/unit/state/create.test.ts` (26 tests), `tests/unit/state/load.test.ts` (30 tests).
- **Shipped in Iteration 3**: `GameStateManager.commit`, `eventsSince`, `writeFinalScores`, `readFinalScores`, module-private `mapLimit` + `EVENTS_READ_CONCURRENCY = 8`; `create` now serializes the caller's input (D-017). Tests `tests/unit/state/commit.test.ts` (24), `events-final.test.ts` (21), `errors.test.ts` (10), `io-budget.test.ts` (3). The code and the public interface of `src/state` are final; only docs remain (Iteration 4).
- Full `pnpm test`: 50 passed + 1 skipped files / 961 passed + 30 skipped tests. `tests/unit/state`: 8 files, 189 tests, per-file durations summing to ≈ 2.3 s locally (commit.test.ts ≈ 1.8 s, the file-store races).

## File map

| Path | Contents |
|---|---|
| `src/state/keys.ts` | `MAX_COMMIT_VERSION`, `GAME_ID_PATTERN`, `assertValidGameId`, key builders, `indexCreatedPrefix`, `parseCommitKey`. Private regexes `COMMIT_FILE`, `DATE_PATTERN`, helper `isCalendarDate`. Imports `./errors`. |
| `src/state/errors.ts` | The six error classes (D-001). No imports. |
| `src/state/schemas.ts` | `ScoreBoardSchema`, `GameMetaSchema`, `CommitSchema`, `HeadSchema`, `FinalScoresSchema`, types, `firstIssuePath`. Private `isIsoTimestamp`, `SEAT_TOKEN_HASH`, `ISO_TIMESTAMP`. Imports `zod`, `@/src/domain/schemas`, `./keys`. |
| `tests/unit/state/keys.test.ts` | VC-601 (id part), VC-602: exact keys, `RangeError`s, leap day, `assertValidKey`/`assertValidPrefix` on every key/prefix, no key is a path prefix of another, `parseCommitKey`, code-unit sort order. |
| `tests/unit/state/schemas.test.ts` | Valid docs round-trip; VC-603 at schema level (via `putJson`/`getJson` on `MemoryObjectStore`, asserting `CorruptObjectError` `reason 'schema'` + exact `issuePath`); `firstIssuePath`; VC-604 per-preset full all-AI game. |
| `tests/unit/state/types.test-d.ts` | `Assert<Equals<z.infer<typeof ScoreBoardSchema>, ScoreBoard>>` (D-005). |
| `src/state/game-state-manager.ts` | `GameStateManager` (8 public methods). Module-private: `Tip`, `EVENTS_READ_CONCURRENCY`, `encodeJson`, `serializeMeta`, `serializeCommit`, `bytesEqual`, `jsonEqual`, `mapLimit`. Private methods: `#findTip`, `#probeFrom`, `#existsCommit`, `#listedVersions`, `#readHint`, `#readCommit`, `#createOrMatch`, `#writeHead`. Imports `@/src/domain/types` (types only), `@/src/storage/object-store`, `./errors`, `./keys`, `./schemas`. |
| `tests/unit/state/support/store-wrappers.ts` | `RecordingStore`, `RecordedCall`, `StoreHooks`, `StoreMethod` (D-011). |
| `tests/unit/state/support/fixtures.ts` | Ids, `makeMeta`, `makeInitial`, `makeCommitBody`, `toCommit`, `makeChain`, `storeGame` (D-011). |
| `tests/unit/state/create.test.ts` | VC-601 (create/loadMeta/load/loadLatest, 0 calls), VC-605 (keys, order, modes, key order of stored docs), P-11 file-store round-trip, VC-606 (six reasons, 0 calls), VC-607 (five bullets), VC-608 (N = 1…4). |
| `tests/unit/state/commit.test.ts` | VC-601 (commit, eventsSince, writeFinalScores, readFinalScores; 0 calls), VC-615 (+ stored bytes, six invalid bodies, v3 after tip 1, orphan), VC-616 (memory + file store, 20 rounds each), VC-617 (retry landed, differing body, null re-read), VC-618 (+ re-read error propagates). |
| `tests/unit/state/events-final.test.ts` | VC-619 (all bullets; 0…40 with a delayed `get` hook: ≤ 8 and exactly 8 commit reads in flight), VC-614 (eventsSince part + a mismatched commit inside the range), VC-620 (+ stored key order, foreign-gameId `final.json`). |
| `tests/unit/state/errors.test.ts` | VC-624: each of the six error classes provoked through the manager on a game with seed `SECRET-SEED-123` and hash `'ab'.repeat(32)`; `message`, `String(err)` and `reason` hold neither. |
| `tests/unit/state/io-budget.test.ts` | VC-625 in full: `loadLatest` 5 calls, `eventsSince(g, 2)` 7 calls, `commit` v6 = exactly 2 puts. |
| `tests/unit/state/load.test.ts` | VC-603 (loadMeta), VC-609, VC-610 (a)–(g) + net + corrupt hinted commit, VC-611 (+ multi-page list), VC-612, VC-613 (+ orphan, single read for v0), VC-614 (load, loadLatest), VC-625 (loadLatest = 5 calls). |

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

// src/state/game-state-manager.ts
export class GameStateManager {
  constructor(store: ObjectStore);
  create(meta: GameMeta, initial: CommitBody): Promise<Commit>;   // InvalidGameIdError, InvalidCommitError, GameExistsError
  loadMeta(gameId: string): Promise<GameMeta>;                    // GameNotFoundError, CorruptObjectError ('gameId')
  load(gameId: string, version: number): Promise<Commit>;         // RangeError, CommitNotFoundError, GameNotFoundError
  loadLatest(gameId: string): Promise<Commit>;                    // GameNotFoundError
  commit(gameId: string, next: CommitBody): Promise<Commit>;      // InvalidCommitError, CommitConflictError; other storage errors propagate
  eventsSince(gameId: string, version: number): Promise<GameEvent[]>; // RangeError, GameNotFoundError, CommitNotFoundError, CorruptObjectError
  writeFinalScores(gameId: string, version: number, board: ScoreBoard): Promise<void>; // InvalidCommitError; storage errors swallowed
  readFinalScores(gameId: string): Promise<FinalScores | null>;   // CorruptObjectError (schema, invalid-json, or 'gameId' mismatch)
}
// Every method rejects with InvalidGameIdError before any I/O for a bad id. Matches spec Data &
// Interfaces exactly; extra exports of the layer are only GAME_ID_PATTERN and firstIssuePath.
// RangeError of eventsSince: `Invalid version <v>: version must be an integer >= 0`.
// InvalidCommitError reasons: create → meta-schema:<p>, commit-schema:<p>, initial-version,
// initial-state-version, state-game-id, seats-mismatch; commit → commit-schema:<p>,
// commit-version, state-version, state-game-id; writeFinalScores → board-schema:<p>, final-version.
// Module-private internals (D-008, D-009, D-013, D-015, D-016):
//   interface Tip { version: number; commit: Commit }
//   #findTip(gameId): Promise<Tip>              — FR-608 steps 1–3 (validates the id first)
//   #probeFrom(gameId, start): Promise<Tip|null> — null iff commit `start` is missing
//   #readCommit(gameId, v): Promise<Commit|null> — getJson + FR-610 identity checks
//   #writeHead(gameId, v): Promise<void>         — putJson overwrite, errors swallowed
//   #createOrMatch(gameId, key, bytes)           — create-only put; ObjectExistsError → raw re-read + bytesEqual, else GameExistsError
//   mapLimit(items, limit, fn)                   — ≤ limit pending, order kept, first rejection wins, no new calls after it
//   serializeCommit(commit): Uint8Array          — keys: schemaVersion, version, at, actorSeat, clientRequestId, events, state, scoreboard
//   serializeMeta(meta): Uint8Array              — keys: schemaVersion, gameId, presetId, engineVersion, createdAt, seats, seatTokenHashes
//   bytesEqual(a, b): boolean

// tests/unit/state/support/store-wrappers.ts
export type StoreMethod = 'get' | 'put' | 'exists' | 'list' | 'delete';
export interface RecordedCall { method: StoreMethod; key?: string; prefix?: string; keys?: readonly string[]; mode?: 'create-only' | 'overwrite' }
export interface StoreHooks {               // each replaces delegation to `inner`; the call is recorded first
  get(args: { key }, inner): Promise<StoredObject | null>;
  put(args: { key; body; opts? }, inner): Promise<void>;
  exists(args: { key }, inner): Promise<boolean>;
  list(args: { prefix; opts? }, inner): Promise<ListResult>;
  delete(args: { keys }, inner): Promise<void>;
}
export class RecordingStore implements ObjectStore {
  constructor(readonly inner: ObjectStore, readonly hooks?: Partial<StoreHooks>);
  readonly calls: RecordedCall[];   // invocation order; put `mode` = effective mode
  maxConcurrentGets: number;
  callsOf(method?: StoreMethod): RecordedCall[];
  reset(): void;
}

// tests/unit/state/support/fixtures.ts
export const GAME_ID = 'abcdefghijklmnopqrstuvwxyz', OTHER_GAME_ID = '234567234567234567234567ab';
export const HUMAN_HASH = 'ab'.repeat(32), CREATED_AT = '2026-11-23T14:05:00.000Z', SEED = 'test-seed';
export function makeSeats(): SeatInfo[];                          // seat 0 human 'p0'/'Ana', seats 1–2 AI
export function makeMeta(overrides?: Partial<GameMeta>): GameMeta; // default preset, hashes [HUMAN_HASH, null, null]
export function makeInitial(gameId?: string): CommitBody;          // createGame(default preset, makeSeats(), SEED), at CREATED_AT
export function makeCommitBody(prev: CommitBody | Commit, n: number, events?: GameEvent[]): CommitBody; // actorSeat 0, 'req-<n>', at CREATED_AT + n min
export function toCommit(body: CommitBody): Commit;
export function makeChain(upTo: number, gameId?: string): CommitBody[];
export function storeGame(store, { upTo, head?, meta?, skip?, gameId? }): Promise<Commit[]>; // putJson meta (unless meta:false), commits 0…upTo minus skip, head if given
```

Issue paths produced by the rules (what `getJson` puts in `CorruptObjectError.issuePath`): `schemaVersion`; `''` for an extra top-level key (nested: the object's path, e.g. `scoreboard.ranking.0`); `gameId`; `createdAt` / `at`; `seats.<i>.seat`; `seatTokenHashes` (count); `seatTokenHashes.<i>` (kind/format); `actorSeat`; `clientRequestId`; `version`.

## Conventions & invariants

- **Layer purity** (BR-603, P-8, D-004): `src/state` imports only `zod`, `@/src/domain/<module>`, `@/src/storage/object-store` and `./…`. Greps that must print nothing:
  - `grep -rnE "from '@/src/(engine|score|players|service|config)" src/state`
  - `grep -rnE "from '\.\./" src/state`
  - `grep -rniwE "ifMatch|lock|locking" src/state` (P-9: keep these words out of comments too)
  - `grep -rnE "mode: 'overwrite'" src/state` must match only `#writeHead` (VC-622).
- **Manager**: every public method validates the gameId first, then its other arguments, before any I/O; methods are `async`, so validation errors arrive as rejections. Writes: create-only for everything but `head.json` (`create` and `commit` both go through `#writeHead`, best-effort); `final.json` is `putJson` create-only with every error swallowed. Reads: commits via `#readCommit` only; the FR-605/FR-613 re-reads are a raw `store.get` + `bytesEqual`, never parsed. `loadLatest` and `eventsSince` never write. `commit` does not check game existence or tip + 1.
- **Serialization** (D-017): stored meta/commit bytes = `JSON.stringify` of the caller's validated input with the top-level keys in the documented order; nested key order is the caller's. Returned documents are the Zod-parsed ones (equal content; nested key order may differ, e.g. scoreboard `live`/`ranking`).
- **Validation first**: every builder validates the gameId before anything else (all compose through `gameKeyPrefix`).
- **Schemas**: `z.strictObject` + `schemaVersion: z.literal(1)`; single-field rules on the field, cross-field rules in `.superRefine` (runs only when the shape parsed). Validate a `CommitBody` with `CommitSchema.safeParse({ schemaVersion: 1, ...next })` (there is no body schema). Timestamps must be exact `Date#toISOString` output.
- **Errors**: messages carry only gameId / version / reason token (BR-604). `InvalidCommitError.reason` per D-002; never a Zod message.
- **Tests**: `tests/unit/state/*.test.ts`; header comment names the spec FRs/VCs; one `describe` per VC. Shared helpers live in `tests/unit/state/support/` (no `.test.ts` suffix). Store commits 0…n directly with `storeGame(memory, { upTo: n, head })`; break one with `skip: [k]` + a direct `memory.put`/`putJson`. Wrap with `new RecordingStore(memory, hooks)` to count calls or inject failures; assert raw state on `store.inner`. Both test files define a local `rejectionOf(promise)` helper. Tests may import any layer. File-store tests: `fs.mkdtemp(path.join(os.tmpdir(), 'lp-state-'))`, removed in `afterEach`; never write under `.data/`.
- **Formatting**: `pnpm exec prettier --write src/state tests/unit/state` before `pnpm lint`. `docs/` and `specs/` are prettier-ignored.
- **Commits**: one per iteration, staged by explicit path (never `git add -A`), message ends with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, PR or merge. Never modify `src/storage`, `src/domain`, `src/engine`, `src/score`, `src/players`, `src/service`, `src/config.ts`, `vitest*.config.ts`, `eslint.config.mjs`, `package.json`, the lockfile.
- **Storage facts** (Phase 5): `putJson(store, key, value, { mode })` (create-only default, `application/json`); `getJson(store, key, schema)` → `null` if missing, `CorruptObjectError('invalid-json')` for bad UTF-8/JSON, `CorruptObjectError('schema', issuePath)` for a schema failure. `CorruptObjectError.issuePath` is always a defined property (value `undefined` for invalid-json). `ObjectExistsError` on create-only conflicts. On Blob, an `ObjectExistsError` may mean the caller's own SDK-retried write landed (the reason for the FR-605/FR-613 byte compare). Keys: one letter case, zero-padded numbers, no key a path prefix of another (file store).

## Commands

All with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed (no network).

| Command | What it does |
|---|---|
| `pnpm vitest run tests/unit/state` | State unit tests (8 files, 189 tests, ≈ 2 s). |
| `pnpm vitest run tests/unit/state --reporter json --outputFile <scratch>/state.json` | Per-file durations (NFR-604 proxy). Without `--outputFile` the JSON reporter writes `.vitest/json/output.json`, which breaks `prettier --check`: delete it. |
| `pnpm vitest run tests/unit/state/keys.test.ts` | Keys only (30 tests). |
| `pnpm vitest run tests/unit/state/schemas.test.ts` | Schemas + VC-604 (45 tests). |
| `pnpm vitest run tests/unit/state/create.test.ts tests/unit/state/load.test.ts` | Manager create/load (56 tests). |
| `pnpm vitest run tests/unit/state/{commit,events-final,errors,io-budget}.test.ts` | Manager commit/events/final/errors/budgets (58 tests). |
| `pnpm typecheck` | `next typegen && tsc --noEmit`; also checks `tests/unit/state/types.test-d.ts`. |
| `pnpm lint` | ESLint 0 warnings + `prettier --check .`. |
| `pnpm test` | Full unit/contract suite (Blob contract skipped without a token). |
| `pnpm test:sim` / `pnpm build` | Final Verification only (sim ≈ 46 s). |

## Known gaps

- Docs not updated: `docs/architecture.md` §6.2, `docs/design.md` §7, `docs/development.md` "Game state" section, `docs/implementation.md` Phase 1 task 6 (Iteration 4).
- NFR-604: the CI "Test" step's `tests/unit/state` durations must be read after the push (local sum ≈ 2.3 s).
- `pnpm test:sim` and `pnpm build` not run yet in this phase (Final Verification, Iteration 4).
- `schemas.test.ts` keeps its own meta/commit fixture (not moved to `support/fixtures.ts`).
- Accepted limits (spec): a gap below the probe start goes unnoticed by `loadLatest`; an orphan `commit` is written but never loaded; `final.json` may be missing (best-effort cache).
