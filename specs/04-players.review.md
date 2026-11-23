# Review ledger — 04-players.md

Original line count: 182 · After pass 1: 183 · After pass 2: 183 (no edits) · Readiness (pass 3): READY, 0 MUST

| ID | Pass | Sev | Location | Finding (one line) | Status | Resolution |
|----|------|-----|----------|--------------------|--------|------------|
| R-001 | 0 | DECISION | FR-400 | Player model: classes (design §8.1) or plain objects | decided | Operator: plain objects and factories; design §8 updated |
| R-002 | 0 | DECISION | FR-411 | AI loop safety cap behaviour | decided | Operator: throw `AiLoopLimitError` (moves, state) |
| R-003 | 0 | DECISION | FR-404 | AI seat without a strategy name | decided | Operator: defaults to `random`; unknown non-empty name throws |
| R-004 | 0 | DECISION | NFR-404 | Where the ≥ 2,000-seed run happens | decided | Operator: local run recorded in the PR; no nightly workflow |
| R-005 | 1 | MUST | FR-400/VC-401 | "No classes" contradicts `UnknownStrategyError` export | fixed | `Error` subclasses allowed; grep excludes `extends Error` |
| R-006 | 1 | MUST | VC-414 | "five labelled lines" vs four-line sample | fixed | Four lines of the sample |
| R-007 | 1 | SHOULD | VC-412/Scope | Ledger home ambiguous (`tests/unit/service` vs `tests/sim`) | fixed | Ledger and harness in `tests/sim/`, never `src` |
| R-008 | 1 | SHOULD | FR-413/NFR-403 | Sim test structure, vitest 5 s timeout, file layout for parallelism | fixed | One file per preset, one `it` per player count × seed; config unchanged |
| R-009 | 1 | SHOULD | FR-413 | Invalid `SIM_SEEDS` silently runs 200 | fixed | Set-but-invalid value fails at load naming it |
| R-010 | 1 | SHOULD | FR-407 | "No other seat's cards" contradicts public trick cards | fixed | Only cards currently held in other hands |
| R-011 | 1 | SHOULD | FR-415 | Ledger behaviour at hand boundaries unspecified | fixed | Event-order processing: credit, close, open; nothing after game-over |
| R-012 | 1 | SHOULD | FR-419/VC-415 | CLI error cases incomplete; runtime error exit code | fixed | Full invalid-argument list; runtime error → stderr with seed, exit 1 |
| R-013 | 1 | SHOULD | NFR-403 | 10-minute budget has no estimate or early warning | fixed | NFR-404 records local S = 200 duration; > 5 min locally → stop and report |
| R-014 | 1 | COULD | FR-404 | `STRATEGY_NAMES` has no consumer this phase | deferred | |
| R-015 | 1 | COULD | FR-410/VC-408 | Defensive players check could be dropped | deferred | |
| R-016 | 1 | COULD | VC-402 | Distribution test redundant; should reuse one Rng | deferred | |
| R-017 | 1 | COULD | FR-418/419 | Name `node:util` parseArgs / no new devDependencies | deferred | |
| R-018 | 1 | COULD | FR-411 | `maxMoves` default tied to 981-move preset; validation of `maxMoves` | deferred | |
| R-019 | 1 | COULD | NFRs | `runAiLoop` per-game cost ceiling; expected 2,000-seed duration | deferred | |
| R-020 | 1 | COULD | FR-413/418 | Fixed sim `createGame` input (gameId, playerIds, names) | deferred | |
| R-021 | 1 | COULD | BR-402/BR-404 | Deal-equality check across strategies; stricter import check | deferred | |
| R-022 | 2 | SHOULD | NFR-404/VC-413 | 5-minute local mark is an escalation trigger in NFR-404 but a gate in VC-413 | deferred | Delta pass; not marked MUST |
| R-023 | 2 | COULD | FR-419 | stdout behaviour on a runtime error mid-run | deferred | |
| R-024 | 2 | COULD | FR-413 | What to do if a seed test nears vitest's 5 s timeout on CI | deferred | |
| R-025 | 3 | COULD | FR-418 | Made-bid rate formula needs parentheses: Σ madeCount / (Σ hands × players) | deferred | Plan states the parenthesised formula |
| R-026 | 3 | COULD | BR-404 | Own-folder import (`ai-loop.ts` → `player-view.ts`) not listed | deferred | Plan: a layer may always import its own folder (spec 00 lint rule) |
| R-027 | 3 | COULD | VC-405 | Test `gameId` must not contain the seed | deferred | Plan pins a seed-free `gameId` |
