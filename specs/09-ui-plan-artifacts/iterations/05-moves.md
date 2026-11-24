# Iteration 5: Bidding, playing, retries and move responses

Commit: this commit, on `spec/09-ui`.

## Criteria results

All run as `pnpm vitest run --project ui tests/ui/<file>` unless noted.

| Criterion | Command / file | Result |
|---|---|---|
| VC-905 completion: move played from in-memory slot with `setItem` throwing | `moves.test.tsx` | PASS |
| VC-907: slot `Y` kept when page `X` reaches game over / gets 401; R-043 overwrite after mount; slot `X` gets `finished: true` / cleared | `slot-ownership.test.tsx` | PASS |
| VC-920 page: lower version changes nothing | `moves.test.tsx` | PASS |
| VC-921, VC-922, VC-923 (in-flight, retry pending, empty `legalMoves`; queue case completes in Iteration 6), VC-924 (ids `id-1`, `id-2`) | `moves.test.tsx` | PASS |
| VC-925 reject-after: identical body after 1 s, 200 at v+1, server tip v+1, next action captured at v+1 | `moves.test.tsx` | PASS |
| VC-926: 4 rejects at 0/1/3/7 s, `Reintentar` fifth send; hang aborted at 20 s; 503, `{version:9}`, 409 no update, 409 `update:{}`, 302 are failures | `moves.test.tsx` | PASS |
| VC-927, VC-928 (403, 422, 400, 413, recovery reject + `Reintentar`, recovery 404), VC-929, VC-930 | `moves.test.tsx` | PASS |
| VC-941 slot part: game over sets `finished: true` (also on load) | `slot-ownership.test.tsx` | PASS |
| `pnpm typecheck` | | PASS |
| `pnpm lint` | | PASS |
| `pnpm test` | 94 files + 1 skipped, 1682 tests + 30 skipped (`ui`: 16 files, 214 tests) | PASS |
| `pnpm build` | | PASS |

## Files

- Added: `app/_client/{bid-bar,hand,notice}.tsx` + `.module.css`, `tests/ui/moves.test.tsx`, `tests/ui/slot-ownership.test.tsx`, `tests/ui/support/moves.ts`, this record.
- Changed: `app/_client/game-page.tsx`, `app/_client/table.tsx` (optional `hand` prop), `CONTEXT.md`, `DECISIONS.md` (D-021..D-024).
- Deleted: none.

## Deviations

- `table.tsx` changed (not in Touches): optional `hand` node (D-021).
- New test helper file `tests/ui/support/moves.ts`.
- No new copy: bid buttons have no prompt (D-023).

## Gotchas

- `createStoredGame` itself POSTs, so count moves with `moveCalls(api)` (filters `/moves`).
- A fixed-response `failNext` skips the handler: fixture-based tests arm the load GET with `armLoad` and each POST with `armMove`.
- `Reintentar` is shared by the load failure and the move failure; a failed recovery GET sets `load: 'failed'` and `recoveryRef` makes the button repeat the `?since` GET.
- A notice only restarts its 4 s timer when its text changes (an action in between clears it first).

## For the next iteration

- Reducer actions added: `move-start`, `move-send`, `move-wait`, `move-failed`, `move-settled`, `notice`, `notice-clear` (D-022).
- Exposure: `state.request` is `'in-flight'` while a send is pending, `'retry-wait'` during the back-off, `'failed'` once `Reintentar` shows, else `'idle'`. `Hand`/`BidBar` get `disabled={request !== 'idle'}`.
- Where `isAnimated` goes: the `adopt` case of `gameReducer` (comment marks it) for `create` and `move`; sources already passed: `'load'` (incl. the kept 201 update, which must become `'create'`), `'move'`, `'conflict'`, `'recovery'`. `send` dispatches `adopt` with `'move'` for 200.
- Page passes `Hand interactive={queueEmpty}` and shows `BidBar` only when `queueEmpty && legalMoves.length > 0`; set `queue` and the page does the rest. `markFinished` stays keyed on the adopted view (D-024); the game-over screen must read `shownBefore` while the queue plays.
- Under fake timers use `fireEvent` and `flush(ms)` from `tests/ui/support/moves.ts` (D-020).
