# Spec 06 — Game State Manager

> Version: 0.2 · Last updated: 2026-11-23 · Status: Draft · Owner: Federico Castañeda
> Source: [`docs/implementation.md`](../docs/implementation.md) §3 Phase 6 and §5 decision 8. Context: [`docs/architecture.md`](../docs/architecture.md) §5, §6.2–§6.5, §11, AD-4, AD-5; [`docs/design.md`](../docs/design.md) §6.3, §7, §9.
> Builds on: [`specs/05-storage-frozen.md`](./05-storage-frozen.md) (`ObjectStore`, `getJson`/`putJson`, `ObjectExistsError`, `CorruptObjectError`, `assertValidKey`, the Blob retry caveat, key-builder rules), [`specs/01-domain-model-frozen.md`](./01-domain-model-frozen.md) (`GameStateSchema`, `GameEventSchema`, `SeatInfoSchema`, `ScoreBoard` type), [`specs/02-engine-frozen.md`](./02-engine-frozen.md) (`ENGINE_VERSION`, `GameState.version`), [`specs/00-project-scaffold-frozen.md`](./00-project-scaffold-frozen.md) (layer rule: `state` may import only `storage`, `domain` and `src/config`).
> Requirement IDs use the 6xx range.

## Purpose

Storage (Phase 5) stores bytes under keys, but nothing yet knows how a game is laid out in it. `GameService` (Phase 7) needs to create a game, find its latest version, load any version, append the next version so that exactly one of two racing requests wins, and read the events a client missed. All of this has to work on Vercel Blob, which has no transactions, so a `head.json` pointer can only ever be a hint. This spec delivers the Game State Manager in `src/state`:

- key builders for the storage layout;
- versioned Zod schemas for every persisted document;
- typed errors;
- a `GameStateManager` that implements the documented creation write order, tip discovery (a hint followed by forward probing), create-only commits (including the Blob SDK-retry case) and best-effort `head.json`/`final.json` writes.

It benefits the developers of Phases 7–10 (service, API, retention), who get persistence whose race, stale-hint and crash behaviour is proven by tests.

## Scope

**In**
- `src/state/keys.ts`, `src/state/schemas.ts`, `src/state/errors.ts`, `src/state/game-state-manager.ts`. Delete `src/state/.gitkeep`.
- The persisted types `GameMeta`, `Commit`, `CommitBody`, `Head`, `FinalScores` (inferred from schemas in `src/state/schemas.ts`), plus a `ScoreBoardSchema` there (`state` cannot import `score`, and `domain` has no scoreboard schema).
- Unit tests in `tests/unit/state/`. Concurrency tests on `MemoryObjectStore` and `FileObjectStore`. A test-only failing-store wrapper in `tests/unit/state/`.
- Docs:
  - `docs/architecture.md` §6.2: shipped document shapes.
  - `docs/design.md` §7: shipped interface.
  - `docs/development.md`: a new "Game state" section right after "Storage", with later sections and cross-references renumbered.

**Out**
- `GameService` and everything else in Phase 7: seed and gameId generation, seat-token generation and hashing, authentication, the `clientRequestId` retry check, mapping `CommitConflictError` to `VersionConflict`/409, and the AI loop.
- Checking `meta.engineVersion` against `ENGINE_VERSION` when loading (Phase 7 decides what a mismatch means).
- The retention job and the deletion of games (Phase 10). This spec only writes the index marker.
- `ifMatch` on `head.json`, which the `ObjectStore` does not offer (implementation decision 8: plain overwrite). Cached reads. Migrations of old `schemaVersion`s (architecture §6.4: none in the MVP).
- Running against a real Blob store (Phase 5b/8). Latency targets (Phase 8).
- Any change to `src/storage`, `src/domain`, `src/engine`, `src/score` or `src/players`.

## Actors

