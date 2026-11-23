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
