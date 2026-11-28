import { describe, expect, it } from 'vitest';
import { median, p95, percentile, roundInt } from '@/scripts/lib/stats';

describe('stats', () => {
  it('percentile is nearest-rank on a sorted list', () => {
    const hundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(p95(hundred)).toBe(95);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile(hundred, 100)).toBe(100);
    expect(p95([7])).toBe(7);
    expect(p95([1, 2, 3, 4])).toBe(4);
  });

  it('percentile rejects an empty list and a bad p', () => {
    expect(() => percentile([], 95)).toThrow(RangeError);
    expect(() => percentile([1], 0)).toThrow(RangeError);
  });

  it('median handles odd, even and unsorted input', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(() => median([])).toThrow(RangeError);
  });

  it('roundInt rounds to the nearest integer', () => {
    expect(roundInt(2.4)).toBe(2);
    expect(roundInt(2.5)).toBe(3);
  });
});
