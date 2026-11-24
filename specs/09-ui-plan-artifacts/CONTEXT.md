# CONTEXT — UI (Phase 9)

Last updated by: Iteration 1 (branch, test infrastructure, small pure modules). Branch `spec/09-ui`.

## Current state

- Phases 0–8 are done and frozen (`specs/00`–`specs/08-*-frozen.md`). Phase 9 (UI) is in progress: only Iteration 1 is done.
- **Done**: jsdom component-test infrastructure beside the node tests; an in-process API (real Phase 8 handlers) for UI tests; pure modules `slot`, `ids`, `cards`, `copy`, `kept-update`; `app/globals.css`; the static layer-boundary test; the Phase 8 freeze (frozen capsule added, working files removed).
- **Not done**: API client, shape checks, game state, display model, components, pages (`app/page.tsx` is still the Phase 0 placeholder), docs.
- Toolchain: Next 16.4.6, React 19.3.1, TypeScript 6.0.3 strict, Vitest 5.1.1 (Vite 8.3.8), pnpm 10.15.1. Local Node is 26 (the "Unsupported engine" WARN is expected and not fatal).
- Test totals after this iteration: `pnpm test` = 85 files passed + 1 skipped, 1496 tests passed + 30 skipped. The `ui` project alone: 7 files, 28 tests. `pnpm build` passes.
- `dependencies` are unchanged from `main`. New devDependencies (exact): `jsdom` 31.0.1, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.13. `@vitejs/plugin-react` is NOT installed (not needed, see D-001).

## File map

