# Iteration 3 — Update state and display model

Commit: this commit, on the worktree branch `worktree-agent-ad25cd61d433f5abe` (fast-forwarded to `spec/09-ui` at `02d69f9` first; the worktree had been created from `main`).

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| VC-920 | `pnpm vitest run --project ui tests/ui/game-state.test.ts` | PASS (null, greater, equal, lower) |
| VC-924 (pure) | same | PASS (adopted version, moveId, `newId` called once; two captures differ) |
| VC-931 | `pnpm vitest run --project ui tests/ui/display.test.ts` | PASS (each event type; delays 0,600,600,600,1200,1200,0; input model not mutated) |
| VC-933 | same | PASS (`hand-dealt` resets; `emptyTable`: no trump, empty hand, `dealt: false`) |
| VC-932 | same | PASS, real game: 8 in-process games on 3 seats (`aiCount: 2`), varied legal choices; every non-game-over move response folded from the pre-move view equals the adopted view on the shared fields, and the exact 7-event queue `card-played x3, trick-won, hand-completed, hand-dealt, bid-made` occurs in a real game (asserted). The 201 events fold from `emptyTable` to the created view. |
| typecheck / lint / test | `pnpm typecheck`; `pnpm lint`; `pnpm test` | PASS / PASS / PASS (87 files + 1 skipped, 1516 tests + 30 skipped) |

## Files

- Added: `app/_client/{game-state,display}.ts`, `tests/ui/{game-state,display}.test.ts`, `tests/ui/support/fixtures.ts`, this record.
- Changed/deleted: none.

## Deviations

