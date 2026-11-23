# CONTEXT — Game State Manager (Phase 6)

Last updated by: Iteration 4 (docs). Phase 6 is complete: code, tests and shipped docs. Next: the orchestrator's verify-spec, push, CI check of NFR-604, then Phase 7 (`GameService`).

## Current state

- Phases 0–6 are complete (domain, engine, score, players + AI loop in `src/service/ai-loop.ts`, storage, game state). Toolchain: Next.js 16.4.6, TypeScript 6.0.3 `strict` (no `noUncheckedIndexedAccess`; target ES2022), pnpm 10.15.1, Node 24 declared (local Node may be newer: pnpm prints an "Unsupported engine" WARN, not fatal), Vitest 5.1.1, ESLint 10 flat config + Prettier 3, zod 4.6.7. `package.json`/lockfile unchanged from `main` (NFR-603).
- **Shipped system**: `src/state/{keys,errors,schemas,game-state-manager}.ts` implement spec 06 exactly (public interface = spec Data & Interfaces, plus the extra exports `GAME_ID_PATTERN` and `firstIssuePath`). `src/state/.gitkeep` is gone. Nothing in `src/` calls the manager yet (Phase 7 will).
- **Tests**: `tests/unit/state/` — 8 test files, 189 tests (keys 30, schemas 45, create 26, load 30, commit 24, events-final 21, errors 10, io-budget 3) + `types.test-d.ts` (compile-time) + `support/{fixtures,store-wrappers}.ts`. Per-file durations sum ≈ 2.2–2.3 s locally (commit.test.ts ≈ 1.8 s: file-store races).
- **Full gates (Iteration 4)**: `pnpm install --frozen-lockfile && typecheck && lint && test && test:sim && build` exit 0; `pnpm test` 50 passed + 1 skipped files / 961 passed + 30 skipped tests; `pnpm test:sim` 5 files / 3605 tests (≈ 45 s).
- **Shipped docs**: `docs/architecture.md` §6.2 (document field table, id/timestamp formats, creation order, retried writes absorbed by byte compare, tip by forward probing) plus stale-line fixes in §4.2, §5, §6.1, §6.3; `docs/design.md` §7 (shipped `GameStateManager` interface, `CommitConflictError` → `VersionConflict` mapping) and §9 step 7; `docs/development.md` new §14 "Game state" (14.1–14.12), "Known limitations" renumbered to §15, stale lines fixed in §1, §2, §9.6, §10.8, §11.7, §12.8, §13, §13.7, §15; `docs/implementation.md` Phase 1 task 6.

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
| `docs/architecture.md` §6.2 | Storage layout + document field table (shipped). |
| `docs/design.md` §7 | Shipped `GameStateManager` interface. |
| `docs/development.md` §14 | Game state guide: module map, keys, schemas, usage example (§14.4), create, load, commit, eventsSince, final scores, error table, tests, gotchas. |

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
| `pnpm test:sim` / `pnpm build` | Simulation suite (≈ 45 s) and production build; both in CI. |

## Known gaps

- NFR-604: read the CI "Test" step after the push; the `tests/unit/state` file durations must sum to < 15 s (local ≈ 2.2 s).
- `schemas.test.ts` keeps its own meta/commit fixture (not moved to `support/fixtures.ts`).
- Accepted limits (spec, documented in development §14.12): a gap below the probe start goes unnoticed by `loadLatest`; an orphan `commit` is written but never loaded and has no index marker (retention will not find it); `final.json` may be missing (best-effort cache); Blob exclusivity rests on the storage driver until the preview checks run.
- README's "The repository currently holds the project foundation … The game itself is built … in later phases" was already outdated before this phase and was left unchanged (D-021).

## Hand-off to Phase 7

- **Construct**: `new GameStateManager(createObjectStore(getConfig()))`; the manager never reads config.
- **Ids and formats to supply**: `gameId` = 16 bytes from a CSPRNG in lowercase RFC 4648 base32 without padding (26 chars of `a–z2–7`; `^[a-z2-7]{26}$`). `createdAt` and every commit `at` = `new Date().toISOString()` exactly (ms + `Z`). `seatTokenHashes[i]` = SHA-256 hex (64 lowercase) for human seats, `null` for AI seats, one per seat. `meta.seats` must deep-equal `initial.state.seats` and `seats[i].seat === i`. `engineVersion` = `ENGINE_VERSION`.
- **Commit bodies**: commit 0 has `version 0`, `state.version 0`, `actorSeat null`, `clientRequestId null`. Every later commit: `version = state.version = req.version + 1` (the service sets `state.version`; the engine does not), `actorSeat` = the authenticated seat, `clientRequestId` 1–128 chars, `scoreboard = evaluate(state)`.
- **Call order per request**: `Promise.all([loadMeta(g), loadLatest(g)])` (round 1 of loadLatest runs alongside the meta read); authenticate against `meta.seatTokenHashes`; treat `GameNotFoundError` from either as 404 — `loadLatest` is authoritative (after a create that failed at commit 0, `loadMeta` succeeds but the game does not exist). Retry check: `load(g, req.version + 1)` (`CommitNotFoundError` = not committed yet). Then `commit(g, next)`; response events via `eventsSince(g, req.version)` or from the transitions just applied.
- **Error mapping**: `CommitConflictError` → run the retry check against `load(g, version)`; same `clientRequestId` + `actorSeat` → return that result, else probe forward (`loadLatest`) and throw `VersionConflict` with the fresh update. `GameNotFoundError` / `InvalidGameIdError` (id from the URL) → `GameNotFound` (404). `CommitNotFoundError` from `eventsSince` → treat as gone. `GameExistsError`, `InvalidCommitError`, `CorruptObjectError`, `RangeError` → 500 (bugs or corrupt data; messages are secret-free and safe to log). Other storage errors propagate → 500.
- **`final.json` meaning**: a best-effort, create-only cache of the terminal commit's `{ ranking, totals, madeCount, missedCount }` plus `gameId` and the terminal `version`. Write it once at game over with `writeFinalScores(g, terminal.version, terminal.scoreboard)` (never throws on storage errors; first write wins). Readers: `readFinalScores(g)`; on `null`, fall back to the terminal commit's `scoreboard`, which is always authoritative. It rejects a `final.json` naming another game.
- **Not checked by the manager**: `meta.engineVersion` vs `ENGINE_VERSION` (Phase 7 decides), tip + 1 on `commit`, game existence on `commit` (always load before committing).
- **Verify-spec commands**: the plan's Final acceptance test block (gate + `pnpm vitest run tests/unit/state --reporter verbose` + the three `src/state` greps + `git diff main -- package.json pnpm-lock.yaml` + `test ! -e src/state/.gitkeep`), plus VC-621's three doc greps (see `iterations/04-docs.md`).
