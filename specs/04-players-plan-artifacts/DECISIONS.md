# DECISIONS — Players, Player View, AI Loop and Simulation (Phase 4)

Decisions locked in while building `specs/04-players.md` from `specs/04-players-plan.md`. Plan decisions P-1 to P-6 are recorded here by the iteration that applies them. Entries: `## D-NNN: <title>  (Iteration N)` with Context / Decision / Rejected / Consequences.

## D-001: Strategy registry is a `Map`  (Iteration 1)

- **Context**: `getStrategy(name)` receives names from `SeatInfo.strategy` (persisted, possibly user-supplied). A plain object lookup would find inherited names such as `'constructor'` or `'toString'`.
- **Decision**: `registry.ts` keeps a private `ReadonlyMap<string, AIStrategy>`; `STRATEGY_NAMES` is a frozen array built from its keys. Inherited names throw `UnknownStrategyError` (tested).
- **Rejected**: plain object literal (prototype names leak); null-prototype object (works, but a `Map` is simpler and needs no `Object.hasOwn`).
- **Consequences**: adding a strategy = add its `[name, strategy]` entry to `STRATEGIES`; `STRATEGY_NAMES` follows automatically.

## D-002: `createPlayers` maps seats in array order, no re-validation  (Iteration 1)

- **Context**: FR-405 says "one `Player` per seat in seat order". `GameState.seats` is already in seat order (engine invariant).
- **Decision**: `createPlayers` is `seats.map(...)` with `player.seat = info.seat`; it neither sorts nor checks seat numbers.
- **Rejected**: sorting by `seat` or throwing on gaps — duplicates FR-410's checks in `runAiLoop` and would hide a malformed state instead of reporting it there.
- **Consequences**: a malformed seat list is caught by `runAiLoop`'s `RangeError` (Iteration 2).

## D-003: `ai-loop.ts` imports `./player-view`  (Iteration 2, plan P-2)

- **Context**: BR-404 lists the layers the two service helpers may import (`domain`, `engine`, `score`, `players`); `runAiLoop` needs `buildPlayerView` for each `DecisionContext`.
- **Decision**: `ai-loop.ts` imports `buildPlayerView` from `./player-view` (a layer may always import its own folder — spec 00 lint rule). BR-404's list is about other layers.
- **Rejected**: duplicating the view composition inside the loop (FR-406 makes `buildPlayerView` the only builder of a `PlayerView`).
- **Consequences**: `buildPlayerView` stays the single caller of `evaluate(` in `src` outside `src/score/`.

## D-004: VC-405 game input keeps the seed out of `gameId`  (Iteration 2, plan P-3)

- **Context**: VC-405 asserts `JSON.stringify(view)` does not contain the seed, and the view carries `gameId`.
- **Decision**: the VC-405 game is `createGame({ gameId: 'view-game', rules: getPreset('argentina-fidepo'), seats: makeSeats(4), seed: 'secret-view-seed' })`, played with `playGame` (first legal move).
- **Rejected**: reusing `newGame` (`gameId 'game-1'`, seed `'seed-1'`) — a short seed could match unrelated text by accident.
- **Consequences**: none outside the test.

## D-005: Cap check happens before each decision, only for AI seats  (Iteration 2)

- **Context**: FR-411 says the loop throws when `maxMoves` moves were applied "and the current actor is still an AI seat, when the next decision would be requested".
- **Decision**: at the top of each iteration, after `currentActor`, `if (moves >= maxMoves && state.seats[seat].kind === 'ai') throw new AiLoopLimitError(moves, state)`. A human actor at the cap is still asked (and answers `await`); game over at the cap returns normally. The kind is read from `state.seats` (already proven equal to `players[seat].kind` by FR-410's check).
- **Rejected**: throwing right after the `maxMoves`-th move (would reject a game that ends or reaches a human on exactly that move).
- **Consequences**: `error.state` is the state after `maxMoves` moves with an AI to act; `error.moves === maxMoves` (VC-409).
