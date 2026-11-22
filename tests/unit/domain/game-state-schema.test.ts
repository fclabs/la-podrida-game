// GameStateSchema (spec 01 FR-116; VC-115, plus plan decisions D-009 and nested strictness).
import { describe, expect, it } from 'vitest';
import { getPreset } from '@/src/domain/presets';
import { GameStateSchema } from '@/src/domain/schemas';

/** Mutations are applied to loosely typed copies so they can break the shape. */
type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * A hand-built valid state: mexico-bazas, 3 seats, second hand (4 cards each) in play. One trick
 * is done (`lastTrick`, won by seat 2) and seat 2 has led one card into the current trick.
 */
const PLAYING_STATE = {
  schemaVersion: 1,
  gameId: 'g-0001',
  rules: getPreset('mexico-bazas'),
  handPlan: [3, 4, 5, 6, 7, 7, 7, 6, 5, 4, 3],
  seats: [
    { seat: 0, playerId: 'p-ana', name: 'Ana', kind: 'human' },
    { seat: 1, playerId: 'p-beto', name: 'Beto', kind: 'human' },
    { seat: 2, playerId: 'p-bot', name: 'Bot', kind: 'ai', strategy: 'random' },
  ],
  seed: 'seed-abc',
  aiDecisionCount: 3,
  phase: 'playing',
  handIndex: 1,
  hand: {
    cardsPerPlayer: 4,
    dealer: 1,
    trumpCard: { suit: 'H', rank: '9' },
    trumpCardInDealerHand: false,
    trumpSuit: 'H',
    hands: [
      [
        { suit: 'S', rank: 'Q' },
        { suit: 'H', rank: '2' },
        { suit: 'C', rank: '5' },
      ],
      [
        { suit: 'D', rank: '10' },
        { suit: 'D', rank: '3' },
        { suit: 'C', rank: 'J' },
      ],
      [
        { suit: 'H', rank: 'A' },
        { suit: 'C', rank: '7' },
      ],
    ],
    bids: [1, 0, 2],
    tricksWon: [0, 0, 1],
    currentTrick: { leader: 2, plays: [{ seat: 2, card: { suit: 'D', rank: 'K' } }] },
    lastTrick: {
      winner: 2,
      plays: [
        { seat: 2, card: { suit: 'S', rank: 'A' } },
        { seat: 0, card: { suit: 'S', rank: '3' } },
        { seat: 1, card: { suit: 'S', rank: '10' } },
      ],
    },
    toAct: 0,
  },
  completedHands: [
    {
      handIndex: 0,
      cardsPerPlayer: 3,
      dealer: 0,
      trumpSuit: 'C',
      bids: [1, 1, 0],
      tricks: [1, 2, 0],
    },
  ],
  version: 12,
};

const fresh = (): Loose => structuredClone(PLAYING_STATE) as Loose;

const INVALID: [string, (s: Loose) => void][] = [
  // VC-115
  ['schemaVersion: 2', (s) => (s.schemaVersion = 2)],
  ["phase: 'dealing'", (s) => (s.phase = 'dealing')],
  ['version: -1', (s) => (s.version = -1)],
  ['aiDecisionCount: 1.5', (s) => (s.aiDecisionCount = 1.5)],
  ["seed: ''", (s) => (s.seed = '')],
  ['delete hand', (s) => delete s.hand],
  ['hand.bids[0] = -1', (s) => (s.hand.bids[0] = -1)],
  ["a card {suit:'X',rank:'A'}", (s) => (s.hand.hands[0][0] = { suit: 'X', rank: 'A' })],
  ["a card {suit:'H',rank:'1'}", (s) => (s.hand.hands[0][0] = { suit: 'H', rank: '1' })],
  ['an extra top-level key foo', (s) => (s.foo = 1)],
  ['an extra key in a seat', (s) => (s.seats[0].extra = true)],
  // FR-116 counts and indexes beyond the VC list
  ['handIndex: -1', (s) => (s.handIndex = -1)],
  ['a seat index -1', (s) => (s.seats[0].seat = -1)],
  ['hand.tricksWon[0] = 0.5', (s) => (s.hand.tricksWon[0] = 0.5)],
  ['completedHands[0].tricks[0] = -1', (s) => (s.completedHands[0].tricks[0] = -1)],
  // Plan decisions (D-009)
  ["gameId: ''", (s) => (s.gameId = '')],
  ["hand.trumpSuit: 'X'", (s) => (s.hand.trumpSuit = 'X')],
  ['handPlan: [0]', (s) => (s.handPlan = [0])],
  // Nested strictness
  ['an extra key in hand', (s) => (s.hand.extra = true)],
  ['an extra key in hand.currentTrick', (s) => (s.hand.currentTrick.extra = true)],
];

describe('VC-115 GameStateSchema', () => {
  it('parses the playing fixture and deep-equals it', () => {
    const state = fresh();
    expect(GameStateSchema.parse(state)).toStrictEqual(state);
  });

  it("parses the fixture with hand: null and phase: 'game-over'", () => {
    const state = fresh();
    state.hand = null;
    state.phase = 'game-over';
    expect(GameStateSchema.parse(state)).toStrictEqual(state);
  });

  it.each(INVALID)('rejects %s', (_name, mutate) => {
    const state = fresh();
    mutate(state);
    expect(GameStateSchema.safeParse(state).success).toBe(false);
  });
});