| Path | Contents |
|---|---|
| `vitest.config.ts` | `test.projects`: `node` (`tests/{unit,contract,api}/**/*.test.ts`) and `ui` (`tests/ui/**/*.test.{ts,tsx}`, jsdom, `setupFiles: tests/ui/setup.ts`); both share the `@` alias. |
| `tsconfig.json` | `include` now has `tests/**/*.tsx`. |
| `tests/ui/setup.ts` | `afterEach`: RTL `cleanup()`, `localStorage.clear()`. |
| `tests/ui/support/in-process-api.ts` | `makeInProcessApi`, types `InProcessApi`, `RecordedCall`, `FailMode`, `FailMatch`. |
| `tests/ui/smoke.test.tsx` | JSX renders in jsdom; presets 200 + create 201 through the in-process fetch; failure injection and abort. |
| `tests/ui/slot.test.ts`, `ids.test.ts`, `cards.test.ts`, `copy.test.ts`, `kept-update.test.ts` | Unit tests of the modules below (VC-904, VC-924 id part, VC-944 label part, verbatim copy). |
| `tests/ui/boundaries.test.ts` | VC-947 static scan of `app/**` minus `app/api/**`; exports `findSpecifiers`, `violations`; has positive controls. |
| `app/_client/slot.ts` | FR-930 slot (see Public interfaces). |
| `app/_client/ids.ts` | FR-935 request ids. |
| `app/_client/cards.ts` | FR-933/934 card labels. |
| `app/_client/copy.ts` | `COPY` (P-9). |
| `app/_client/kept-update.ts` | P-4 module variable handoff. |
| `app/globals.css` | Colour tokens (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--accent-text`, `--danger`, `--highlight`, `--card-red|black|oros|copas|espadas|bastos`), `--font`, `box-sizing`, body base. |
| `app/layout.tsx` | Imports `./globals.css`; `<html lang="es">`. |
| `specs/08-http-api-frozen.md` | Phase 8 capsule (added). 08 working files are deleted (readable from git at `7eb81ae`). |

## Public interfaces

```ts
// app/_client/slot.ts
export interface GameSlot { gameId: string; seatToken: string; deck: string; finished: boolean }
export const SLOT_KEY = 'la-podrida:game';
export function readSlot(storage: Pick<Storage,'getItem'> | null): GameSlot | null;
export function writeSlot(storage: Pick<Storage,'setItem'> | null, slot: GameSlot): boolean;
export function clearSlot(storage: Pick<Storage,'removeItem'> | null): void;

// app/_client/ids.ts
export interface CryptoLike { randomUUID?: () => string; getRandomValues?: <T extends ArrayBufferView | null>(a: T) => T }
export function newClientRequestId(cryptoLike?: CryptoLike): string; // default globalThis.crypto

// app/_client/cards.ts
export type CardColour = 'red'|'black'|'oros'|'copas'|'espadas'|'bastos';
export interface CardLabel { rank: string; suit: string; name: string; colour: CardColour }
export function cardLabel(card: Card, deck: string | undefined): CardLabel;
// rank: token ('12'/'11'/'10' for spanish R/C/S); suit: ♠♥♦♣ (french) or the word (spanish);
// name: "<rank name> de <suit word>"; colour: red for H/D, black for S/C (french), own token (spanish).

// app/_client/kept-update.ts
export function keepUpdate(gameId: string, update: PlayerUpdate): void;
export function takeKeptUpdate(gameId: string): PlayerUpdate | null; // clears in both cases

// app/_client/copy.ts — const COPY (as const). Keys:
// nameLabel, aiCountLabel, startGame, createFailed, createInvalid, continueGame,
// noAccess, newGame, accessInvalid, gameGone, gameUnsupported, loadFailed, retry,
// moveFailed, moveConflict, moveIllegal, moveUnexpected, skip, you, noBid, trumpInDealerHand, scoreSheet, close,
// liveStatus: { 'on-track', 'made-so-far', busted },
// handCompleted(handIndex), handLine(handIndex, handCount, cards)

// tests/ui/support/in-process-api.ts
export function makeInProcessApi(opts?: MakeApiOptions): InProcessApi;
interface InProcessApi {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  api: Api;                 // { deps, store (RecordingStore), service, logs } from makeApi
  calls: RecordedCall[];    // { method, path (with query), headers (lower-case), body (parsed JSON|raw|undefined), status (number|null) }
  failNext(mode: FailMode, match?: { method?: string; path?: string | RegExp }): void;
}
type FailMode = 'reject-before' | 'reject-after' | 'hang' | { status: number; body: unknown };
```

`Card` is not exported by `@/src/domain/types`; `cards.ts` uses `PlayerView['yourHand'][number]`.

## Conventions & invariants

- Layer rule (BR-902): nothing under `app/` outside `app/api/` imports a value from `src/**` or anything from `app/api/**`; only `import type` from `@/src/domain/types`. Enforced by lint (`src` part) and `tests/ui/boundaries.test.ts` (`app/api` part, and type-only/`src/domain` only).
- UI tests live in `tests/ui/**` (`.test.ts` or `.test.tsx`), run in jsdom. They import the in-process API from `./support/in-process-api`.
- Strings: only via `COPY`; tests assert `COPY.x`, not retyped sentences (the verbatim texts are typed once in `copy.test.ts`).
- CSS: tokens in `globals.css`; each component gets a `*.module.css` next to it; mobile first, one breakpoint `min-width: 768px` (P-7).
- `localStorage` only inside effects/handlers (FR-932). Slot access always through `slot.ts`.
- Handler `Response`s are copied to plain `Response`s by the in-process fetch; the handlers never see jsdom's `AbortSignal` (the `Request` is built without a signal; abort is handled in the fetch wrapper).
- Prettier: single quotes, 100 columns; `pnpm lint` runs prettier `--check` over the whole repo.

## Commands

- `pnpm test` — both projects. `pnpm vitest run --project ui` — only jsdom UI tests. `pnpm vitest run --project node` — only the old tests. One file: `pnpm vitest run --project ui tests/ui/slot.test.ts`.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:sim` (unchanged; `vitest.sim.config.ts` untouched).

## Known gaps

- No UI yet beyond the Phase 0 placeholder page and layout.
- Unspecified copy not in `COPY` (spec gives no text): dealer marker, turn marker, last-trick label, current-trick label, hand/score-sheet column headings, game-over place labels. Iterations 4–6 decide them or stop and report.
- `RecordedCall.status` is an addition to the plan's `{ method, path, headers, body }` (used by VC-945 "every request was 200/201").
- No manual or real-browser checks yet (Iteration 7).