| Actor | Description | Permissions |
|---|---|---|
| `GameService` (Phase 7) | The only production caller | Every `GameStateManager` method; supplies `gameId`, timestamps, seat-token hashes, and the state/scoreboard to commit |
| Retention job (Phase 10) | Deletes old games | Uses the key builders (`gameKeyPrefix`, `indexCreatedPrefix`) and the `ObjectStore` directly, not the manager |
| Unit/concurrency tests | Exercise the manager | Build it over `MemoryObjectStore`, `FileObjectStore` (temp folder) or a failing/counting wrapper |

## Functional Requirements

### Keys

- **FR-600 (Must)** — A `gameId` is valid iff it matches `^[a-z2-7]{26}$`: 128 random bits in lowercase RFC 4648 base32 without padding. The manager does not generate ids. Every manager method and key builder that takes a `gameId` throws (rejects with) `InvalidGameIdError` naming the id before any I/O when the id is invalid. For `create`, the id checked is `meta.gameId`, and this check runs before every other FR-604 check.
- **FR-601 (Must)** — The key builders return exactly:
  - `metaKey(id)` → `games/{id}/meta.json`;
  - `commitKey(id, v)` → `games/{id}/commits/{v as 8 zero-padded digits}.json` (`v` an integer in 0–99,999,999, else `RangeError` naming `version`);
  - `commitsPrefix(id)` → `games/{id}/commits/`;
  - `headKey(id)` → `games/{id}/head.json`;
  - `finalScoresKey(id)` → `games/{id}/scores/final.json`;
  - `gameKeyPrefix(id)` → `games/{id}/`;
  - `indexCreatedKey(date, id)` → `index/created/{yyyy-mm-dd}/{id}`, where `date` is a UTC `yyyy-mm-dd` string (validated: a real calendar date, else `RangeError` naming `date`);
  - `indexCreatedPrefix` → the constant `index/created/`.

  Every built key satisfies the storage key rule, and no built key is a path prefix of another.

### Documents (schemas)

- **FR-602 (Must)** — Every persisted document is validated with a strict Zod schema (unknown keys rejected) that includes `schemaVersion: z.literal(1)`. The documents are `GameMeta`, `Commit`, `Head`, `FinalScores` (Data & Interfaces). A stored document with any other `schemaVersion`, or one that fails its schema, makes the reading method reject with the storage `CorruptObjectError` (except the FR-605/FR-613 re-reads, which compare raw bytes and never parse) (`reason: 'schema'`, with `issuePath`). The manager never returns unvalidated data. The schemas also enforce these cross-field rules, so they apply on every read and every write (a write that breaks one rejects with `InvalidCommitError`, per FR-604/FR-611):
  - `GameMeta`: `gameId` matches FR-600. `seats[i].seat === i`. `seatTokenHashes.length === seats.length`. `seatTokenHashes[i]` matches `^[0-9a-f]{64}$` when `seats[i].kind === 'human'` and is `null` when it is `'ai'`. `createdAt` is a `Date#toISOString` string (`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$`, and `new Date(createdAt).toISOString() === createdAt`).
  - `Commit`: `version` is an integer in 0–`MAX_COMMIT_VERSION`. `actorSeat` and `clientRequestId` are both `null` when `version === 0`, and both non-null otherwise. `clientRequestId` has 1–128 characters. `at` has the same format as `createdAt`.
  - `Head`: `version` is an integer in 0–`MAX_COMMIT_VERSION`.
- **FR-603 (Must)** — `ScoreBoardSchema` is strict and matches the domain `ScoreBoard` type field for field (`live` optional). A compile-time check fails the typecheck if `z.infer<typeof ScoreBoardSchema>` and `ScoreBoard` are not mutually assignable.

### Create

- **FR-604 (Must)** — Given a valid `GameMeta` and a commit-0 `CommitBody`, `create(meta, initial)` first validates both. It rejects with `InvalidCommitError` (`reason` naming the check) before any I/O when any of these fails:
  - the meta schema (including its FR-602 rules);
  - the commit schema (including its FR-602 rules);
  - `initial.version === 0`;
  - `initial.state.version === 0`;
  - `initial.state.gameId === meta.gameId`;
  - `meta.seats` deep-equals `initial.state.seats`.

  It then writes, in this order and each step only after the previous one succeeds:
  1. the index marker `indexCreatedKey(UTC date of meta.createdAt, gameId)` with an empty body, create-only;
  2. `meta.json`, create-only;
  3. commit 0, create-only;
  4. `head.json` `{ schemaVersion: 1, version: 0 }`, overwrite, best-effort (any error swallowed).

  It resolves to the commit-0 `Commit`.
