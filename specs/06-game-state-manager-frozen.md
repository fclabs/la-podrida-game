# Frozen: Spec 06 — Game State Manager

Source: specs/06-game-state-manager.md (plan + build record: specs/06-game-state-manager-plan.md, specs/06-game-state-manager-plan-artifacts/; review: specs/06-game-state-manager.review.md)
Status: SHIPPED
Frozen: 2026-11-23
PR / commit: https://github.com/fclabs/la-podrida-game/pull/8 — squash commit 0383bb2

## Purpose
Storage (Phase 5) stores bytes under keys, but nothing yet knows how a game is laid out in it. `GameService` (Phase 7) needs to create a game, find its latest version, load any version, append the next version so that exactly one of two racing requests wins, and read the events a client missed. All of this has to work on Vercel Blob, which has no transactions, so a `head.json` pointer can only ever be a hint. This spec delivers the Game State Manager in `src/state`: key builders for the storage layout; versioned Zod schemas for every persisted document; typed errors; a `GameStateManager` that implements the documented creation write order, tip discovery (a hint followed by forward probing), create-only commits (including the Blob SDK-retry case) and best-effort `head.json`/`final.json` writes. It benefits the developers of Phases 7–10 (service, API, retention).

## What it does
- **Ids and keys.** A `gameId` is valid iff `^[a-z2-7]{26}$` (128 bits, lowercase base32); the manager never generates ids. Every method and key builder rejects an invalid id with `InvalidGameIdError` before any I/O (`create` checks `meta.gameId` first). `commitKey` zero-pads the version to 8 digits (0–99,999,999, else `RangeError`); `indexCreatedKey` takes a real UTC `yyyy-mm-dd` (else `RangeError`). No built key is a prefix of another.
- **Schemas.** Every document is strict Zod with `schemaVersion: z.literal(1)`. Reads that fail the schema reject with storage `CorruptObjectError` (`reason: 'schema'`, `issuePath`); writes that fail reject with `InvalidCommitError`. Cross-field rules live in the schemas: `seats[i].seat === i`; seat-token hash is 64-hex for human seats and `null` for AI; `actorSeat`/`clientRequestId` are `null` iff `version === 0`; timestamps are exact `Date#toISOString` strings. `ScoreBoardSchema` is compile-time checked against the domain `ScoreBoard`.
- **create(meta, initial)** validates (schemas; `initial.version === 0 === initial.state.version`; matching `gameId`; `meta.seats` deep-equals `state.seats`) and then writes, in order: empty index marker (create-only) → `meta.json` (create-only) → commit 0 (create-only) → `head.json` (overwrite, best-effort). On `ObjectExistsError`, the marker counts as success; meta/commit 0 count as success only if the stored bytes are byte-identical (Blob retry), else `GameExistsError`.
- **Existence.** A game exists iff `meta.json` and commit 0 both exist. After a failure at commit 0, `loadMeta` still returns the meta but `loadLatest` → `GameNotFoundError`.
- **loadMeta** returns the validated meta, `GameNotFoundError` if missing, `CorruptObjectError` if `meta.gameId` mismatches.
- **loadLatest** checks meta + commit 0 + reads `head.json` in parallel; a missing/corrupt head means "no hint". From the hint it reads commit `h` and probes `h+1` in parallel, then probes forward one `exists` at a time until a miss; if commit `h` is missing (hint ahead) or there's no hint, it lists `commits/` and tries candidates highest-first, falling back to 0. It never writes or repairs `head.json`.
- **load(gameId, version)** returns that commit; `CommitNotFoundError` if missing while commit 0 exists, `GameNotFoundError` if commit 0 is missing (so orphan commits are never returned). It does not read meta.
- Every commit read checks key version = `commit.version` and `state.gameId` = requested id, else `CorruptObjectError`.
- **commit(gameId, next)** validates (schema; `version ≥ 1`; `state.version === version`; matching `gameId`), serializes once with a fixed key order, writes create-only, then overwrites `head.json` best-effort. It does not check tip + 1 or game existence (an orphan is possible only via caller bug). On `ObjectExistsError` it re-reads: byte-identical → success (Blob retry), otherwise (or missing) → `CommitConflictError`. Of two racing different bodies, exactly one wins. Other storage errors propagate; `head.json` errors never do.
- **eventsSince(gameId, v)** finds the tip as `loadLatest` does, returns `[]` when `v ≥ tip`, else concatenates the `events` of commits `v+1…tip` in order (≤ 8 reads in flight, tip read reused). A missing commit in range → `CommitNotFoundError`; a non-integer or negative `v` → `RangeError`.
- **writeFinalScores** validates and writes `final.json` create-only, swallowing every storage error. **readFinalScores** returns it or `null`.
- Errors never contain a seed, hand, seat-token hash or document body: at most a gameId, a version and a reason.

## Public interfaces / data

### Module exports

| Module | Exports |
|---|---|
| `src/state/keys.ts` | `MAX_COMMIT_VERSION` (99,999,999); `assertValidGameId(id: string): void`; `metaKey`, `commitKey`, `commitsPrefix`, `headKey`, `finalScoresKey`, `gameKeyPrefix`, `indexCreatedKey`, `indexCreatedPrefix`; `parseCommitKey(gameId: string, key: string): number \| null` |
| `src/state/schemas.ts` | `ScoreBoardSchema`, `GameMetaSchema`, `CommitSchema`, `HeadSchema`, `FinalScoresSchema`; types `GameMeta`, `Commit`, `CommitBody`, `Head`, `FinalScores` (all `z.infer` / derived) |
| `src/state/errors.ts` | `InvalidGameIdError`, `GameNotFoundError`, `GameExistsError`, `CommitNotFoundError`, `CommitConflictError`, `InvalidCommitError` |
| `src/state/game-state-manager.ts` | `GameStateManager` |

