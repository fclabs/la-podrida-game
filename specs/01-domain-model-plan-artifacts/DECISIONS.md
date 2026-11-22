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