- **FR-605 (Must)** — When a create-only step of FR-604 rejects with `ObjectExistsError`, `create` handles it as follows. This covers the Blob SDK-retry case, as FR-613 does for `commit`.
  - Step 1 (the empty index marker): counts as success, and `create` continues.
  - Steps 2 and 3: `create` reads the stored bytes. If they are byte-identical to the bytes it tried to write, the step counts as success and `create` continues. Otherwise, or when the stored object is missing on the re-read, `create` rejects with `GameExistsError { gameId }` and writes nothing further.

  Any other storage error from steps 1–3, or from a re-read, propagates unchanged, and nothing further is written.
- **FR-606 (Must)** — A game counts as existing iff both its `meta.json` and its commit 0 exist. After a failure (or crash) at or before step 2 of FR-604, both `loadMeta` and `loadLatest` reject with `GameNotFoundError`. After a failure at step 3, `loadLatest` rejects with `GameNotFoundError`, while `loadMeta` returns the stored meta (it only reads `meta.json`). After step 3, the game loads normally, with or without `head.json`.

### Load

- **FR-607 (Must)** — `loadMeta(gameId)` resolves to the validated `GameMeta`. It rejects with `GameNotFoundError { gameId }` when `meta.json` is missing, and with `CorruptObjectError` when `meta.gameId ≠ gameId`.
- **FR-608 (Must)** — `loadLatest(gameId)` resolves to the tip: the last commit reached by the forward probe below. Commits below the starting point are not checked.
  1. In parallel: `exists(metaKey)`, `exists(commitKey(0))` and `getJson(headKey)`. If meta or commit 0 is missing → `GameNotFoundError`. A `head.json` that is missing, or rejects with `CorruptObjectError`, counts as "no hint". Any other storage error from these three calls propagates; when several reject, the first rejection wins (`Promise.all`).
  2. **Forward probe from a start `s`.** In parallel, read commit `s` (with the FR-610 checks) and call `exists(commitKey(s+1))`.
     - If commit `s` is missing, the start is invalid (go to step 3, or, if already there, try its next candidate).
     - Any rejection of either call (including `CorruptObjectError` from the commit-`s` read) propagates, even when `s+1` exists (`Promise.all` semantics).
     - If `s+1` is missing, the tip is `s`, and the commit already read is returned with no further call.
     - Otherwise probe `s+2, s+3, …` one at a time with `exists` until one is missing; then read the last existing one and return it.
  3. With a hint `h`, start at `s = h`. With no hint, or when commit `h` is missing (hint ahead of reality): list `commitsPrefix` (every page). Take as candidates the listed keys that parse as commit keys (`parseCommitKey`), highest first, and try step 2 from each until one is not missing. If none works (or the listing is empty), start from `s = 0`.

  `loadLatest` never writes. In particular, it never repairs `head.json`.
- **FR-609 (Must)** — `load(gameId, version)` resolves to the validated commit `version`. It rejects with:
  - `RangeError` for a version outside FR-601's range;
  - `CommitNotFoundError { gameId, version }` when that commit is missing but commit 0 exists;
  - `GameNotFoundError` when commit 0 is missing.

  It calls `exists(commitKey(0))` in parallel with the read of commit `version` (for `version` 0, one read suffices), so a commit without a commit 0 (an orphan, FR-611) is never returned. It does not read `meta.json`.
- **FR-610 (Must)** — Every commit read (`load`, `loadLatest`, `eventsSince`; not the FR-613 or FR-605 re-reads, which compare raw bytes only) also checks that `commit.version` equals the version in its key and that `commit.state.gameId` equals the requested `gameId`. A mismatch rejects with `CorruptObjectError` (`reason: 'schema'`, `issuePath` `'version'` or `'state.gameId'`).

### Commit

