# Frozen: Spec 09 — UI

Source: [`specs/09-ui.md`](./09-ui.md)
Status: SHIPPED
Frozen: 2026-11-27
PR / commit: https://github.com/fclabs/la-podrida-game/pull/12 (squash commit `5517830`)

## Purpose

The game can be played end to end over HTTP (Phase 8), but only with `curl`. This spec delivers the browser UI from design §10: a new-game page and a game table where the one human seat plays against 2–5 AIs. The UI holds the latest `PlayerUpdate`, offers only the server's legal moves, replays the returned events as an animation before showing the new view, shows the score sheet and the final ranking, resumes a game after a reload, and survives transport failures without applying a move twice. It never computes game rules or scores. It completes the first part of milestone M3: a full default-preset game playable in the browser on `pnpm dev`. It benefits the human player, and Phase 11, which deploys it.

## What it does

- `/` shows a form (name, max 40 chars; 2–5 rivals, default 3); the submit is disabled while the trimmed name is empty or a create is in flight.
- On submit it reads `GET /api/presets`, then calls `POST /api/games` with `{ humanName, aiCount, rulesPreset: defaultPresetId }`. Any failure leaves no slot and shows a Spanish message (400 has its own).
- On 201 it writes the slot, hands the 201 update over in memory, navigates to `/game/<gameId>` and animates the opening events from an empty table.
- `/` offers `Continuar partida` only for a valid, unfinished slot.
- `/game/[id]` without a matching slot shows "no access" and makes no API call. With a matching slot and no kept update it loads with `GET /api/games/<id>`: 401/404/410 clear the slot and show a message; transport/5xx keep it and offer `Reintentar`.
- The UI adopts an update only if its `version` is greater than the adopted one. 201 and 200 move responses queue their events; page load, 409 and recovery updates replace the shown view at once.
- A finished game sets `finished: true` in the slot.
- Bid buttons (one per legal bid, ascending) and clickable cards (only legal plays; others dimmed) appear only when the queue is empty and `legalMoves` is non-empty, and are disabled while a move is in flight or awaiting retry.
- A click captures `{ version, moveId, clientRequestId }` once; every retry sends that identical body.
- Transport failures retry after 1 s, 2 s, 4 s, then show `Reintentar`. Every call aborts at 20 s.
- Move responses: 200 adopts; 409 adopts `update` and shows a notice; 403/422 (and 400/413 with another message) recover via `GET ?since=<adopted version>`; 401/404/410 behave as on load. Notices vanish after 4 s or on the next action.
- Queued events play one at a time on a display model with fixed delays (`hand-dealt`, `bid-made`, `card-played` 600 ms; `trick-won`, `hand-completed` 1200 ms; `game-started`, `game-over` 0 ms). While the queue runs there is no turn marker or input, and the score sheet and phase stay as before. `Saltar` empties the queue and shows the adopted view. The acting seat is highlighted (Should).
- The table shows seats (name, `(vos)`, cards, bid, tricks, dealer and turn markers), trump card, current and last trick, the `Mano N de M · K cartas` line and the human's hand.
- The game-over screen shows `finalRanking` with tied places equal and a `Nueva partida` link.
- `Planilla` opens a score sheet with one row per `handPlan` entry, running totals, a totals row and live status (`En camino`, `Cumplida`, `Pasada`) for the current hand.
- The slot is one `localStorage` key, `la-podrida:game`; unreadable or malformed values count as no slot. It is read only after mount; if it cannot be written the game runs from an in-memory copy. A page changes the slot only when the slot's `gameId` equals its route `id`.
- Cards are CSS boxes with rank and suit from the slot's deck (`french-52` or `spanish-40`, unknown falls back to `french-52`) and Spanish accessible names. A clickable card is a `<button>`.
- `clientRequestId` is `crypto.randomUUID()` or a v4 UUID built from `crypto.getRandomValues`.
- `docs/development.md` has §17 "UI" (Known limitations is §18); `docs/implementation.md` §5 decision 1 is decided.
- Rules:
  - The server is the only rules authority; the UI only does display bookkeeping and sums given points.
  - No file under `app/` outside `app/api/` imports from `app/api/**`, or any value from `src/**`.
  - Each user action is applied at most once (same body on every send).
  - The adopted version never decreases.
  - The seat token is sent only in `Authorization` to `/api/games/<id>` routes and never put in a URL, logged or rendered.
  - The UI renders only what an adopted update or queued event contains.

## Public interfaces / data

### API usage (per spec 08; no changes)

