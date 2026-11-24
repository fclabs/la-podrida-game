# Manual checks (VC-950 to VC-954)

These need a real browser and a person. Automated tests (jsdom) cannot cover them. Record every
result in the tables below. A check that is not run must be recorded as `WAIVED` with a reason,
never as `PASS`. `verify-spec` cannot return PASSED while any row is blank.

Status of this file: **all five checks are PENDING the human** (written in Phase 9 Iteration 7).

## 0. Setup

1. From the repo root: `pnpm install` (once), then start the dev server with the file store (the
   default outside Vercel; games are written to `.data/`):

   ```sh
   FILE_STORE_DIR=/tmp/podrida pnpm dev --hostname 0.0.0.0
   ```

   Using `FILE_STORE_DIR=/tmp/podrida` keeps `.data/` clean and makes commit counting easy (below).
   For a phone, also pass the phone-facing host (section 6).
2. Open `http://localhost:3000` in Chrome. Open DevTools (Console and Network tabs). Keep the Console
   open for the whole session: any React error or hydration warning fails NFR-905.
3. Counting server commits of a game: each applied action adds one file under
   `<FILE_STORE_DIR>/games/<gameId>/commits/`. The game id is in the page URL (`/game/<gameId>`).

   ```sh
   ls /tmp/podrida/games/<gameId>/commits | wc -l
   ```

4. To start from a clean state: stop the server, `rm -rf /tmp/podrida`, clear the site's
   `localStorage` (DevTools, Application, Local Storage, delete `la-podrida:game`), restart.

## 1. VC-950: full game with 5 AIs in Chrome

1. On `/`, type a name, choose 5 rivals, press `Empezar partida`.
2. Play to the end: when a bid row appears press any number; when cards are clickable press any
   card. Use `Saltar` when you do not want to watch the animation.
3. Open `Planilla` at least once mid-game and once at the end.

Pass when: the game-over screen (`Fin de la partida`) appears with a ranking, and the `Planilla`
totals match the ranking totals. No notice or error text appears during normal play.

## 2. VC-951: reload mid-hand

1. Start a game (any AI count). Bid, then play at least one card.
2. Note your hand, the bids and the trick counts. Reload the page (F5).
3. Open `/` in a new tab.

Pass when: after the reload the same hand number, the same cards in your hand, the same bids and
trick counts are shown, and play continues to the end of the hand. `/` in the new tab shows
`Continuar partida`.

## 3. VC-952: offline retry (idempotent move)

Case A, recovery before the third retry:
1. Mid-hand, note the commit count (section 0, step 3).
2. DevTools, Network, throttling set to `Offline`. Click a card (or a bid button).
3. Wait about 3 s (retries go at 1 s and 2 s after the first failure), then set the throttling back to
   `No throttling` before the 4 s retry.

Case B, `Reintentar`:
1. Repeat step 1-2, but stay offline until `Reintentar` and the failure message appear (about 7 s).
2. Set the network back online and click `Reintentar`.

Pass when, in both cases: the move is applied once (commit count rises by exactly 1 for that
action, not 2) and the UI shows the next state.

## 4. VC-953: phone layout at 375 x 667

DevTools, device toolbar, Responsive, 375 x 667 (or iPhone SE). For each case below, check with the
score sheet closed and then open (`Planilla`); close it with `Cerrar`.

How to reach each NFR-901 case (default preset, deck `french-52`; the first hand is the largest:
17 cards for 3 seats (29 hands: 17 down to 4 and back up), 8 cards for 6 seats (14 hands)):

- Case (a), 6 seats at an 8-card hand: start with 5 rivals. The first hand has 8 cards (bid buttons
  0 to 8). Check it right after the first animation ends.
- Case (b), 3 seats at a 17-card hand: start with 2 rivals. The first hand has 17 cards (bid
  buttons 0 to 17). The score sheet has 29 rows for this game; open it from the first hand on.

Pass when, for both cases, open and closed: no horizontal page scroll (the body never scrolls
sideways; the score sheet table may scroll inside its own box); every bid button and every card is
visible and tappable without sideways scrolling; and the measured size (DevTools, hover or Computed
tab) of a card, a bid button, `Saltar`, `Reintentar` (force it by going offline as in VC-952),
`Planilla` and `Cerrar` is each at least 44 x 44 px. Also check `/` at 375 px (no sideways scroll).

## 5. VC-954: Safari on iOS and Firefox

Firefox (desktop): repeat VC-950 for one hand at least. Safari on iOS: see section 6 for access.
Over plain `http://<LAN IP>:3000`, `crypto.randomUUID` is unavailable, so this also checks the id
fallback (FR-935).

Pass when: moves are accepted, there is no layout break, and the console shows no errors and no
hydration warnings (on iOS use Safari's Web Inspector from a Mac, or Develop menu).

## 6. Reaching the dev server from an iPhone (P-6)

Next 16 blocks cross-origin dev requests (the HMR websocket and `/_next/` dev resources) from any
host that is not `localhost` unless it is listed in `allowedDevOrigins`; the page then loads but live
reload fails and the console shows "Blocked cross-origin request". This repo reads the list from
`DEV_ALLOWED_ORIGINS` (comma separated hosts, no scheme, no port). This applies to `pnpm dev` only.

1. Phone and computer on the same Wi-Fi. Find the computer's LAN IP: `ipconfig getifaddr en0` (macOS).
2. Restart the server with that IP allowed:

   ```sh
   DEV_ALLOWED_ORIGINS=<LAN IP> FILE_STORE_DIR=/tmp/podrida pnpm dev --hostname 0.0.0.0
   ```

3. On the iPhone open `http://<LAN IP>:3000`. If the computer has a firewall, allow incoming
   connections for Node.

## Results

Fill in: date, browser and version, OS, `PASS` / `FAIL` / `WAIVED`, notes.

| VC | Check | Date | Browser / OS | Result | Notes |
|----|-------|------|--------------|--------|-------|
| VC-950 | Full game, 5 AIs, Chrome | | | | |
| VC-951 | Reload mid-hand, continue link | | | | |
| VC-952 | Offline retry A (before third retry) | | | | |
| VC-952 | Offline retry B (`Reintentar`) | | | | |
| VC-953 | 375 px, case (a) closed / open | | | | |
| VC-953 | 375 px, case (b) closed / open | | | | |
| VC-953 | Tap targets >= 44 x 44 | | | | |
| VC-954 | Firefox, one hand | | | | |
| VC-954 | Safari iOS over LAN IP, one hand | | | | |
