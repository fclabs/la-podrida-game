# CONTEXT — UI (Phase 9), final

Last updated by: Iteration 8 (documentation). Branch `spec/09-ui`. This describes the shipped system.

## Current state

- Phases 0–9 are built. The browser UI is complete: `/` (new game, continue link) and `/game/[id]` (table, bidding, playing, event animation, `Saltar`, score sheet, game over, resume, idempotent retries). All eight iterations are done.
- Shipped docs: `docs/development.md` §17 "UI" (overview, module map, slot, calls, versions and moves, display model, table and copy, styling, UI tests, manual play-through with LAN access, gotchas); "Known limitations" is now §18; `docs/implementation.md` §5 decision 1 reads as decided (default preset only, `rulesPreset: defaultPresetId`). The docs do not mention the spec, the plan or this directory.
- **Pending the human**: the five manual checks (VC-950 to VC-954) in `MANUAL-CHECKS.md`. They are written, not run, not claimed passed. `verify-spec` cannot return PASSED until each is recorded PASS, FAIL or WAIVED.
- Layout at 375 px is verified only by `tests/ui/tap-targets.test.ts` (static CSS) and by reasoning until the human runs the manual checks.
- Toolchain: Next 16.4.6, React 19.3.1, TypeScript 6.0.3 strict, Vitest 5.1.1 (Vite 8.3.8), pnpm 10.15.1. Local Node is 26 (the "Unsupported engine" WARN is expected and not fatal).
- Test totals at Iteration 8: `pnpm test` = 99 files passed + 1 skipped, 1707 tests passed + 30 skipped (`ui` project: 21 files, 239 tests).
- `dependencies` are unchanged from `main`. New devDependencies (exact): `jsdom` 31.0.1, `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.13. `@vitejs/plugin-react` is not installed (not needed, D-001).
- Source changes outside `app/_client` and `tests/ui`: `app/page.tsx`, `app/game/[id]/page.tsx`, `app/layout.tsx`, `app/globals.css`, `vitest.config.ts`, `tsconfig.json`, `next.config.ts` (`allowedDevOrigins`), `package.json`, `pnpm-lock.yaml`, the Phase 8 freeze housekeeping, and the docs.

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
| `app/_client/api.ts` | `ApiResult<T>`, `ApiDeps`, `API_TIMEOUT_MS`, `getPresets`, `createGame`, `getUpdate`, `submitMove` (never throw; 20 s abort). |
| `app/_client/shape.ts` | `isPlayerUpdate`, `isCreateBody`, `isPresetsBody` (FR-936 top-level checks, P-8). |
| `app/_client/api-types.ts` | `PresetEntry`, `PresetsBody`, `CreateGameRequest`, `CreateGameBody`, `MoveRequest`, `ErrorBody`. |
| `app/_client/game-state.ts` | `shouldAdopt`, `captureAction`, `isAnimated`, `type UpdateSource` (FR-910/911/916). |
| `app/_client/display.ts` | `DisplayModel`, `Banner`, `viewToDisplay`, `emptyTable`, `applyEvent`, `eventDelayMs` (FR-920–922). |
| `tests/ui/api.test.ts`, `shape.test.ts` | Stub-fetch and shape tests (100 tests). |
| `tests/ui/game-state.test.ts`, `display.test.ts` | VC-920, VC-924 (pure), VC-931–933. |
| `tests/ui/support/fixtures.ts` | `card`, `makeScoreboard`, `makeView`, `makeUpdate`. |
| `app/page.tsx`, `app/game/[id]/page.tsx` | `/` renders `NewGamePage`; `/game/[id]` is a server component awaiting `params` and rendering `<GamePage key={id} id={id}/>`. |
| `app/_client/deps.tsx` | `ClientDeps`, `ClientDepsProvider`, `WithClientDeps`, `useClientDeps` (D-015). |
| `app/_client/new-game-page.tsx` (+ `.module.css`) | `NewGamePage`: FR-900–FR-904. |
| `app/_client/game-page.tsx` (+ `.module.css`) | `GamePage`, `gameReducer`, `initialGameState`, types `GameState`, `GameAction`, `LoadStatus` (D-016); private `resolveSlot`, `clearOwnSlot`. |
| `app/_client/table.tsx` (+ `.module.css`) | `Table` (FR-925); optional `hand` node replaces the plain hand list (D-021). |
| `app/_client/bid-bar.tsx`, `hand.tsx`, `notice.tsx` (+ `.module.css`) | `BidBar` (FR-914), `Hand` (FR-913/915), `Notice` (FR-919). |
| `app/_client/banner.tsx`, `score-sheet.tsx`, `game-over.tsx` (+ `.module.css`) | `Banner` (FR-921, rendered by `Table` when `model.banner`), `ScoreSheet` (FR-927/928), `GameOver` (FR-926). |
| `tests/ui/animation.test.tsx`, `score-sheet.test.tsx`, `game-over.test.tsx` | VC-901 (anim), 923 (queue), 927 (409), 932–935, 941 (screen), 942, 943. |
| `app/_client/card-view.tsx` (+ `.module.css`) | `CardView` (FR-933/934). |
| `app/_client/memory-slot.ts` | FR-931 in-memory slot (D-017). |
| `tests/ui/support/render.tsx` | `renderWithDeps`, `makeDeps`, `createStoredGame`, `resetClientState`. |
| `tests/ui/new-game.test.tsx`, `load.test.tsx`, `table.test.tsx` | VC-900–903, 905 (part), 906, 910–913, 940, 944 (render). |
| `tests/ui/moves.test.tsx`, `slot-ownership.test.tsx` | VC-905 (completion), 907, 920–930, 941 (slot). Run under fake timers. |
| `tests/ui/support/moves.ts` | `bid`, `play` (legal moves), `errorBody`, `armLoad(api, update, gameId?)` (stores slot, arms next GET), `armMove(api, status, body)`, `flush(ms)`, `moveCalls(api)`. |
| `tests/ui/full-game.test.tsx` | VC-945-VC-949: records one game (create via `NewGamePage`, play on `GamePage`, `Saltar` each time), asserts per VC (D-029). |
| `tests/ui/tap-targets.test.ts` | Static CSS check: 44px tap targets, wrapping, score-sheet scroll, single breakpoint (D-030). |
| `next.config.ts` | `agentRules: false`; `allowedDevOrigins` from `DEV_ALLOWED_ORIGINS` (dev only, D-028). |
| `specs/09-ui-plan-artifacts/MANUAL-CHECKS.md` | Steps and result table for the five manual checks; all PENDING the human. |
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

// app/_client/deps.tsx
interface ClientDeps extends ApiDeps { storage: () => Storage | null; newId: () => string; navigate: (path: string) => void }
const ClientDepsProvider; function WithClientDeps({children}); function useClientDeps(): ClientDeps;

// app/_client/memory-slot.ts
getMemorySlot(): GameSlot | null;  setMemorySlot(slot: GameSlot | null): void;

// app/_client/table.tsx, card-view.tsx
<Table model: DisplayModel toAct: number | null deck: string | undefined hand?: ReactNode />
<BidBar legalMoves disabled onBid(moveId) />  <Hand cards deck legalMoves interactive disabled onPlay(moveId) />  <Notice message />
<CardView card deck onClick? disabled? dimmed? />   // <button> when onClick, else <span role="img">, aria-label = card name
<Banner banner seats />
<ScoreSheet scoreboard: ScoreBoard | null handPlan: number[] handIndex: number seats: {seat,name}[] onClose />  // role=dialog, rows tbody tr[data-row][data-state=done|live|empty], totals tfoot tr
<GameOver ranking: NonNullable<PlayerView['finalRanking']> seats: {seat,name}[] />  // ol li[data-seat], link `Nueva partida`
// Table seats carry data-highlight="true" on the acting seat (FR-924).
// COPY also has (Iteration 6, D-025): handNumber, points, total, gameOverTitle.
// COPY also has: title, loading, dealerMarker, turnMarker, seatCards, seatBid, seatTricks, trumpLabel,
// currentTrickLabel, lastTrickLabel, lastTrickWinner(name), yourHandLabel, seatFallback(seat) (D-019)

// tests/ui/support/render.tsx
renderWithDeps(ui, { api?, overrides?: Partial<ClientDeps>, strict? }) => RTL result + { api, deps, navigated: string[] }
makeDeps(api, overrides?, navigate?): ClientDeps;  resetClientState(): void;
createStoredGame(api, { aiCount?, store? }) => { gameId, seatToken, update, slot }   // also writes the slot unless store:false

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

```ts
// app/_client/api.ts
interface ApiDeps { fetch: typeof fetch; setTimeout: (h: () => void, ms: number) => unknown; clearTimeout: (id: never) => void }
getPresets(deps): Promise<ApiResult<PresetsBody>>;                                  // 200
createGame(deps, body: CreateGameRequest): Promise<ApiResult<CreateGameBody>>;      // 201, 400
getUpdate(deps, gameId, token, since?: number): Promise<ApiResult<PlayerUpdate>>;    // 200, 401, 404, 410
submitMove(deps, gameId, token, body: MoveRequest): Promise<ApiResult<PlayerUpdate>>; // 200; 409+update -> conflict; 400/401/403/404/410/413/422 -> error
// Build ApiDeps from wrapper functions (e.g. (...a) => globalThis.fetch(...a)); bare fetch risks illegal invocation.

