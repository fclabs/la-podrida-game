// Hand-plan expansion (spec 02 FR-207 to FR-210; VC-207 to VC-210).
// The expected hand plans below are literal arrays written by hand from the spec's Hand plans
// table; they are never computed with expandHandSequence.
import { describe, expect, it } from 'vitest';
import { FRENCH_52, SPANISH_40 } from '@/src/domain/decks';
import { getPreset } from '@/src/domain/presets';
import type { HandSequenceSpec, PresetId, RuleSet } from '@/src/domain/rules';
import { expandHandSequence, maxCardsPerPlayer } from '@/src/engine/sequence';

/** A mutable copy of preset `id` with its hand sequence replaced. */
function withSequence(id: PresetId, handSequence: HandSequenceSpec): RuleSet {
  const rules = structuredClone(getPreset(id));
  rules.handSequence = handSequence;
  return rules;
}

interface PlanRow {
  id: PresetId;
  players: number;
  length: number;
  plan: number[];
}

// prettier-ignore
const PLANS: PlanRow[] = [
  // argentina-fidepo: max→5, 4×players, 5→max
  { id: 'argentina-fidepo', players: 3, length: 29, plan: [
    17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5,
    4, 4, 4,
    5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
  ] },
  { id: 'argentina-fidepo', players: 4, length: 22, plan: [
    13, 12, 11, 10, 9, 8, 7, 6, 5,
    4, 4, 4, 4,
    5, 6, 7, 8, 9, 10, 11, 12, 13,
  ] },
  { id: 'argentina-fidepo', players: 5, length: 17, plan: [
    10, 9, 8, 7, 6, 5,
    4, 4, 4, 4, 4,
    5, 6, 7, 8, 9, 10,
  ] },
  { id: 'argentina-fidepo', players: 6, length: 14, plan: [
    8, 7, 6, 5,
    4, 4, 4, 4, 4, 4,
    5, 6, 7, 8,
  ] },
  // spain-ludoteka: 1→max−1, max×players, max−1→1
  { id: 'spain-ludoteka', players: 3, length: 25, plan: [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    12, 12, 12,
    11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
  ] },
  { id: 'spain-ludoteka', players: 4, length: 22, plan: [
    1, 2, 3, 4, 5, 6, 7, 8, 9,
    10, 10, 10, 10,
    9, 8, 7, 6, 5, 4, 3, 2, 1,
  ] },
  { id: 'spain-ludoteka', players: 5, length: 19, plan: [
    1, 2, 3, 4, 5, 6, 7,
    8, 8, 8, 8, 8,
    7, 6, 5, 4, 3, 2, 1,
  ] },
  { id: 'spain-ludoteka', players: 6, length: 16, plan: [
    1, 2, 3, 4, 5,
    6, 6, 6, 6, 6, 6,
    5, 4, 3, 2, 1,
  ] },
  // gamerules: min(10,max)→1, 2→min(10,max)
  { id: 'gamerules', players: 3, length: 19, plan: [
    10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    2, 3, 4, 5, 6, 7, 8, 9, 10,
  ] },
  { id: 'gamerules', players: 4, length: 19, plan: [
    10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    2, 3, 4, 5, 6, 7, 8, 9, 10,
  ] },
  { id: 'gamerules', players: 5, length: 19, plan: [
    10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
    2, 3, 4, 5, 6, 7, 8, 9, 10,
  ] },
  { id: 'gamerules', players: 6, length: 15, plan: [
    8, 7, 6, 5, 4, 3, 2, 1,
    2, 3, 4, 5, 6, 7, 8,
  ] },
  { id: 'gamerules', players: 7, length: 13, plan: [
    7, 6, 5, 4, 3, 2, 1,
    2, 3, 4, 5, 6, 7,
  ] },
  // mexico-bazas: 3→6, 7×players, 6→3
  { id: 'mexico-bazas', players: 3, length: 11, plan: [3, 4, 5, 6, 7, 7, 7, 6, 5, 4, 3] },
  { id: 'mexico-bazas', players: 4, length: 12, plan: [3, 4, 5, 6, 7, 7, 7, 7, 6, 5, 4, 3] },
  { id: 'mexico-bazas', players: 5, length: 13, plan: [3, 4, 5, 6, 7, 7, 7, 7, 7, 6, 5, 4, 3] },
  { id: 'mexico-bazas', players: 6, length: 14, plan: [
    3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 6, 5, 4, 3,
  ] },
  { id: 'mexico-bazas', players: 7, length: 15, plan: [
    3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 7, 6, 5, 4, 3,
  ] },
];

