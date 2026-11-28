# DECISIONS

## D-001: CLI-spawn test helper runs `node --import tsx` (Iteration 1)
Context: tests must run the CLI as a real process (and later kill it, set env vars).
Decision: `runCli` spawns `process.execPath` with `--import tsx scripts/generate-data.ts`, from the repo root, using `child_process.spawn` and collecting stdout/stderr as strings; returns `{ code, stdout, stderr }`.
Rejected: `pnpm generate-data` (slow, pnpm warnings on stderr, harder to SIGKILL the real process); `tsx` binary (adds a wrapper process, so killing it may not kill the node child).
Consequences: the child PID is the node process itself, so later kill tests can SIGKILL it directly; stderr is exactly the CLI's.

## D-002: `UsageError` carries the message without the prefix (Iteration 1)
Context: FR-1202 requires one stderr line `generate-data: <problem>`.
Decision: `UsageError.message` is the problem text only; `scripts/generate-data.ts` adds the `generate-data: ` prefix and newline. Same shape as `simulate.ts`. `parseArgs` errors keep their first line only. Parsers take argv after the subcommand and return plain objects (`RunOptions`, `ValidateOptions`, snake_case fields).
Rejected: putting the prefix in the error (would double when wrapped later).
Consequences: later iterations (resume guard, validate) can throw/print their own lines with the same prefix convention.

## D-003: Parsers have no I/O (Iteration 1)
Decision: `parseRunArgs` reads only `os.availableParallelism()`; it never touches `--out`, so a usage error cannot create files.
Consequences: directory checks (FR-1220) belong to `run`, after parsing.

## D-004: Pending vs complete rows are two schemas (Iteration 2)
Context: the pipeline must not be able to flush a row without outcome labels.
Decision: `PendingDecisionRowSchema` has the 24 non-outcome columns; `OutcomeColumnsSchema` has the 7 labels; `DecisionRowSchema = Pending.extend(Outcome.shape)` (still strict, pending keys first). Types `PendingDecisionRow` / `DecisionRow`; the recorder returns only `PendingDecisionRow`. `policy_probs` is `z.null()`, `explore` is `z.literal(false)`.
Rejected: one schema with nullable outcome columns (an unlabeled row would type-check as complete).
Consequences: Iteration 3 maps `PendingDecisionRow` + `OutcomeColumns` to `DecisionRow`; flush APIs accept `DecisionRow` only.

## D-005: Trick state is tracked from events inside the recorder (Iteration 2)
Context: the view has no `cards_played_this_hand` or `trick_number` (FR-1207).
Decision: `createRecorder(initialState)` keeps `playedIds` and `trickNumber`; in `onTransition` the row is built from the current tracking first, then the transition's events update it (`hand-dealt` resets, `card-played` appends the id, `trick-won` increments). Hand 0 starts empty because the recorder is created from the initial state.
Rejected: deriving from `prev` (`lastTrick`/`completedHands` cannot give the cards of earlier tricks); recomputing hidden columns from the view (oracle must come from `prev`).
Consequences: one recorder per game; the recorder must see every transition of its game.