- **FR-611 (Must)** — `commit(gameId, next)` validates `next` before any I/O. It rejects with `InvalidCommitError` when any of these fails:
  - the commit schema (including its FR-602 rules);
  - `next.version ≥ 1`;
  - `next.state.version === next.version`;
  - `next.state.gameId === gameId`.

  It then serializes the document `{ schemaVersion: 1, ...next }` once, with `JSON.stringify` and a fixed key order (Data & Interfaces), and writes those bytes create-only to `commitKey(gameId, next.version)`. On success it writes `head.json` `{ schemaVersion: 1, version: next.version }` with an overwrite, best-effort (any error swallowed), and resolves to the `Commit`. It does not check that `next.version` is the tip + 1: the create-only write is the only ordering guard (storage BR-502). It also does not check that the game exists. A commit for a game without `meta.json` and commit 0 is written as an orphan key, which no load ever returns (FR-606). The service always loads before it commits, so this only happens through a caller bug, and it keeps `commit` at 2 calls.
- **FR-612 (Must)** — Given two `commit` calls with different bodies racing for the same version, exactly one resolves and the other rejects with `CommitConflictError { gameId, version }`. The stored commit is the winner's.
- **FR-613 (Must)** — When the create-only write rejects with `ObjectExistsError`, `commit` reads the stored bytes of that commit key. It resolves as a success iff they are byte-identical to the bytes it tried to write; this covers the Blob SDK-retry case, where the caller's own retried write landed. Otherwise it rejects with `CommitConflictError`. A stored commit that is missing on the re-read, which can only happen after an external delete, also rejects with `CommitConflictError`. In the success case it also performs the `head.json` write.
- **FR-614 (Must)** — Any storage error other than `ObjectExistsError` from the commit write or the re-read propagates unchanged. `head.json` errors never propagate.

### Events and final scores

- **FR-615 (Must)** — `eventsSince(gameId, version)` rejects with `RangeError` naming `version` when `version` is not an integer ≥ 0. Otherwise it finds the tip `t` as in FR-608. It resolves to `[]` when `version ≥ t`; otherwise it reads commits `version+1 … t` (with the FR-610 checks; the tip commit already read by FR-608 is reused), at most 8 reads in flight at a time, and resolves to their `events` concatenated in version order. A commit missing inside that range (deleted meanwhile) rejects with `CommitNotFoundError`.
- **FR-616 (Must)** — `writeFinalScores(gameId, version, board)` validates `board` with `ScoreBoardSchema` and `version` as an integer ≥ 0, and rejects with `InvalidCommitError` on failure. It then writes `{ schemaVersion: 1, gameId, version, ranking, totals, madeCount, missedCount }` (from `board`) create-only to `finalScoresKey`, and resolves to `void` whatever the write does: `ObjectExistsError` and every other storage error are swallowed.
- **FR-617 (Must)** — `readFinalScores(gameId)` resolves to the validated `FinalScores`, or `null` when `final.json` is missing. A corrupt one rejects with `CorruptObjectError`.

### Docs

- **FR-618 (Must)** — Update the docs as follows:
  - `docs/architecture.md` §6.2 lists the shipped document fields of `meta.json`, commits, `head.json` and `final.json`.
  - `docs/design.md` §7 shows the shipped `GameStateManager` interface (including `loadMeta`, `readFinalScores`, the `version` argument of `writeFinalScores`, and `CommitConflictError` in place of `VersionConflict`).
  - `docs/development.md` gains a "Game state" section numbered right after "Storage" (later sections and cross-references renumbered). It covers the module map, the key layout, the document schemas, the create order, tip discovery, commit conflicts and the Blob retry case, the errors, and how to test with the failing store.

## Business Rules

