# Iteration 7: Full-game, security checks and responsive pass

Commit: this commit, on `spec/09-ui`.

## Criteria results

| Criterion | Command / file | Result |
|---|---|---|
| VC-945 full game (2 AIs) ends on the ranking, all 200/201, no notice, server tip = UI tip, slot `finished` | `pnpm vitest run --project ui tests/ui/full-game.test.tsx` (4 tests; ~3 s; run 4 times, stable) | PASS |
| VC-946 enabled controls and every sent moveId are legal moves of the adopted update | same file | PASS |
| VC-947 no import into `app/api`, types-only from `src/domain` | `tests/ui/boundaries.test.ts` (unchanged) + `pnpm lint` | PASS |
| VC-948 token only in `Authorization` (URLs, bodies, DOM, console, navigation) | `full-game.test.tsx` | PASS |
| VC-949 no rendered card name outside the cards seen in updates | `full-game.test.tsx` | PASS |
| Static CSS: 44px min-width and min-height on bid, card, `.button` (Saltar/Reintentar/Planilla), `.close`, game-over link; min-height on submit | `pnpm vitest run --project ui tests/ui/tap-targets.test.ts` (9 tests) | PASS |
| P-6 outcome recorded | D-028 and below | PASS |
| `MANUAL-CHECKS.md` has VC-950-VC-954 | `specs/09-ui-plan-artifacts/MANUAL-CHECKS.md` | PASS |
| `pnpm typecheck`, `pnpm lint`, `pnpm build` | | PASS |
| `pnpm test` | 99 files + 1 skipped, 1707 tests + 30 skipped | PASS |

Manual VC-950-VC-954 are NOT run and NOT marked passed: pending the human.

## P-6 outcome

Blocked by default. `pnpm dev --hostname 0.0.0.0` on Next 16.4.6: page 200; a `/_next/` asset request with `Origin: http://192.168.10.200:3000`, `Sec-Fetch-Site: cross-site` gave 403 and the HMR websocket was refused ("Blocked cross-origin request to Next.js dev resource"). Added `allowedDevOrigins` from `DEV_ALLOWED_ORIGINS` in `next.config.ts`; with the variable set, the same request gave 200 and nothing was logged. Both dev servers were killed (`pgrep next` empty). The sandbox could not connect to the LAN IP itself, so requests went to localhost with `Host`/`Origin` set to the LAN IP.

## Files

- Added: `tests/ui/full-game.test.tsx`, `tests/ui/tap-targets.test.ts`, `specs/09-ui-plan-artifacts/MANUAL-CHECKS.md`, this record.
- Changed: `next.config.ts`, `app/_client/score-sheet.module.css` (`.scroll` min/max width, panel overscroll), `CONTEXT.md`, `DECISIONS.md` (D-028..D-030).
- Deleted: none. `tests/ui/boundaries.test.ts` needed no change.

## Deviations

- No restyling of other CSS modules: the earlier iterations already had 44px minimums, wrapping lists and one breakpoint (D-030). Only the score sheet changed.
- VC-946 "sent moveId" is checked in the recording fetch at send time, not after the run.
- The tap-target check is a test, not a grep; the equivalent grep is `grep -n "min-height\|min-width" app/_client/*.module.css`.

## Gotchas

- `NewGamePage` only calls `navigate`; the test unmounts it and mounts `GamePage` on the stored id. The kept 201 update then plays without a GET.
- 201 bodies wrap the update (`{ gameId, seatToken, update }`); 200 bodies are the update. The presets 200 has no `version`: filter by shape when recording.
- A POST to `/api/games` has no `moveId`; check only paths ending `/moves`.
- A card "in the DOM" is any `[aria-label]` equal to a deck card name; this relies on FR-934.

## For the next iteration (8, docs)

- Document `DEV_ALLOWED_ORIGINS` and the LAN/iPhone steps (MANUAL-CHECKS section 6), and the CSS conventions in CONTEXT.md (tap targets, wrapping, score sheet scroll, single breakpoint).
- Document the minimal copy decisions (D-019, D-025) and the manual play-through from `MANUAL-CHECKS.md` as steps. VC-950-VC-954 stay pending until the human records them; no shipped doc may link to the spec, plan or artifact directory.
- Every D-001..D-030 entry must be reflected in section 17 or listed as internal in `08-docs.md`.
