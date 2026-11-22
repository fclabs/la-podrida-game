# Iteration 1 — Cards, decks and their schemas

- Commit: `Add domain cards, decks and their Zod schemas` (on `spec/01-domain-model`, parent `f1bcaa5`). Not pushed.
- Environment: macOS, Node 26.13.1 locally (project declares 24), pnpm 10.15.1.
- Carry-over: none (first iteration).

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| VC-101 to VC-108 | `pnpm vitest run tests/unit/domain/cards.test.ts tests/unit/domain/decks.test.ts` | PASS — 2 files, 57 tests, exit 0 |
| Every VC input appears in the tests | manual review against spec §Verification Criteria | PASS — VC-101 (4 cards), VC-102 (round-trip both decks, `10S`, `CC`), VC-103 (`''`, `H`, `10`, `1H`, `7h`, `3O` / `KO`, `10O`, `7H`), VC-104 (8 pairs + sort per deck), VC-105 (2 cases), VC-106 (both literals), VC-107 (sizes for n=3..7 / 3,4,5,6; duplicates; no `2`; `AS KS QS`; mutation), VC-108 (`0`, `-1`, `2.5`, `NaN`) |
| Typecheck | `pnpm typecheck` | PASS — exit 0, no errors |
| Lint (0 warnings) + Prettier | `pnpm lint` | PASS — exit 0; ESLint clean, "All matched files use Prettier code style!" |
| Full suite | `pnpm test` | PASS — 5 files, 131 tests |
| Purity | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.' src/domain` | PASS — no matches (grep exit 1) |
| Domain imports | `grep -hn '^import' src/domain/*.ts` | PASS — only `zod` and `./decks`, `./cards`, `./schemas` (type-only between type modules) |
| Artifacts | `ls specs/01-domain-model-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-cards-decks.md}` | PASS — CONTEXT.md lists every public function/constant with signature |

Extra sanity check (not a VC; scratch script, not committed): `DeckDefinitionSchema.safeParse` rejects `suits: []`, duplicate ranks, keys `x`/`03`/`0`, removed rank `Z`, an extra key and a missing `removeRanksForPlayers`, and accepts `SPANISH_40`; `CardSchema` rejects `{suit:'X'}`, `{rank:'1'}` and extra keys. These are the deck-level VC-114 mutations Iteration 2 will test through `RuleSetSchema`.

## Files

Added: `src/domain/schemas.ts`, `src/domain/cards.ts`, `src/domain/decks.ts`, `tests/unit/domain/cards.test.ts`, `tests/unit/domain/decks.test.ts`, `specs/01-domain-model-plan-artifacts/{CONTEXT.md,DECISIONS.md,iterations/01-cards-decks.md}`.
Deleted: `src/domain/.gitkeep`.

## Deviations

- None from the plan's Scope. Additions beyond the VCs in `decks.test.ts`: a deep-freeze check (D-003), `DeckDefinitionSchema.parse` of both decks, `CardSchema.parse` of every built card, and an explicit suit-major/high→low order check for `SPANISH_40`.
- Decisions: D-001 to D-003 are the plan's decisions; D-004 (quoted input in error messages) is mine.

## Gotchas

- `import type { z } from 'zod'` + `z.infer<typeof Schema>` with `import type { Schema }` works (type queries on type-only imports are allowed); no runtime import of `schemas.ts` is needed in `cards.ts`/`decks.ts`.
- `KNOWN_SUITS`/`KNOWN_RANKS` are typed `readonly string[]` (not `as const` tuples) so `.includes(someString)` typechecks.
- `parseCard('10', FRENCH_52)` parses as rank `1` + suit `0` and fails on the suit; `'H'` fails because the rank part is empty.
- Zod 4 `z.record(z.string().regex(...), …)` validates keys against the regex (rejects `x`, `03`, `0`) and infers `Record<string, string[]>`.
- Vitest's `%d` formats `NaN` fine in `it.each` titles; `%j` shows `''` as `""`.

## For the next iteration

- Add `BoundSchema`, `SegmentSchema`, `HandSequenceSpecSchema`, `ScoringSpecSchema`, `PresetIdSchema`, `RuleSetSchema` to `schemas.ts`; reuse `DeckDefinitionSchema` for `RuleSet.deck` (it already enforces every deck-level VC-114 mutation).
- Presets must `structuredClone(FRENCH_52 / SPANISH_40)` — the constants are frozen.
- `rules.ts` should follow the `cards.ts` pattern: `import type { z } from 'zod'` and `import type { …Schema } from './schemas'`.
- Test files: `tests/unit/domain/presets.test.ts`, `tests/unit/domain/rule-set-schema.test.ts`, same header/`describe('VC-NNN …')` style.