- The worktree started at `main` (`7eb81ae`), not `02d69f9`; fast-forwarded with `git merge --ff-only 02d69f9` before any work.
- `makeScoreboard(overrides, seats = 4)`, `card(rank, suit)` also exported from fixtures (not in the plan's list).
- The game-over response is excluded from the VC-932 fold comparison (the game-over view is not a hand state: trump/tricks are cleared by the server, no `hand-dealt` follows). Its events (`hand-completed`, `game-over`) are covered by the per-event tests.

## Gotchas

- `applyEvent` `card-played` removes the human's card only when `model.you === event.seat`; matching is by suit+rank, removing one copy.
- `trick-won` copies `model.currentTrick` into `lastTrick` (the model's own plays, not the target view's).
- `hand-completed` banner is built from `result.bids[seat]` / `result.tricks[seat]` (indexed by seat).
- `highlightSeat` is reset to null by `hand-dealt`, `hand-completed`, `game-started`, `game-over`; `viewToDisplay` gives `banner: null`, `highlightSeat: null`, `dealt: true`.
- `applyEvent` does not touch `handPlan`, `you` or seat names/kinds; those stay from the starting model.
- BSD `sed -i` needs a suffix on macOS; use Edit.

## For the next iteration

- Import `shouldAdopt`, `captureAction`, `isAnimated` (and type `UpdateSource`) from `@/app/_client/game-state`; `viewToDisplay`, `emptyTable`, `applyEvent`, `eventDelayMs`, types `DisplayModel`, `Banner` from `@/app/_client/display`.
- Queue start model: `emptyTable(adopted.view)` for source `create`; `viewToDisplay(shownBefore)` for `move`. After the queue empties render `viewToDisplay(adopted.view)`.
- Fixtures: `makeView(overrides)`, `makeUpdate({ version?, events?, legalMoves?, view?: Partial<PlayerView> })` (version defaults to the view's, 5), `makeScoreboard(overrides, seats)`, `card(rank, suit)`. Default view: 4 seats, human seat 0 "Ana", hand 0 of `[3,2,1]`, hand `2S 5H KD`, trump `9H`, phase `playing`.

## Proposed CONTEXT.md changes

- File map: `app/_client/game-state.ts` (FR-910/911/916 pure helpers); `app/_client/display.ts` (FR-920-922 display model); `tests/ui/game-state.test.ts`, `tests/ui/display.test.ts` (VC-920, VC-924 pure, VC-931-933); `tests/ui/support/fixtures.ts` (`card`, `makeScoreboard`, `makeView`, `makeUpdate`).
- Public interfaces:
```ts
// game-state.ts
export type UpdateSource = 'create' | 'move' | 'load' | 'conflict' | 'recovery';
export function shouldAdopt(current: PlayerUpdate | null, incoming: PlayerUpdate): boolean;
export function captureAction(adopted: PlayerUpdate, moveId: string, newId: () => string): { version: number; moveId: string; clientRequestId: string };
export function isAnimated(source: UpdateSource): boolean; // create|move only
// display.ts
export interface Banner { handIndex: number; perSeat: { seat: number; bid: number; tricks: number }[] }
export interface DisplayModel { seats; handIndex; handPlan; dealer; trumpCard; trumpCardInDealerHand; yourHand; currentTrick; lastTrick; you; banner: Banner | null; highlightSeat: number | null; dealt: boolean }
export function viewToDisplay(view: PlayerView): DisplayModel;
export function emptyTable(view: PlayerView): DisplayModel;
export function applyEvent(model: DisplayModel, event: GameEvent, target: PlayerView): DisplayModel; // pure, no mutation
export function eventDelayMs(event: GameEvent): number;
// fixtures.ts
export function makeView(o?: Partial<PlayerView>): PlayerView;
export function makeUpdate(o?: Partial<Omit<PlayerUpdate,'view'>> & { view?: Partial<PlayerView> }): PlayerUpdate;
export function makeScoreboard(o?: Partial<ScoreBoard>, seats?: number): ScoreBoard;
export function card(rank: string, suit: string): Card;
```
- Conventions: display code never mutates models (each event returns a new model); `Card`/`Seat` types derive from `PlayerView` (D-008).
- Commands: `pnpm vitest run --project ui tests/ui/display.test.ts`.
- Known gaps: the display model has no turn marker or legal moves (the page takes them from the adopted update only when the queue is empty, FR-937); `game-over` response views are not foldable (by design).

## Proposed decisions

## D-?: Display model is a pure fold over events, from `viewToDisplay` or `emptyTable`  (Iteration 3)
**Context**: FR-920/921 require an animated model that ends exactly at the adopted view; P-5 puts playback in the page.
**Decision**: `applyEvent(model, event, target)` is pure and returns a new model; `target` is only used by `hand-dealt` (hand per FR-922). `viewToDisplay` gives `dealt: true`, no banner, no highlight; `emptyTable` gives `dealt: false`. `highlightSeat` is set by `bid-made`/`card-played`/`trick-won` and null otherwise. Verified by folding real in-process move responses (VC-932) and the 201 events from `emptyTable`.
**Rejected**: mutating one model in place (breaks React state); deriving the model from the target view by calculation (BR-901).
**Consequences**: Iterations 5-6 only schedule `applyEvent` with `eventDelayMs`; game-over responses end at a model that need not equal the final view, because the page renders `adopted.view` once the queue empties.

## D-?: Version guard, action capture and animation source are pure helpers  (Iteration 3)
**Context**: FR-910, FR-911, FR-916 must hold under out-of-order and retried responses.
**Decision**: `shouldAdopt` (strictly greater or nothing adopted), `captureAction` (calls `newId` exactly once; the returned object is reused verbatim by retries) and `isAnimated(source)` (true for `create` and `move` only) live in `game-state.ts` with `type UpdateSource`.
**Rejected**: calling the id source at send time (retries would change `clientRequestId`).
**Consequences**: the page passes `newClientRequestId` as `newId` and stores the captured body for retries.

## D-?: Shared UI fixtures  (Iteration 3)
**Context**: Later iterations need hand-built views alongside real in-process updates.
**Decision**: `tests/ui/support/fixtures.ts` exports `card`, `makeScoreboard`, `makeView` (4 seats, human seat 0, hand `[3,2,1]`, version 5), `makeUpdate` (version follows the view). Tests needing server consistency use `makeInProcessApi` instead.
**Rejected**: deep-partial overrides (shallow `Partial<PlayerView>` is enough).
**Consequences**: a test that overrides `seats` must supply all four seats.
