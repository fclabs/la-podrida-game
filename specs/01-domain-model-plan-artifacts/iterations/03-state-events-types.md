# Iteration 3 — Game state and event schemas, shared types, type-level tests

- Commit: `Add game state and event schemas and shared domain types` (on `spec/01-domain-model`, parent `eeb6d90`). Not pushed.
- Environment: macOS, Node 26.13.1 locally (project declares 24), pnpm 10.15.1.
- Carry-over from Iteration 2 applied: `GameStateSchema.rules` reuses `RuleSetSchema`; fixtures use `getPreset('mexico-bazas')`; `Bound` expected type uses the tuple shapes `[number, 'max']` / `['max', number]`; z.infer grep went from 7/13 to 13/13.

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| VC-115, VC-116, VC-117 | `pnpm vitest run tests/unit/domain/` | PASS — exit 0; 7 files, 141 tests (new: game-state 22, game-event 12, types 7) |
| VC-117 z.infer grep | `grep -nE "z\.infer<typeof (Card\|DeckDefinition\|Bound\|Segment\|HandSequenceSpec\|ScoringSpec\|RuleSet\|SeatInfo\|TrickPlay\|HandState\|HandResult\|GameState\|GameEvent)Schema>" src/domain/*.ts` | PASS — 13 matches (cards 1, decks 1, rules 5, types 6) |
| VC-117 type assertions | `pnpm typecheck` | PASS — exit 0; all 13 `toEqualTypeOf` against hand-copied `Exp*` shapes hold, plus the four VC spot checks and `GameState['phase']` = `Phase` |
| Mutation check | edit `src/domain/schemas.ts` line 207 `dealer: nonNegativeInt` → `dealer: z.string()`, then `pnpm typecheck` | PASS — typecheck exit 2 with 3 errors, all in `tests/unit/domain/types.test.ts` (lines 242–244: `HandResult` "dealer: Expected: number, Actual: string", `GameState`, `GameEvent`). Reverted from a scratch backup; `cmp` identical; never committed |
| Extra probe (not required) | `strategy: z.string().optional()` → `z.string()`, `pnpm typecheck` | 3 errors (SeatInfo/GameState/GameEvent); reverted (`cmp` identical) |
| Typecheck | `pnpm typecheck` | PASS — exit 0 |
| Lint (0 warnings) + Prettier | `pnpm lint` | PASS — exit 0; "All matched files use Prettier code style!" (no unused-import errors in `types.test.ts`) |
| Full suite | `pnpm test` | PASS — exit 0; 10 files, 215 tests |
| Chain | `pnpm typecheck && pnpm lint && pnpm test` | PASS — exit 0 |
| Purity | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.' src/domain` | PASS — no matches (grep exit 1) |
| Strict objects | `grep -nE 'z\.object\(\|looseObject\|passthrough' src/domain/schemas.ts` | PASS — no matches; every object and union variant is `z.strictObject` |
| Domain imports | `grep -hn '^import\|^} from' src/domain/*.ts` | PASS — only `zod`, `./cards`, `./decks`, `./rules`, `./schemas`; `types.ts` uses `import type` only |
| Artifacts | CONTEXT.md export map vs code | PASS — Domain export map table matches the six modules |

The first `pnpm typecheck` failed once (see Gotchas: `DEFAULT_PRESET_ID`); after fixing the test the whole checklist above was run from the top and passed.

## Files

Added: `src/domain/types.ts`, `tests/unit/domain/game-state-schema.test.ts`, `tests/unit/domain/game-event-schema.test.ts`, `tests/unit/domain/types.test.ts`, `specs/01-domain-model-plan-artifacts/iterations/03-state-events-types.md`.
Changed: `src/domain/schemas.ts` (appended private `nonNegativeInt`, `knownSuit`, `handPlan`; `SeatInfoSchema`, `TrickPlaySchema`, `HandStateSchema`, `HandResultSchema`, `GameStateSchema`, `GameEventSchema`), `specs/01-domain-model-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.

## Deviations

- None from the plan's Scope. Extras beyond the VCs: FR-116 rows not in VC-115 (`handIndex: -1`, seat index `-1`, `tricksWon` `0.5`, completed-hand `tricks` `-1`); a VC-116 test that the valid list covers all seven types in order; exact value-signature checks (`cardId`, `parseCard`, …) in `types.test.ts` on top of not-`any`.
- `handPlan` ≥ 1 (plan decision for `GameState`) also applies to the `game-started` event's `handPlan` (shared private schema) — D-009.
- Decisions: D-009, D-010 are the plan's decisions; D-011 (self-contained `Exp*` expected types, `typeof DEFAULT_PRESET_ID`) is mine.

## Gotchas

- `expectTypeOf(DEFAULT_PRESET_ID).toEqualTypeOf<'argentina-fidepo'>()` fails: `DEFAULT_PRESET_ID = 'argentina-fidepo' satisfies PresetId` has a *widening* literal type, which generic inference widens to `string`. `expectTypeOf<typeof DEFAULT_PRESET_ID>()` passes. Iteration 2's code was left unchanged (out of scope); a non-widening annotation `: 'argentina-fidepo'` would also fix it.
- Zod 4 infers `strategy?: string | undefined` for `.optional()`; without `exactOptionalPropertyTypes` that equals the spec's `strategy?: string` under `toEqualTypeOf`.
- In Zod 4 a `z.strictObject` key whose schema is `.nullable()` (not `.optional()`) is required, so `delete hand` fails as FR-116 demands.
- `z.discriminatedUnion('type', [...])` with `z.strictObject` members rejects `{type:'game-over',extra:1}`; the `bid-made` missing-field row fails on `tricks`.
- Vitest's `expectTypeOf` is a no-op at runtime; the type assertions are enforced by `pnpm typecheck` (tests are in `tsconfig.json` `include`).
- `toExtend` (not the deprecated `toMatchTypeOf`) is available in Vitest 5.

## Other observations

- During this iteration the working tree showed the Phase 0 spec files (`specs/00-project-scaffold*.md`, `specs/00-project-scaffold-plan-artifacts/**`) as deleted, though the tree was clean at start. This iteration did not touch them and did not stage them; whoever deleted them should decide.

## For the next iteration

- Final domain export map is in CONTEXT.md "Domain export map"; use it for the `docs/development.md` Domain model section.
- Facts for the docs: `Phase` is `GameState['phase']`; score/view/player types are hand-written and unimplemented; persistence types (`GameMeta`, `Commit`, `CommitBody`) are Phase 6; `GameStateSchema` checks shape only (cards vs both decks' suits/ranks); changing a persisted shape means updating schema + `Exp*` types in `types.test.ts`.
- Decisions to reflect or mark internal: D-001 to D-011 (D-011 and D-004 are test/internal detail).
