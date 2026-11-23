# DECISIONS — Score Engine (Phase 3)

Decisions locked in while implementing `specs/03-score-engine-plan.md`. Newest last. Each entry: Context / Decision / Rejected / Consequences.

## D-001: Spanish miss computed as `0 - x`, never unary minus  (Iteration 1)

- **Context**: VC-302 requires `handPoints` never to return `-0`. With unary minus, `-(missPenaltyPerTrick * |t − b|)` is `-0` whenever the product is `0` (e.g. a cast spec with `missPenaltyPerTrick: 0`). `-0` deep-equals differently (`Object.is`) and prints as `-0` in some serialisations.
- **Decision** (plan decision): `0 - scoring.missPenaltyPerTrick * Math.abs(tricks - bid)`. Tested with a cast spec whose penalty is `0`: `Object.is(result, 0)`.
- **Rejected**: unary minus plus a `|| 0` / `+ 0` normalisation (works but obscures intent); relying on schema literals (`5`) making `-0` impossible (custom specs exist in tests and later variants).
- **Consequences**: any future negative-score formula must use the same `0 - x` form.

## D-002: Custom `ScoringSpec` in tests cast via `unknown`  (Iteration 1)

- **Context**: The plan says to build `{ ...spec, perTrick: 3 } as ScoringSpec`. `ScoringSpecSchema` uses literal numbers, so `tsc` rejects that cast with TS2352 (`3` not comparable to `5`).
- **Decision**: `as unknown as ScoringSpec` in tests.
- **Rejected**: widening the domain type (out of scope; domain is frozen).
- **Consequences**: test-only; no effect on `src/`.

## D-003: `evaluate` error prefixes `state.completedHands[k]: ` / `state.hand: `  (Iteration 2)

- **Context**: FR-309 requires `evaluate` errors to contain the literal location `completedHands[k]` or `hand`, also for FR-303 failures detected by `scoreHand`. The bare word `hand` also appears in other messages (`handIndex`), so asserting on it proves nothing (review ledger R-016).
- **Decision** (plan decision): every `evaluate` error starts with `` `state.completedHands[${k}]: ` `` or `state.hand: `. Seat-count checks on a completed hand run first; then `scoreHand` runs in `try/catch` and a `RangeError` is rethrown with the prefix + the original message (`state.completedHands[1]: scoreHand: handIndex 1: sum(tricks) …`). Non-`RangeError`s are rethrown unchanged. Tests assert `message.startsWith(prefix)` plus a regex for the check.
- **Rejected**: duplicating FR-303 checks inside `evaluate` (two sources of truth); bare `hand` prefix (ambiguous).
- **Consequences**: callers and docs can rely on the two prefixes; Iteration 3 documents them.

## D-004: `makeState` uses empty `hands` and an options object  (Iteration 2)

- **Context**: The plan asks for a `makeState(overrides)` builder and to check whether empty per-seat `hands` pass `GameStateSchema`.
- **Decision**: `GameStateSchema` accepts empty card arrays (`hands: z.array(z.array(CardSchema))`; deck consistency is an engine invariant, not schema), so the default hand has one empty array per seat — scoring never reads cards. The builder takes an options object `{ players, completedHands, handIndex, hand, phase }` where `hand` is a partial override of a fresh bidding hand or `null` (game over), rather than a raw `Partial<GameState>`, because the default hand depends on the seat count and hand index. A helper test asserts schema validity for 3 seats, 4 seats and game over.
- **Rejected**: filling `hands` from `buildDeck` (noise, no effect on scoring); `Partial<GameState>` overrides (callers would rebuild the hand for every non-default seat count).
- **Consequences**: hand-built states are shape-valid but not engine-consistent; never feed them to `checkInvariants`.

## D-005: `evaluate` checks completed hands before the current hand  (Iteration 2)

- **Context**: FR-309 lists completed-hand and current-hand checks but not which runs first when both fail.
- **Decision**: completed hands in index order, then the current hand (the plan's Scope order). Only the first failure is reported.
- **Rejected**: collecting all failures (spec asks for one `RangeError`).
- **Consequences**: a state with two problems reports the `state.completedHands[k]: ` one. Does not change any spec outcome.
