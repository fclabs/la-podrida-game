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
