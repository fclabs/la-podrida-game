import { FRENCH_52, SPANISH_40 } from './decks';
import type { PresetId, RuleSet } from './rules';
import { PresetIdSchema } from './schemas';

/** The preset ids, in canonical order. Frozen. */
export const PRESET_IDS: readonly PresetId[] = Object.freeze([...PresetIdSchema.options]);

/** The preset used when none is chosen. */
export const DEFAULT_PRESET_ID = 'argentina-fidepo' satisfies PresetId;

/** Thrown by `getPreset` for an id that is not in `PRESET_IDS`. */
export class UnknownPresetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownPresetError';
  }
}

/** Recursively freezes plain objects and arrays so the internal presets cannot be mutated. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/*
 * The four presets, every field spelled out (spec BR-101). Flags marked "unused" are ignored by the
 * engine because the flag they qualify (`mustBeatLedSuit` / `mustOvertrump`) is `false`; they still
 * carry a fixed value so presets stay explicit and diffable. Decks are clones of the frozen deck
 * constants.
 */
const ARGENTINA_FIDEPO: RuleSet = {
  id: 'argentina-fidepo',
  deck: structuredClone(FRENCH_52),
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
    beatNotRequiredAfterTrumped: false, // unused
    mustOvertrump: false,
    whenCannotOvertrump: 'any-trump', // unused
  },
  scoring: { kind: 'bonus-plus-tricks', bonus: 10, perTrick: 1, missedPerTrick: 1 },
  tieBreak: 'fewest-misses',
};

const SPAIN_LUDOTEKA: RuleSet = {
  id: 'spain-ludoteka',
  deck: structuredClone(SPANISH_40),
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
};

const GAMERULES: RuleSet = {
  id: 'gamerules',
  deck: structuredClone(FRENCH_52),
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
    beatNotRequiredAfterTrumped: false, // unused
    mustOvertrump: false,
    whenCannotOvertrump: 'any-trump', // unused
  },
  scoring: { kind: 'bonus-plus-bid', bonus: 10 },
  tieBreak: 'fewest-misses',
};

const MEXICO_BAZAS: RuleSet = {
  id: 'mexico-bazas',
  deck: structuredClone(FRENCH_52),
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
};

/**
 * Deeply frozen presets keyed by id, on a null-prototype object so inherited names such as
 * `'__proto__'`, `'constructor'` or `'toString'` are never found.
 */
const PRESETS: Readonly<Record<PresetId, RuleSet>> = deepFreeze(
  Object.assign(Object.create(null) as Record<PresetId, RuleSet>, {
    'argentina-fidepo': ARGENTINA_FIDEPO,
    'spain-ludoteka': SPAIN_LUDOTEKA,
    gamerules: GAMERULES,
    'mexico-bazas': MEXICO_BAZAS,
  }),
);

function isPresetId(id: string): id is PresetId {
  return Object.hasOwn(PRESETS, id);
}

/**
 * Returns the preset with this id as an independent deep copy (mutating it never affects later
 * calls). Throws `UnknownPresetError` (message contains the id) for any other id.
 */
export function getPreset(id: string): RuleSet {
  if (!isPresetId(id)) {
    throw new UnknownPresetError(`Unknown rules preset "${id}"`);
  }
  return structuredClone(PRESETS[id]);
}
