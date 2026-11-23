# Spec 03 — Score Engine

> Version: 0.2 · Last updated: 2026-11-22 · Status: Draft · Owner: Federico Castañeda
> Source: [`docs/implementation.md`](../docs/implementation.md) §3 Phase 3. Context: [`docs/design.md`](../docs/design.md) §5.5, §6, §11; [`docs/game_rules.md`](../docs/game_rules.md) §3.7–3.8; [`docs/architecture.md`](../docs/architecture.md) §3, §4.1.
> Builds on: [`specs/00-project-scaffold-frozen.md`](./00-project-scaffold-frozen.md) (layer rule: `src/score` imports only `src/domain`, `zod`, `@noble/hashes`), [`specs/01-domain-model-frozen.md`](./01-domain-model-frozen.md) (`ScoringSpec`, `RuleSet.tieBreak`, `HandResult`, `HandScore`, `ScoreBoard`, `GameState`, preset scoring values) and [`specs/02-engine-frozen.md`](./02-engine-frozen.md) (`completedHands` / `state.hand` hand-off; the engine never scores).
> Requirement IDs use the 3xx range. Domain types are used exactly as frozen in spec 01 and are not redefined here.

## Purpose

The engine (spec 02) plays a full game but, by design, never scores it: it records each finished hand's bids and tricks in `GameState.completedHands` and leaves points, totals and rankings to someone else. This spec delivers that someone: the Score Engine in `src/score`, pure functions that turn a hand result into points under each preset's `ScoringSpec`, and a whole game state into a `ScoreBoard` — the per-hand score sheet (*planilla*), running totals, made/missed counts, a live status per seat for the hand in progress, and a ranking with the configured tie-break. It benefits the developers of Phases 4–9 (players and simulator, service, API, UI), who need one authoritative score that is always recomputed from the state and so can never drift from it.

## Scope

**In**
- `src/score/formulas.ts`: points for one seat's bid and tricks under each of the three `ScoringSpec` kinds.
- `src/score/score-engine.ts`: `scoreHand`, `evaluate`, `rankSeats`, `liveStatus`.
- Input shape checks that throw `RangeError` on malformed hand data.
- Deleting `src/score/.gitkeep`.
- Updating `docs/design.md` §6 and `docs/development.md` (a new Score section) to match this spec.
- Unit tests in `tests/unit/score/`.

**Out**
- Composing `PlayerView` / `finalRanking` (Phase 4/7: `GameService` does `{ ...tableViewFor(…), scoreboard: evaluate(state), finalRanking }`).
- Persisting the scoreboard in commits and writing `final.json` (Phases 6–7).
- Target-score endings, extra tie-break hands, "Pocha" bonuses, suit multipliers, the unclear GameRules "most common" variant (design §11, game_rules §3.7).
- Any change to the engine, the domain types or `ScoringSpec`; the Score Engine never imports `src/engine`.
- Zod parsing of the whole state inside `evaluate` (callers hold engine-produced states; shape checks are limited to FR-308/FR-309).

## Actors

| Actor | Description | Permissions |
|---|---|---|
| GameService (Phase 7) | Builds every `PlayerView` and the terminal result | Calls `evaluate` |
| Players / AI loop and simulator (Phase 4) | Read the scoreboard inside `PlayerView`; the simulator checks scores of full games | Call every exported score function |
| Tests (this phase) | Drive the functions with hand-built results and engine-played states | Call every exported score function; may use the engine and `tests/unit/engine/helpers.ts` to produce states |

## Functional Requirements

### Formulas

- **FR-300 (Must)** — Given a `ScoringSpec`, a bid `b` and tricks `t` (non-negative integers), when `handPoints(scoring, b, t)` is called, then the bid is *made* iff `t === b`, and it returns, for `bonus-plus-tricks`: made → `bonus + perTrick·t`, missed → `missedPerTrick·t`; for `bonus-plus-bid`: made → `bonus + b`, missed → `0`; for `spanish`: made → `bonus + perTrick·t`, missed → `−missPenaltyPerTrick·|t − b|`. Formulas read the numbers from the `ScoringSpec` fields, not from constants.
- **FR-301 (Must)** — Given `b` or `t` that is not a non-negative integer, when `handPoints` is called, then it throws `RangeError` naming the offending argument and value.

### Hand score

- **FR-302 (Must)** — Given a `RuleSet` and a valid `HandResult`, when `scoreHand(rules, result)` is called, then it returns `{ handIndex: result.handIndex, perSeat }` with one entry per seat in seat order, each `{ seat, bid: bids[seat], tricks: tricks[seat], made: tricks[seat] === bids[seat], points: handPoints(rules.scoring, bids[seat], tricks[seat]) }`.
- **FR-303 (Must)** — Given a `HandResult` where `bids.length !== tricks.length` or either is empty; `cardsPerPlayer` is not an integer ≥ 1; any bid is not an integer in `0 … cardsPerPlayer` (including `null`); any trick count is not a non-negative integer; or `sum(tricks) !== cardsPerPlayer`, when `scoreHand` is called, then it throws `RangeError` whose message names the `handIndex` and the failed check.

