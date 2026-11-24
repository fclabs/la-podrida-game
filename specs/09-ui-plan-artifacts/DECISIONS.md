# DECISIONS — UI (Phase 9)

## D-001: Two Vitest projects, no React plugin  (Iteration 1)
**Context**: Plan P-1. `pnpm test` must keep the node tests and add jsdom component tests.
**Decision**: `vitest.config.ts` uses `test.projects`: `node` (old `include`, `environment: 'node'`) and `ui` (`tests/ui/**/*.test.{ts,tsx}`, jsdom, `setupFiles: tests/ui/setup.ts` doing RTL `cleanup()` and `localStorage.clear()` after each test). Both set the same `@` alias. `tests/**/*.tsx` added to `tsconfig.json` `include`. `@vitejs/plugin-react` is not needed: Vitest 5 / Vite 8 compiles `.tsx` with the automatic JSX runtime (verified by `tests/ui/smoke.test.tsx`).
**Rejected**: per-file `// @vitest-environment` comments (easy to forget); adding `@vitejs/plugin-react` (unneeded dependency).
**Consequences**: `pnpm vitest run --project ui` runs only UI tests. `vitest.sim.config.ts` unchanged.

## D-002: Exact devDependency versions  (Iteration 1)
**Context**: Spec Scope requires exact pins whose peers include react 19.3, vite 8, vitest 5, and no peer warnings.
**Decision**: `pnpm add -D -E`: `jsdom` 31.0.1 (peer: optional `@napi-rs/canvas`; engines `^22.22.2 || ^24.15.0 || >=26`), `@testing-library/react` 16.3.3 (react/react-dom `^18 || ^19`, `@testing-library/dom ^10`), `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.13 (dom `>=7.21.4`). These were the latest published when chosen. No peer-dependency warnings were printed by `pnpm add` or `pnpm install --frozen-lockfile`.
**Rejected**: `@vitejs/plugin-react` 6.3.0 (not needed, D-001); ranges (`^`/`~`).
**Consequences**: `dependencies` unchanged. The pnpm "Ignored build scripts: esbuild" notice is pre-existing and unrelated.

## D-003: In-process API without jsdom global workarounds  (Iteration 1)
**Context**: Plan P-2 allows a workaround if jsdom's `Request`/`Response`/`AbortSignal` clash with the handlers.
**Decision**: No clash: jsdom does not replace `Request`/`Response`/`Headers`, so Node's are used by the handlers. The in-process `fetch` builds the handler `Request` with a byte body and without a signal (jsdom's `AbortSignal` is never passed to Node's `Request`), honours `init.signal` itself by racing the handler against an `abort` listener (rejects `AbortError` `DOMException`), and copies the handler `Response` into a new plain `Response` (status, headers, text). `makeInProcessApi(opts?: MakeApiOptions)` returns `{ fetch, api, calls, failNext }`; `failNext(mode, match?)` arms one failure, consumed by the first call matching `match`; modes `'reject-before' | 'reject-after' | 'hang' | { status, body }`. Unknown routes answer a 404 JSON. `RecordedCall` also has `status` (null when the call rejected, hung or aborted).
**Rejected**: capturing Node globals in `setup.ts` (not needed); stubbing globals.
**Consequences**: later tests use `makeInProcessApi().fetch` directly as `ClientDeps.fetch`.

## D-004: Page structure and deps context (plan P-3)  (Iteration 1)
**Context**: P-3 fixes how pages and client components are split.
**Decision**: Adopted as stated: `app/page.tsx` renders client `NewGamePage`; `app/game/[id]/page.tsx` is a server component awaiting `params` and rendering client `GamePage id`; client code gets `fetch`, `storage`, the UUID source and `navigate` from the `ClientDeps` context (`app/_client/deps.tsx`); `localStorage` only in effects/handlers. Nothing of this is built in Iteration 1; only the pure modules it relies on exist (`slot`, `ids`, `kept-update`).
**Rejected**: mocking `next/navigation` in tests.
**Consequences**: Iteration 4 creates the files.

## D-005: Kept 201 update survives Strict Mode (plan P-4)  (Iteration 1)
**Context**: Strict Mode runs effects twice; a take-once module variable would lose the update on the second run (R-037).
**Decision**: `app/_client/kept-update.ts` exports `keepUpdate(gameId, update)` and `takeKeptUpdate(gameId)` (returns the update only for a matching `gameId`; clears in both cases). `GamePage` (Iteration 4) calls it once per instance and caches the result in a `useRef` initialised to `undefined`.
**Rejected**: leaving the variable set after the first take (a later visit would replay).
**Consequences**: covered by `tests/ui/kept-update.test.ts`.

## D-006: One global stylesheet, CSS Modules per component (plan P-7)  (Iteration 1)
**Context**: No CSS framework (spec Scope).
**Decision**: `app/globals.css` (imported by `app/layout.tsx`) holds colour tokens (including the six `CardColour` tokens as `--card-*`), the base font and `box-sizing`. Components use `*.module.css` in `app/_client/`; inline `style` only for runtime-computed values; mobile first at 375 px with at most one `min-width: 768px` breakpoint.
**Rejected**: utility CSS, CSS-in-JS.
**Consequences**: later iterations add modules, not global rules.

## D-007: All copy in `COPY` (plan P-9)  (Iteration 1)
**Context**: Spanish texts are asserted by many tests.
**Decision**: `app/_client/copy.ts` exports `const COPY = {...} as const` with the exact spec strings; templates with values are functions (`handCompleted`, `handLine`). Components and tests import it; `copy.test.ts` asserts each FR text verbatim once. Texts the spec does not give are deliberately absent (see CONTEXT Known gaps).
**Rejected**: inline strings; an i18n library (spec: no language switch).
**Consequences**: a copy change is one edit plus the verbatim test.

## D-008: `Card` type derived from `PlayerView`  (Iteration 1)
**Context**: The plan and spec say `import type { Card } from '@/src/domain/types'`, but `types.ts` only imports `Card` locally and does not export it.
**Decision**: `cards.ts` uses `type Card = PlayerView['yourHand'][number]` with `import type { PlayerView } from '@/src/domain/types'`, keeping the "only `@/src/domain/types`" constraint and the lint rule.
**Rejected**: importing from `@/src/domain/cards` (allowed by lint but outside the stated rule); changing `src/**` (out of scope).
**Consequences**: later modules needing `Card` use the same derivation.

## D-009: Client calls race the abort signal  (Iteration 2)
**Context**: FR-936 requires a 20 s abort; a fetch or `json()` may ignore the signal and hang.
**Decision**: `call()` aborts an `AbortController` at 20,000 ms and also races the request against that abort, mapping any throw to `transport`.
**Rejected**: Relying on `fetch` honouring the signal (a hang would never resolve).
**Consequences**: A hung call always settles at 20 s; the timer is cleared on every settle.

## D-010: Handled 4xx without an error body keeps its status  (Iteration 2)
**Context**: FR-936 lists handled statuses but not what an unparsable error body means.
**Decision**: Return `error` with the status and `code: ''`.
**Rejected**: Mapping to `transport` (it would retry a definitive 4xx) and stopping.
**Consequences**: Callers must decide by `status`, never by a non-empty `code`.

## D-011: Timer deps typed with `clearTimeout(id: never)`  (Iteration 2)
**Context**: `deps` must be pure and accept both browser and Node timer ids (tests use fake timers).
**Decision**: `setTimeout` returns `unknown`; `clearTimeout` takes `never`, so any matching timer pair is assignable.
**Rejected**: Typing ids as `number` (breaks Node typings) or importing globals.
**Consequences**: Callers pass wrapper functions; the client never touches `window`.

## D-012: Display model is a pure fold over events, from `viewToDisplay` or `emptyTable`  (Iteration 3)
**Context**: FR-920/921 require an animated model that ends exactly at the adopted view; P-5 puts playback in the page.
**Decision**: `applyEvent(model, event, target)` is pure and returns a new model; `target` is only used by `hand-dealt` (hand per FR-922). `viewToDisplay` gives `dealt: true`, no banner, no highlight; `emptyTable` gives `dealt: false`. `highlightSeat` is set by `bid-made`/`card-played`/`trick-won` and null otherwise. Verified by folding real in-process move responses (VC-932) and the 201 events from `emptyTable`.
**Rejected**: mutating one model in place (breaks React state); deriving the model from the target view by calculation (BR-901).
**Consequences**: Iterations 5-6 only schedule `applyEvent` with `eventDelayMs`; game-over responses end at a model that need not equal the final view, because the page renders `adopted.view` once the queue empties.

## D-013: Version guard, action capture and animation source are pure helpers  (Iteration 3)
**Context**: FR-910, FR-911, FR-916 must hold under out-of-order and retried responses.
**Decision**: `shouldAdopt` (strictly greater or nothing adopted), `captureAction` (calls `newId` exactly once; the returned object is reused verbatim by retries) and `isAnimated(source)` (true for `create` and `move` only) live in `game-state.ts` with `type UpdateSource`.
**Rejected**: calling the id source at send time (retries would change `clientRequestId`).
**Consequences**: the page passes `newClientRequestId` as `newId` and stores the captured body for retries.

## D-014: Shared UI fixtures  (Iteration 3)
**Context**: Later iterations need hand-built views alongside real in-process updates.
**Decision**: `tests/ui/support/fixtures.ts` exports `card`, `makeScoreboard`, `makeView` (4 seats, human seat 0, hand `[3,2,1]`, version 5), `makeUpdate` (version follows the view). Tests needing server consistency use `makeInProcessApi` instead.
**Rejected**: deep-partial overrides (shallow `Partial<PlayerView>` is enough).
**Consequences**: a test that overrides `seats` must supply all four seats.

## D-015: ClientDeps context with a router fallback (plan P-3 as applied)  (Iteration 4)
**Context**: Components need `fetch`, storage, ids, timers and `navigate` injected, but `useRouter` throws without the app router (jsdom tests).
**Decision**: `deps.tsx` exports `ClientDeps` (extends `ApiDeps` with `storage()`, `newId`, `navigate`), `ClientDepsProvider` (the context provider, the test seam), `WithClientDeps` and `useClientDeps`. `WithClientDeps` uses the injected value when present, else wraps children in `RouterDeps`, the only place that calls `useRouter` and builds browser deps from wrapper functions (`(...a) => globalThis.fetch(...a)`, `window.setTimeout`, `window.localStorage` in try/catch). `NewGamePage` and `GamePage` are `WithClientDeps` around an inner component. `ClientDeps` is passed straight to the API functions.
**Rejected**: mocking `next/navigation`; calling `useRouter` unconditionally.
**Consequences**: tests wrap in `ClientDepsProvider` (via `renderWithDeps`) and never touch the router. `app/game/[id]/page.tsx` renders `<GamePage key={id} id={id}/>` so a route change remounts.

## D-016: GamePage reducer state (plan P-5 as applied)  (Iteration 4)
**Context**: P-5 fixes the state shape; only loading exists so far.
**Decision**: `gameReducer` in `game-page.tsx` (exported with `initialGameState`, types `GameState`, `GameAction`, `LoadStatus`). State: `load` (`init|loading|ready|no-access|invalid|gone|unsupported|failed`), `adopted`, `shownBefore`, `queue`, `display`, `request`, `notice`. Actions: `load-start`, `load-failed`, `denied{status}`, `no-access`, `adopt{update, source}`. `adopt` applies `shouldAdopt` and, for now, always takes the non-animated path (`shownBefore = adopted.view`, queue empty, `display` null); the kept 201 update uses source `'load'` here. `request`, `notice`, `queue`, `display` exist but are not driven yet. The table renders `state.display ?? viewToDisplay(adopted.view)` and passes `toAct` only when the queue is empty.
**Rejected**: building the animated adoption now (not in scope, would be untested code).
**Consequences**: Iteration 5 adds move actions; Iteration 6 makes `adopt` animated for `create`/`move` via `isAnimated`.

## D-017: The in-memory slot lives in `memory-slot.ts`  (Iteration 4)
**Context**: FR-931 needs a tab-session copy of the slot when `localStorage` cannot be written.
**Decision**: New module `app/_client/memory-slot.ts` with `getMemorySlot()` / `setMemorySlot(slot | null)` (a module variable). `NewGamePage` sets it only when `writeSlot` fails (and clears it when the write succeeds). `GamePage.resolveSlot` prefers the stored slot when its `gameId` equals the route id, else the memory slot when it matches. `clearOwnSlot` (FR-907/FR-938) re-reads the stored slot and clears it only when it matches the route id, and nulls the memory slot when it matches. The continue link on `/` reads storage only.
**Rejected**: putting it in `slot.ts` (kept pure/storage-only); showing the continue link from memory (FR-904 speaks of "a valid slot", FR-931 limits memory to the game page).
**Consequences**: tests reset it with `resetClientState()` (`tests/ui/support/render.tsx`).

## D-018: Load is deduplicated per attempt  (Iteration 4)
**Context**: P-4 fixes the kept update under Strict Mode; the GET path would otherwise run twice in dev.
**Decision**: `Game` keeps `keptRef` (`{ id, update }`, taken once per instance and id) and `startedRef` (`"<id>:<attempt>"`); an effect run for an already started key returns. `Reintentar` increments `attempt` and so repeats the GET. A late response after unmount is not guarded (React 19 ignores it).
**Rejected**: cancel flags in effect cleanup (Strict Mode would cancel the first GET and fire a second).
**Consequences**: one GET under Strict Mode; kept path makes zero GETs.

## D-019: Unspecified table copy chosen in this iteration  (Iteration 4)
**Context**: The spec gives no text for several table labels; the plan says to pick minimal Spanish labels when the spec is silent.
**Decision**: Added to `COPY`: `title` "La Podrida", `loading` "Cargando…", `dealerMarker` "Repartidor", `turnMarker` "Turno", `seatCards` "Cartas", `seatBid` "Pedido", `seatTricks` "Bazas", `trumpLabel` "Triunfo", `currentTrickLabel` "Baza actual", `lastTrickLabel` "Última baza", `lastTrickWinner(name)` "Ganó <name>", `yourHandLabel` "Tu mano", `seatFallback(seat)` "Asiento <n>". None contradicts a spec string.
**Rejected**: English labels; omitting the markers.
**Consequences**: Iterations 5-6 still need copy for bid prompts, score sheet headings and the game-over screen (record there). Not covered by the verbatim `copy.test.ts`.

## D-020: Fake-timer tests use `fireEvent`, not `userEvent`  (Iteration 4)
**Context**: Plan P-5 suggests `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`. With Vitest fake timers a `user.type`/`user.click` hung until the 5 s test timeout, even with `delay: null` (RTL's `asyncWrapper` awaits a real `setTimeout(0)` and only auto-advances for Jest's fake timers).
**Decision**: Tests that run under `vi.useFakeTimers()` set values and click with `fireEvent` inside `act`, advancing time with `await act(async () => { await vi.advanceTimersByTimeAsync(ms) })`. Tests without fake timers keep `userEvent`.
**Rejected**: `shouldAdvanceTime`/real timers (cannot assert exact 20 s).
**Consequences**: Iterations 5-6 do the same for 1/2/4 s retries and the 600/1200 ms animation steps; do not call `userEvent` while fake timers are on.

## D-021: `Table` takes an optional `hand` node  (Iteration 5)
**Context**: FR-913/FR-915 need the hand drawn with clickable cards, but `Table` (Iteration 4) draws the hand itself; rendering a second `Hand` beside it would duplicate every card name.
**Decision**: `Table` gets an optional `hand?: ReactNode` that replaces its plain card list; the page passes `<Hand/>`. Without it the plain list is unchanged (table tests untouched). `table.tsx` is not in Iteration 5's Touches; this is the smallest change that avoids duplication.
**Rejected**: giving `Table` the legal moves and a click handler (couples it to the pipeline); hiding the table's hand with CSS.
**Consequences**: Iteration 6 keeps passing `Hand` and sets `interactive={false}` while the queue plays.

## D-022: Move pipeline lives in `Game` with refs and six reducer actions  (Iteration 5)
**Context**: FR-916/917/918 need one captured body reused verbatim, a back-off chain, and several outcomes.
**Decision**: Reducer actions `move-start` (in-flight, notice cleared), `move-send` (in-flight again), `move-wait` (`retry-wait`), `move-failed` (`failed`: shows `moveFailed` + `Reintentar`), `move-settled` (`idle`), `notice{message}`, `notice-clear`. `act(moveId)` guards with `busyRef`, calls `captureAction(adopted, moveId, deps.newId)` once, stores it in `pendingRef`, and `send(body, retry)` loops through 1/2/4 s using `deps.setTimeout` (timer kept in `timerRef`, cleared on unmount; `mountedRef` stops late continuations). `Reintentar` calls `send(body, 3)` (one send, no auto retries). 403/422/400/413 call `recover(body.version, message)`: GET `?since=`, adopt as `'recovery'`, then `notice`; a failed recovery sets `load: 'failed'` and keeps `recoveryRef` so `Reintentar` repeats that GET, not the plain load. Notices clear via an effect on `state.notice` (4 s timer).
**Rejected**: a state machine library; storing the body in reducer state (a ref is enough, it never renders).
**Consequences**: `request` is the single source for "disabled" (`!== 'idle'`); Iteration 6 reads it for nothing else.

## D-023: Hand dimming and no bid-prompt copy  (Iteration 5)
**Context**: FR-915 dims non-legal cards; VC-923 dims all cards when `legalMoves` is empty; the spec gives no text for a bid prompt.
**Decision**: `Hand` dims a card when `interactive` and (some legal play exists, or no legal move exists); during bidding the cards stay plain; while `interactive` is false (queue) they are plain. `BidBar` has no heading (a `role="group"` without a name). No new `COPY` keys.
**Rejected**: a `Tu apuesta` prompt (would be invented copy).
**Consequences**: none for later iterations except that no copy was added this iteration.

## D-024: `finished: true` is written by an effect on the adopted phase  (Iteration 5)
**Context**: FR-912 says "when the adopted view has phase game-over"; FR-938 requires re-reading and ownership.
**Decision**: `markFinished(deps, id)` (beside `clearOwnSlot`) re-reads the stored slot and writes `{ ...stored, finished: true }` only when its `gameId` equals `id`; it also marks a matching in-memory slot. An effect keyed on `adopted?.view.phase === 'game-over'` calls it, so a game that loads already finished is marked too. Iteration 6 must keep this keyed on the adopted view, not the shown one.
**Rejected**: writing in the move response handler (misses the load path).
**Consequences**: `denied`/401 paths share `deny(status)` = `clearOwnSlot` + `denied`.

## D-025: Copy added for the score sheet and game over  (Iteration 6)
**Context**: FR-927 and FR-926 give no text for column headings or a game-over title; P-9 wants every string in `COPY`.
**Decision**: Added `handNumber: '#'`, `points: 'Puntos'`, `total: 'Total'`, `gameOverTitle: 'Fin de la partida'`. Headings reuse `seatCards` (`Cartas`), `seatBid` (`Pedido`), `seatTricks` (`Bazas`). The banner reuses `COPY.handCompleted` and prints `<name>: Pedido <b> · Bazas <t>` per seat. The ranking shows place, name and total as plain numbers (no label).
**Rejected**: a `Posición` heading or `puntos` suffix on totals (more invented copy).
**Consequences**: Iteration 8 documents these as minimal labels; the spec still gives no text for them.

## D-026: The queue is the not-yet-finished events; one timer per head  (Iteration 6)
**Context**: P-5 describes a `setTimeout` chain. FR-920 applies an event at its start and holds it for its delay, and `queue` empty must mean "drained".
**Decision**: `queue` holds the events not finished, head included. `adopt` of a `create` or `move` update with at least one event sets `queue = update.events`, `display = applyEvent(start, events[0])`, `shownBefore` = `null` (create) or the view shown before (the adopted view, or the one a running queue began from). An effect keyed on `queue` sets one `deps.setTimeout(tick, eventDelayMs(queue[0]))`; `tick` drops the head and applies the next event; the last tick sets `queue = []`, `display = null`, `shownBefore = adopted.view`. `skip` does the same at once. A 201/200 with no events jumps. The page renders `shown = queueEmpty ? adopted.view : shownBefore` for the score sheet, phase and `GameOver`.
**Rejected**: a `setTimeout` chain inside an async function (no clean cancel on skip or unmount).
**Consequences**: A kept 201 update is adopted with source `'create'`. Tests: one `flush(ms)` fires at most one tick (React renders and re-arms the timer after the `act` ends), so step the clock event by event.

## D-027: Page chrome buttons are not game controls in tests  (Iteration 6)
**Context**: FR-927 and FR-923 add `Planilla` (always) and `Saltar` (queue) buttons; Iteration 5 tests counted all buttons as bid/card controls.
**Decision**: `moves.test.tsx` got a `controls()` helper that drops `Planilla` and `Saltar`; its VC-925 now clicks `Saltar` before the next action because a real 200 animates. The new tests use the same filter.
**Rejected**: hiding `Planilla` while input is possible (the spec shows it at all times).
**Consequences**: Later tests counting buttons must filter the chrome.
