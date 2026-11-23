# DECISIONS — Game State Manager (Phase 6)

## D-001: Error classes and messages  (Iteration 1)
**Context**: Spec Data & Interfaces lists six error classes; BR-604 forbids secrets in messages.
**Decision**: Applied P-1 in `src/state/errors.ts`. Each class extends `Error`, sets `this.name` to its class name, has the spec's `readonly` fields and the exact P-1 message (`Invalid game id: "<id>"`, `Game not found: <id>`, `Game already exists: <id>`, `Commit <v> not found in game <id>`, `Commit <v> already exists in game <id>`, `Invalid document: <reason>`).
**Rejected**: A shared base class (no caller needs it; `instanceof` per class suffices). Putting Zod messages in errors (can echo values).
**Consequences**: Messages are safe to log. Iteration 3's `errors.test.ts` (VC-624) checks them.

## D-002: InvalidCommitError reasons and the `firstIssuePath` helper  (Iteration 1)
**Context**: P-2 fixes the reason tokens; a Zod failure must become `meta-schema:<path>` etc. without the issue message.
**Decision**: `src/state/schemas.ts` exports `firstIssuePath(error: z.ZodError): string`: the first issue's path joined with `.`, or `(root)` when empty. Iteration 2/3 build reasons as `` `meta-schema:${firstIssuePath(e)}` ``, `commit-schema:…`, `board-schema:…`, plus the fixed tokens `initial-version`, `initial-state-version`, `state-game-id`, `seats-mismatch`, `commit-version`, `state-version`, `final-version`.
**Rejected**: Inline path joining in each manager method (duplicated); exposing `issue.message`.
**Consequences**: One extra export of `schemas.ts` beyond the spec table (listed in CONTEXT.md).

## D-003: Schema construction  (Iteration 1)
**Context**: P-3; FR-602 rules must apply on every read and write.
**Decision**: Every document schema is a `z.strictObject` with `schemaVersion: z.literal(1)`. Single-field rules sit on the field (`gameId` regex, `createdAt`/`at` via a `toISOString` round-trip refine, `version` 0–`MAX_COMMIT_VERSION`, `clientRequestId` 1–128). Cross-field rules use `.superRefine`, one issue per broken rule with a path at the field (`seats.<i>.seat`, `seatTokenHashes` for the length, `seatTokenHashes.<i>`, `actorSeat`, `clientRequestId`). `CommitSchema` validates the full document (with `schemaVersion`); there is no body schema: validate a `CommitBody` by parsing `{ schemaVersion: 1, ...next }`. Types are `z.infer`; `CommitBody = Omit<Commit, 'schemaVersion'>`. Domain parts reuse `PresetIdSchema`, `SeatInfoSchema`, `GameEventSchema`, `GameStateSchema`.
**Rejected**: A separate `CommitBodySchema` (two sources of truth).
**Consequences**: `superRefine` runs only once the object's shape parsed, so a document breaking a shape rule and a cross-field rule reports only the shape issue first. An extra top-level key reports `issuePath ''` (Zod `unrecognized_keys` has an empty path).

## D-004: Imports inside `src/state`  (Iteration 1)
**Context**: P-8 / BR-603 layer purity.
**Decision**: `keys.ts` imports `./errors`; `schemas.ts` imports `zod`, `@/src/domain/schemas` and `./keys`. No `../`, no `@/src/config`, engine, score, players or service. Storage will be imported only from `@/src/storage/object-store` (Iteration 2).
**Rejected**: A barrel `index.ts` (spec: none).
**Consequences**: The two BR-603 greps print nothing; `pnpm lint` enforces the layer rule.

