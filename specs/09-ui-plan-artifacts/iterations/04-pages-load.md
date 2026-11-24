# Iteration 4: New-game page, game page load, table

Commit: this commit, on `spec/09-ui`.

## Criteria results

| Criterion | Command | Result |
|---|---|---|
| VC-900 form controls, defaults, enablement | `pnpm vitest run --project ui tests/ui/new-game.test.tsx` | PASS |
| VC-901 (non-animation): presets before create, exact body, slot, `navigate('/game/<id>')`, update kept | same | PASS |
| VC-902: presets 500; create 400; create reject; create `hang` aborted at 20 s | same (fake timers) | PASS |
| VC-903: continue link (unfinished shows; finished / no key / `{` / `gameId: 1` do not) | same | PASS |
| VC-906: zero `getItem` calls in first render of `NewGamePage` and `GamePage`, calls after effects | `new-game.test.tsx`, `load.test.tsx` | PASS |
| VC-905 (part): `setItem` throws, memory slot makes the table available; after reset `No tenés acceso...` | `pnpm vitest run --project ui tests/ui/load.test.tsx` | PASS (moving a card completes in Iteration 5) |
| VC-910, VC-911 (both cases, kept A on route B, mount after take), VC-912, VC-913 (incl. `hang`) | same | PASS |
| Strict Mode: kept path makes zero GETs (load path one GET) | same | PASS |
| VC-940 every FR-925 element incl. `Mano 3 de 28 · 3 cartas`, `(vos)` | `pnpm vitest run --project ui tests/ui/table.test.tsx` | PASS |
| VC-944 render part: clickable card is a `<button>` named `10 de picas` | same | PASS |
| typecheck / lint / test / build | `pnpm typecheck`; `pnpm lint`; `pnpm test`; `pnpm build` | PASS x4 (92 files + 1 skipped, 1647 tests + 30 skipped; `ui` project 14 files, 179 tests; routes `/` and `/game/[id]` built) |

## Files

- Added: `app/_client/{deps.tsx,new-game-page.tsx,game-page.tsx,table.tsx,card-view.tsx,memory-slot.ts}`, `app/_client/{new-game-page,game-page,table,card-view}.module.css`, `app/game/[id]/page.tsx`, `tests/ui/{new-game,load,table}.test.tsx`, `tests/ui/support/render.tsx`, this record.
- Changed: `app/page.tsx` (renders `NewGamePage`), `app/_client/copy.ts` (new keys, D-019), `CONTEXT.md`, `DECISIONS.md` (D-015..D-020).
- Deleted: none.

## Deviations

- New file `app/_client/memory-slot.ts` (plan allowed `slot.ts` or a new file; D-017).
- Extra COPY keys for labels the spec leaves open (D-019). `Cargando…` shown while the load runs.
- Tests under fake timers use `fireEvent` instead of `userEvent` (D-020).
- The kept 201 update is adopted with source `'load'`, no animation, as the plan says.

## Gotchas

- `next/link` renders fine in jsdom without the app router; no mock needed.
- `useRouter` is only called inside `RouterDeps`; tests always provide `ClientDepsProvider`.
- Reducer state is module-free but `kept-update` and `memory-slot` are module variables: call `resetClientState()` in `beforeEach`.
- `GamePage` is keyed by id in `app/game/[id]/page.tsx`; do not rely on one instance seeing two ids.
- `Reintentar` after a failed load increments an `attempt` counter; the load effect dedupes by `"<id>:<attempt>"` (D-018).
- Prettier reformats test files; run `pnpm prettier --write tests/ui app` before `pnpm lint`.

## For the next iteration

- Reducer (`game-page.tsx`): state `{ load, adopted, shownBefore, queue, display, request, notice }`; actions `load-start | load-failed | denied{status} | no-access | adopt{update, source}`. Add move actions (`request` transitions, `notice` set/clear) and bid/hand components; pass `onClick` to `CardView` for legal cards and render bid buttons from `adopted.legalMoves` (only when `queue` is empty).
- Slot helpers `resolveSlot(deps, id)` and `clearOwnSlot(deps, id)` are private in `game-page.tsx`; add the `finished: true` writer (FR-912, FR-938: re-read, only when the stored `gameId` equals `id`) beside them.
- Render helper: `renderWithDeps(ui, { api?, overrides?, strict? })` from `tests/ui/support/render.tsx` returns RTL's result plus `{ api, deps, navigated }`; `overrides` replaces any `ClientDeps` field (`storage`, `newId`, `fetch`, `navigate`, timers). `createStoredGame(api, { aiCount?, store? })` creates a game via the in-process API and stores its slot, returning `{ gameId, seatToken, update, slot }`. `resetClientState()` in `beforeEach`.
- Fake the network with `api.failNext(...)`; `makeDeps(api)` builds deps for tests that render without the helper. Timers in the fake deps call the global `setTimeout` at call time so `vi.useFakeTimers()` works; do not use `userEvent` under fake timers (D-020).
- Animation is NOT wired: the kept 201 update is adopted at once (source `'load'`), `Saltar`, the queue and `display` are unused. Iteration 6 switches `create` to `emptyTable(adopted.view)` and `move` to `viewToDisplay(shownBefore)`.
- In-memory slot: `app/_client/memory-slot.ts` (`getMemorySlot` / `setMemorySlot`).
- Table API: `<Table model toAct deck />`; `CardView` props `{ card, deck, onClick?, disabled?, dimmed? }` (button when `onClick` is given).