## D-006: `hidden_stock_left` uses remaining hands plus played cards (Iteration 2)
Decision: dealt set = cards still in `prev.hand.hands` + the recorder's played ids + the trump card; stock = `buildDeck` order minus that set. This covers the trump-in-dealer-hand case with no special branch.
Consequences: lengths match VC-1212 (deck - n*cards_dealt - 1, or without -1 when the trump is in the dealer's hand).

## D-007: Per-game hooks are plain function arguments; replay compares event-derived move ids (Iteration 3)
Context: the spec's hooks are `(real) => fn` factories loaded from a module, but this iteration has no loading.
Decision: `playRecordedGame` takes `runAiLoop`, `replayRunAiLoop`, `transformRows` as ready functions (I-4: the first only for the game's own play). The replay is unrecorded and its moves are rebuilt from `bid-made`/`card-played` events of the replay result, so any injected loop is observable.
Rejected: collecting moves through `onTransition` in the replay (an injected loop may ignore it).
Consequences: Iteration 6 wraps the loaded hook module `(real) => fn` into these arguments. Compare order: moves by step first, then final totals.

## D-008: Check 1 runs before labeling; labeling errors become `GameFailure` (Iteration 3)
Decision: a non-`game-over` result fails check 1 immediately (labels need a finished game); `buildTables` errors (inconsistent events/rows) are wrapped as `GameFailure("labels: ...")`. Checks 2-5 run after `transformRows` against `evaluate(final state)`; check 2 compares the `hands` row count only, check 5 looks rows up by `hand_index`.
Rejected: letting label errors escape as plain `Error` (the shard processor would lack the seed).
Consequences: `GameFailure` is the only per-game failure type apart from errors thrown by the loop itself.

## D-009: `hands` deal columns come from `hand-dealt` events (Iteration 3)
Decision: `trump_card`, `dealer`, `trump_in_dealer_hand`, `cards_dealt` are taken from the `hand-dealt` events (hand 0 from the initial state, since `createGame`'s events are not in the loop result); scoring columns from `evaluate(final).hands`. `final_place_by_seat[seat]` = the ranking entry's place (competition numbering).
Rejected: reading the recorder rows (hands with no decisions cannot exist, but the hands table must not depend on rows).
Consequences: a hands row exists for each scored hand even if `decisions` are dropped by a hook.

## D-010: Manifest shard entries are a discriminated union; file paths are relative (Iteration 4)
Context: the spec table lists fields per status; `path` in a manifest should survive moving the run directory.
Decision: `ShardEntrySchema` is a `z.discriminatedUnion('status', ...)` of strict objects (pending: shard, games; complete: + git_commit, git_dirty, completed_at, files; failed: + error). `files.*.path` is relative to the run directory (`shards/shard-00000.games.jsonl.gz`); timestamps are `z.iso.datetime()`.
Rejected: one object with optional fields (allows nonsense combinations); absolute paths (break when the dataset is moved).
Consequences: resume/validate resolve a file as `path.join(runDir, entry.path)`.

## D-011: Sink writes through gzip into `<path>.tmp`; hashing reads the stored file back (Iteration 4)
Decision: `createJsonlGzipSink` pipes a `zlib` gzip (default level) into a write stream on `<final>.tmp`; `append` honors backpressure (races `drain` against the pipeline's failure); `finish()` ends the stream, SHA-256s the stored file by streaming it back, stats it, then renames. `abort()` closes without renaming or deleting. `rows` counts appended objects.
Rejected: hashing in a tee transform (more moving parts, same result); buffering rows in memory.
Consequences: one extra sequential read of each file per shard; gzip output is deterministic for one Node/zlib (A-3).

## D-012: `processShard` takes `ShardParams` and a `ShardStamp`; returns the manifest entry itself (Iteration 4)
Context: the plan's signature `{ params, shard, runDir, hooks }` lacks the run id (not in the manifest `params`) and the caller-supplied git fields.
Decision: `params` is `Pick<RunOptions, 'run_id'|'preset'|'games'|'shard_size'|'strategies'|'replay_every'>`; an extra `stamp: { git_commit, git_dirty, now }` carries the caller's git info and a clock (`now()` called once, after the renames, for `completed_at`). `hooks` is optional plain functions (D-007). The result is the `complete` `ShardEntry` or `{ status: 'failed', seed, message }`.
Rejected: passing `completed_at` as a string (would be the shard's start time); reading git inside the shard (the main thread computes it once, Iteration 5).
Consequences: Iteration 5's worker message carries the params and stamp fields; the main thread maps a failure to `{ status: 'failed', error: { seed, message } }`.

## D-013: Only `GameFailure` becomes a failure result in Iteration 4 (Iteration 4)
Decision: following the plan scope ("on a `GameFailure`"), `processShard` returns a failure only for `GameFailure`; other errors abort the sinks and propagate unchanged. Iteration 6 widens it (seed from `gameSeed`).
Consequences: no `.tmp` cleanup yet in either case.

## D-014: Pool = long-lived workers fed from one shared queue (Iteration 5)
Context: FR-1216 wants at most W workers, each taking the next unprocessed shard; a shard by exactly one worker.
Decision: `executeRun` starts `min(workers, shards)` workers once (`startWorker(worker.ts)`). The main thread owns a queue of shard numbers; each worker slot posts a `ShardRequest` for `queue.shift()` and, when the worker answers, records the result in the manifest and posts the next one, until the queue is empty. Workers are reused for many shards and terminated in `finally`. The unit of work is one message per shard, so no shard can be taken twice.
Rejected: one worker per shard (start-up cost of tsx per shard); workers pulling from a shared array (needs SharedArrayBuffer/locks).
Consequences: shard order of completion varies with workers, but the dataset does not (rows depend only on the seed).

## D-015: Message protocol and manifest ownership (Iteration 5)
Decision: types live in worker-host.ts. `ShardRequest {kind:'shard', params, shard, runDir, git_commit, git_dirty}` -> `ShardResponse {kind:'shard-result', shard, result}` or `ShardErrorResponse {kind:'shard-error', shard, message}`. The worker builds the clock itself. The main thread maps a `{status:'failed',seed,message}` result to the manifest entry `{shard,games,status:'failed',error:{seed,message}}`; `record()` replaces the entry and chains an atomic rewrite (serialised). worker.ts never imports or mentions the manifest.
Rejected: worker writing results to disk itself (BR-1206); passing `now` (functions are not cloneable).
Consequences: Iteration 6 extends `shard-error` into a failure with `seed` (via `gameSeed`) and handles worker exit.

## D-016: Interim failure behaviour (Iteration 5)
Decision: failed shards (GameFailure) are recorded and the run exits 1 after the summary; a `shard-error`, worker `error` or unexpected `exit` rejects `executeRun` (uncaught -> nonzero exit, no summary). No file cleanup. Both are replaced by FR-1217 handling in Iteration 6.
Consequences: nothing in this iteration depends on it; no test exercises it.

## D-017: `run` test must not use the default `--out` (Iteration 5)
Decision: the old args.test "valid run hits the stub" was removed (it would now run 1000 games into `.data/datasets`); CLI run tests always pass `--out <makeTempDir()>`.

## D-018: Any failed shard terminates its worker, is cleaned up, then recorded; the worker is replaced (Iteration 6)
Context: FR-1217 + I-6 want the files deleted only once the worker has stopped, whatever the failure.
Decision: for a failed game result, `shard-error`, worker `error` or worker `exit`, the slot calls `worker.terminate()` (resolves when the worker is gone), then `cleanupShardFiles(runDir, shard)`, then `record(failed)`, and spawns a replacement worker on its next shard. A game failure also costs a worker restart (tsx start-up, ~0.3 s).
Rejected: keeping a worker alive after posting a failure (needs a "done writing" proof beyond I-6's wording); worker calling `process.exit` itself.
Consequences: pool size is kept; `executeRun` only rejects on manifest-write errors.

## D-019: Any error thrown by a game is a game failure with `gameSeed` (Iteration 6)
Decision: `processShard` wraps only the `playRecordedGame` call: whatever it throws (GameFailure, AiLoopLimitError, IllegalMoveError, a hook's error) yields `{status:'failed', seed: gameSeed(run_id, shard, index), message: error.message}` and stops the shard. Errors from the sinks/disk still reject (`shard-error`, seed null). Supersedes D-013.
Consequences: shard.test's "other errors propagate" test became "any error thrown by a game fails the shard".

## D-020: Hook loading and `onShard` timing (Iteration 6)
Decision: `hooks.ts` `loadHooks(env)` imports `pathToFileURL(resolve(path))`, takes the default export, and calls `runAiLoop(real)` / `replayRunAiLoop(real)` once to get the plain functions of D-007. The worker starts the load at module start and each shard awaits it. `onShard('start')` runs before `processShard`; `'end'` only for a shard that completed (after the renames); a failed shard gets no `end`. An empty variable counts as unset.
Rejected: calling `end` for failed shards too (spec says "end after the renames"); loading hooks in the main thread.
Consequences: a throwing `onShard` or a hook-load error is a `shard-error` (seed null).

## D-021: Test fixtures are one env-configured module (Iteration 6)
Decision: `fixtures/hooks-configurable.ts` exports all four hooks and is inert unless the test sets its `HOOK_*` env vars (documented in CONTEXT.md); `hooks-empty.ts` exports `{}`. Tests identify games by `state.seed` (I-4).
Consequences: later tests (resume, validate) reuse these to create failed shards.

## D-022: Validate checks 1-2 over the manifest, checks 3-7 shard by shard (Iteration 7)
Context: FR-1221 lists seven checks "in order"; running each over the whole dataset would gunzip every file up to seven times.
Decision: check 1, then check 2 for all complete shards (hash + row count), then for each shard one streaming pass that applies checks 3-6 (failures collected per check number, the lowest one reported at the end of the shard) and finally the replays (7) of that shard.
Rejected: one full pass per check (cost x5); stopping at the first failure of any check inside a shard (could hide a lower-numbered one).
Consequences: across shards the reported failure is the first failing shard's lowest check.

## D-023: Replay code shared through `replayAgainst`; hands check by consistency (Iteration 7)
Decision: `game.ts` exports `replayAgainst` (seats from `strategy_by_seat`, recorded move ids + totals); `playRecordedGame`'s replay now calls it with identical messages. Plan files touched beyond the scope list: `game.ts` (export only, behaviour unchanged). Rejected: duplicating the replay loop.
Note: the first version of check 6 used a consistency proxy for FR-1212 check 5; superseded by D-026.

## D-024: Validate stderr wording and exit rules (Iteration 7)
Decision: a failed check prints one line `generate-data: validate: check N (<name>): <detail>` (names in `CHECK_NAMES`); no report on stdout. INCOMPLETE (pending/failed shards present, complete shards pass) prints the report and exits 1; failure inside the complete shards of such a run prints the check line only. Exact texts are in CONTEXT.md.
Consequences: Iteration 8 and the docs can quote these lines.

## D-025: Report accumulator streams, `oneDecimal` duplicated (Iteration 7)
Decision: `report.ts` holds `createReportAccumulator` (fed per game/hand, keeps counters only) and `formatReport(runId, status, stats)`, with its own `oneDecimal`; `run.ts` keeps its identical copy to avoid touching the run module. With no complete shards the report prints zeros and empty seat/strategy lists.

## D-026: Check 6 re-scores every hand with `scoreHand` (Iteration 7, gate fix)
Context: FR-1221.6 uses FR-1212 check 5, i.e. bid/tricks/made/points must equal the score engine's, so a self-consistent tampering must be caught.
Decision: per `hands` row validate calls `scoreHand(getPreset(game.preset), { handIndex, cardsPerPlayer: cards_dealt, dealer, trumpSuit: trump_card.slice(-1), bids, tricks })` (only bids, tricks, cardsPerPlayer and scoring are read) and compares bid, tricks, made, points per seat; a RangeError is reported as check 6 `cannot be scored`. Also kept: tricks sum == cards_dealt, decision `hand_*`/`final_*` vs their rows, Σ points == `final_total_by_seat`. The `made == (bid == tricks)` proxy was removed (scoreHand covers it).
Rejected: rebuilding a GameState for `evaluate`.

## D-027: The guard throws `UsageError` from `executeRun`; `generate-data.ts` unchanged (Iteration 8)
Context: FR-1219/1220 need one stderr line, exit 1, nothing on disk changed. `executeRun` only had stdout (`write`).
Decision: `openRun` (run.ts) does the guard first, before any mkdir/delete/write, and throws `UsageError`; `main` already prints `generate-data: <message>` and returns 1. Messages: `run directory "<join(--out, id)>" exists without a manifest` (path as given, like validate's `no run` line) and `run "<id>" has a different <name>`. Comparison uses the parsed `RunOptions` (defaults already applied) in the order preset, players, games, shard-size, strategies (joined names), replay-every, schema_version, generator_version (I-7).
Rejected: a new `writeError` dep (touches the entry wiring); resolving the path in the message.
Consequences: an invalid-but-present manifest.json is not handled (ZodError/SyntaxError crash, see Known gaps).

## D-028: Resume resets non-valid shards to `pending` and rewrites the manifest before work (Iteration 8)
Decision: with a matching manifest, `removeTmpFiles` runs first (every `*.tmp` file under the run dir, recursive; directories untouched). Each `complete` entry is checked with `stat` size and a streamed SHA-256 for its three files (path = runDir + `files.*.path`); a mismatch, missing file or read error means re-run. Every non-skipped entry becomes `{shard, games, status:'pending'}` (stale error/files/completed_at gone), the manifest keeps its `created_at`, is written atomically, then the pool runs the queue. `skipped` = the shards left untouched; the summary's rows/size come from the manifest's complete entries.
Rejected: deleting an invalid shard's old files up front (the re-run renames over them; failure cleanup deletes them); skipping the manifest rewrite when nothing changed.
Consequences: a resume with all shards valid rewrites only `manifest.json` (same content).

## D-029: Kill-test helpers in `helpers.ts` (Iteration 8)
Decision: `spawnCli` (child handle + `closed` promise), `waitForManifest` (poll every 20 ms with a timeout, no fixed sleeps) and `tryReadManifest` live next to `runCli`, reusable by Iterations 9-10. The kill happens only after the manifest shows >=3 complete shards; the manifest read after `closed` is the truth for what was complete.
Rejected: a hook that slows shards (a 200-game run takes ~9 s on 2 workers, ample margin).
Consequences: the `strategies` guard difference cannot be made through the CLI alone (only `random` exists), so tests edit the manifest.

## No new decisions (Iteration 9)
Iteration 9 only measured and checked; no source change, no interpretation chosen. The 3-player runs (default preset minimum) are the NFR-1201 comparison; the 5-player run is the size projection (NFR-1203), as the scope prescribes.

## No new decisions (Iteration 10)
Iteration 10 only ran the full dataset and the kill/resume proof; no source change and no interpretation chosen. The kill used SIGKILL on the whole `pnpm` process tree (workers are threads, so no stray processes) once the manifest showed 40 complete shards.

## No new decisions (Iteration 11)
Iteration 11 only wrote documentation. Two wording choices, neither a design decision: the docs state the unparsable-manifest crash as a limitation (Known gaps), and the proposal's code tree (§5) now shows the shipped `scripts/datagen/` layout instead of `src/datagen/`.
