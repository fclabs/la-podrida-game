// Rule presets (spec 01 FR-110 to FR-114, BR-101 to BR-103; VC-109 to VC-113).
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESET_ID, PRESET_IDS, UnknownPresetError, getPreset } from '@/src/domain/presets';
import { RuleSetSchema } from '@/src/domain/schemas';

// Expected presets, written by hand from the spec's Preset values table (independent of the
// preset constants on purpose).
const FRENCH_52_LITERAL = {
  id: 'french-52',
  suits: ['S', 'H', 'D', 'C'],
  ranksHighToLow: ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'],
  removeRanksForPlayers: {},
};

const SPANISH_40_LITERAL = {
  id: 'spanish-40',
  suits: ['O', 'C', 'E', 'B'],
  ranksHighToLow: ['A', '3', 'R', 'C', 'S', '7', '6', '5', '4', '2'],
  removeRanksForPlayers: { '3': ['2'], '6': ['2'] },
};

const EXPECTED: Record<string, unknown> = {
  'argentina-fidepo': {
    id: 'argentina-fidepo',
    deck: FRENCH_52_LITERAL,
    players: { min: 3, max: 6 },
    handSequence: [
      { kind: 'range', from: 'max', to: 5 },
      { kind: 'repeat', cards: 4, times: 'players' },
      { kind: 'range', from: 5, to: 'max' },
    ],
    trump: { source: 'next-stock-card-or-dealer-last' },
    bidding: { dealerRestriction: true, dealerRestrictionExemptCardCounts: [] },
    play: {
      mustFollowSuit: true,
      mustTrumpWhenVoid: true,
      mustBeatLedSuit: false,
      beatNotRequiredAfterTrumped: false,
      mustOvertrump: false,
      whenCannotOvertrump: 'any-trump',
    },
    scoring: { kind: 'bonus-plus-tricks', bonus: 10, perTrick: 1, missedPerTrick: 1 },
    tieBreak: 'fewest-misses',
  },
  'spain-ludoteka': {
    id: 'spain-ludoteka',
    deck: SPANISH_40_LITERAL,
    players: { min: 3, max: 6 },
    handSequence: [
      { kind: 'range', from: 1, to: { offset: ['max', -1] } },
      { kind: 'repeat', cards: 'max', times: 'players' },
      { kind: 'range', from: { offset: ['max', -1] }, to: 1 },
    ],
    trump: { source: 'next-stock-card-or-dealer-last' },
    bidding: { dealerRestriction: true, dealerRestrictionExemptCardCounts: [1] },
    play: {
      mustFollowSuit: true,
      mustTrumpWhenVoid: true,
      mustBeatLedSuit: true,
      beatNotRequiredAfterTrumped: false,
      mustOvertrump: true,
      whenCannotOvertrump: 'any-trump',
    },
    scoring: { kind: 'spanish', bonus: 10, perTrick: 5, missPenaltyPerTrick: 5 },
    tieBreak: 'fewest-misses',
  },
  gamerules: {
    id: 'gamerules',
    deck: FRENCH_52_LITERAL,
    players: { min: 3, max: 7 },
    handSequence: [
      { kind: 'range', from: { min: [10, 'max'] }, to: 1 },
      { kind: 'range', from: 2, to: { min: [10, 'max'] } },
    ],
    trump: { source: 'next-stock-card-or-dealer-last' },
    bidding: { dealerRestriction: true, dealerRestrictionExemptCardCounts: [] },
    play: {
      mustFollowSuit: true,
      mustTrumpWhenVoid: true,
      mustBeatLedSuit: false,
      beatNotRequiredAfterTrumped: false,
      mustOvertrump: false,
      whenCannotOvertrump: 'any-trump',
    },
    scoring: { kind: 'bonus-plus-bid', bonus: 10 },
    tieBreak: 'fewest-misses',
  },
  'mexico-bazas': {
    id: 'mexico-bazas',
    deck: FRENCH_52_LITERAL,
    players: { min: 3, max: 7 },
    handSequence: [
      { kind: 'range', from: 3, to: 6 },
      { kind: 'repeat', cards: 7, times: 'players' },
      { kind: 'range', from: 6, to: 3 },
    ],
    trump: { source: 'next-stock-card-or-dealer-last' },
    bidding: { dealerRestriction: true, dealerRestrictionExemptCardCounts: [] },
    play: {
      mustFollowSuit: true,
      mustTrumpWhenVoid: true,
      mustBeatLedSuit: true,
      beatNotRequiredAfterTrumped: true,
      mustOvertrump: true,
      whenCannotOvertrump: 'any-trump',
    },
    scoring: { kind: 'spanish', bonus: 10, perTrick: 5, missPenaltyPerTrick: 5 },
    tieBreak: 'fewest-misses',
  },
};

const ALL_IDS = ['argentina-fidepo', 'spain-ludoteka', 'gamerules', 'mexico-bazas'];

describe('VC-109 preset ids', () => {
  it('PRESET_IDS lists the four ids in order', () => {
    expect(PRESET_IDS).toEqual(['argentina-fidepo', 'spain-ludoteka', 'gamerules', 'mexico-bazas']);
  });

  it('DEFAULT_PRESET_ID is argentina-fidepo', () => {
    expect(DEFAULT_PRESET_ID).toBe('argentina-fidepo');
  });
});

describe('VC-110 preset values', () => {
  it.each(ALL_IDS)('getPreset(%j) equals the Preset values table', (id) => {
    expect(getPreset(id)).toStrictEqual(EXPECTED[id]);
  });
});

describe('VC-111 getPreset returns independent deep copies', () => {
  it('mutating one result does not affect the next call', () => {
    const a = getPreset('gamerules');
    a.players.max = 99;
    a.handSequence.push({ kind: 'repeat', cards: 1, times: 1 });
    const b = getPreset('gamerules');
    expect(b.players.max).toBe(7);
    expect(b.handSequence).toHaveLength(2);
  });

  it('mutating a returned deck does not affect other presets', () => {
    const a = getPreset('argentina-fidepo');
    a.deck.suits.push('X');
    expect(getPreset('mexico-bazas').deck.suits).toEqual(['S', 'H', 'D', 'C']);
  });
});

describe('VC-112 unknown preset ids', () => {
  it.each(['foo', '', '__proto__', 'constructor', 'toString'])(
    'getPreset(%j) throws UnknownPresetError',
    (id) => {
      expect(() => getPreset(id)).toThrow(UnknownPresetError);
    },
  );

  it('the message contains the id', () => {
    expect(() => getPreset('foo')).toThrow(/foo/);
  });
});

describe('VC-113 presets are valid, plain JSON data', () => {
  it.each(ALL_IDS)('RuleSetSchema.parse(getPreset(%j)) deep-equals the preset', (id) => {
    const preset = getPreset(id);
    expect(RuleSetSchema.parse(preset)).toStrictEqual(preset);
  });

  it.each(ALL_IDS)('getPreset(%j) survives a JSON round-trip', (id) => {
    const preset = getPreset(id);
    expect(JSON.parse(JSON.stringify(preset))).toStrictEqual(preset);
  });
});
