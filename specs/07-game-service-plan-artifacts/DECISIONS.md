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
