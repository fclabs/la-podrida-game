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