### Live status

- **FR-304 (Must)** — Given a bid (`number | null`), `tricksWon` and `tricksLeft` (non-negative integers), when `liveStatus(bid, tricksWon, tricksLeft)` is called, then it returns `'on-track'` if `bid` is `null`; `'busted'` if `tricksWon > bid` or `tricksWon + tricksLeft < bid`; `'made-so-far'` if `tricksWon === bid`; otherwise `'on-track'`. A non-integer or negative `tricksWon`, `tricksLeft` or non-null `bid` throws `RangeError`.

### Ranking

- **FR-305 (Must)** — Given `totals` and `missedCount` arrays of equal length N and a `tieBreak`, when `rankSeats(totals, missedCount, tieBreak)` is called, then it returns N entries `{ seat, total, place }` where seat `s` is *ahead of* seat `r` iff `totals[s] > totals[r]`, or `tieBreak === 'fewest-misses'` and `totals[s] === totals[r]` and `missedCount[s] < missedCount[r]`; `place` = 1 + the number of seats ahead of the seat (competition numbering: tied seats share a place and the next place skips the shared slots, e.g. 1, 1, 3).
- **FR-306 (Must)** — Given the result of `rankSeats`, then entries are ordered by `place` ascending and, within one place, by `seat` ascending. Seat order never decides a place. Arrays of unequal length throw `RangeError`.

### Scoreboard

- **FR-307 (Must)** — Given a `GameState` with `N = seats.length`, when `evaluate(state)` is called, then it returns a `ScoreBoard` with: `hands` = `scoreHand(state.rules, r)` for each `r` of `state.completedHands`, in order; `totals[s]` = sum of seat `s`'s `points` over `hands` (`0` when there are none); `madeCount[s]` / `missedCount[s]` = number of `hands` where seat `s` made / missed; `ranking = rankSeats(totals, missedCount, state.rules.tieBreak)`. Every array has length N.
- **FR-308 (Must)** — Given `state.hand` is non-null (phase `bidding` or `playing`), when `evaluate` is called, then the board has `live` with one entry per seat in seat order, `{ seat, bid: hand.bids[seat], tricksWon: hand.tricksWon[seat], status: liveStatus(hand.bids[seat], hand.tricksWon[seat], tricksLeft) }` where `tricksLeft = hand.cardsPerPlayer − sum(hand.tricksWon)`. Given `state.hand` is `null` (game over), the board has no `live` property (`'live' in board === false`).
- **FR-309 (Must)** — Given a state where any `completedHands` entry has `bids` or `tricks` of length ≠ N, or fails FR-303; or a non-null `hand` whose `cardsPerPlayer` is not an integer ≥ 1, whose `bids` or `tricksWon` length ≠ N, any of whose `tricksWon` is not a non-negative integer, whose `sum(tricksWon) > cardsPerPlayer`, or whose non-null bid is not an integer in `0 … cardsPerPlayer`, when `evaluate` is called, then it throws `RangeError` whose message contains the literal location `completedHands[k]` (with the index `k`) or `hand`, and the failed check — also when the failure is one of FR-303's checks (`evaluate` checks before calling `scoreHand`, or rethrows with the location added).
- **FR-310 (Must)** — Given any call to `evaluate` or `scoreHand`, then the input is not mutated (deep-equal to a `structuredClone` taken before the call), and the returned board shares no mutable object with the input.

### Docs

- **FR-311 (Must)** — `docs/design.md` §6 matches this spec: the formulas of FR-300, the live-status rule of FR-304 including `'on-track'` for a `null` bid and no `live` at game over, the ranking rule of FR-305/FR-306 (competition numbering, listing order) and the `RangeError` on malformed input; and `docs/development.md` gains a "Score" section (numbered after "Engine", with later sections and cross-references renumbered) containing the module map, a usage example, the ranking and live-status rules, and how the score relates to the engine (derived from state only).

## Business Rules

- **BR-301 — Score is derived, never stored.** `evaluate` depends only on its `state` argument; the same state always yields a deep-equal board. *Rationale:* the score can always be recomputed and can never drift from the state (design §6.1). *Exceptions:* none.
- **BR-302 — Totals are consistent with the sheet.** For every board, `totals[s] = Σ hands[k].perSeat[s].points` and `madeCount[s] + missedCount[s] = hands.length`. *Rationale:* the planilla and the totals are the same numbers. *Exceptions:* none.
- **BR-303 — Ties are never broken by seat.** Two seats with equal total (and, under `fewest-misses`, equal misses) always share a place. *Rationale:* design §11 (still tied → shared win). *Exceptions:* none.
- **BR-304 — Score purity.** `src/score` performs no I/O, uses no randomness or time, and imports only `src/domain` (never `src/engine`). *Rationale:* spec 00 layer rule; architecture §3 keeps engine and score independent. *Exceptions:* none.

