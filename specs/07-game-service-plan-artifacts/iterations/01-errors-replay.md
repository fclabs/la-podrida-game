# Iteration 1 — Service errors and persisted replay

- **Commit**: this commit (`Add service errors and persisted game replay`).
- **Decisions**: D-001 (P-1), D-002 (P-9), D-003 (fixture shape).

## Criteria results

All commands run from the repository root with `env -u BLOB_READ_WRITE_TOKEN -u BLOB_STORE_ID -u VERCEL_OIDC_TOKEN` prefixed.

| Criterion | Command | Result |
|---|---|---|
| VC-724 | `pnpm vitest run tests/unit/service/replay.test.ts` | PASS (12 tests in the file: `GameUnsupported` on engineVersion mismatch; `[]`, `[0,2]`, `[1]`, `[1,0]` → `RangeError` matching `/commits/`; commits guard before engine guard) |
| VC-723 (chain built without the service) | same file, `describe('VC-723…')` | PASS (3 seeds played to `game-over`: every replayed state `toEqual` the stored state, `version` and `aiDecisionCount` equal, `evaluate` equals the stored scoreboard; partial chain; inputs not mutated) |
| Tampered `card-played` → `IllegalMoveError` | same file, `describe('FR-724…')` | PASS (`reason 'unknown-move'`, the tampered seat) |
| Errors | `pnpm vitest run tests/unit/service/errors.test.ts` | PASS (15 tests) |
| VC-727 (replay imports) | `grep -nE "^import" src/service/replay.ts` | PASS: `@/src/domain/cards` (`cardId`), `import type` `@/src/domain/types`, `@/src/engine/engine`, `import type` `@/src/state/schemas`, `./errors` |
| VC-727 (replay purity) | `grep -nE "storage\|config\|node:\|Date\|Math\.random\|crypto" src/service/replay.ts` | PASS (no output, exit 1) |
| Gates | `pnpm typecheck && pnpm lint && pnpm test` | PASS (exit 0 each; `pnpm test` 52 passed + 1 skipped files, 988 passed + 30 skipped tests) |
| Artifacts | — | PASS: this record lists every criterion; `CONTEXT.md` file map and interfaces match the code |

## Files

- Added: `src/service/errors.ts`, `src/service/replay.ts`, `tests/unit/service/errors.test.ts`, `tests/unit/service/replay.test.ts`, `tests/unit/service/support/replay-fixtures.ts`, `specs/07-game-service-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-errors-replay.md}`.
- Changed: none. Deleted: none.

## Deviations

- None from scope. Extra test cases beyond the plan's minimum: `[1, 0]` order, guard order, a partial chain, input non-mutation, three seeds instead of one.

## Gotchas

- The VC-727 replay grep also matches comments: keep "Date", "config", "storage", "crypto" out of `replay.ts` entirely.
- `replayGame` keeps the engine's own `version` on its running state and sets the commit version only on the returned copies; `applyMove` preserves `version`, so results still deep-equal the stored states.
- Stored (Zod-parsed) commits may have different nested key order than fresh engine output; compare with `toEqual`.
- In zsh, a prefix held in a variable (`E="env -u …"; $E pnpm test`) is not word-split and fails with "command not found"; write the prefix literally.
- `pnpm` prints an "Unsupported engine" WARN on Node ≠ 24; harmless.

## For the next iteration

- Import errors from `./errors` and replay is ready for VC-723 on the service game (Iteration 3: load commits `0…tip`, call `replayGame(meta, commits)`).
- `buildStoredChain` lives in `tests/unit/service/support/replay-fixtures.ts`; its `chainSeats()` follow FR-703 and can serve as expected seats (human name differs from the service's trimmed `humanName`).
- Create `tests/unit/service/support/{service-fixtures,gated-store}.ts` per P-10; import `RecordingStore` from `../../state/support/store-wrappers`.
