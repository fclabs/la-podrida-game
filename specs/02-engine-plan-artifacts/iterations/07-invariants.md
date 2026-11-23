# Iteration 7 — Invariants (parallel group A)

**Commit**: this commit ("Add game-state invariant checks"), on the worktree branch, parent `b2f28b1` (Iteration 5). Runs in parallel with Iteration 6 (view).

## Criteria results

Rows run with `pnpm vitest run tests/unit/engine/invariants.test.ts` (1 file, 35 tests passed) unless noted.

| Criterion | Result | Evidence |
|---|---|---|
| VC-233 valid sweep | PASS | `checkInvariants` = `[]` for every state of a full first-legal-move game of argentina-fidepo, spain-ludoteka, gamerules and mexico-bazas at 3 players (each preset's minimum). Extra: argentina 3p and mexico 3p with `lastMove` (non-zero bids, dealer restriction live). The input deep-equals a pre-call clone for every state. |
| VC-233 duplicate card | PASS | Seat 0's first card copied into seat 1's hand → only `(a)`, message names the card. Extra: a hand card equal to a current-trick card → only `(a)`. |
| VC-233 off-deck card | PASS | `{suit:'O', rank:'3'}` in a French-deck hand → only `(b)`, message contains `3O`. |
| VC-233 extra card | PASS | The stock trump card pushed onto seat 0 → only `(c)`, `seat 0 holds 18 cards, expected 17`. |
| VC-233 null bid in playing | PASS | → only `(d)`, names seat 1. |
| VC-233 dealer bid sum = cardsPerPlayer | PASS | Dealer bid set to `cardsPerPlayer − others` in playing → only `(e)`. Extra: not reported during bidding, nor on a spain-ludoteka 1-card (exempt) hand. |
| VC-233 `hand: null` while bidding | PASS | → only `(g)`. Extra: hand non-null at game-over → `(g)`. |
| VC-233 cardsPerPlayer ≠ handPlan[handIndex] | PASS | 16 vs 17 → `(c)` (hand sizes) and `(h)`, message `handPlan[0] is 17`. |
| VC-233 completedHands off by one | PASS | mid-game (one popped) and at game-over (one extra) → only `(i)`. |
| VC-233 `hand.toAct = N` | PASS | Exactly one message, `(s) hand.toAct is 3 …`; no throw; (f) skipped (`legalMoves(s, 3)` would throw `RangeError`). |
| VC-233 `hand.bids` length N − 1 | PASS | Exactly one message, `(s) hand.bids has length 2, expected 3`. Extra (s) rows: `hands`/`tricksWon` length, `dealer` = 5, `leader` = N, `handIndex = handPlan.length` → only `(s)`. |
| VC-233 off-deck rank (plan) | PASS | French state with `{suit:'H', rank:'R'}` on the table and seat 2 to act holding a heart: `legalMoves` throws `InvalidCardError`, `checkInvariants` does not; result has `(b)` naming `RH` and no `(f)`. |
| VC-233 no mutation | PASS | Every mutation case asserts schema-validity and deep-equality of the input before/after (`check` helper). |
| FR-240 robustness (extra) | PASS | Schema-valid oddities, none throws: no seats (hand present / game over), `cardsPerPlayer = handPlan[0] = 2^32`, trump suit outside the deck in playing, unresolved full trick with a foreign seat, empty `handPlan`, `tricksWon` 1e9. |
| Several violations | PASS | null bid + extra completed hand + off-deck card → tags `b, d, i`. |
| Mutation sanity | PASS | Scratch script (not committed) mutating `invariants.ts`, then restored: no (a)/(b) skip of (f) → 1 failure; no deck-size guard → 2; no early return on (s) → 8; (c) ignoring the current trick → 10; (e) disabled → 1. |
| Full gate | PASS | `pnpm typecheck && pnpm lint && pnpm test` → exit 0 (21 files, 457 tests; 0 warnings; Prettier clean). |
| Purity grep | PASS | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/score\|\.\./score' src/engine` → no matches. `invariants.ts` imports `@/src/domain/{cards,decks,types}` and `./engine`. |
| Record | PASS | This file, with the two Proposed sections. |

## Files

- Added: `src/engine/invariants.ts`, `tests/unit/engine/invariants.test.ts`, `specs/02-engine-plan-artifacts/iterations/07-invariants.md`.
- Changed: none. Deleted: none. (`CONTEXT.md`, `DECISIONS.md`, `helpers.ts`, `engine.ts` untouched.)

## Deviations

- The worktree branch was created at `050f441` (main), not `b2f28b1`; it was clean, so it was reset to `b2f28b1` before any work (`git reset --hard b2f28b1`).
- One extra skip of (f) beyond the spec's "(a) or (b) failed": (f) is also skipped when `hand.cardsPerPlayer` exceeds `buildDeck(rules.deck, N).length`. Reason: FR-240 (never throw on schema-valid input) — the schema allows `cardsPerPlayer` up to `Number.MAX_SAFE_INTEGER`, and `legalBids` builds `0 … cardsPerPlayer`, which throws `RangeError: Invalid array length` at 2^32 (and exhausts memory well before). Follows the spec's own principle "no check runs on data it cannot handle". See proposed D-? 2.
- (e) runs only when every bid is set (a missing bid is already (d)). See proposed D-? 1.
- (f) runs only when `phase !== 'game-over'` (plus `hand` non-null); (d) and (e) only in `playing`.

## Gotchas

- `invariants.ts` imports `legalMoves` from `./engine` (one-way; `engine.ts` does not import invariants).
- (c) can pass with a large `tricksWon` sum and a huge `cardsPerPlayer`; then nothing flags the oversized `cardsPerPlayer` unless (h) does (the spec has no "cardsPerPlayer ≤ max" rule). Recorded as a known gap.
- (a)/(b) count distinct `cardId`s: a card duplicated three times is one `(a)` message ("appears 3 times"); an off-deck card held twice gives one `(a)` and one `(b)`.
- Hand-built `withHand` positions fail several rules at once; test assertions compare tag sets (`tags()`), not messages, except where a value is pinned.
- The `trumpCard` itself is not checked by (a)/(b) (spec scope: hands and the current trick).

## For the next iteration

- Reconciliation: merge the Proposed sections below (Iteration 6's first, then these).
- Iteration 8 docs: describe `checkInvariants` (message tags `(s)`, `(a)`–`(i)`, skip rules, the deck-size guard on (f)) in the development.md Engine section; the simulator (Phase 4) should call it after every move and assert `[]`.

## Proposed CONTEXT.md changes

- **Current state**: add `src/engine/invariants.ts` is done (spec FR-239, FR-240): `checkInvariants`. Remove `invariants.ts (7)` from "Not yet built". Tests: +1 file, +35 tests (engine dir 11 files, 242 tests; whole suite 21 files, 457 tests, before Iteration 6's additions).
- **File map** rows:
  - `src/engine/invariants.ts` | `checkInvariants` (FR-239/240): structural (s) checks, rules (a)–(i), skip rules; pure, never throws on schema-valid state.
  - `tests/unit/engine/invariants.test.ts` | VC-233: valid sweeps (4 presets at 3p, first move; argentina/mexico last move), every mutation row, off-deck-rank (f) skip, FR-240 schema-valid oddities, no-mutation checks.
- **Public interfaces** — new subsection `@/src/engine/invariants`:

  ```ts
  export function checkInvariants(state: GameState): string[];
  // [] when valid; one message per violation, each starting with its tag:
  // '(s) …' structural, '(a) …' … '(i) …' rules, followed by the offending values.
  ```

  - Order: (s) first; if any (s) fails, only the (s) messages are returned. Otherwise messages come in rule order a, b, c, d, e, f, g, h, i.
  - (s): `handIndex < handPlan.length`; with `hand`: `hands`/`bids`/`tricksWon` length N; `toAct`/`dealer`/`currentTrick.leader` integers in `0…N−1`.
  - (a) one message per duplicated `cardId` ("appears k times"); (b) one per distinct off-deck `cardId` (deck = `buildDeck(rules.deck, N)`); (c) one per seat; (d) one per seat with a null bid (playing only); (e) playing only, restriction applies, all bids set; (f) `legalMoves(state, toAct)` empty, only when hand non-null, phase ≠ game-over, (a) and (b) passed, and `cardsPerPlayer ≤ deck size`; (g) hand null iff game-over; (h) hand non-null only; (i) always.
  - Imports `legalMoves` from `./engine`.
- **Conventions & invariants**: add "Invariant messages start with `(<tag>) ` (`s`, `a`–`i`); tests assert on tags, not full text."
- **Known gaps**: replace "invariants (7)" in the not-built line; add "`checkInvariants` has no rule bounding `cardsPerPlayer` by the deck: a state with an oversized `cardsPerPlayer` that still satisfies (c) and (h) reports nothing, and (f) is skipped for it."

## Proposed decisions

## D-?: (e) is checked only when every bid is set  (Iteration 7)

**Context**: FR-239 (e) says the sum of bids ≠ `cardsPerPlayer` once bidding has closed, but a `playing` state may hold a `null` bid (itself an (d) violation), which leaves the sum undefined.
**Decision**: (e) runs in `playing`, when the dealer restriction applies (`dealerRestriction` and `cardsPerPlayer` not exempt), and only if no bid is `null`; "bidding closed" = `phase === 'playing'`.
**Rejected**: treating `null` as 0 (could report a sum violation caused only by the missing bid, double-reporting one cause); also checking at game-over with a non-null hand (that is a (g) state).
**Consequences**: one cause, one message: a null bid gives only `(d)`.

## D-?: (f) is also skipped when `cardsPerPlayer` exceeds the deck size  (Iteration 7)

**Context**: FR-240 requires `checkInvariants` never to throw on a schema-valid state. The schema allows any safe-integer `cardsPerPlayer`; (f) calls `legalMoves` → `legalBids`, which allocates `cardsPerPlayer + 1` entries and throws `RangeError` at 2^32 (memory runs out far earlier).
**Decision**: besides the spec's "(a) or (b) failed", (f) is skipped when `hand.cardsPerPlayer > buildDeck(rules.deck, N).length` — no real hand can be that large. No extra message is added (the spec defines no such rule).
**Rejected**: `try/catch` around `legalMoves` (the plan forbids it); a new rule reporting the oversized count (not in the spec's rule list); bounding by `maxCardsPerPlayer` (would skip (f) on states where it is still computable).
**Consequences**: such a state is usually caught by (c) or (h); if both pass, nothing is reported (Known gap).
