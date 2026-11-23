# DECISIONS — GameService (Phase 7)

## D-001: Service error classes per P-1  (Iteration 1)

- **Context**: spec Data & Interfaces lists seven errors; BR-701 forbids secrets in them; plan P-1 fixes constructors and messages.
- **Decision**: applied P-1 exactly in `src/service/errors.ts`: each class extends `Error`, sets `this.name` to its class name, has `readonly` fields as in the spec, and uses the P-1 message. `GameNotFound` stores and prints `gameId.slice(0, 64)` (UTF-16 code units). `IllegalMove.reason` is typed `'game-over' | 'unknown-move'`; `InvalidRequest.reason` is `string` (callers pass one of the seven field names).
- **Rejected**: a shared base class (not in the spec's interface); clipping only the message (P-1 clips the field too).
- **Consequences**: Iterations 2–3 throw these as is; VC-725(b) can serialize `{ name, message, ...ownFields }` safely.

## D-002: replayGame per P-9  (Iteration 1)

- **Context**: FR-723/724 and BR-705; P-9 fixes the allowed imports and the guard order.
- **Decision**: `replayGame` first checks `commits` (empty → `RangeError('Invalid commits: at least commit 0 is required')`; `commits[i].version !== i` → `RangeError('Invalid commits: commit at index <i> has version <v>, expected <i>')`), then `meta.engineVersion`. It starts from engine `createGame` with `meta.gameId`, `commits[0].state.rules`, `meta.seats`, `commits[0].state.seed`, discards its events, applies only `bid-made`/`card-played` events with `applyMove`, and returns `{ ...state, version: commit.version }` per commit. The running state keeps the engine's `version` (0); only the returned copies carry the commit version.
- **Rejected**: reusing `tests/sim/harness.ts` (tests are not importable from `src`); checking each replayed state against the stored one (spec asks only to return states).
- **Consequences**: `replay.ts` has no comments containing the VC-727 grep words.

## D-003: buildStoredChain test fixture shape  (Iteration 1)

- **Context**: the plan names `buildStoredChain(opts)` but not its options or seat names.
- **Decision**: `opts = { maxCommits?, seed? ('replay-seed'), gameId? (GAME_ID), presetId? (DEFAULT_PRESET_ID) }`. Seats via `chainSeats()` follow FR-703 (`human-0`, `ai-<i>`/`AI <i>`, `random`) with the human named `'Ana'`. Later commits use `actorSeat 0`, `clientRequestId 'req-<n>'`, `at = CREATED_AT + n min`. The meta and every commit are the `GameMetaSchema`/`CommitSchema`-parsed copies (the shape `load` returns).
- **Rejected**: returning unparsed bodies (would not prove the stored shape).
- **Consequences**: test-only; no effect on the service API.

## D-004: Randomness and encodings per P-2  (Iteration 2)

- **Context**: FR-702 fixes the formats; P-2 fixes draw order and encoders.
- **Decision**: `#randomBytes` is drawn 16 (gameId), 32 (seed), 32 (seat token), in that order. `gameId = base32Lower(bytes)` (module-private, RFC 4648 lowercase alphabet, no padding, trailing bits zero-filled; `0x00…0x0f` → `aaaqeayeaudaocajbifqydiob4`). `seed = Buffer.from(bytes).toString('hex')`, `seatToken = …toString('base64url')`, hash `createHash('sha256').update(token, 'utf8').digest('hex')`. One named import line `import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'`; the default is `(n) => randomBytes(n)`.
- **Rejected**: a base32 package (NFR-703); keying the script on `n` (call order is simpler and the lengths are still checked by `scriptedBytes`).
- **Consequences**: tests script ids with `scriptedBytes([id16, seed32, token32])`.

## D-005: Constant-time authentication per P-3  (Iteration 2)

- **Context**: FR-708 requires comparing every non-null hash whatever the outcome.
- **Decision**: `#authenticate` computes the 32-byte digest once, loops over all `seatTokenHashes` with a `for` loop, calls `timingSafeEqual(digest, Buffer.from(hash, 'hex'))` for each non-null hash, records the first match and never exits early. No match → `Unauthorized`. Auth runs before the engine-version check (FR-709).
- **Rejected**: `Array.find`/early `break` (leaks the matching index through timing; P-3).
- **Consequences**: VC-710 counts 2 `timingSafeEqual` calls for a 2-human meta on both match and mismatch.

## D-006: createGame input checks per P-4, plus two edge cases  (Iteration 2)

- **Context**: FR-701 lists the checks; P-4 fixes how; two edges were open.
- **Decision**: `typeof` before `.length`; `humanName.trim()` 1–40 UTF-16 units (trimmed value is the seat name); `Number.isInteger` for `aiCount` 2–5; `getPreset` from `@/src/domain/presets`. Own choices: a present non-string `rulesPreset` → `InvalidRequest('rulesPreset')` without calling `getPreset`; when `rulesPreset` is absent, the configured default is resolved with `getPreset` and an `UnknownPresetError` there (a server misconfiguration, typed out by `PresetId`) propagates unmapped, since FR-701 maps only a *present* `rulesPreset`. `meta.presetId` is the requested/default id string (validated by `getPreset`).
- **Rejected**: mapping the default's failure to `InvalidRequest` (blames the caller for server config).
- **Consequences**: VC-708 `createGame` order tests also cover `rulesPreset: 7`.

## D-007: Missed events per P-5  (Iteration 2)

- **Context**: FR-716; `eventsSince` would re-probe the tip and could end past `update.version`.
- **Decision**: `#missedEvents(gameId, from, tip)` returns `[]` when `from ≥ tip.version`, else `state.load`s `from+1 … tip.version−1` through a module-private copy of Phase 6's `mapLimit` (limit 8) and appends `tip.events`. `getUpdate` calls it only when `sinceVersion` is given.
- **Rejected**: `state.eventsSince` (P-5).
- **Consequences**: a commit landing after `loadLatest` never leaks into the events (VC-712 race test); counts are 6 + 2·(t − v − 1).

## D-008: Update builder per P-6  (Iteration 2)

- **Context**: FR-716; every returned update must come from `buildPlayerView` and `legalMoves`.
- **Decision**: `#update(commit, seat, events)` builds `{ version: commit.version, events, view: buildPlayerView(commit.state, seat), legalMoves: legalMoves(commit.state, seat) }`. `createGame` builds its update from the commit returned by `state.create` (the schema-parsed copy).
- **Rejected**: building from the in-memory loop state (equal content, but the parsed copy is what later reads return).
- **Consequences**: Iteration 3 uses `#update` for success, retry and `VersionConflict.update`.

## D-009: State-error mapping per P-7; non-string gameId  (Iteration 2)

- **Context**: P-7 lists the only translated errors; FR-706 step 1 maps a malformed id to `GameNotFound`.
- **Decision**: `#loadAndAuthenticate` maps only state `GameNotFoundError` (from `loadMeta`/`loadLatest`) to `GameNotFound(gameId)`; everything else propagates. `#validateIdAndToken` maps `InvalidGameIdError` from `assertValidGameId` to `GameNotFound`; a non-string id (only possible from untyped callers) is passed as `String(gameId)` so the error constructor's `.slice` cannot throw.
- **Rejected**: mapping `CorruptObjectError` or other storage errors (P-7: propagate).
- **Consequences**: Iteration 3 adds the `CommitConflictError`/`CommitNotFoundError`/`IllegalMoveError` mappings inside `submitMove` only.

## D-010: Test support per P-10, GatedStore semantics  (Iteration 2)

- **Context**: P-10 names the helpers but not every behaviour of `GatedStore`.
- **Decision**: `makeService<S>(store?, overrides?)` defaults to `RecordingStore(new MemoryObjectStore())`, `now = () => FIXED_NOW`, real randomness. `scriptedBytes(seq)` returns entries by call order and throws on exhaustion or a length mismatch; `byteRange(start, n)` added. `GatedStore` starts closed; `release()` resumes held calls and opens the gate for good; `barrierOnCommitPut(n)` opens the gate and holds only create-only puts whose key contains `/commits/` until `n` are held, then resumes them together once; `whenPending(n)`/`settle()` wait on `setImmediate` turns. `RecordingStore` is imported from `tests/unit/state/support/`, not copied.
- **Rejected**: a `release()` that resumes one call at a time (the 4-pending check only needs the first round, then the rest must run).
- **Consequences**: VC-729 for `submitMove`: `whenPending(4)`, `settle()`, assert `pending === 4`, `release()`.

## D-011: Module mocks per P-11  (Iteration 2)

- **Context**: `vi.mock` is hoisted per file; ESM namespaces cannot be spied.
- **Decision**: one mocked module per file with a partial mock that delegates (`vi.fn(actual.fn)`), accessed through `vi.mocked(ns.fn)` on a namespace import of the same specifier. `create-preset-mock.test.ts` mocks `@/src/domain/presets`; `auth-crypto.test.ts` mocks `node:crypto` (it intercepts `game-service.ts`'s named imports).
- **Rejected**: `vi.spyOn` on namespaces (spec VC preamble).
- **Consequences**: Iteration 3's `ai-loop-mock.test.ts` mocks `@/src/service/ai-loop` the same way.

## D-012: submitMove stub shape  (Iteration 2)

- **Context**: the plan wants `submitMove` declared with a `throw new Error('not implemented')` body; `@typescript-eslint/no-unused-vars` rejects unused parameters.
- **Decision**: `async submitMove(gameId, seatToken, req)` with `void gameId; void seatToken; void req;` before the throw (so it rejects rather than throwing synchronously).
- **Rejected**: an `eslint-disable` comment; underscore-prefixed names (not ignored by the config).
- **Consequences**: Iteration 3 replaces the whole body; the `void` lines go away.