const count = (plan: number[], value: number): number => plan.filter((c) => c === value).length;

describe('VC-207 maxCardsPerPlayer', () => {
  it.each([
    [3, 17],
    [4, 13],
    [5, 10],
    [6, 8],
    [7, 7],
  ])('FRENCH_52 with %i players → %i', (players, expected) => {
    expect(maxCardsPerPlayer(FRENCH_52, players)).toBe(expected);
  });

  it.each([
    [3, 12],
    [4, 10],
    [5, 8],
    [6, 6],
  ])('SPANISH_40 with %i players → %i', (players, expected) => {
    expect(maxCardsPerPlayer(SPANISH_40, players)).toBe(expected);
  });
});

describe('VC-208 every preset reproduces its hand plan', () => {
  it('covers 18 rows: every preset × every player count in its range', () => {
    const expectedKeys = PLANS.map((row) => `${row.id}:${row.players}`).sort();
    const presetKeys = (
      ['argentina-fidepo', 'spain-ludoteka', 'gamerules', 'mexico-bazas'] as const
    ).flatMap((id) => {
      const { min, max } = getPreset(id).players;
      return Array.from({ length: max - min + 1 }, (_, i) => `${id}:${min + i}`);
    });
    expect(PLANS).toHaveLength(18);
    expect(presetKeys.sort()).toEqual(expectedKeys);
  });

  it.each(PLANS.map((row) => [row.id, row.players, row] as const))(
    '%s with %i players',
    (id, players, row) => {
      expect(row.plan).toHaveLength(row.length);
      const plan = expandHandSequence(getPreset(id), players);
      expect(plan).toEqual(row.plan);
      expect(plan).toHaveLength(row.length);
    },
  );

  it.each(PLANS.filter((row) => row.id === 'gamerules').map((row) => [row.players, row] as const))(
    'gamerules with %i players has exactly one 1-card hand',
    (players) => {
      expect(count(expandHandSequence(getPreset('gamerules'), players), 1)).toBe(1);
    },
  );

  it.each(
    PLANS.filter((row) => row.id === 'spain-ludoteka' || row.id === 'mexico-bazas').map(
      (row) => [row.id, row.players] as const,
    ),
  )('%s with %i players has the top count exactly n times', (id, players) => {
    const plan = expandHandSequence(getPreset(id), players);
    expect(count(plan, Math.max(...plan))).toBe(players);
  });

  it('returns a new array on every call', () => {
    const rules = getPreset('mexico-bazas');
    const a = expandHandSequence(rules, 4);
    const b = expandHandSequence(rules, 4);
    expect(a).not.toBe(b);
    a.push(99);
    expect(expandHandSequence(rules, 4)).toEqual(b);
  });
});

describe('VC-209 custom sequence with range and min bound', () => {
  it('[{range 3→3}, {repeat min(2,max) ×2}] with 4 players → [3, 2, 2]', () => {
    const rules = withSequence('argentina-fidepo', [
      { kind: 'range', from: 3, to: 3 },
      { kind: 'repeat', cards: { min: [2, 'max'] }, times: 2 },
    ]);
    expect(expandHandSequence(rules, 4)).toEqual([3, 2, 2]);
  });
});

describe('VC-210 out-of-range players and counts throw RangeError', () => {
  it.each([2, 7])('argentina-fidepo with %i players → RangeError naming the count', (players) => {
    const call = () => expandHandSequence(getPreset('argentina-fidepo'), players);
    expect(call).toThrow(RangeError);
    expect(call).toThrow(String(players));
  });

  it('{repeat, cards: 20, times: 1} with 4 players (max 13) → RangeError containing 20', () => {
    const rules = withSequence('argentina-fidepo', [{ kind: 'repeat', cards: 20, times: 1 }]);
    const call = () => expandHandSequence(rules, 4);
    expect(call).toThrow(RangeError);
    expect(call).toThrow('20');
  });
});
