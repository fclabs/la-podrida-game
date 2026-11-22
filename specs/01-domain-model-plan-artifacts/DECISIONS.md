# DECISIONS — Domain Model (Phase 1)

## D-001: `schemas.ts` may export helpers beyond the Module exports table  (Iteration 1)
**Context**: The spec's Module exports table lists required exports; `CardSchema` needs the union of suits and ranks, which later phases may also want.
**Decision**: Plan decision (R-016). The table lists exports that must exist, not every allowed export. `schemas.ts` exports `KNOWN_SUITS` (`S H D C O E B`) and `KNOWN_RANKS` (`A K Q J 10 9 8 7 6 5 4 3 2 R C S`), both frozen `readonly string[]`.
**Rejected**: keeping the lists private (Iteration 3 needs them for `trumpSuit`; engine tests may too).
**Consequences**: New helper exports in `schemas.ts` are allowed; required ones must still match the table.

## D-002: `import type` between type modules  (Iteration 1)
**Context**: `cards.ts` needs `DeckDefinition` and `decks.ts` needs `Card`; a runtime import would create a cycle.
**Decision**: Plan decision (R-016). Type modules are `cards.ts`, `decks.ts`, `rules.ts`, `types.ts`. They may import `schemas.ts`; among themselves they use `import type` only. `cards.ts`/`decks.ts` also import `zod` and `schemas.ts` as types, since they only need `z.infer`.
**Rejected**: moving `DeckDefinition` into `cards.ts` (breaks the spec's Module exports table).
**Consequences**: No runtime cycles in `src/domain`. A type module that needs a schema at runtime imports `schemas.ts` with a value import (allowed).

## D-003: Deck constants are deeply frozen  (Iteration 1)
**Context**: `FRENCH_52` and `SPANISH_40` are shared module-level objects; spec BR-104 wants a pure domain.
**Decision**: Plan decision (BR-104 hardening). A private `deepFreeze` freezes the decks and their nested arrays and record. They stay typed `DeckDefinition` (the spec's type), so the freeze is runtime-only. `buildDeck` returns new, unfrozen arrays and card objects.
**Rejected**: `Readonly<…>`/`as const` types (would diverge from the spec's `DeckDefinition` type and the `z.infer` shape).
**Consequences**: Mutating a deck constant throws `TypeError` (ES modules are strict). Code that needs a mutable deck (presets) must `structuredClone` it.

## D-004: `parseCard` and `compareRanks` error messages quote the input  (Iteration 1)
**Context**: FR-103 requires the message to contain the input, including the empty string.
**Decision**: Messages are `Invalid card id "<id>" for deck <deck.id>` and `Invalid rank "<rank>" for deck <deck.id>`; tests assert the quoted form `"<id>"`, which is meaningful even for `''`.
**Rejected**: unquoted input (an empty input would trivially "contain" itself).
**Consequences**: Later callers may rely on the quoted id appearing in the message.

## D-005: Preset lookup via `Object.hasOwn` on a null-prototype map  (Iteration 2)
**Context**: `getPreset(id: string)` takes arbitrary strings; a plain object lookup would find inherited keys such as `toString`.
**Decision**: Plan decision. `PRESETS` is `Object.create(null)` populated with the four presets; `getPreset` checks `Object.hasOwn(PRESETS, id)` (a type guard to `PresetId`) and throws `UnknownPresetError` (`Unknown rules preset "<id>"`) otherwise. VC-112 also tests `'__proto__'`, `'constructor'`, `'toString'`.
**Rejected**: a `switch` (duplicates the id list); a `Map` (fine, but the plan names `Object.hasOwn`).
**Consequences**: No prototype key can ever resolve to a preset.

## D-006: Presets are deeply frozen internally; `getPreset` returns a `structuredClone`  (Iteration 2)
**Context**: FR-112 needs independent copies; BR-104 hardening (D-003) wants shared module state immutable.
**Decision**: Plan decision. Each preset's deck is `structuredClone(FRENCH_52 | SPANISH_40)`; the `PRESETS` map is deep-frozen with a private `deepFreeze` copied into `presets.ts` (the one in `decks.ts` stays private, so no new public export). `getPreset` returns `structuredClone(PRESETS[id])`, which is unfrozen and mutable.
**Rejected**: exporting `deepFreeze` from `decks.ts` (widens the spec's Module exports for an internal helper); a shared internal module (outside the iteration's Touches).
**Consequences**: Callers may mutate what `getPreset` returns. The two `deepFreeze` copies must stay identical (6 lines each).

## D-007: `PresetIdSchema` is the single source of preset ids  (Iteration 2)
**Context**: `PresetId` (type), `PRESET_IDS` (ordered list) and the `RuleSet.id` validator must agree.
**Decision**: `schemas.ts` exports `PresetIdSchema = z.enum([...four ids in spec order])` (helper export, allowed by D-001). `PresetId = z.infer<typeof PresetIdSchema>`; `PRESET_IDS = Object.freeze([...PresetIdSchema.options])`. `DEFAULT_PRESET_ID = 'argentina-fidepo' satisfies PresetId` (literal type).
**Rejected**: writing the id list twice (schema and `presets.ts`).
**Consequences**: Adding a preset id starts at `PresetIdSchema`; the `Record<PresetId, RuleSet>` map then forces a preset to exist. `src/config.ts` still has its own literal list (spec Scope Out).

## D-008: VC-114 mutation placement and schema details  (Iteration 2)
**Context**: VC-114 lists "a segment `{kind:'range',from:0,to:5}`" and bound cases without saying where they go.
**Decision**: The segment mutation replaces `handSequence[0]`; every bound case (invalid `{offset:['max',1]}` and the three valid ones) is set as `handSequence[0].to` of a fresh `spain-ludoteka` preset. `players` is `strict { min: int >= 2, max: int >= 2 }` plus a refine `min <= max` (issue path `players.max`). Integers use Zod 4 `z.int()`.
**Rejected**: appending extra segments (also valid, but replacing isolates the bound under test).
**Consequences**: Each VC-114 row fails solely because of its mutation (the base preset parses).