## Non-Functional Requirements

- **NFR-301** — `pnpm typecheck`, `pnpm lint` (0 warnings) and `pnpm test` pass, locally and in CI.
- **NFR-302** — `package.json` `dependencies` are unchanged: exactly `next, react, react-dom, zod, @noble/hashes` (`@noble/hashes` at `2.4.0`).
- **NFR-303** — `evaluate` on the final state of an `argentina-fidepo` 3-player game (29 completed hands) takes < 1 ms, measured in the test run as the median of 101 calls after 10 untimed warm-up calls. *Why 1 ms:* it is a safety ceiling, not a target: `evaluate` is a linear walk over hands × seats (expected in the microseconds) and runs on every request and every AI decision (design §5.5), so the bound catches an accidental super-linear implementation while staying robust to CI timer noise. 29 hands is the longest hand plan of the MVP default preset.

## Data & Interfaces

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

## Verification Criteria

### Formulas
- **VC-301** (FR-300): every worked example of game_rules §3.7 via `handPoints` with the preset's `ScoringSpec`: argentina-fidepo (2,2) → 12, (2,1) → 1, (2,3) → 3; spain-ludoteka (2,2) → 20, (0,0) → 10, (5,4) → −5, (5,6) → −5, (1,4) → −15. Also argentina (0,0) → 10, (0,1) → 1; gamerules (3,3) → 13, (0,0) → 10, (3,2) → 0, (0,3) → 0; mexico-bazas equals spain-ludoteka on all rows above.
- **VC-302** (FR-300): a custom `ScoringSpec` value with different numbers changes the result (e.g. a `spanish` spec cast with `perTrick: 3` gives (2,2) → 16), proving the fields are read; `handPoints` never returns `-0` (`Object.is(result, -0) === false` for every row of VC-301).
- **VC-303** (FR-301): `handPoints(s, -1, 0)`, `(s, 0, 1.5)`, `(s, NaN, 0)` → `RangeError` whose message contains the argument name and value.

### Hand score
- **VC-304** (FR-302): `scoreHand(getPreset('argentina-fidepo'), { handIndex: 4, cardsPerPlayer: 3, dealer: 2, trumpSuit: 'S', bids: [1, 0, 1], tricks: [1, 1, 1] })` → `{ handIndex: 4, perSeat: [ {seat 0, bid 1, tricks 1, made true, points 11}, {seat 1, bid 0, tricks 1, made false, points 1}, {seat 2, bid 1, tricks 1, made true, points 11} ] }`.
- **VC-305** (FR-303): each → `RangeError` naming the `handIndex`: bids length 3 / tricks length 2; empty bids and tricks; `cardsPerPlayer: 0`; a bid of `4` with `cardsPerPlayer: 3`; a `null` bid (cast); a trick of `-1`; tricks summing to `cardsPerPlayer − 1`.

### Live status
- **VC-306** (FR-304): `liveStatus(null, 0, 5)` → `on-track`; `(2, 2, 1)` → `made-so-far`; `(0, 0, 3)` → `made-so-far`; `(1, 2, 1)` → `busted`; `(3, 0, 2)` → `busted`; `(3, 1, 2)` → `on-track`; `(3, 1, 1)` → `busted`; `(2, 2, 0)` → `made-so-far`; `(1, -1, 0)` and `(1.5, 0, 0)` → `RangeError`.

### Ranking
- **VC-307** (FR-305, FR-306, BR-303): `rankSeats([30, 25, 30], [2, 1, 1], 'fewest-misses')` → `[{seat 2, total 30, place 1}, {seat 0, total 30, place 2}, {seat 1, total 25, place 3}]`; `rankSeats([30, 30, 10, 30], [1, 1, 0, 2], 'fewest-misses')` → seats in order `0, 1, 3, 2` with places `1, 1, 3, 4`; `rankSeats([30, 30, 10], [3, 0, 0], 'shared')` → seats `0, 1, 2`, places `1, 1, 3`; `rankSeats([0, 0, 0, 0], [0, 0, 0, 0], 'fewest-misses')` → every place `1`, seats `0…3`; `rankSeats([1], [0, 0], 'shared')` → `RangeError`.