- **BR-601 — The commit is the truth; `head.json` and `final.json` are caches.** The game's current version is decided only by which commit keys exist, and its final result only by the terminal commit. *Rationale:* architecture §6.3 and AD-5. `head.json` can be stale, missing or ahead, and Blob has no transactions. *Exceptions:* none.
- **BR-602 — Create-only is the only ordering guard.** The manager never locks, never uses `ifMatch`, and never overwrites a commit, `meta.json`, the index marker or `final.json`. Only `head.json` is overwritten. *Rationale:* storage BR-502; implementation decision 8. *Exceptions:* none.
- **BR-603 — State is game-agnostic about rules.** `src/state` imports only `@/src/storage/*`, `@/src/domain/*`, `zod` and Node built-ins (no `src/config`), and nothing from `engine`, `score`, `players` or `service`. It never interprets moves or scores; it stores and validates documents. *Rationale:* the layer rule (architecture §4.1). *Exceptions:* none.
- **BR-604 — No secrets in errors.** Messages of `GameNotFoundError`, `GameExistsError`, `CommitConflictError`, `CommitNotFoundError`, `InvalidCommitError` and `InvalidGameIdError` contain at most the gameId, a version and a reason. They never contain a seed, a hand, a seat-token hash or a document body. *Rationale:* stored state holds the seed and every hand (architecture §8). *Exceptions:* none.

## Non-Functional Requirements

- **NFR-601** — `pnpm typecheck`, `pnpm lint` (0 warnings), `pnpm test`, `pnpm test:sim` and `pnpm build` pass, locally and in CI.
- **NFR-602** — In the normal path (`head.json` exact), `loadLatest` makes exactly 5 `ObjectStore` calls in two parallel rounds (round 1: `exists` meta, `exists` commit 0, `get` head; round 2: `get` commit `h`, `exists` commit `h+1`) and 0 `list` calls. `commit` without a conflict makes exactly 2 calls (1 create-only `put`, 1 overwrite `put`). `eventsSince(g, v)` with an exact hint and tip `t > v` makes 5 + (t − v − 1) calls, with at most 8 commit reads in flight. These counts are measured with a counting store wrapper.
- **NFR-603** — `package.json` `dependencies` and `devDependencies` are unchanged.
- **NFR-604** — The `tests/unit/state` files complete in < 15 s in total, as reported by vitest in the CI "Test" step.

## Data & Interfaces

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

## Verification Criteria

### Keys and schemas
- **VC-601** (FR-600): `assertValidGameId` accepts `'a'.repeat(26)`, `'abcdefghijklmnopqrstuvwxyz'` and `'234567'.repeat(4) + 'ab'`. It rejects `''`, 25 and 27 chars, uppercase, `0`, `1`, `8`, `/`, and `..`, each with `InvalidGameIdError` whose `gameId` equals the input. Every manager method given `'BAD'` (for `create`: `meta.gameId = 'BAD'`, with an otherwise invalid commit body too) rejects with `InvalidGameIdError`, and a counting store records 0 calls.
- **VC-602** (FR-601): for id `g = 'abcdefghijklmnopqrstuvwxyz'` (valid): `commitKey(g, 0)` → `games/g…/commits/00000000.json`; `commitKey(g, 41)` → `…/00000041.json`; `commitKey(g, 99999999)` is accepted; `-1`, `1.5` and `100000000` → `RangeError`. `indexCreatedKey('2026-11-23', g)` → `index/created/2026-11-23/{g}`; `'2026-02-30'` and `'2026-1-5'` → `RangeError`. Every builder's output passes `assertValidKey`. `parseCommitKey(g, commitKey(g, 7)) === 7`, and `parseCommitKey(g, headKey(g)) === null`. Sorting `commitKey(g, v)` for v = 9, 10, 100 by code unit gives version order.
- **VC-603** (FR-602): `getJson` with each schema rejects a document with `schemaVersion: 2` (`issuePath 'schemaVersion'`), one with an extra key, and one missing a required field. `loadMeta` of a stored meta with `schemaVersion: 2` → `CorruptObjectError` `reason 'schema'`. Each FR-602 rule is broken once in a stored document and gives `CorruptObjectError`:
  - meta: `seats[1].seat = 2`; a hash on an AI seat; `null` on a human seat; an uppercase hash; one hash too few; `createdAt '2026-11-23T14:05:00Z'`; `createdAt '2026-02-30T00:00:00.000Z'`;
  - commit: v1 with `actorSeat: null`; v0 with a `clientRequestId`; a `clientRequestId` of 129 chars; `''`;
  - head: `version 100000000`.
