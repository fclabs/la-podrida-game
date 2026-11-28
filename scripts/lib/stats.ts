// Small statistics helpers for the Phase 11 scripts (spec 11 FR-1117: nearest-rank percentiles,
// milliseconds rounded to integers).

/** Rounds to the nearest integer (`Math.round`, halves up). */
export function roundInt(value: number): number {
  return Math.round(value);
}

/** Nearest-rank percentile of an ASCENDING-sorted, non-empty list; `p` in (0, 100]. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('percentile of an empty list');
  if (!(p > 0 && p <= 100)) throw new RangeError('percentile p must be in (0, 100]');
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1];
}

/** Nearest-rank 95th percentile of an ascending-sorted, non-empty list. */
export function p95(sorted: readonly number[]): number {
  return percentile(sorted, 95);
}

/** Median of a non-empty list in any order (mean of the two middle values when the count is even). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
