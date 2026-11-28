# Review ledger — specs/12-data-generation.md

Original: 298 lines. After pass 1 fixes: see the end of this file.

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 1 | MUST | VC-1211 | Trump counted twice when `trump_in_dealer_hand` (verified in `engine.ts:144-145`) | fixed | VC-1211 states the exception |
| R-002 | 1 | MUST | FR-1207, BR-1202 | `cards_played_this_hand` and `trick_number` are not in `PlayerView` | fixed | FR-1207 and BR-1202 say the recorder builds them from observed public events |
| R-003 | 1 | MUST | FR-1218 | "does not read" contradicts the SHA-256 check | fixed | Wording: does not rewrite or rename; reads only for size and SHA-256 |
| R-004 | 1 | MUST | FR-1219, VC-1241 | Omitted options on resume; `<name>` token undefined | decided | Operator: omitted options compared as defaults. `<name>` = option name without dashes or manifest field |
| R-005 | 1 | MUST | VC-1221–1226, VC-1229 | Stubs cannot reach `worker_threads` workers | decided | Operator: env-var hook module (`GENERATE_DATA_TEST_HOOKS`); BR-1211, "Test hooks", VCs rewritten, VC-1247 and VC-1253 added |
| R-006 | 1 | SHOULD | FR-1206, FR-1209 | A wrapper cannot see `prev` state | fixed | Row completed in `onTransition`; players built with `createAiPlayer` |
| R-007 | 1 | SHOULD | `hidden_stock_left` | "deck order" ambiguous | fixed | `buildDeck(rules.deck, n_players)` order |
| R-008 | 1 | SHOULD | VC coverage | Missing VCs for FR-1207 columns, FR-1212.2/.4, AiLoopLimitError, version mismatch, file names, BR-1206, BR-1208, NFR-1204 | fixed | VC-1223, 1241, 1247–1253 |
| R-009 | 1 | SHOULD | FR-1221, VC-1236 | No FR for `validate` on a missing run | fixed | Added to FR-1221 |
| R-010 | 1 | SHOULD | FR-1217 | Does a shard stop at its first failure? | fixed | Yes; FR-1217 and VC-1247 |
| R-011 | 1 | SHOULD | BR-1204, VC intro | Test folder undefined; `tests/sim` is not run by `pnpm test` | fixed | `tests/unit/datagen/`, 120 s timeout for spawn tests |
| R-012 | 1 | SHOULD | A-2 | Open-ended "goes back to the user" | fixed | Fallback loader named (`execArgv --import tsx`); failure halts per gate 3 |
| R-013 | 1 | SHOULD | NFR-1203, A-6, VC-1230 | 8 GB ceiling is a placeholder; no projection check | fixed | VC-1230 projects size and halts the full run on a breach |
| R-014 | 1 | SHOULD | Data & Interfaces | gzip level, SHA-256 library, JSONL rationale unstated | fixed | "Format choices" section |
| R-015 | 1 | COULD | NFR-1201, FR-1203 | Measured quantity; `os.availableParallelism()` | fixed | Named in both (cheap clarification) |
| R-016 | 1 | SHOULD | FR-1224 | Priority S but gated by VC-1230 | fixed | Now M |
| R-017 | 1 | SHOULD | FR-1221.7 | Replay check duplicated in `validate` | wontfix | Proposal §7 lists replay under validation; validate must be able to re-check a dataset it did not generate |
| R-018 | 1 | SHOULD | FR-1218 | Re-hashing all complete shards on resume | wontfix | Needed to catch same-size corruption; cost is NFR-1205's file check |
| R-019 | 1 | SHOULD | `--strategies` | Pluggable strategies with one registry entry | wontfix | Operator chose config-driven seats in discovery |
| R-020 | 1 | SHOULD | Scope In | Generality of presets and player counts | wontfix | Operator chose "any preset and player count" in discovery |
| R-021 | 1 | SHOULD | NFR-1202/1203, VC-1230/1245 | Hardware-dependent acceptance | wontfix | Same pattern as spec 04's local long sweep recorded in the PR; thresholds are explicit |
| R-022 | 1 | SHOULD | A-2, A-6, "Open Questions: None" | Deferred decisions | fixed | See R-012 and R-013 |
| R-023 | 1 | COULD | BR-1209 | Guards an out-of-scope harness | deferred | Cheap, grounded in proposal §9; kept |
| R-024 | 1 | COULD | VC list / manifest git fields | 46+ VCs; provenance fields unused | deferred | |
| R-025 | 1 | COULD | FR-1202 | Error precedence when several problems exist | deferred | |
| R-026 | 1 | COULD | VC-1246 | Tolerance formula | fixed | Replaced by the `skipped` counter |
| R-027 | 2 | MUST | VC-1252 | `onShard` hook cannot observe the `.tmp` file before the last game (start-phase wait would deadlock) | fixed | VC-1252 polls the `.tmp` file from the test process while a `runAiLoop` hook blocks the last game |
| R-028 | 2 | SHOULD | FR-1221 | Default `--out` for `validate` not stated | deferred | Delta pass; not a blocker (same default as `run`) |
| R-029 | 2 | SHOULD | VC-1230 | "repeated with `--workers 1`" would resume under the same run id | deferred | Delta pass |
| R-030 | 2 | SHOULD | BR-1204 | Parenthetical lists test folders; reviewer claimed `retention` is included | fixed | Reviewer was right: `retention` is now in the vitest include (repo moved on during the session; my earlier rejection used a stale read). BR-1204 no longer lists the folders
| R-031 | 2 | SHOULD | BR-1211 | "manifest identical" ignores timestamps and git fields | deferred | VC-1253 already compares the dataset only |
| R-032 | 2 | SHOULD | VC-1224 | Which hook counts replays | deferred | |
| R-033 | 2 | COULD | Test hooks | Hook output leaves workers via files | deferred | |
| R-034 | 2 | COULD | FR-1219 | Comparison order wording | deferred | |
| R-035 | 3 | MUST | VC-1252, NFR-1204 | A synchronous hook block starves async stream writers, so the VC forces a flush-per-game design the spec never chose | fixed | Deleted: NFR-1204 withdrawn and turned into a design note; VC-1252 withdrawn. Throughput and size stay bounded by NFR-1202/1203 |
| R-036 | 3 | MUST | FR-1214, VC-1252 | `.tmp` file name undefined | fixed | FR-1214: `<final file name>.tmp` in the same directory |
| R-037 | 3 | SHOULD | Test hooks / VC-1224 | Hook cannot tell which game it is playing; whether replays pass through the `runAiLoop` hook | deferred | Delta pass (same family as R-032) |
| R-038 | 4 | SHOULD | FR-1215 | Manifest temp file not named | deferred | Delta pass 4 |
| R-039 | 5 | MUST | FR-1217, VC-1221/1225/1226 | A failed shard's `.tmp` files may remain while VCs assert no `shard-00001.*` file exists | fixed | FR-1217: the main thread deletes all files of a failed shard (final and `.tmp`) after its worker stops, before recording `failed` |
| R-040 | 5 | SHOULD | FR-1217 | "worker has stopped" unclear when a failed game leaves the worker alive | deferred | Final delta; both readings pass every VC |
| R-041 | 5 | SHOULD | FR-1217 | Deleting a failed shard's files can itself fail | deferred | Final delta; edge case |

## Outcome

Verdict: READY (last delta pass returned no MUST; the readiness pass found one MUST, R-039, fixed and delta-verified; no further full-spec readiness pass was run, per the loop rules).
Passes: 1 discovery (3 reviewers), 3 delta, 1 readiness. Verified MUSTs per pass: 5, 1, 2, 0, 1 (readiness), 0 (final delta).
Size: 298 lines originally, 328 lines final (+10%).