No barrel `index.ts`. Callers import from each module (`@/src/state/<module>`).

### Documents

```ts
// games/{gameId}/meta.json — create-only
interface GameMeta {
  schemaVersion: 1;
  gameId: string;                       // FR-600 (schema rules: FR-602)
  presetId: PresetId;
  engineVersion: number;                // integer ≥ 1 (ENGINE_VERSION at creation)
  createdAt: string;                    // ISO 8601 UTC, e.g. "2026-11-23T14:05:00.000Z" (Date#toISOString form)
  seats: SeatInfo[];                    // SeatInfoSchema; seats[i].seat === i
  seatTokenHashes: (string | null)[];   // by seat; /^[0-9a-f]{64}$/ for human seats, null for AI seats
}

// games/{gameId}/commits/{version:08d}.json — create-only
// Serialized with keys in exactly this order.
interface Commit {
  schemaVersion: 1;
  version: number;                      // integer ≥ 0
  at: string;                           // ISO 8601 UTC
  actorSeat: number | null;             // null only for version 0
  clientRequestId: string | null;       // non-empty, ≤ 128 chars; null only for version 0
  events: GameEvent[];                  // GameEventSchema
  state: GameState;                     // GameStateSchema
  scoreboard: ScoreBoard;               // ScoreBoardSchema
}
type CommitBody = Omit<Commit, 'schemaVersion'>;

// games/{gameId}/head.json — overwrite, hint only
interface Head { schemaVersion: 1; version: number }

// games/{gameId}/scores/final.json — create-only, best-effort cache
interface FinalScores {
  schemaVersion: 1;
  gameId: string;
  version: number;                      // the terminal commit's version
  ranking: ScoreBoard['ranking'];
  totals: number[];
  madeCount: number[];
  missedCount: number[];
}

// index/created/{yyyy-mm-dd}/{gameId} — create-only, empty body
```

### Manager

```ts
export class GameStateManager {
  constructor(store: ObjectStore);
  create(meta: GameMeta, initial: CommitBody): Promise<Commit>;              // GameExistsError, InvalidCommitError
  loadMeta(gameId: string): Promise<GameMeta>;                               // GameNotFoundError
  loadLatest(gameId: string): Promise<Commit>;                               // GameNotFoundError
  load(gameId: string, version: number): Promise<Commit>;                    // CommitNotFoundError, GameNotFoundError
  commit(gameId: string, next: CommitBody): Promise<Commit>;                 // CommitConflictError, InvalidCommitError
  eventsSince(gameId: string, version: number): Promise<GameEvent[]>;
  writeFinalScores(gameId: string, version: number, board: ScoreBoard): Promise<void>;  // best-effort
  readFinalScores(gameId: string): Promise<FinalScores | null>;
}
```

### Errors

```ts
export class InvalidGameIdError extends Error { readonly gameId: string }
export class GameNotFoundError extends Error { readonly gameId: string }
export class GameExistsError extends Error { readonly gameId: string }
export class CommitNotFoundError extends Error { readonly gameId: string; readonly version: number }
export class CommitConflictError extends Error { readonly gameId: string; readonly version: number }
export class InvalidCommitError extends Error { readonly reason: string }   // names the failed check, never a value from the body
```

Each sets `this.name`. `state` never throws the service's `VersionConflict` (it cannot import `service`).

## Key decisions
- The commit is the truth; `head.json` and `final.json` are caches. Current version = which commit keys exist (Blob has no transactions; AD-5).
- Create-only is the only ordering guard: no locks, no `ifMatch`, nothing but `head.json` is ever overwritten (storage BR-502; implementation decision 8).
- The Blob SDK-retry case is absorbed inside `create`/`commit` by comparing the stored bytes with the bytes this call wrote (same process, same serializer), so a retried write is not a false conflict.
- `state` imports only `storage`, `domain`, `zod` and Node built-ins (not `src/config`, `engine`, `score`, `players`, `service`), so it defines its own `ScoreBoardSchema` and throws `CommitConflictError`, not the service's `VersionConflict`.
- Caller (the service) supplies the `gameId`, timestamps, seat-token hashes and the state/scoreboard; the manager only stores and validates documents.

## Known limits (still true at freeze)
- Call budgets (counting-store tested): `loadLatest` with an exact hint = 5 calls in 2 parallel rounds, 0 `list`; `commit` without conflict = 2 `put`s; `eventsSince(g, v)` with exact hint = 5 + (t − v − 1) calls.
- `meta.engineVersion` is not checked against `ENGINE_VERSION` on load — Phase 7 decides what a mismatch means.
- The service must load before committing and must write tip + 1; the manager won't catch either mistake. Map `CommitConflictError` → `VersionConflict`/409 in the service.
- `GameExistsError` signals a bug (ids are 128-bit random), not bad luck.
- A gap left by an external partial delete below the probe start goes unnoticed by `loadLatest`; inside an `eventsSince` range it surfaces as `CommitNotFoundError`.
- Only `schemaVersion: 1` exists; there are no migrations. Not tested against a real Blob store (Phase 5b/8).

## Deliberately excluded
- Everything in `GameService` (id/seed/token generation, auth, `clientRequestId` retry check, AI loop) and the retention job/deletion (Phase 10; this spec only writes the index marker).
- Cached reads, `ifMatch` on `head.json`, latency targets, and any change to `storage`/`domain`/`engine`/`score`/`players`.
