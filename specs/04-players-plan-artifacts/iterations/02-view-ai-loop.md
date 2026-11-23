# Iteration 2 — Player view and AI loop

Commit: this commit ("Build player views and run the AI loop"; see `git log`).

## Criteria

| Criterion | Command | Result |
|---|---|---|
| VC-404, VC-405 | `pnpm vitest run tests/unit/service/player-view.test.ts` | PASS — 1 file, 7 tests |
| VC-404 (grep) | `grep -rln "evaluate(" src \| grep -v "^src/score/"` | PASS — prints only `src/service/player-view.ts` |
| VC-405 (grep, BR-401) | `grep -rnE "src/(engine\|score\|service)\|GameState" src/players` | PASS — no output (exit 1) |
| VC-406 to VC-410 | `pnpm vitest run tests/unit/service/ai-loop.test.ts` | PASS — 1 file, 17 tests (argentina-fidepo 3p = exactly 981 moves; all 4 presets at min and max players reach `game-over` in one call) |
| BR-404 | `grep -rnE "src/(storage\|state)\|@/src/config\|Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\." src/service/player-view.ts src/service/ai-loop.ts src/players` | PASS — no output (exit 1) |
| Service imports | `grep -n "^import" src/service/*.ts` | PASS — only `@/src/domain/types`, `@/src/engine/view`, `@/src/engine/engine`, `@/src/score/score-engine`, `@/src/players/player`, `./player-view` |
| `.gitkeep` gone / no barrel | `ls src/service/.gitkeep src/service/index.ts` | PASS — both "No such file or directory" (`.gitkeep` removed with `git rm`) |
| Toolchain | `pnpm typecheck && pnpm lint && pnpm test` | PASS — each exit 0; 34 files / 606 tests; ESLint 0 warnings; Prettier clean |
| Artifacts | this record; `CONTEXT.md` lists `buildPlayerView`, `runAiLoop`, `AiLoopLimitError`, `AiLoopOptions`, `AiLoopResult` with signatures and the P-4 recipe | PASS |

No FAIL occurred; the checklist was run once from the top.

## Measured all-AI game time (hand-off for Iterations 3–4)

One argentina-fidepo 3-player all-AI game (P-4 input, seeds `sim-argentina-fidepo-3-0…5`) through `runAiLoop(createGame(...).state, createPlayers(seats))`, timed with `performance.now()` in a throwaway script run by `pnpm exec tsx` (deleted): 74.2 ms (first, cold), then 60.0, 58.8, 58.2, 58.1, 60.5 ms — **~60 ms per game**, 981 moves each. In vitest (no sim checks) other combinations take 7–40 ms per game. Estimate for Iteration 3: 18 × 200 games of play alone ≈ 2–3 min CPU before per-move checks, split across vitest workers (one file per preset); the per-move `checkInvariants` / `evaluate` / ledger checks and the 10-seed determinism + replay will add to that.

## Files

- Added: `src/service/player-view.ts`, `src/service/ai-loop.ts`; `tests/unit/service/player-view.test.ts`, `tests/unit/service/ai-loop.test.ts`; `specs/04-players-plan-artifacts/iterations/02-view-ai-loop.md`.
- Deleted: `src/service/.gitkeep`.
- Changed: `specs/04-players-plan-artifacts/CONTEXT.md` (rewritten to current state), `specs/04-players-plan-artifacts/DECISIONS.md` (D-003 to D-005 appended).

## Decisions

- D-003 (plan P-2: `ai-loop.ts` imports `./player-view`), D-004 (plan P-3: VC-405 uses `gameId 'view-game'`, seed `'secret-view-seed'`), D-005 (cap check before each decision, only for AI seats; human at the cap is still asked).

## Deviations

- None from the plan's Scope. Extra tests beyond the VCs: no `finalRanking` key on every non-final state; game-over view deep-equals the composition for every viewer; `buildPlayerView` rejects seat 4 with `RangeError`; VC-406 plays the whole game, alternating loop and human moves, and checks `calls === stops + 1`; VC-407 also checks the concatenated transition events equal `result.events`; VC-409 checks the `IllegalMoveError`'s `moveId`; VC-410 checks the last event is `game-over`.
- VC-405 / VC-406 / VC-407 use argentina-fidepo / gamerules games played by `playGame` (first legal move) or `createPlayers` (random); VC-407 uses gamerules 3p (short game).
- VC-408 message checks: length → `/length 3.*4 seats/`; seat → `/^seat 2:/`; kind → `/^seat 1:.*kind/`.

## Gotchas

- The leak walk compares by `cardId`, so the trump card in a dealer's hand (whole-deck hands) must be excluded explicitly; the VC-405 game asserts it covers both a stock-trump hand (`trumpCardInDealerHand false`) and a 13-card whole-deck hand.
- `result.events` does not include `createGame`'s `game-started` / initial `hand-dealt`; the sim's ledger and replay must start from `createGame`'s state/events.
- `onTransition` throwing leaves that move applied (counted in the observable move counter) — VC-407 relies on this (5 calls, 5 `choose` calls).
- Per-step deep-equality inside loops: report with `if (bad) expect(detail).toBeNull()` rather than calling `expect().toEqual` thousands of times.
- `tests/sim` is still collected by `pnpm test:sim` only; `pnpm test` does not run `.sim.test.ts` files.

## For the next iteration

- Use the P-4 recipe in `CONTEXT.md` ("All-AI game recipe"); keep `createGame`'s `Transition` (`start.state` for hand 0 of the ledger, `start.events` for the full log) and pass `onTransition` to `runAiLoop`; `prev` is the state before the move, `transition.events` are in engine order.
- `runAiLoop` already enforces FR-410 and FR-411; sims should never hit `AiLoopLimitError` (longest game is 981 < 1000).
- Import `IllegalMoveError` from `@/src/engine/engine`, `AiLoopLimitError` / `runAiLoop` from `@/src/service/ai-loop`, `createPlayers` from `@/src/players/registry`.
- Replay (FR-417) uses only `applyMove` with `bid:<tricks>` / `play:<cardId>` from the move events; `aiDecisionCount` reproduces because `applyMove` increments it for AI seats.
- Budget: ~60 ms per argentina-3p game of play; measure the S = 200 suite and stop if > 5 minutes (NFR-404).