### Scoreboard
- **VC-308** (FR-307, BR-302): a hand-built argentina-fidepo 3-seat state at hand index 2 (`phase 'bidding'`, a fresh hand with all bids `null`) whose `completedHands` are hand 0 `{cardsPerPlayer 17, bids [5, 1, 10], tricks [5, 1, 11]}` and hand 1 `{cardsPerPlayer 16, bids [4, 3, 8], tricks [4, 4, 8]}` → `hands` rows with points `[15, 11, 11]` and `[14, 4, 18]`; `totals [29, 15, 29]`; `madeCount [2, 1, 1]`; `missedCount [0, 1, 1]`; `ranking` `[{seat 0, total 29, place 1}, {seat 2, total 29, place 2}, {seat 1, total 15, place 3}]` (tie on 29 decided by fewer misses); a state with no `completedHands` → `hands []`, `totals`, `madeCount`, `missedCount` all `[0, 0, 0]`, every place 1.
- **VC-309** (FR-308): a `playing` hand with `cardsPerPlayer 5`, `bids [2, 3, 0, 1]`, `tricksWon [2, 0, 1, 0]` → `live` statuses `made-so-far, busted, busted, on-track`, with `bid` and `tricksWon` copied; a `bidding` hand with `bids [1, null, null, null]`, `tricksWon [0, 0, 0, 0]` → every status `on-track`, bids `[1, null, null, null]`; a game-over state (`hand: null`) → `'live' in board === false`.
- **VC-310** (FR-309): in a 3-seat game `evaluate` throws `RangeError` whose message contains the given location for: `completedHands[0]` with 2 bids; `completedHands[1]` (first hand valid) whose tricks sum ≠ `cardsPerPlayer`; `hand` with `tricksWon` of length 2; `hand` with a `tricksWon` entry of `-1`; `hand` with `cardsPerPlayer: 0`; `hand` with `sum(tricksWon) = cardsPerPlayer + 1`; `hand` with a bid of `cardsPerPlayer + 1`.
- **VC-311** (FR-310, BR-301): for every state reached in one full engine-played game (spain-ludoteka, 4 seats, last-legal-move policy via `playGame`), `structuredClone(state)` taken before `evaluate` deep-equals the state after it; two `evaluate` calls on the same state are deep-equal; mutating the returned board's `hands[0].perSeat[0]`, `totals` and `live[0]` leaves a fresh `evaluate` of the same state unchanged.
- **VC-312** (FR-307, FR-308, BR-302): for each preset at its minimum player count, playing a full game by `playGame` with the last-legal-move policy and calling `evaluate` after every move never throws; `live` is present iff `hand !== null`; on the final state `hands.length === handPlan.length`, `totals[s] = Σ hands[k].perSeat[s].points`, `madeCount[s] + missedCount[s] = hands.length`, and `ranking` has one entry per seat with place 1 for the top total.

### Docs, purity, NFRs
- **VC-313** (FR-311): `docs/design.md` §6 states the competition place numbering (an example such as `1, 1, 3`), the listing order, `on-track` for a `null` bid, no `live` at game over and the `RangeError` on malformed input; `docs/development.md` has a "Score" section listing `handPoints`, `scoreHand`, `evaluate`, `rankSeats`, `liveStatus` and both modules, numbered right after "Engine", with no stale section cross-reference (`grep` for the old Known-limitations number finds only correct references).
- **VC-314** (NFR-301, NFR-302, NFR-303, BR-304): on the final tree `pnpm typecheck && pnpm lint && pnpm test` exit 0 with 0 warnings locally and in the branch's CI run; `package.json` `dependencies` are exactly `@noble/hashes,next,react,react-dom,zod` with `@noble/hashes` `2.4.0`; a test times `evaluate` on the final argentina-fidepo 3-player state as specified in NFR-303 and asserts the median < 1 ms; `grep -rnE 'Math\.random|new Date|Date\.now|crypto\.|fetch\(|process\.|performance\.|src/engine|\.\./engine' src/score` finds nothing; `src/score/.gitkeep` no longer exists.

## Open Questions

None.

## Assumptions

- Engine-produced states satisfy `checkInvariants` (spec 02), so `evaluate` never throws on them; the FR-309 checks exist for hand-built or corrupted states.
- Tests may import `src/engine` and `tests/unit/engine/helpers.ts` (the layer rule restricts `src/score`, not `tests/`).

## Changelog

- 0.2 (2026-11-22): review pass 1 — NFR-303 rationale reframed as a safety ceiling; FR-309 adds current-hand `cardsPerPlayer` and `tricksWon` entry checks and pins the error location text (`completedHands[k]` / `hand`) also for FR-303 failures; VC-308 fixed data and expected board (incl. a misses tie-break); VC-310 rows for the new checks.
- 0.1 (2026-11-22): initial draft from implementation.md Phase 3 and discovery answers (competition place numbering 1,1,3; `on-track` for a `null` bid, `live` present whenever a hand is in progress and absent at game over; `RangeError` on malformed input; one ranking rule mid-game and at game over, ties listed by seat ascending).
