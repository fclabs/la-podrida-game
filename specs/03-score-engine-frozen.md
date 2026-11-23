# Frozen: Spec 03 — Score Engine

Source: specs/03-score-engine.md (plan + build record: specs/03-score-engine-plan.md, specs/03-score-engine-plan-artifacts/; review: specs/03-score-engine.review.md)
Status: SHIPPED
Frozen: 2026-11-23
PR / commit: https://github.com/fclabs/la-podrida-game/pull/4 — squash commit 40e8d55

## Purpose
The engine (spec 02) plays a full game but, by design, never scores it: it records each finished hand's bids and tricks in `GameState.completedHands` and leaves points, totals and rankings to someone else. This spec delivers that someone: the Score Engine in `src/score`, pure functions that turn a hand result into points under each preset's `ScoringSpec`, and a whole game state into a `ScoreBoard` — the per-hand score sheet (*planilla*), running totals, made/missed counts, a live status per seat for the hand in progress, and a ranking with the configured tie-break. It benefits the developers of Phases 4–9 (players and simulator, service, API, UI), who need one authoritative score that is always recomputed from the state and so can never drift from it.

## What it does
- `handPoints(scoring, bid, tricks)` applies the preset formula (made iff `t === b`), reading every number from the `ScoringSpec`. It never returns `-0` and throws `RangeError` for a non-negative-integer violation, naming the argument.
- `scoreHand(rules, result)` returns one `{ seat, bid, tricks, made, points }` per seat. It throws `RangeError` (`scoreHand: handIndex N: …`) on mismatched or empty arrays, a bad `cardsPerPlayer`, a bid outside `0…cardsPerPlayer`, a bad trick count, or `sum(tricks) ≠ cardsPerPlayer`.
- `liveStatus(bid, tricksWon, tricksLeft)` follows the Live status table below. A `null` bid counts as `on-track`.
- `rankSeats(totals, missedCount, tieBreak)` gives place = 1 + the number of seats ahead, using competition numbering (1, 1, 3), and lists entries by place, then seat.
  - A seat is ahead if it has a higher total, or, under `fewest-misses`, an equal total and fewer misses.
  - Seat order never decides a place (BR-303).
- `evaluate(state)` builds `hands`, `totals`, `madeCount`, `missedCount` and `ranking` (all of length N) from `completedHands`.
  - `live` is present iff `state.hand !== null`, with `tricksLeft = cardsPerPlayer − sum(tricksWon)`. At game over the key is absent, not `undefined`.
  - Malformed hands throw `RangeError` prefixed `state.completedHands[k]: ` or `state.hand: `. Completed hands are checked first, and only the first failure is reported.
  - It never mutates its input and shares no objects with it (FR-310).
- **Business rules.** The score is derived only from the state and is never stored in it (BR-301). `totals = Σ points` and `made + missed = hands.length` (BR-302). `src/score` is pure and imports only `src/domain`, never `src/engine` (BR-304).
- `docs/design.md` §6 and `docs/development.md` §11 Score document all of the above. Known limitations is now §12.

## Public interfaces / data

### Module exports

| Module | Exports |
|---|---|
| `src/score/formulas.ts` | `handPoints(scoring: ScoringSpec, bid: number, tricks: number): number` |
| `src/score/score-engine.ts` | `scoreHand(rules: RuleSet, result: HandResult): HandScore`; `evaluate(state: GameState): ScoreBoard`; `rankSeats(totals: readonly number[], missedCount: readonly number[], tieBreak: RuleSet['tieBreak']): ScoreBoard['ranking']`; `liveStatus(bid: number \| null, tricksWon: number, tricksLeft: number): LiveStatus`; type `LiveStatus = 'on-track' \| 'made-so-far' \| 'busted'` |

No barrel `index.ts` (same convention as specs 01–02). Domain types (`ScoringSpec`, `RuleSet`, `HandResult`, `HandScore`, `ScoreBoard`, `GameState`) come from their spec-01 modules, unchanged. `ScoreBoard.live` stays optional; `evaluate` sets it exactly per FR-308.

### Points by preset (FR-300 with preset values)

| Preset | `ScoringSpec` | Made (t = b) | Missed (t ≠ b) |
|---|---|---|---|
| argentina-fidepo | `bonus-plus-tricks` 10/1/1 | 10 + t | t |
| gamerules | `bonus-plus-bid` 10 | 10 + b | 0 |
| spain-ludoteka, mexico-bazas | `spanish` 10/5/5 | 10 + 5t | −5·\|t − b\| |

### Live status

| Condition (checked in this order) | Status |
|---|---|
| `bid === null` | `on-track` |
| `tricksWon > bid` | `busted` (too many) |
| `tricksWon + tricksLeft < bid` | `busted` (too few left) |
| `tricksWon === bid` | `made-so-far` |
| otherwise | `on-track` |

## Key decisions
- **The score is recomputed, never cached in `GameState`.** It can't drift from the state. Commit snapshots (Phases 6–7) store a derived copy.
- **Competition places, with ties listed by seat.** This applies the same way mid-game and at game over (operator decisions), and design §11 says a tie that remains is a shared win.
- **`on-track` for a seat with no bid; no `live` at game over.** Operator decisions; `live` exists only while a hand is in progress.
- **`RangeError` shape checks.** This was an operator decision: scoring never produces numbers from a corrupt state. Errors carry a fixed location prefix so tests and logs can tell where the bad data is (D-003).
- **`rankSeats` and `liveStatus` are exported.** This lets them be tested on their own and lets AI strategies use them for "what if" reasoning.

## Known limits (still true at freeze)
- **NFR-303:** `evaluate` on a 29-hand game takes < 1 ms (median, a safety ceiling); measured at ≈ 15 µs. It is cheap enough to call on every view and every AI decision.
- **NFR-302:** runtime `dependencies` are unchanged: `next, react, react-dom, zod, @noble/hashes` (`2.4.0`).
- `evaluate` doesn't cross-check `completedHands[k].handIndex === k`, `handIndex` against `handPlan`, or `phase` against `hand`; the engine's invariants guarantee those. `handPoints` trusts the `ScoringSpec` numbers.
- `ScoreBoard.live[].status` in `src/domain/types.ts` is a separate inline copy of `LiveStatus` (the domain can't import score); change both together.
- **Hand-off:** `PlayerView = { ...tableViewFor(state, seat), scoreboard: evaluate(state), finalRanking }`, where `finalRanking = scoreboard.ranking` only at game over. The simulator should assert BR-302 and `'live' in board === (state.hand !== null)` after every move. The service is the only place that combines engine and score.

## Deliberately excluded
- `PlayerView` composition, persisting the scoreboard and `final.json` (Phases 4–7); any engine or domain change.
- Target-score endings, extra tie-break hands, "Pocha" bonuses, suit multipliers, and the unclear GameRules "most common" variant.
