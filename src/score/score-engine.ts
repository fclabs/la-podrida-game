import type { RuleSet } from '@/src/domain/rules';
import type { GameState, HandResult, HandScore, ScoreBoard } from '@/src/domain/types';
import { handPoints } from './formulas';

/** A seat's status in the hand in progress. */
export type LiveStatus = 'on-track' | 'made-so-far' | 'busted';

/** Throws `RangeError` unless `value` is a non-negative integer. */
function assertNonNegativeInt(fn: string, name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${fn}: ${name} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Live status of one seat in the hand in progress, checked in this order: `null` bid →
 * `'on-track'`; `tricksWon > bid` or `tricksWon + tricksLeft < bid` → `'busted'`;
 * `tricksWon === bid` → `'made-so-far'`; otherwise `'on-track'`.
 *
 * @throws RangeError when `tricksWon`, `tricksLeft` or a non-null `bid` is not a non-negative
 *   integer.
 */
export function liveStatus(bid: number | null, tricksWon: number, tricksLeft: number): LiveStatus {
  if (bid !== null) assertNonNegativeInt('liveStatus', 'bid', bid);
  assertNonNegativeInt('liveStatus', 'tricksWon', tricksWon);
  assertNonNegativeInt('liveStatus', 'tricksLeft', tricksLeft);
  if (bid === null) return 'on-track';
  if (tricksWon > bid) return 'busted';
  if (tricksWon + tricksLeft < bid) return 'busted';
  if (tricksWon === bid) return 'made-so-far';
  return 'on-track';
}

/**
 * Ranks seats by total. Seat `s` is ahead of seat `r` iff `totals[s] > totals[r]`, or
 * `tieBreak === 'fewest-misses'` and the totals are equal and `missedCount[s] < missedCount[r]`.
 * `place` = 1 + the number of seats ahead (competition numbering: 1, 1, 3). Entries are listed
 * by `place` ascending, then `seat` ascending; seat order never decides a place.
 *
 * @throws RangeError when `totals` and `missedCount` have different lengths.
 */
export function rankSeats(
  totals: readonly number[],
  missedCount: readonly number[],
  tieBreak: RuleSet['tieBreak'],
): ScoreBoard['ranking'] {
  if (totals.length !== missedCount.length) {
    throw new RangeError(
      `rankSeats: totals and missedCount must have equal length, got ${totals.length} and ${missedCount.length}`,
    );
  }
  const isAhead = (r: number, s: number): boolean =>
    totals[r] > totals[s] ||
    (tieBreak === 'fewest-misses' && totals[r] === totals[s] && missedCount[r] < missedCount[s]);
  const entries = totals.map((total, seat) => {
    let ahead = 0;
    for (let r = 0; r < totals.length; r++) if (isAhead(r, seat)) ahead++;
    return { seat, total, place: 1 + ahead };
  });
  return entries.sort((a, b) => a.place - b.place || a.seat - b.seat);
}

/** `true` iff `value` is an integer in `min … max` (inclusive). */
function isIntIn(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/** Sum of a number array (`0` when empty). */
function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/**
 * Scores one completed hand: one entry per seat in seat order with the seat's bid, tricks,
 * whether the bid was made (`tricks === bid`) and its `handPoints` under `rules.scoring`.
 *
 * Checks, in this order, and throws on the first failure: `bids` and `tricks` have equal,
 * non-zero length; `cardsPerPlayer` is an integer ≥ 1; every bid is an integer in
 * `0 … cardsPerPlayer`; every trick count is a non-negative integer; `sum(tricks) ===
 * cardsPerPlayer`.
 *
 * @throws RangeError `scoreHand: handIndex <n>: <check>` on malformed `result`.
 */
export function scoreHand(rules: RuleSet, result: HandResult): HandScore {
  const { handIndex, cardsPerPlayer, bids, tricks } = result;
  const fail = (check: string): never => {
    throw new RangeError(`scoreHand: handIndex ${handIndex}: ${check}`);
  };
  if (bids.length !== tricks.length) {
    fail(`bids and tricks must have equal length, got ${bids.length} and ${tricks.length}`);
  }
  if (bids.length === 0) fail('bids and tricks must not be empty');
  if (!isIntIn(cardsPerPlayer, 1, Infinity)) {
    fail(`cardsPerPlayer must be an integer >= 1, got ${cardsPerPlayer}`);
  }
  bids.forEach((bid, seat) => {
    if (!isIntIn(bid, 0, cardsPerPlayer)) {
      fail(`bids[${seat}] must be an integer in 0…${cardsPerPlayer}, got ${bid}`);
    }
  });
  tricks.forEach((t, seat) => {
    assertNonNegativeInt(`scoreHand: handIndex ${handIndex}`, `tricks[${seat}]`, t);
  });
  const totalTricks = sum(tricks);
  if (totalTricks !== cardsPerPlayer) {
    fail(`sum(tricks) must equal cardsPerPlayer ${cardsPerPlayer}, got ${totalTricks}`);
  }
  return {
    handIndex,
    perSeat: bids.map((bid, seat) => ({
      seat,
      bid,
      tricks: tricks[seat],
      made: tricks[seat] === bid,
      points: handPoints(rules.scoring, bid, tricks[seat]),
    })),
  };
}

/**
 * The scoreboard of `state`, derived from the state only: every completed hand scored
 * (`scoreHand`), per-seat totals and made/missed counts, the ranking (`rankSeats` with
 * `rules.tieBreak`) and, when a hand is in progress, the live status of every seat. At game over
 * (`hand === null`) the board has no `live` key at all. Never mutates `state`; every returned
 * array and object is freshly built.
 *
 * @throws RangeError prefixed `state.completedHands[k]: ` or `state.hand: ` when the hand data
 *   is malformed (wrong seat count, or a failed `scoreHand` / current-hand shape check).
 */
export function evaluate(state: GameState): ScoreBoard {
  const n = state.seats.length;
  const hands: HandScore[] = state.completedHands.map((result, k) => {
    const fail = (check: string): never => {
      throw new RangeError(`state.completedHands[${k}]: ${check}`);
    };
    if (result.bids.length !== n) fail(`bids must have length ${n}, got ${result.bids.length}`);
    if (result.tricks.length !== n) {
      fail(`tricks must have length ${n}, got ${result.tricks.length}`);
    }
    try {
      return scoreHand(state.rules, result);
    } catch (error) {
      if (error instanceof RangeError) fail(error.message);
      throw error;
    }
  });

  const totals = new Array<number>(n).fill(0);
  const madeCount = new Array<number>(n).fill(0);
  const missedCount = new Array<number>(n).fill(0);
  for (const hand of hands) {
    for (const { seat, made, points } of hand.perSeat) {
      totals[seat] += points;
      if (made) madeCount[seat]++;
      else missedCount[seat]++;
    }
  }

  const board: ScoreBoard = {
    hands,
    totals,
    madeCount,
    missedCount,
    ranking: rankSeats(totals, missedCount, state.rules.tieBreak),
  };

  const { hand } = state;
  if (hand !== null) {
    const fail = (check: string): never => {
      throw new RangeError(`state.hand: ${check}`);
    };
    const { cardsPerPlayer, bids, tricksWon } = hand;
    if (!isIntIn(cardsPerPlayer, 1, Infinity)) {
      fail(`cardsPerPlayer must be an integer >= 1, got ${cardsPerPlayer}`);
    }
    if (bids.length !== n) fail(`bids must have length ${n}, got ${bids.length}`);
    if (tricksWon.length !== n) fail(`tricksWon must have length ${n}, got ${tricksWon.length}`);
    tricksWon.forEach((t, seat) => {
      assertNonNegativeInt('state.hand', `tricksWon[${seat}]`, t);
    });
    const played = sum(tricksWon);
    if (played > cardsPerPlayer) {
      fail(`sum(tricksWon) must be <= cardsPerPlayer ${cardsPerPlayer}, got ${played}`);
    }
    bids.forEach((bid, seat) => {
      if (bid !== null && !isIntIn(bid, 0, cardsPerPlayer)) {
        fail(`bids[${seat}] must be null or an integer in 0…${cardsPerPlayer}, got ${bid}`);
      }
    });
    const tricksLeft = cardsPerPlayer - played;
    board.live = bids.map((bid, seat) => ({
      seat,
      bid,
      tricksWon: tricksWon[seat],
      status: liveStatus(bid, tricksWon[seat], tricksLeft),
    }));
  }
  return board;
}
