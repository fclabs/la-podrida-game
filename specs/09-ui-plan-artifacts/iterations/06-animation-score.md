# Iteration 6: Event animation, score sheet and game over

Commit: this commit, on `spec/09-ui`.

## Criteria results

| Criterion | Command / file | Result |
|---|---|---|
| VC-901 animation part: kept 201 starts from the empty table, no input until the queue drains | `pnpm vitest run --project ui tests/ui/animation.test.tsx` | PASS |
| VC-923 queue case: no bid button / clickable card while the queue plays | `animation.test.tsx` (VC-932, VC-933 201) | PASS |
| VC-932: 7-event queue at 0/600/1200/1800/3000/4200/4800 ms, banner 3000-4200, no turn marker, pre-move sheet, no input, final table equals a fresh load of the adopted view | `animation.test.tsx` | PASS |
| VC-933 page (200 and 201) | `animation.test.tsx` | PASS |
| VC-934 `Saltar`, VC-935 highlight | `animation.test.tsx` | PASS |
| VC-941 screen (tie for first, `Nueva partida`, no input, `finished: true`) | `game-over.test.tsx` | PASS |
| VC-942, VC-943 | `score-sheet.test.tsx` | PASS |
| VC-927 still passes (409 not animated) | `moves.test.tsx`, `animation.test.tsx` | PASS |
| FR-937 game-over screen waits for the queue | `animation.test.tsx` | PASS |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | | PASS |
| `pnpm test` | 97 files + 1 skipped, 1694 tests + 30 skipped (`ui`: 19 files, 226 tests) | PASS |

## Files

- Added: `app/_client/{banner,score-sheet,game-over}.tsx` + `.module.css`; `tests/ui/{animation,score-sheet,game-over}.test.tsx`; this record.
- Changed: `app/_client/game-page.tsx` (queue reducer, `tick`/`skip`, `Planilla`/`Saltar`, `GameOver`), `table.tsx` (banner, `data-highlight`), `copy.ts` (4 keys), `game-page.module.css`, `tests/ui/moves.test.tsx` (D-027), `CONTEXT.md`, `DECISIONS.md` (D-025..D-027).
- Deleted: none.

## Deviations

- `tests/ui/moves.test.tsx` is outside the plan's Touches: the always-present `Planilla` and the new animation broke its button counts and VC-925's follow-up action. Fixed with a `controls()` filter and a `Saltar` click (D-027). No behaviour assertion was weakened.
- The plan's "userEvent setup" hint was not used (D-020); tests use `fireEvent` and `flush`.

## Gotchas

- One `flush(ms)` advances at most one queue tick: React commits and re-arms the timer only after the `act`. Step the clock per event; `flush(60_000)` does not drain the queue.
- A real 200 from the in-process API animates; a test that needs the next legal action must click `Saltar` first.
- Right after `render` of a kept-update page (before any `flush`) the first event (`game-started`, 0 ms) is applied but not yet ticked: that is the empty-table moment.
- `ScoreSheet` and `GameOver` are inside the page; tests find rows by `tbody tr[data-state]` and `ol li[data-seat]`.

## Ambiguities flagged (none changes behaviour)

- FR-937 for a 201: "view shown before" does not exist; the sheet gets `scoreboard = null` (empty rows, empty totals) and no game-over screen.
- FR-928 does not say which row is "the current hand's"; used the shown view's `handIndex` when that hand is not in `scoreboard.hands`.
- FR-926 does not say how ties order among themselves; server order is kept (stable sort by place).
- FR-921 banner content: bid and tricks per seat, labelled with existing copy (D-025).

## For the next iteration

- Queue: see D-026. `GameState.queue`/`display`/`shownBefore` are live; kept 201 uses source `'create'`.
- Full-game test (VC-945): drive each turn by clicking `Saltar` (or stepping the clock) then reading `legalMoves` buttons; filter `Planilla`/`Saltar` from controls.
- Props: `ScoreSheet { scoreboard | null, handPlan, handIndex, seats, onClose }`, `GameOver { ranking, seats }`, `Banner { banner, seats }`.
- No responsive CSS pass done yet: the sheet panel is `position: fixed; inset: 0` with a horizontally scrollable table (4 columns per seat; wide for 6 seats).