| Call | When | Body / query | Handled statuses |
|---|---|---|---|
| `GET /api/presets` | New game | – | 200 → `{ defaultPresetId, presets[].deck }`; else FR-903 |
| `POST /api/games` | New game | `{ humanName, aiCount, rulesPreset }` | 201; 400 and else → FR-903 |
| `GET /api/games/{id}` | Page load | – | 200; 401/404/410 → FR-907; ≥ 500 / transport → FR-908 |
| `GET /api/games/{id}?since=v` | After 403/422/400/413 on a move | – | as page load |
| `POST /api/games/{id}/moves` | Bid / play | `{ version, moveId, clientRequestId }` | FR-918 |

All requests use `cache: 'no-store'` and the 20 s timeout and transport-failure rule of FR-936. Authenticated calls send `Authorization: Bearer <seatToken>`.

### Types

Imported with `import type` from `@/src/domain/types`: `PlayerUpdate`, `PlayerView`, `GameEvent`, `LegalMove`, `Card`, `ScoreBoard`. The presets and create responses and the error body are typed locally in `app/_client` (spec 08 shapes), because the UI may not import `app/api/_lib`.

### Client modules (`app/_client/`)

Pure modules have no React; `fetch`, `Storage`, the UUID source and timers are passed in, so `tests/ui` can test them directly:

```ts
// slot.ts — FR-930/931
export interface GameSlot { gameId: string; seatToken: string; deck: string; finished: boolean }
export function readSlot(storage: Pick<Storage, 'getItem'> | null): GameSlot | null;
export function writeSlot(storage: Pick<Storage, 'setItem'> | null, slot: GameSlot): boolean; // false on failure
export function clearSlot(storage: Pick<Storage, 'removeItem'> | null): void;

// api.ts — one result type for every call; never throws
export type ApiResult<T> =
  | { kind: 'ok'; status: number; body: T }
  | { kind: 'conflict'; update: PlayerUpdate }          // 409 on a move (FR-918)
  | { kind: 'error'; status: number; code: string }     // a 4xx handled for this call by its FR
  | { kind: 'transport' };                              // per FR-936

// game-state.ts — FR-910, FR-916
export function shouldAdopt(current: PlayerUpdate | null, incoming: PlayerUpdate): boolean;
export function captureAction(adopted: PlayerUpdate, moveId: string, uuid: () => string):
  { version: number; moveId: string; clientRequestId: string };

// display.ts — FR-920–922, FR-937
export interface DisplayModel { /* TableView fields the table renders, plus banner */ }
export function applyEvent(model: DisplayModel, event: GameEvent, target: PlayerView): DisplayModel;
export function eventDelayMs(event: GameEvent): number;

// cards.ts — FR-933/934
export function cardLabel(card: Card, deck: string): { rank: string; suit: string; name: string; colour: string };
```

Exact names may change in the plan; the behaviour above may not. (At freeze the shipped names are in `app/_client/`; see `docs/development.md` §17.)

## Key decisions

- Both pages are client components: everything they show depends on `localStorage` and the seat token, which the server never sees outside an API call.
- CSS Modules, no framework, no card images: zero new runtime dependencies.
- Automated tests run in jsdom only, no Playwright: CI stays simple and fast. Layout and tap-target NFRs and real-browser behaviour are checked only manually and can regress unnoticed.
- UI tests run against the real handlers and `GameService` on `MemoryObjectStore`, so a contract mismatch with spec 08 fails a test.
- The 201 update is handed over in memory: it saves a GET and lets the opening AI bids animate; a hard navigation falls back to a plain load.
- Only 201 and 200 move responses animate: 409 and recovery updates can span several of the human's own actions, whose hands the client does not know.
- Retry policy (20 s timeout, 3 retries at 1/2/4 s, then a manual button) is safe because the server dedupes by `clientRequestId` (spec 07).
- The deck is learned from `GET /api/presets` because the view has no deck field and suit `C` is ambiguous; sending `rulesPreset: defaultPresetId` keeps the stored deck consistent with the created game.

## Known limits (still true at freeze)

- Default preset only; one human seat (seat 0); one remembered game per browser.
- Evergreen browsers only (latest two of Chrome, Edge, Firefox, Safari incl. iOS); no polyfills.
- Phone layout at 375 × 667 without horizontal scroll, worst cases 6 seats × 8 cards and 3 seats × 17 cards with a 29-row score sheet; every bid button, card, `Saltar`, `Reintentar`, `Planilla` and `Cerrar` is at least 44 × 44 px.
- Firefox and iOS Safari over a LAN IP were **not** manually verified (VC-954 WAIVED); the `crypto.randomUUID` fallback is covered in jsdom only.
- The UI must not import `app/api/_lib` (it pulls in server-only `src/state`).
- `pnpm test` also runs `tests/ui/**` in jsdom.

## Deliberately excluded

- Preset choice, spectating, multi-human games, accounts, language switch, card images, animation speed control.
- Polling or push, Playwright or any real-browser automated test, and any change to `src/**`, `app/api/**` or the HTTP contract.
