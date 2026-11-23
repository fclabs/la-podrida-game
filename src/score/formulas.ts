import type { ScoringSpec } from '@/src/domain/rules';

/** Throws `RangeError` unless `value` is a non-negative integer. */
function assertNonNegativeInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`handPoints: ${name} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Points one seat scores for a hand under `scoring`, given its `bid` and the `tricks` it won.
 * The bid is made iff `tricks === bid`. Every number is read from the `ScoringSpec` fields.
 *
 * - `bonus-plus-tricks`: made → `bonus + perTrick·t`; missed → `missedPerTrick·t`.
 * - `bonus-plus-bid`: made → `bonus + b`; missed → `0`.
 * - `spanish`: made → `bonus + perTrick·t`; missed → `−missPenaltyPerTrick·|t − b|`.
 *
 * @throws RangeError when `bid` or `tricks` is not a non-negative integer.
 */
export function handPoints(scoring: ScoringSpec, bid: number, tricks: number): number {
  assertNonNegativeInt('bid', bid);
  assertNonNegativeInt('tricks', tricks);
  const made = tricks === bid;
  switch (scoring.kind) {
    case 'bonus-plus-tricks':
      return made ? scoring.bonus + scoring.perTrick * tricks : scoring.missedPerTrick * tricks;
    case 'bonus-plus-bid':
      return made ? scoring.bonus + bid : 0;
    case 'spanish':
      // `0 - x`, never unary minus: a zero penalty must give 0, not -0.
      return made
        ? scoring.bonus + scoring.perTrick * tricks
        : 0 - scoring.missPenaltyPerTrick * Math.abs(tricks - bid);
    default: {
      const unknown: never = scoring;
      throw new RangeError(`handPoints: unknown scoring kind ${JSON.stringify(unknown)}`);
    }
  }
}