- **VC-604** (FR-603): `ScoreBoardSchema.parse(evaluate(state))` succeeds for every state reached in one seeded all-AI game per preset (built in the test via engine + score + players; tests may import any layer). A file `tests/unit/state/types.test-d.ts`, or an equivalent compile-time assertion checked by `pnpm typecheck`, asserts mutual assignability.

### Create
- **VC-605** (FR-604): `create` on an empty memory store, with `createdAt '2026-11-23T23:59:59.999Z'`, results in:
  - exactly the keys `index/created/2026-11-23/{g}`, `games/{g}/meta.json`, `games/{g}/commits/00000000.json` and `games/{g}/head.json`;
  - an empty marker body;
  - `head.json` holding `{ schemaVersion: 1, version: 0 }`;
  - a returned `Commit` that deep-equals `load(g, 0)` and `loadLatest(g)`;
  - a recording store wrapper that shows the four puts in the FR-604 order, with modes create-only ×3 then overwrite.
- **VC-606** (FR-604): each of the six validation failures listed in FR-604 (for the schemas: one meta rule and one commit rule from FR-602) → `InvalidCommitError`, and the store is empty afterwards.
- **VC-607** (FR-605):
  - `create` twice with the same gameId and a different `createdAt` → the second rejects with `GameExistsError`, and the stored meta and commit 0 are the first call's.
  - `create` twice with identical arguments → both resolve, and the store holds one copy of each key.
  - With only the marker key pre-existing → `create` resolves and writes the other three keys.
  - A store wrapper whose first create-only `put` to `meta.json` (and, in a second run, to commit 0) stores the body and then rejects with `ObjectExistsError` → `create` resolves, and `loadLatest` returns commit 0.
  - A wrapper that rejects meta's put with `ObjectExistsError` while the re-read returns `null` → `GameExistsError`.
- **VC-608** (FR-604, FR-606): with a failing store that rejects the Nth `put` (N = 1, 2, 3) with a plain `Error('boom')`, `create` rejects with that error, `loadLatest(g)` rejects with `GameNotFoundError`, and `loadMeta(g)` rejects with `GameNotFoundError` for N ≤ 2 and returns the meta for N = 3. With N = 4 (the `head.json` write), `create` resolves and `loadLatest(g)` returns commit 0.

### Load
- **VC-609** (FR-607): `loadMeta` returns the stored meta, and a missing meta gives `GameNotFoundError`. A meta stored under `g` whose `gameId` is another valid id → `CorruptObjectError`.
- **VC-610** (FR-608) — tip discovery: with commits 0…5 stored and `head.json` set to each case below, `loadLatest` returns commit 5 in every case and never writes (the recording store shows 0 puts):
  - (a) `{version: 5}` exact;
  - (b) `{version: 2}` behind;
  - (c) `{version: 9}` ahead;
  - (d) missing;
  - (e) holding `not json`;
  - (f) holding `{schemaVersion: 2, version: 5}`;
  - (g) holding `{schemaVersion: 1, version: 100000000}`.

  A store wrapper whose `get` of `head.json` rejects with `Error('net')` makes `loadLatest` reject with that same object. With `head.json` at 2 and commit 2 holding `not json` (commits 0…5 otherwise valid), `loadLatest` rejects with `CorruptObjectError`.
- **VC-611** (FR-608): with commits 0…3 stored, `head.json` missing, and a store wrapper whose `list` returns `{ keys: [] }` → `loadLatest` returns commit 3 (probing from 0). With a wrapper whose `list` returns only `commits/00000001.json` and a non-commit key `…/commits/x` → `loadLatest` returns commit 3.
- **VC-612** (FR-606, FR-608): meta missing with commits 0…2 present → `GameNotFoundError`. Commit 0 missing with meta and commits 1…2 present → `GameNotFoundError`. Both present and nothing else → commit 0.
- **VC-613** (FR-609): `load(g, 3)` with commits 0…3 returns commit 3. `load(g, 4)` → `CommitNotFoundError { version: 4 }`. `load(g, -1)` → `RangeError`. `load` on an unknown game → `GameNotFoundError`.
- **VC-614** (FR-610): a commit stored under `…/00000003.json` whose `version` is 4 → `load(g, 3)` rejects with `CorruptObjectError` `issuePath 'version'`. A commit whose `state.gameId` is a different id → `issuePath 'state.gameId'`. The same mismatched commit 3 as the tip (commits 0…3, head 3) makes `loadLatest` and `eventsSince(g, 2)` reject the same way.

