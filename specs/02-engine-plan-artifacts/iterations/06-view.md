# Iteration 6 — Table view (parallel group A)

**Commit**: this commit ("Add per-seat table view with information hiding"). Previous: `b2f28b1` (Iteration 5). Built in a parallel worktree alongside Iteration 7; reduced artifact protocol (no `CONTEXT.md` / `DECISIONS.md` edits; see the Proposed sections).

## Criteria results

View rows run with `pnpm vitest run tests/unit/engine/view.test.ts --reporter=verbose` (1 file, 24 tests passed). Game under test: argentina-fidepo, 4 seats, seed `view-secret-seed-7f3a`, played by `firstMove` (22 hands, 800 moves, 801 states).

| Criterion | Result | Evidence |
|---|---|---|
| VC-216 (view part) | PASS | Hands 0 and 21 (13 × 4 = 52, `trumpCardInDealerHand true`, trump in dealer's hand): for seats 0–3 and `'spectator'`, `view.trumpCard` equals the hand's trump; the cards collected by a recursive walk (objects with exactly the string keys `suit`, `rank`, mapped with `cardId`) that belong to the dealer's hand are exactly `{trump}` for every non-dealer viewer and the dealer's full hand for the dealer. |
| VC-218 (`tableViewFor` rows) | PASS | Bidding state: seats 4, −1, 1.5, NaN → `RangeError`; game-over state: 4, −1, 1.5 → `RangeError`; seats 0–3 and `'spectator'` accepted on both. |
| VC-228 | PASS | Mid-trick playing state (1–3 plays, a `lastTrick` present), seat 1: exact `TableView` key set; `you 1`; `yourHand` = seat 1's hand; `seats` = `{seat, name, kind, cardCount = hand length, bid, tricksWon}` per seat; `dealer`, `trumpCard`, `trumpCardInDealerHand`; `currentTrick` = plays; `lastTrick` = hand's `lastTrick`; `toAct` = `currentActor` = `hand.toAct`. Spectator: `you null`, `yourHand []`, rest identical to seat 1's view. Fresh hand: `lastTrick null`, `currentTrick []`. Mutating every array/card/seat of the view leaves the state deep-equal; no object of any view (5 viewers) is reachable from the state (identity walk). |
| VC-229 | PASS | Game-over state, every viewer: exact key set, `toAct null`, `trumpCard null`, `lastTrick null`, `trumpCardInDealerHand false`, `yourHand []`, `currentTrick []`, every seat `cardCount 0`, `bid null`, `tricksWon 0` (names/kinds kept), `handIndex = handPlan.length − 1`, `dealer` = last `completedHands` entry's dealer. Extra: mexico-bazas 3p, seeds `go-0…go-5`, `dealer` = last completed dealer for every viewer, and the last dealers differ across seeds (so a constant `dealer` is caught). |
| VC-230 | PASS | The game's `hand-dealt` events include both `trumpCardInDealerHand true` (whole-deck) and `false` (stock-trump) hands. For all 801 states × 5 viewers (4,005 views): no collected card belongs to another seat's hand except `trumpCard`; every collected card is the viewer's own, on the table, in `lastTrick`, or the trump (none at game over); `JSON.stringify(view)` does not contain the seed; no key `seed`, `rules` or `aiDecisionCount` anywhere in the view (recursive key walk). |
| View file | PASS | `pnpm vitest run tests/unit/engine/view.test.ts` → 24 passed. |
| Full gate | PASS | `pnpm typecheck && pnpm lint && pnpm test` → exit 0 (21 files, 446 tests; ESLint 0 warnings; Prettier clean). Note: Iteration 7's files are not in this worktree. |
| Purity grep | PASS | `grep -rnE 'Math\.random\|new Date\|Date\.now\|crypto\.\|fetch\(\|process\.\|performance\.\|src/score\|\.\./score' src/engine` → no matches (exit 1). `view.ts` imports only `@/src/domain/{cards,types}` (types) and `./engine` (`currentActor`). |
| Mutation sanity | PASS | Temporarily: (1) `yourHand` from the next seat → 4 failures; (2) spectator sees seat 0's hand → 3; (3) `currentTrick` shares the state's array → 2; (4) no FR-219 check → 7; (5) game-over `dealer` hard-coded to 0 → 1 (only after adding the multi-seed test; the argentina game's last dealer happens to be 0). All restored. |
| Record | PASS | This file, with the Proposed CONTEXT.md changes and Proposed decisions sections. |

## Files

- Added: `src/engine/view.ts`, `tests/unit/engine/view.test.ts`, `specs/02-engine-plan-artifacts/iterations/06-view.md`.
- Changed: none. Deleted: none.

## Deviations

- None from Scope. `engine.ts` does not export `assertSeatInRange`, so `view.ts` has its own private copy with the same check and message (per orchestrator instruction; `engine.ts` untouched). See D-? (seat check).
- The worktree was created at `main` (`050f441`) instead of the stated base; it had no changes, so its branch was reset to `b2f28b1` before any work.

## Gotchas

- `tableViewFor` treats `hand === null` like game over (like `currentActor` / `applyMove`), so a malformed `{phase: 'bidding', hand: null}` gives the game-over shape instead of throwing.
- Game-over `dealer` falls back to `0` if `completedHands` is empty (impossible for a valid state; see D-?).
- Cards are copied field by field (`{ suit, rank }`), not spread, so an extra property on a state card cannot reach the view.
- The argentina 4p first-move game with this seed has last dealer 0, so it alone cannot catch a constant game-over `dealer`; the mexico multi-seed test does.
- The full sweep (4,005 views with walks) runs in ~180 ms; the argentina game is memoised per file.

## For the next iteration

- Reconciliation: apply the Proposed CONTEXT.md changes and assign numbers to the Proposed decisions below (after Iteration 7's).
- Iteration 8 docs: list `view.ts` in the module map (eight modules), and say that the view hides other hands except the public `trumpCard` and contains no seed/rules/`aiDecisionCount`.
- Phase 4 (`PlayerView`) can spread `tableViewFor(state, seat)` and add the scoreboard; the view already shares no object with the state.

## Proposed CONTEXT.md changes

**Current state** — replace the "`src/engine/engine.ts` is complete" neighbourhood with an added bullet:
- `src/engine/view.ts` is done (spec FR-219 for views, FR-236 to FR-238, BR-205): `tableViewFor`.

and change "Not yet built" to drop `view.ts (6)`; update the test count line (this worktree alone: 21 files, 446 tests; engine dir 11 files, 231 tests — reconcile with Iteration 7's numbers).

**File map** — add rows:

| Path | Purpose |
|---|---|
| `src/engine/view.ts` | `tableViewFor` (FR-236–238): per-seat/spectator `TableView`, copies only, game-over shape, private FR-219 seat check. |
| `tests/unit/engine/view.test.ts` | VC-216 view part, VC-218 `tableViewFor` rows, VC-228, VC-229 (+ multi-seed game-over dealer), VC-230 full-game leak sweep; test-local `collectCards` / `collectKeys` walks. |

**Public interfaces** — add a section:

```ts
// @/src/engine/view
export function tableViewFor(state: GameState, seat: number | 'spectator'): TableView;
```

- Numeric seat: `RangeError` unless an integer in `0 … N − 1` (same check and message as `engine.ts`'s private `assertSeatInRange`, duplicated privately in `view.ts`). `'spectator'` → `you: null`, `yourHand: []`.
- From the state: `gameId`, `version`, `phase`, `handIndex`, `[...handPlan]`. `seats[i] = { seat: i, name, kind }` from `state.seats[i]` plus `cardCount = hand.hands[i].length`, `bid = hand.bids[i]`, `tricksWon = hand.tricksWon[i]`.
- Hand in progress: `dealer`, `trumpCard` (copy), `trumpCardInDealerHand` from the hand; `toAct = currentActor(state)`; `yourHand` = copy of the viewer's hand; `currentTrick` = copy of `currentTrick.plays`; `lastTrick` = copy or `null` (no key in the hand).
- **Game-over view** (`phase 'game-over'` or `hand === null`): `toAct`, `trumpCard`, `lastTrick` `null`; `trumpCardInDealerHand false`; `yourHand`, `currentTrick` `[]`; each seat `cardCount 0`, `bid null`, `tricksWon 0`; `dealer = completedHands.at(-1).dealer` (fallback `0` if empty).
- Never contains another seat's cards (except the public `trumpCard`, also when in the dealer's hand), undealt cards, `seed`, `rules` or `aiDecisionCount`. Shares no object with the state (cards copied as `{ suit, rank }`).

**Conventions & invariants** — add:
- **Views carry copies** (like D-003 for events): `tableViewFor` returns fresh arrays and cards; nothing in a view is reachable from the state.
- Leak tests walk the view for objects with exactly the string keys `suit` and `rank` and compare by `cardId`.

**Known gaps** — remove "Still open for Iteration 6: VC-216 view part, VC-218 `tableViewFor(state, N)` rows"; drop "View (6)" from the not-built line. Add: "`view.ts` duplicates `engine.ts`'s private `assertSeatInRange`; a later change could export it from `engine.ts` and drop the copy."

## Proposed decisions

## D-?: `tableViewFor` keeps a private copy of the FR-219 seat check  (Iteration 6)

**Context**: FR-219 requires `tableViewFor` to throw `RangeError` for an out-of-range seat; `engine.ts` has the check as a private `assertSeatInRange`, and the parallel-group rules forbid editing `engine.ts` in Iteration 6.
**Decision**: `view.ts` defines its own private `assertSeatInRange(state, seat)` with the same condition (`Number.isInteger(seat) && 0 <= seat < N`) and the same message (`seat <s> is outside 0–<N−1>`). Any value other than `'spectator'` goes through it.
**Rejected**: exporting it from `engine.ts` (outside this iteration's files, and it would widen the spec's export table); skipping the check for views.
**Consequences**: two identical 4-line checks; keep them in sync, or export one from `engine.ts` in a later, non-parallel change.

## D-?: Game-over view shape and copy rules  (Iteration 6)

**Context**: FR-237 fixes the game-over values but not what `tableViewFor` does when `hand` is `null` outside `game-over`, or when `completedHands` is empty; FR-236 says "copy" without saying how deep.
**Decision**: the game-over shape is used whenever `phase === 'game-over'` or `hand === null` (same rule as `currentActor`/`applyMove`); `dealer = completedHands.at(-1)?.dealer ?? 0`. Every array and card in the view is fresh (cards copied as `{ suit, rank }`), so no view object is reachable from the state.
**Rejected**: throwing on a `null` hand outside game-over or on empty `completedHands` (neither occurs in a valid state; views stay total like `currentActor`); shallow array copies sharing `Card` objects with the state.
**Consequences**: Phase 4's `PlayerView` can extend the view without cloning; malformed states are reported by `checkInvariants` (g)/(i), not by the view.
