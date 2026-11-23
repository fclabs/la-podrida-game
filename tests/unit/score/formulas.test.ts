// Scoring formulas (spec 03 FR-300, FR-301; VC-301, VC-302, VC-303).
import { describe, expect, it } from 'vitest';
import type { PresetId, ScoringSpec } from '@/src/domain/rules';
import { getPreset } from '@/src/domain/presets';
import { handPoints } from '@/src/score/formulas';

type Row = [preset: PresetId, bid: number, tricks: number, expected: number];

const SPANISH_ROWS: [bid: number, tricks: number, expected: number][] = [
  [2, 2, 20],
  [0, 0, 10],
  [5, 4, -5],
  [5, 6, -5],
  [1, 4, -15],
];

// game_rules §3.7 worked examples plus the extra rows of VC-301.
const ROWS: Row[] = [
  ['argentina-fidepo', 2, 2, 12],
  ['argentina-fidepo', 2, 1, 1],
  ['argentina-fidepo', 2, 3, 3],
  ['argentina-fidepo', 0, 0, 10],
  ['argentina-fidepo', 0, 1, 1],
  ['gamerules', 3, 3, 13],
  ['gamerules', 0, 0, 10],
  ['gamerules', 3, 2, 0],
  ['gamerules', 0, 3, 0],
  ...SPANISH_ROWS.map(([b, t, e]): Row => ['spain-ludoteka', b, t, e]),
  ...SPANISH_ROWS.map(([b, t, e]): Row => ['mexico-bazas', b, t, e]),
];

describe('VC-301 handPoints matches the worked examples for each preset', () => {
  it.each(ROWS)('%s bid %i tricks %i → %i', (preset, bid, tricks, expected) => {
    expect(handPoints(getPreset(preset).scoring, bid, tricks)).toBe(expected);
  });
});

describe('VC-302 handPoints reads the ScoringSpec fields and never returns -0', () => {
  it('a spanish spec with perTrick 3 gives (2,2) → 16', () => {
    const scoring = {
      ...getPreset('spain-ludoteka').scoring,
      perTrick: 3,
    } as unknown as ScoringSpec;
    expect(handPoints(scoring, 2, 2)).toBe(16);
  });

  it.each(ROWS)('%s bid %i tricks %i is not -0', (preset, bid, tricks) => {
    expect(Object.is(handPoints(getPreset(preset).scoring, bid, tricks), -0)).toBe(false);
  });

  it('a spanish spec with missPenaltyPerTrick 0 gives +0 on a miss', () => {
    const scoring = {
      ...getPreset('spain-ludoteka').scoring,
      missPenaltyPerTrick: 0,
    } as unknown as ScoringSpec;
    expect(Object.is(handPoints(scoring, 2, 1), 0)).toBe(true);
  });
});

describe('VC-303 handPoints rejects bids and tricks that are not non-negative integers', () => {
  const scoring = getPreset('argentina-fidepo').scoring;
  it.each([
    ['bid', -1, 0, '-1'],
    ['tricks', 0, 1.5, '1.5'],
    ['bid', NaN, 0, 'NaN'],
  ] as const)('%s = %s → RangeError', (name, bid, tricks, shown) => {
    expect(() => handPoints(scoring, bid, tricks)).toThrow(RangeError);
    expect(() => handPoints(scoring, bid, tricks)).toThrow(name);
    expect(() => handPoints(scoring, bid, tricks)).toThrow(shown);
  });
});
