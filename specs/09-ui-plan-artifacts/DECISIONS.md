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
