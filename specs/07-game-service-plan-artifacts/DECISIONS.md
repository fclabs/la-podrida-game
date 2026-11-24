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

## D-013: submitMove flow per P-8  (Iteration 3)

- **Context**: FR-712–FR-722 and P-8 fix the order; the Iteration 2 helpers must be reused.
- **Decision**: `submitMove` = `#validateIdAndToken` → `#validateSubmit` (FR-713; `typeof` before `.length`, `isIntInRange` for `version`, `isStringOfLength` in UTF-16 units) → `#loadAndAuthenticate` → retry check (FR-714) or `#applyHumanMove` (FR-715) → `runAiLoop` on `createPlayers(human.state.seats)` → commit body with `state = { ...loop.state, version }` → `state.commit` → `#resolveRace` on `CommitConflictError` → `writeFinalScores` at `game-over` → `#update(committed, …)`. The match test is a module function `isSameRequest(commit, seat, clientRequestId)` shared by FR-714 and FR-719. The stale-path `load(req.version + 1)` is not reused by `#missedEvents`; its errors propagate (P-7 does not map them).
- **Rejected**: a separate retry helper duplicating `#update`/`#missedEvents`; reusing the retry-check load (breaks NFR-702).
- **Consequences**: success = 8 calls (+1 at game over); stale 409 = 8 + 2·(t − v − 1); updates come only from `#update`.

## D-014: Race resolution per P-7 and FR-719  (Iteration 3)

- **Context**: FR-719 re-reads commit `v + 1` after `CommitConflictError`, then `loadLatest`; P-7 maps `GameNotFoundError` "from `loadMeta`/`loadLatest`" and `CommitNotFoundError` from this re-read.
- **Decision**: `#resolveRace` treats `CommitNotFoundError` from `load(v + 1)` as no match (other errors propagate), returns the winner's update with its events on a match (no `final.json` write, FR-721), and otherwise calls `loadLatest`, mapping its state `GameNotFoundError` to `GameNotFound(gameId)` as P-7 states for `loadLatest`, then throws `VersionConflict` with the missed events from `req.version`.
- **Rejected**: letting the race-path `GameNotFoundError` escape as a state error (P-7 names `loadLatest` without restricting it to the first load).
- **Consequences**: a game deleted mid-race answers 404 rather than 500; the update's version is ≥ `v + 1` whenever commit `v + 1` exists (probe from a stale head).

## D-015: Shared test helpers beyond `playToEnd`  (Iteration 3)

- **Context**: VC-716 (`NotYourTurn`) and VC-719 need games `createGame` cannot build (an AI to act at the tip; two human seats), in both `submit.test.ts` and `secrets.test.ts`.
- **Decision**: `service-fixtures.ts` (listed in Touches) also gets `sha256Hex(text)` and `storeHandmadeGame(state, { gameId, seats, tokens, seed, runLoop? })`, which writes meta + commit 0 with `GameStateManager.create` (default preset, `FIXED_NOW`). `playToEnd` uses `clientRequestId` `play-<n>` (n = the commit version it creates).
- **Rejected**: copying the `twoHumanGame` recipe into each test file (two copies); a new support file (not in Touches).
- **Consequences**: test-only; `auth-crypto.test.ts` keeps its own local copy (Iteration 2 file, not edited).

## D-016: How VC-725 detects cards and serializes errors  (Iteration 3)

- **Context**: VC-725 asks for "no card of another seat's hand" in updates and "cards only in `card-played.card` and `hand-dealt.trumpCard`" in events; R-033 asks for the error JSON `{ name, message, ...ownFields }`.
- **Decision**: a card is any object whose keys are exactly `rank` and `suit` (the strict `CardSchema` shape), found by a recursive walk that records the property path. Errors serialize as `{ ...err, name, message }` (own fields first so TypeScript accepts the override). The test also asserts that cards were found (non-vacuous) and that the seat token appears only in `createGame` results.
- **Rejected**: string-matching card ids in the JSON (ids like `"QH"` could collide with other text).
- **Consequences**: test-only.

## D-017: Documentation choices for the shipped service  (Iteration 4)

- **Context**: FR-725 and Iteration 4 ask for docs organised by reader need; three points were open: how to show the Phase 8 status mapping without deciding it, what to do with `implementation.md` Phase 8's "`?since` ahead → 400" (it contradicts FR-711's `[]`), and how to run the doc examples "verbatim".
- **Decision**: `development.md` §15.7 gives the mapping as "intended" plus a compiled sketch (`toHttpStatus`) in which `GameUnsupported` → 410 `game_unsupported` is labelled a proposal; `architecture.md` §7's table is left for Phase 8 (§10 says the row is not there yet). Phase 8's `since` line is left untouched (Phase 7 lines only) and flagged in `CONTEXT.md` hand-off. The temporary `doc-example.test.ts` lifts and dedupes the examples' imports, pastes each example body verbatim into `it` blocks (the mock example's `vi.mock` part at module level), and adds assertions for the examples' comments.
- **Rejected**: adding a `GameUnsupported` row to `architecture.md` §7 (decides Phase 8's status); rewriting Phase 8's `since` rule (out of Touches' "Phase 7 only").
- **Consequences**: Phase 8 must choose the `GameUnsupported` status and the `since > tip` behaviour.