### Commit
- **VC-615** (FR-611): `commit(g, body v1)` after `create` stores the commit, sets `head.json` to 1 and returns a `Commit` equal to `load(g, 1)`. The stored bytes equal `JSON.stringify` of the document with keys in Data & Interfaces order. Each failure below → `InvalidCommitError`, with 0 store calls:
  - version 0;
  - `state.version` ≠ `version`;
  - the wrong `state.gameId`;
  - `actorSeat: null` at v1;
  - `clientRequestId: null` at v1;
  - an extra key.

  `commit` of v3 when the tip is 1 succeeds; the manager does not check tip + 1. `commit(g2, v1)` for a gameId `g2` that was never created resolves, and `loadLatest(g2)` and `load(g2, 1)` still reject with `GameNotFoundError`.
- **VC-616** (FR-612): on `MemoryObjectStore` and on `FileObjectStore` (temp folder), two `commit` calls for v1 with different `clientRequestId`s, started together via `Promise.allSettled`, give exactly 1 fulfilled and 1 `CommitConflictError { gameId: g, version: 1 }`. `load(g, 1)` equals the fulfilled one's commit. Repeat 20 times per driver.
- **VC-617** (FR-613): a store wrapper simulates the SDK retry: the first create-only `put` to the commit key stores the body and then rejects with `ObjectExistsError`. `commit` resolves to the commit, and `head.json` is set. With a pre-stored v1 whose body differs only in `clientRequestId` → `CommitConflictError`. With a wrapper that throws `ObjectExistsError` while the re-read returns `null` → `CommitConflictError`.
- **VC-618** (FR-614): a commit-write rejection `Error('net')` → `commit` rejects with that same object. A `head.json` put that rejects `Error('head')` → `commit` still resolves, and the next `loadLatest` returns the new commit (via probing).

### Events and final scores
- **VC-619** (FR-615): with commits 0…4 holding events `[e0a, e0b]`, `[e1]`, `[]`, `[e3a, e3b]`, `[e4]`:
  - `eventsSince(g, 0)` → `[e1, e3a, e3b, e4]`;
  - `eventsSince(g, 3)` → `[e4]`;
  - `eventsSince(g, 4)` → `[]`;
  - `eventsSince(g, 9)` → `[]`;
  - `-1` and `1.5` → `RangeError`;
  - with commit 2 deleted afterwards (and `head.json` at 4), `eventsSince(g, 0)` → `CommitNotFoundError { version: 2 }`;
  - an unknown game → `GameNotFoundError`;
  - with commits 0…40 and a store wrapper counting concurrent `get`s, `eventsSince(g, 0)` returns the 40 commits' events in order, and the concurrent commit reads never exceed 8.
- **VC-620** (FR-616, FR-617): `writeFinalScores(g, 7, board)` then `readFinalScores(g)` → exactly `{ schemaVersion: 1, gameId: g, version: 7, ranking, totals, madeCount, missedCount }`, the last four deep-equal to `board`'s. A second call with a different board resolves, and the stored file is unchanged. With a store that rejects every put, it resolves. An invalid board (`totals: 'x'`) and a `version` of `-1` or `1.5` → `InvalidCommitError`. `readFinalScores` on a missing file → `null`; on `not json` → `CorruptObjectError`.

### Docs, purity, errors, NFRs
- **VC-621** (FR-618):
  - `docs/architecture.md` §6.2 mentions `seatTokenHashes`, `engineVersion`, `actorSeat`, `clientRequestId`, `scoreboard` and `FinalScores` fields.
  - `docs/design.md` §7 contains `loadMeta`, `readFinalScores` and `CommitConflictError`.
  - `docs/development.md` has a "Game state" section right after "Storage", with no stale section cross-reference (every `§N` reference resolves to a heading with that title).
