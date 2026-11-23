import type { RuleSet } from '@/src/domain/rules';
import type { ScoreBoard } from '@/src/domain/types';

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
