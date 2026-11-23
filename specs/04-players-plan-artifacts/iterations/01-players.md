# Iteration 1 — Players, random strategy and registry

Commit: this commit ("Add player model, random strategy and strategy registry"; see `git log`).

## Criteria

| Criterion | Command | Result |
|---|---|---|
| VC-401 | `pnpm vitest run tests/unit/players/players.test.ts` | PASS — 1 file, 3 tests |
| VC-401 (grep) | `grep -rn "class " src/players \| grep -v "extends Error"` | PASS — no output (exit 1) |
| VC-402 | `pnpm vitest run tests/unit/players/random.test.ts` | PASS — 1 file, 4 tests (name; 20-seed formula; 6,000 calls on one `deriveRng('s','ai',0,0)`, each index 1,800–2,200; throwing `Proxy` view with `get`/`has`/`ownKeys` traps) |
| VC-403 | `pnpm vitest run tests/unit/players/registry.test.ts` | PASS — 1 file, 6 tests |
| BR-401 (partial) | `grep -rnE "src/(engine\|score\|service)\|GameState" src/players` | PASS — no output (exit 1) |
| BR-404 (players part, extra) | `grep -rnE "src/(storage\|state)\|@/src/config\|Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\." src/players` | PASS — no output (exit 1) |
| `.gitkeep` gone | `ls src/players/.gitkeep` | PASS — "No such file or directory" (removed with `git rm`) |
| No barrel | `ls src/players/index.ts` | PASS — does not exist |
| Toolchain | `pnpm typecheck && pnpm lint && pnpm test` | PASS — exit 0; 32 files / 582 tests; ESLint 0 warnings; Prettier clean |
| Artifacts | this record; `CONTEXT.md` Public interfaces lists every `src/players` export with its signature | PASS |

No FAIL occurred; the checklist was run once from the top.

## Files

- Added: `src/players/player.ts`, `src/players/human-player.ts`, `src/players/ai-player.ts`, `src/players/strategies/random.ts`, `src/players/registry.ts`; `tests/unit/players/players.test.ts`, `tests/unit/players/random.test.ts`, `tests/unit/players/registry.test.ts`; `specs/04-players-plan-artifacts/CONTEXT.md`, `DECISIONS.md`, `iterations/01-players.md`.
- Deleted: `src/players/.gitkeep`.
- Changed: none.

## Decisions

- D-001 (registry is a `Map`), D-002 (`createPlayers` maps in array order, no re-validation). Plan decisions P-1 to P-6 concern Iterations 2–4; none applied here.

## Deviations

- None from the plan's Scope. Extra tests beyond the VCs: players are plain objects (prototype check); inherited names (`'constructor'`, `'toString'`, `'__proto__'`, `'hasOwnProperty'`) throw `UnknownStrategyError`; `error.name === 'UnknownStrategyError'`.
- `STRATEGY_NAMES` is built from the registry map keys and frozen (typed `readonly string[]`), rather than a literal `['random'] as const`; value is the same.
- Orchestrator note recorded in `CONTEXT.md`: group A (Iterations 3–4) is sequential and every iteration uses the full artifact protocol.

## Gotchas

- `randomStrategy` is written `choose: (_view, moves, rng) => …`; ESLint's default `no-unused-vars` (`args: 'after-used'`) accepts the unused leading `_view`.
- In tests, a stub `PlayerView` needs `as unknown as PlayerView`.
- The `Proxy` in VC-402 must also trap `has` and `ownKeys` to prove nothing (including spreading or `in`) touches the view.
- `pnpm` prints an "Unsupported engine" WARN (local Node 26); harmless.

## For the next iteration

- Import players from their modules: `@/src/players/registry` (`createPlayers`, `getStrategy`, `UnknownStrategyError`, `STRATEGY_NAMES`), `@/src/players/ai-player` (`createAiPlayer`), `@/src/players/human-player`, `@/src/players/player` (types), `@/src/players/strategies/random`.
- For VC-406–VC-408 stub strategies, wrap with `createAiPlayer(seat, name, { name: 'stub', choose: … })` and count `choose` calls.
- `createPlayers` does not validate; `runAiLoop` must perform FR-410's length/seat/kind checks before any move.
- Apply P-2 (ai-loop imports `./player-view`) and P-3 (`gameId: 'view-game'`, seed `'secret-view-seed'`) and record them in `DECISIONS.md` as D-003+.