- **VC-622** (BR-601, BR-602): `grep -rnE "mode: 'overwrite'" src/state` matches only the `head.json` write site(s). `grep -rniE "ifMatch|lock" src/state` finds nothing outside comments. VC-610 shows `loadLatest` never writes.
- **VC-623** (BR-603): `grep -rnE "from '@/src/(engine|score|players|service)" src/state` finds nothing, and `pnpm lint` passes the layer rule.
- **VC-624** (BR-604): for every error class, a test throws it from a game whose state seed is `SECRET-SEED-123` and whose meta has seat-token hash `'ab'.repeat(32)`. The message contains neither string; `InvalidCommitError` raised from a body holding them does not either.
- **VC-625** (NFR-602): a counting wrapper over memory, with commits 0…5 and `head.json` at 5, shows `loadLatest` = 5 calls (0 `list`) and `eventsSince(g, 2)` = 7 calls. `commit` of v6 without a conflict = 2 `put` calls.
- **VC-626** (NFR-601, NFR-603, NFR-604): local and CI gates are green. `package.json` dependency lists are unchanged from `main`. `src/state/.gitkeep` is gone. The CI "Test" step reports the `tests/unit/state` files' durations summing to < 15 s.

## Open Questions

None.

## Assumptions

- The service (Phase 7) supplies a `gameId` matching FR-600, generated from 16 cryptographically random bytes. With 128 bits, and with retried writes absorbed by FR-605, `GameExistsError` signals a bug, not bad luck.
- `JSON.stringify` of the same `CommitBody` object always yields the same bytes in one process. FR-613 compares the bytes this call wrote with what is stored, so the comparison never spans processes or serializer versions.
- `Date#toISOString` gives `createdAt` and `at`; the schema accepts exactly that format (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- Commits never have gaps: only `commit` writes commit keys, each create-only, and the service always writes tip + 1. A gap left by an external partial delete below the probe start goes unnoticed by `loadLatest` (FR-608), and makes `eventsSince` reject with `CommitNotFoundError` when the gap is in its range (FR-615). That is accepted (architecture §6.5).

## Changelog

- 0.2 (2026-11-23): review pass 1:
  - tip defined by the probe procedure (FR-608);
  - 5-call probe order: parallel read of `h` and probe of `h+1` (FR-608, NFR-602, VC-625);
  - FR-606 split into step ≤ 2 and step 3;
  - `create` checks `meta.gameId` first (FR-600);
  - operator decisions:
    - the cross-field rules are schema refinements (FR-602);
    - `create` absorbs SDK retries with a byte compare, and the marker's "exists" counts as success (FR-605);
    - `eventsSince` reads with at most 8 in flight (FR-615);
    - orphan `commit` is allowed and documented (FR-611);
    - non-corrupt `head.json` errors propagate (FR-608);
  - `Head.version` bounded;
  - extra VCs for FR-610 and FR-616;
  - readiness pass: the FR-613 and FR-605 re-reads are raw byte compares only (FR-602, FR-610); exact VC-620 document;
  - operator: fold in deferred R-028 (a corrupt probe read propagates), R-029 (`load` checks commit 0), R-030 (round-trip timestamp check) and R-037.
- 0.1 (2026-11-23): initial draft from implementation.md Phase 6, architecture §6.2–§6.5, design §7/§9, and discovery answers:
  - the Blob retry case is handled inside `commit` by a byte comparison;
  - the caller supplies `gameId` and timestamps;
  - `commit` validates the schema and version consistency, but not tip + 1;
  - `eventsSince` returns `[]` past the tip and throws `RangeError` on an invalid version;
  - meta is lean, with seat-token hashes as hex strings by seat;
  - `loadMeta` is separate and `loadLatest` checks meta and commit 0;
  - `create` clashes become `GameExistsError`;
  - `final.json` is create-only, best-effort with errors swallowed, and has a reader.
