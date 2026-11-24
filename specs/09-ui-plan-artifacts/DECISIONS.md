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