## D-005: Compile-time ScoreBoard check uses strict Equals  (Iteration 1)
**Context**: P-12 allows relaxing `Equals` to mutual `extends` if `readonly`/optional differences break it.
**Decision**: The strict identity-based `Equals` passes as is (no `exactOptionalPropertyTypes`, so `live?: X[] | undefined` equals `live?: X[]`). No relaxation. `tests/unit/state/types.test-d.ts` exports `type _ScoreBoardMatches` (exported so ESLint's unused-vars rule does not flag it).
**Rejected**: Mutual-`extends` form (weaker, not needed).
**Consequences**: Verified to bite: adding a field to `ScoreBoardSchema` makes `pnpm typecheck` fail with TS2344.

## D-006: Extra exports of `keys.ts`  (Iteration 1)
**Context**: `schemas.ts` needs the FR-600 pattern for `GameMeta.gameId` and `FinalScores.gameId`.
**Decision**: `keys.ts` also exports `GAME_ID_PATTERN` (`/^[a-z2-7]{26}$/`). `parseCommitKey` validates its `gameId` (throws `InvalidGameIdError`), like every builder. All builders compose through `gameKeyPrefix`, so the id check is always first; `indexCreatedKey(date, id)` checks the id before the date; `commitKey` checks the id before the version.
**Rejected**: Duplicating the regex in `schemas.ts`; `parseCommitKey` returning `null` for a bad id (would hide caller bugs).
**Consequences**: Callers must pass a validated id to `parseCommitKey` (the manager always does).

## D-007: Numeric field typing in the schemas  (Iteration 1)
**Context**: The domain `ScoreBoard` and the spec documents type numbers as `number`; the spec bounds only some.
**Decision**: Seats, indices, bids, trick counts and made/missed counts are `z.int().min(0)`; `ranking[].place` is `z.int().min(1)`; `points`, `totals` and `ranking[].total` are `z.number()` (scores may be negative). `actorSeat` is a non-negative int or `null`. `engineVersion` is `z.int().min(1)`. `FinalScores.version` is `z.int().min(0)` (FR-616 states only "integer ≥ 0"); `Commit.version` and `Head.version` are bounded by `MAX_COMMIT_VERSION`.
**Rejected**: Plain `z.number()` everywhere (would accept `1.5` seats).
**Consequences**: VC-604 proves every engine-produced scoreboard parses under these bounds for all four presets.

## D-008: Serialization and byte comparison  (Iteration 2)
**Context**: P-4; FR-605/FR-613 compare the bytes a call wrote with the stored bytes.
**Decision**: Module-private helpers in `game-state-manager.ts`: `encodeJson(value)` (`TextEncoder` over `JSON.stringify`), `serializeMeta(meta)` and `serializeCommit(commit)` (each builds a fresh literal with keys in the spec's Data & Interfaces order, `schemaVersion: 1` first), and `bytesEqual(a, b)`. The bytes are produced once per call and written with `store.put(key, bytes, { mode: 'create-only', contentType: 'application/json' })` inside the private `#createOrMatch(gameId, key, bytes)`. `head.json` goes through `putJson` in the private `#writeHead(gameId, version)` (the only `mode: 'overwrite'` site). The index marker is `store.put(key, new Uint8Array(0), { mode: 'create-only' })`.
**Rejected**: `putJson` for meta/commits (its bytes are not available for the re-read compare).
**Consequences**: Iteration 3's `commit` reuses `serializeCommit`, `bytesEqual` and `#writeHead`; `#createOrMatch` throws `GameExistsError`, so `commit` needs its own conflict variant.

## D-009: Commit and meta reads  (Iteration 2)
**Context**: P-5; FR-607, FR-610.
**Decision**: Private `#readCommit(gameId, version): Promise<Commit | null>` = `getJson(store, commitKey, CommitSchema)` then `new CorruptObjectError(key, 'schema', 'version')` / `(key, 'schema', 'state.gameId')` on mismatch. `loadMeta` throws `new CorruptObjectError(metaKey, 'schema', 'gameId')` when `meta.gameId ≠ gameId`. Version check runs before the gameId check.
**Rejected**: Folding the identity checks into the schema (the key is not part of the document).
**Consequences**: Every commit read except the raw re-reads goes through `#readCommit` (Iteration 3's `eventsSince` too).

## D-010: Index marker date  (Iteration 2)
**Context**: P-7; FR-604 step 1 needs the UTC date of `createdAt`.
**Decision**: `indexCreatedKey(meta.createdAt.slice(0, 10), gameId)` on the validated meta.
**Rejected**: `new Date(createdAt)` round trip (redundant: the schema guarantees the `toISOString` form).
**Consequences**: VC-605 proves `23:59:59.999Z` stays on the same day.

## D-011: Test support files  (Iteration 2)
**Context**: P-10.
**Decision**: `tests/unit/state/support/store-wrappers.ts`: `class RecordingStore(inner, hooks = {})` with `calls: RecordedCall[]` (`{ method, key?, prefix?, keys?, mode? }`, `mode` = effective put mode, recorded before the hook runs), `maxConcurrentGets`, `callsOf(method?)`, `reset()`, and `hooks: Partial<StoreHooks>` where each hook is `(args, inner)` with `args` = `{ key }`, `{ key, body, opts }`, `{ prefix, opts }`, `{ keys }`. `support/fixtures.ts`: `GAME_ID`, `OTHER_GAME_ID`, `HUMAN_HASH`, `CREATED_AT`, `SEED`, `makeSeats()`, `makeMeta(overrides?)`, `makeInitial(gameId?)`, `makeCommitBody(prev, n, events?)`, `toCommit(body)`, `makeChain(upTo, gameId?)`, `storeGame(store, { upTo, head?, meta?, skip?, gameId? })`.
**Rejected**: Separate failing/retry store classes (hooks cover them). Moving the `schemas.test.ts` fixture (left as is; no need to touch that file).
**Consequences**: Extra fixture exports beyond P-10 (`HUMAN_HASH`, `CREATED_AT`, `SEED`, `makeSeats`, `toCommit`, `makeChain`, `storeGame`) are additive.

## D-012: File-store tests use a temp folder  (Iteration 2)
**Context**: P-11.
**Decision**: `create.test.ts` has one `FileObjectStore` round-trip (create → loadMeta/loadLatest) in `fs.mkdtemp(path.join(os.tmpdir(), 'lp-state-'))`, removed in `afterEach`. The races (VC-616) come in Iteration 3 with the same pattern.
**Rejected**: Writing under `.data/`.
**Consequences**: Proves the create write order works on the file driver too.

## D-013: Tip discovery details  (Iteration 2)
**Context**: FR-608 leaves a few unreachable-in-practice edges open.
**Decision**: Private `#findTip(gameId): Promise<Tip>` with `Tip = { version: number; commit: Commit }`, and `#probeFrom(gameId, start): Promise<Tip | null>` (`null` = commit `start` missing). Probing past `MAX_COMMIT_VERSION` answers "missing" without a call (`#existsCommit`). Listed versions are de-duplicated and sorted highest first (`#listedVersions`, every page via `cursor`); a hint that was missing is retried if listed. If the final probe from 0 finds commit 0 gone (deleted after round 1) → `GameNotFoundError`. If the last existing commit found by `exists` is missing on its read (external delete) → `CommitNotFoundError(gameId, last)`.
**Rejected**: Returning `null` from the probe in that last case (would fall back to a lower start and silently return an older tip).
**Consequences**: Iteration 3's `eventsSince` calls `#findTip` and reuses `tip.commit`.

## D-014: Seats comparison and create validation order  (Iteration 2)
**Context**: FR-604 needs a deep-equal of `meta.seats` and `initial.state.seats`; FR-600 the id check first.
**Decision**: `create` runs `assertValidGameId(meta.gameId)`, then `GameMetaSchema`, then `CommitSchema` on `{ schemaVersion: 1, ...initial }`, then `initial-version`, `initial-state-version`, `state-game-id`, `seats-mismatch`. Seats are compared with a private `jsonEqual` (key-order independent; a key holding `undefined` counts as absent). `create` writes and returns the parsed (validated) documents.
**Rejected**: `node:util.isDeepStrictEqual` (a Node built-in; P-8 says not needed); `JSON.stringify` equality (key-order dependent).
**Consequences**: `load` validates `version` via `commitKey(gameId, version)` before any I/O (id first, then `RangeError`).

## D-015: Commit write path and validation order  (Iteration 3)
**Context**: FR-611–FR-614; `#createOrMatch` throws `GameExistsError`, so `commit` cannot reuse it.
**Decision**: `commit` runs `assertValidGameId(gameId)`, then `CommitSchema.safeParse({ schemaVersion: 1, ...next })` (`commit-schema:<path>`), then `commit-version` (`version ≥ 1`), `state-version`, `state-game-id` (P-2). It serializes once (`serializeCommit`, P-4), writes with `store.put(key, bytes, { mode: 'create-only', contentType: 'application/json' })` inline, and on `ObjectExistsError` re-reads with a raw `store.get` + `bytesEqual`: identical → success; different or `null` → `CommitConflictError(gameId, version)`. Any other error from the put or the re-read propagates as is. Then `#writeHead` (the single `mode: 'overwrite'` site). Returns the Zod-parsed commit.
**Rejected**: Generalising `#createOrMatch` with an error factory (one extra indirection for two call sites); checking game existence or tip + 1 (spec FR-611: orphan allowed, 2 calls).
**Consequences**: A schema-valid commit-0 body gives `commit-version`; a v1 body relabelled 0 fails the schema first (`commit-schema:actorSeat`).

## D-016: Bounded parallel reads in eventsSince  (Iteration 3)
**Context**: P-6, FR-615, NFR-602.
**Decision**: Module-private `mapLimit(items, limit, fn)`: a pool of `min(limit, n)` workers pulling the next index; results kept in item order; `Promise.all` over the workers rejects with the first rejection, and a shared `failed` flag stops workers from starting new calls after it. `EVENTS_READ_CONCURRENCY = 8` (module constant, not exported). `eventsSince` validates the id, then `version` (`RangeError` `Invalid version <v>: version must be an integer >= 0`), calls `#findTip`, returns `[]` when `version ≥ tip.version`, reads `version+1 … tip−1` via `#readCommit` (`null` → `CommitNotFoundError(gameId, v)`) and appends the probe's `tip.commit`.
**Rejected**: A dependency such as p-limit (NFR-603); unbounded `Promise.all`.
**Consequences**: Calls = 5 + (t − v − 1) with an exact hint. Verified to bite: with the limit at 16 the VC-619 bound test fails (16 > 8).

## D-017: Stored bytes come from the caller's validated input  (Iteration 3)
**Context**: VC-615 requires the stored bytes to equal `JSON.stringify` of the document with keys in the documented order. Zod 4 re-orders nested keys to schema order (scoreboard `live` before `ranking`), while `evaluate()` emits `ranking` before `live`, so serializing the parsed data broke VC-615.
**Decision**: `serializeCommit`/`serializeMeta` fix the top-level key order and take nested values from the caller's input after it validated: `commit` serializes `{ schemaVersion: 1, ...next }`, and `create` now serializes `meta` and `{ schemaVersion: 1, ...initial }` too (same rule for both). Returned documents stay the parsed ones (D-014; equal content).
**Rejected**: Serializing the parsed data (fails VC-615 literally); deep key sorting (not the spec's order).
**Consequences**: Nested key order of stored documents is whatever the caller built; the byte compare is still same-process (spec Assumptions). Strict schemas mean the input holds no extra keys.

## D-018: Final scores write and read  (Iteration 3)
**Context**: FR-616, FR-617.
**Decision**: `writeFinalScores` validates the id, then the board (`board-schema:<path>`), then `version` with `FinalScoresSchema.shape.version` (safe integer ≥ 0, `final-version`), so whatever it writes reads back. It writes `{ schemaVersion, gameId, version, ranking, totals, madeCount, missedCount }` (parsed board fields) with `putJson(..., { mode: 'create-only' })` and swallows every error. `readFinalScores` = `getJson(FinalScoresSchema)`, plus `CorruptObjectError(key, 'schema', 'gameId')` when the stored `gameId` differs (same rule as `loadMeta`, D-009).
**Rejected**: `Number.isInteger` only (accepts unsafe integers the schema rejects); no gameId check (would return another game's result).
**Consequences**: The gameId check is an addition beyond FR-617's text, consistent with "never return unvalidated data"; Iteration 4 should document it.

## D-019: Race and concurrency tests  (Iteration 3)
**Context**: VC-616, VC-619; P-11.
**Decision**: VC-616 creates the game through the manager on a fresh store per round (memory: new `MemoryObjectStore`; file: a `round-<n>` subfolder of one `mkdtemp` folder removed in `afterEach`), then races two v1 bodies differing in `clientRequestId` via `Promise.allSettled`; 20 rounds each. VC-619's 0…40 case uses a `get` hook that sleeps 2 ms before delegating and counts in-flight commit reads; it asserts ≤ 8 (and `maxConcurrentGets ≤ 8`) and exactly 8 reached.
**Rejected**: Reusing one store with 20 game ids (would need 20 valid ids; same proof).
**Consequences**: The file-store races cost ≈ 1.8 s locally (fsync per put); still far under NFR-604.

## D-020: Secret-leak tests provoke real errors  (Iteration 3)
**Context**: VC-624, BR-604.
**Decision**: `errors.test.ts` creates a game whose commit-0 `state.seed` is `SECRET-SEED-123` and whose meta hash is `'ab'.repeat(32)`, then provokes each class through the manager (bad id, deleted commit 0, re-create with another `createdAt`, `load` past the tip, conflicting commit, invalid bodies/meta/board that hold the secrets). It checks `message`, `String(err)` and `InvalidCommitError.reason`.
**Rejected**: Constructing errors directly only (would not prove the manager never passes secrets in).
**Consequences**: None for the code: messages already carry only gameId/version/reason tokens.
