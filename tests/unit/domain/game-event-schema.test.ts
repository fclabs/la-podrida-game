// GameEventSchema (spec 01 FR-117; VC-116).
import { describe, expect, it } from 'vitest';
import { GameEventSchema } from '@/src/domain/schemas';

const VALID: [string, unknown][] = [
  [
    'game-started',
    {
      type: 'game-started',
      seats: [
        { seat: 0, playerId: 'p-ana', name: 'Ana', kind: 'human' },
        { seat: 1, playerId: 'p-bot', name: 'Bot', kind: 'ai', strategy: 'random' },
      ],
      handPlan: [3, 4, 5],
    },
  ],
  [
    'hand-dealt',
    {
      type: 'hand-dealt',
      handIndex: 0,
      dealer: 1,
      cardsPerPlayer: 3,
      trumpCard: { suit: 'O', rank: 'R' },
      trumpCardInDealerHand: true,
    },
  ],
  ['bid-made', { type: 'bid-made', seat: 0, tricks: 2 }],
  ['card-played', { type: 'card-played', seat: 1, card: { suit: 'H', rank: '10' } }],
  ['trick-won', { type: 'trick-won', seat: 1, trickNumber: 1 }],
  [
    'hand-completed',
    {
      type: 'hand-completed',
      handIndex: 0,
      result: {
        handIndex: 0,
        cardsPerPlayer: 3,
        dealer: 1,
        trumpSuit: 'O',
        bids: [1, 1],
        tricks: [2, 1],
      },
    },
  ],
  ['game-over', { type: 'game-over' }],
];

const INVALID: [string, unknown][] = [
  ["{type:'unknown'}", { type: 'unknown' }],
  ["{type:'bid-made',seat:0} (missing tricks)", { type: 'bid-made', seat: 0 }],
  ["{type:'game-over',extra:1}", { type: 'game-over', extra: 1 }],
  ["{type:'trick-won',seat:0,trickNumber:0}", { type: 'trick-won', seat: 0, trickNumber: 0 }],
];

describe('VC-116 GameEventSchema', () => {
  it('has one valid example per event type', () => {
    expect(VALID.map(([type]) => type)).toStrictEqual([
      'game-started',
      'hand-dealt',
      'bid-made',
      'card-played',
      'trick-won',
      'hand-completed',
      'game-over',
    ]);
  });

  it.each(VALID)('parses a %s event and deep-equals it', (_type, event) => {
    expect(GameEventSchema.parse(event)).toStrictEqual(event);
  });

  it.each(INVALID)('rejects %s', (_name, event) => {
    expect(GameEventSchema.safeParse(event).success).toBe(false);
  });
});
