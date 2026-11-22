# Iteration 2 — Rule sets, presets and the RuleSet schema

- Commit: `Add rule-set schema and the four explicit presets` (on `spec/01-domain-model`, parent `af98348`). Not pushed.
- Environment: macOS, Node 26.13.1 locally (project declares 24), pnpm 10.15.1.
- Carry-over from Iteration 1 applied: reused `DeckDefinitionSchema` for `RuleSet.deck`; `structuredClone` of the frozen deck constants in presets; `rules.ts` uses `import type` for `zod` and `schemas.ts`; test files `presets.test.ts` and `rule-set-schema.test.ts` with the `describe('VC-NNN …')` style.

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| VC-109 to VC-114 | `pnpm vitest run tests/unit/domain/presets.test.ts tests/unit/domain/rule-set-schema.test.ts` | PASS — 2 files, 43 tests, exit 0 |
| VC-110 literals independent of preset constants | manual review of `presets.test.ts` | PASS — four expected `RuleSet` objects (and both deck literals) are written in the test from the spec's Preset values table, incl. "(unused)" values; only `getPreset`, `PRESET_IDS`, `DEFAULT_PRESET_ID`, `UnknownPresetError`, `RuleSetSchema` are imported; compared with `toStrictEqual` |
| Prototype-key rows | `pnpm vitest run tests/unit/domain/presets.test.ts --reporter=verbose` | PASS — `getPreset("__proto__")`, `("constructor")`, `("toString")` throw `UnknownPresetError` |
| Every VC-114 mutation present | manual review of `rule-set-schema.test.ts` | PASS — 17 invalid rows (each spec mutation, one `it.each` row, fresh `getPreset('spain-ludoteka')`), 3 valid-bound rows, plus the unmodified preset accepted |
| Typecheck | `pnpm typecheck` | PASS — exit 0 |
| Lint (0 warnings) + Prettier | `pnpm lint` | PASS — exit 0; "All matched files use Prettier code style!" |
| Full suite | `pnpm test` | PASS — exit 0; 7 files, 174 tests |
| Chain | `pnpm typecheck && pnpm lint && pnpm test` | PASS — exit 0 |
| Purity | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.' src/domain` | PASS — no matches (grep exit 1) |
| Domain imports | `grep -hn '^import' src/domain/*.ts` | PASS — only `zod` and `./cards`, `./decks`, `./rules`, `./schemas` |
| Artifacts | `CONTEXT.md` lists `getPreset`, `PRESET_IDS`, schema names, rule types | PASS |

All criteria passed on the first full run; no FAIL → re-run cycle was needed.

## Files

Added: `src/domain/rules.ts`, `src/domain/presets.ts`, `tests/unit/domain/presets.test.ts`, `tests/unit/domain/rule-set-schema.test.ts`, `specs/01-domain-model-plan-artifacts/iterations/02-rules-presets.md`.
Changed: `src/domain/schemas.ts` (appended `BoundSchema`, `SegmentSchema`, `HandSequenceSpecSchema`, `ScoringSpecSchema`, `PresetIdSchema`, `RuleSetSchema`, private `positiveInt`), `specs/01-domain-model-plan-artifacts/{CONTEXT.md,DECISIONS.md}`.

## Deviations

- None from the plan's Scope. Extras beyond the VCs: VC-111 also checks that mutating one preset's returned deck does not leak into another preset; VC-114 also asserts the unmodified base preset parses (so every rejection is due to its mutation).
- Decisions: D-005, D-006 are the plan's decisions; D-007 (`PresetIdSchema` as single id source) and D-008 (VC-114 placement, `players` refine, `z.int()`) are mine. `deepFreeze` is duplicated privately in `presets.ts` (D-006).

## Gotchas

- Zod 4: `z.tuple([...])` has no rest element by default, so `{min:[10,'max',1]}` is rejected; refinements on `z.strictObject` keep it a `ZodObject` (inferred type unchanged).
- `z.discriminatedUnion('kind', [z.strictObject(...), ...])` works with strict members; `z.union` is used for `Bound` (no shared discriminator).
- `'argentina-fidepo' satisfies PresetId` keeps the literal type for `DEFAULT_PRESET_ID`.
- `structuredClone` is typed via `lib.dom` in `tsconfig.json`; it is a Node global at runtime.
- `toStrictEqual` passes against `getPreset` results because `structuredClone` yields ordinary (`Object.prototype`) objects even though the map holding them has a null prototype.
- The VC-114 test uses a `Record<string, any>` "Loose" type with an inline `eslint-disable-line @typescript-eslint/no-explicit-any` to apply shape-breaking mutations.

## For the next iteration

- Rule types live in `@/src/domain/rules` (types only); presets and `getPreset` in `@/src/domain/presets`; all schemas in `@/src/domain/schemas`.
- `GameStateSchema.rules` should reuse `RuleSetSchema` directly; a valid `rules` fixture is `getPreset(<id>)` (returns a mutable deep clone).
- VC-117 (`types.test.ts`) must also import `PRESET_IDS`, `DEFAULT_PRESET_ID`, `UnknownPresetError`, `getPreset` and the rule types, and assert `RuleSet['id']` equals `PresetId`; the FR-118 rule types (`Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `RuleSet`) need `toEqualTypeOf` with hand-copied expected shapes — note `Bound`'s tuple types infer as `[number, 'max']` / `['max', number]`.
- `PresetId` is `z.infer<typeof PresetIdSchema>`; the VC-117 grep for 13 `z.infer<typeof …Schema>` matches already finds `Bound`, `Segment`, `HandSequenceSpec`, `ScoringSpec`, `RuleSet` in `rules.ts` (plus `PresetId`, which is not one of the 13 and won't match the grep's name list).