// app/_client/game-state.ts
export type UpdateSource = 'create' | 'move' | 'load' | 'conflict' | 'recovery';
export function shouldAdopt(current: PlayerUpdate | null, incoming: PlayerUpdate): boolean;
export function captureAction(adopted: PlayerUpdate, moveId: string, newId: () => string): { version: number; moveId: string; clientRequestId: string };
export function isAnimated(source: UpdateSource): boolean; // create|move only

// app/_client/display.ts
export interface Banner { handIndex: number; perSeat: { seat: number; bid: number; tricks: number }[] }
export interface DisplayModel { seats; handIndex; handPlan; dealer; trumpCard; trumpCardInDealerHand; yourHand; currentTrick; lastTrick; you; banner: Banner | null; highlightSeat: number | null; dealt: boolean }
export function viewToDisplay(view: PlayerView): DisplayModel;
export function emptyTable(view: PlayerView): DisplayModel;
export function applyEvent(model: DisplayModel, event: GameEvent, target: PlayerView): DisplayModel; // pure
export function eventDelayMs(event: GameEvent): number;

// tests/ui/support/fixtures.ts
makeView(o?: Partial<PlayerView>): PlayerView;   // 4 seats, human seat 0; seats override must supply all four
makeUpdate(o?): PlayerUpdate;  makeScoreboard(o?, seats?): ScoreBoard;  card(rank, suit): Card;
```

`Card` is not exported by `@/src/domain/types`; `cards.ts` uses `PlayerView['yourHand'][number]`.

## Conventions & invariants

- Layer rule (BR-902): nothing under `app/` outside `app/api/` imports a value from `src/**` or anything from `app/api/**`; only `import type` from `@/src/domain/types`. Enforced by lint (`src` part) and `tests/ui/boundaries.test.ts` (`app/api` part, and type-only/`src/domain` only).
- UI tests live in `tests/ui/**` (`.test.ts` or `.test.tsx`), run in jsdom. They import the in-process API from `./support/in-process-api`.
- Strings: only via `COPY`; tests assert `COPY.x`, not retyped sentences (the verbatim texts are typed once in `copy.test.ts`).
- CSS: tokens in `globals.css`; each component gets a `*.module.css` next to it; mobile first, one breakpoint `min-width: 768px` (P-7).
- `localStorage` only inside effects/handlers (FR-932). Slot access always through `slot.ts`.
- Handler `Response`s are copied to plain `Response`s by the in-process fetch; the handlers never see jsdom's `AbortSignal` (the `Request` is built without a signal; abort is handled in the fetch wrapper).
- Client calls never throw; every unhandled outcome is `transport`; the token travels only in `Authorization`; every call is aborted at 20,000 ms (D-009). A handled 4xx without an error body gives `error` with `code: ''`; decide by `status` (D-010).
- Display code never mutates models; each event returns a new model. Queue start: `emptyTable(adopted.view)` for a `create` update, `viewToDisplay(shownBefore)` for `move`; when the queue empties render `viewToDisplay(adopted.view)`.
- Component tests: wrap in `ClientDepsProvider` through `renderWithDeps`; never mock `next/navigation`. Call `resetClientState()` in `beforeEach` (kept update and memory slot are module variables). Under `vi.useFakeTimers()` use `fireEvent` and `act(async () => vi.advanceTimersByTimeAsync(ms))`, not `userEvent` (D-020). The fake deps' timers call the global `setTimeout` at call time.
- Page rules: slot read only in effects; the page uses the stored slot if its `gameId` equals the route id, else the in-memory slot; slot changes only when the stored `gameId` equals the route id, re-read first (FR-938). The load effect dedupes by `"<id>:<attempt>"` (Strict Mode, D-018).
- Queue (D-026): `GameState.queue` = events not finished (head is shown); `tick` / `skip` actions; an effect keyed on `queue` arms one `deps.setTimeout` per head. `shown = queueEmpty ? adopted.view : shownBefore` feeds the score sheet, phase and `GameOver` (FR-937); `shownBefore` is `null` for a 201. Table `toAct` is `null` while the queue plays. `finished: true` stays keyed on the adopted phase (D-024).
- Tests under fake timers: one `flush(ms)` fires at most one queue tick (renders re-arm the timer after `act`); step the clock per event. Filter `Planilla`/`Saltar` when counting game controls (D-027).
- Move pipeline (`game-page.tsx`, D-022): `request` (`idle|in-flight|retry-wait|failed`) is the one "disabled" flag; reducer actions `move-start|move-send|move-wait|move-failed|move-settled|notice|notice-clear` besides the Iteration 4 ones. The captured body is in `pendingRef` and every send reuses it. Responses: 200 adopt `'move'`; 409 adopt `'conflict'` + notice; 403/422 and 400/413 `recover(since, message)`; 401/404/410 `deny`. `markFinished` and `clearOwnSlot` re-read the slot first (FR-938).
- CSS conventions (Iteration 7): tap targets declare `min-width` and `min-height` >= 44px (`.bid`, `.card`, game-page `.button`, `.close`, `.link`); lists of cards, bid buttons and seats use `flex-wrap: wrap`; the score sheet is a fixed full-screen panel (`overflow: auto`) whose table sits in `.scroll` (`overflow-x: auto; max-width: 100%`) so only it scrolls sideways; one breakpoint, `@media (min-width: 768px)`. Keep these or update `tap-targets.test.ts`.
- Full-game test: real timers, click `Saltar` before reading controls, filter `Planilla`/`Saltar`/`Reintentar` when counting controls.
- LAN dev access: `DEV_ALLOWED_ORIGINS=<ip>[,<ip>] pnpm dev --hostname 0.0.0.0` (Next 16 blocks cross-origin dev requests otherwise).
- Prettier: single quotes, 100 columns; `pnpm lint` runs prettier `--check` over the whole repo.

## Commands

- `pnpm test` runs both projects. `pnpm vitest run --project ui` only the jsdom UI tests (~5 s). `pnpm vitest run --project node` only the old tests. One file: `pnpm vitest run --project ui tests/ui/slot.test.ts`.
- `pnpm typecheck`, `pnpm lint` (eslint plus prettier over the whole repo, docs included), `pnpm build`, `pnpm test:sim` (unchanged; `vitest.sim.config.ts` untouched).
- `FILE_STORE_DIR=/tmp/podrida pnpm dev` for manual play; add `DEV_ALLOWED_ORIGINS=<LAN IP>` and `--hostname 0.0.0.0` for a phone.

## Known gaps

- The display model has no turn marker or legal moves (the page takes them from the adopted update when the queue is empty); `game-over` responses are not foldable to the final view by design.
- `ScoreSheet` live row uses the shown view's `handIndex`; its `Total` cell on a live row is empty; ties keep the server's order.
- Minimal copy was chosen where the spec gave none (D-019, D-025); no bid prompt exists (D-023).
- `RecordedCall.status` is an addition to the plan's `{ method, path, headers, body }`.
- Stale statements left in `README.md` (outside this iteration's binding scope): it says the browser UI is "built in a later phase", that opening `/` shows "a page titled La Podrida" only, and that `pnpm test` runs only `tests/unit`, `tests/contract` and `tests/api`. A follow-up should update them.
- No real-browser automated test (out of scope); no polling; one remembered game.
