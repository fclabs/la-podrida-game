// RuleSetSchema (spec 01 FR-115; VC-114).
import { describe, expect, it } from 'vitest';
import { getPreset } from '@/src/domain/presets';
import { RuleSetSchema } from '@/src/domain/schemas';

/** Mutations are applied to loosely typed copies so they can break the shape. */
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const fresh = (): Loose => getPreset('spain-ludoteka') as Loose;

const INVALID: [string, (r: Loose) => void][] = [
  ['players.min = 1', (r) => (r.players.min = 1)],
  ['players = {min:5,max:4}', (r) => (r.players = { min: 5, max: 4 })],
  ['players.max = 4.5', (r) => (r.players.max = 4.5)],
  ['delete tieBreak', (r) => delete r.tieBreak],
  ['delete deck.removeRanksForPlayers', (r) => delete r.deck.removeRanksForPlayers],
  ['play.extra = true', (r) => (r.play.extra = true)],
  ['play.mustFollowSuit = false', (r) => (r.play.mustFollowSuit = false)],
  [
    'bidding.dealerRestrictionExemptCardCounts = [0]',
    (r) => (r.bidding.dealerRestrictionExemptCardCounts = [0]),
  ],
  ['deck.suits = []', (r) => (r.deck.suits = [])],
  ["deck.ranksHighToLow = ['A','A']", (r) => (r.deck.ranksHighToLow = ['A', 'A'])],
  [
    "deck.removeRanksForPlayers = {'x':['2']}",
    (r) => (r.deck.removeRanksForPlayers = { x: ['2'] }),
  ],
  [
    "deck.removeRanksForPlayers = {'03':['2']}",
    (r) => (r.deck.removeRanksForPlayers = { '03': ['2'] }),
  ],
  [
    "deck.removeRanksForPlayers = {'0':['2']}",
    (r) => (r.deck.removeRanksForPlayers = { '0': ['2'] }),
  ],
  [
    "deck.removeRanksForPlayers = {'3':['Z']}",
    (r) => (r.deck.removeRanksForPlayers = { '3': ['Z'] }),
  ],
  [
    "a segment {kind:'range',from:0,to:5}",
    (r) => (r.handSequence[0] = { kind: 'range', from: 0, to: 5 }),
  ],
  ["a bound {offset:['max',1]}", (r) => (r.handSequence[0].to = { offset: ['max', 1] })],
  ['scoring.bonus = 11', (r) => (r.scoring.bonus = 11)],
];

const VALID_BOUNDS: [string, unknown][] = [
  ["{offset:['max',-1]}", { offset: ['max', -1] }],
  ["{min:[10,'max']}", { min: [10, 'max'] }],
  ["'max'", 'max'],
];

describe('VC-114 RuleSetSchema', () => {
  it('accepts the unmodified preset', () => {
    expect(RuleSetSchema.safeParse(fresh()).success).toBe(true);
  });

  it.each(INVALID)('rejects %s', (_name, mutate) => {
    const ruleSet = fresh();
    mutate(ruleSet);
    expect(RuleSetSchema.safeParse(ruleSet).success).toBe(false);
  });

  it.each(VALID_BOUNDS)('accepts the bound %s', (_name, bound) => {
    const ruleSet = fresh();
    ruleSet.handSequence[0].to = bound;
    expect(RuleSetSchema.safeParse(ruleSet).success).toBe(true);
  });
});
