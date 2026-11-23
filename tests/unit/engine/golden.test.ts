// Golden fixture (spec 02 FR-241, BR-201; VC-237).
//
// !! These literals are a tripwire. They were computed once with the engine and pasted here; they
// !! are NOT recomputed. If a change makes this test fail, that change alters the deals or move
// !! outcomes for an existing seed and move sequence: it MUST bump `ENGINE_VERSION` in
// !! `src/engine/engine.ts` by 1, and only then may these literals be updated.
import { describe, expect, it } from 'vitest';
import { cardId, type Card } from '@/src/domain/cards';
import { buildDeck } from '@/src/domain/decks';
import { getPreset } from '@/src/domain/presets';
import type { HandResult } from '@/src/domain/types';
import { ENGINE_VERSION } from '@/src/engine/engine';
import { deriveRng } from '@/src/engine/rng';
import { firstMove, newGame, playGame } from './helpers';

// argentina-fidepo, 4 seats (`makeSeats(4)`), gameId 'game-1', seed 'golden-seed'.
const SEED = 'golden-seed';
const GOLDEN_ENGINE_VERSION = 1;
const HAND0_DEALER = 0;
const HAND0_TRUMP = 'KD'; // whole deck dealt (13 × 4 = 52): the trump is the dealer's last card
// prettier-ignore
const HAND0_HANDS = [
  '10S 7S 2S JH 7H 4H KD 8D 2D 10C 8C 7C 4C',
  'AS 9S 8S 4S 9H 5H 2H 9D 7D 5D 4D 9C 2C',
  'KS QS 6S AH KH 8H 3H 10D AC KC QC 6C 3C',
  'JS 5S 3S QH 10H 6H AD QD JD 6D 3D JC 5C',
];
// Played to the end by first legal move.
// prettier-ignore
const COMPLETED_HANDS: HandResult[] = [
  { handIndex: 0, cardsPerPlayer: 13, dealer: 0, trumpSuit: 'D', bids: [0, 0, 0, 0], tricks: [0, 3, 4, 6] },
  { handIndex: 1, cardsPerPlayer: 12, dealer: 1, trumpSuit: 'H', bids: [0, 0, 0, 0], tricks: [2, 4, 2, 4] },
  { handIndex: 2, cardsPerPlayer: 11, dealer: 2, trumpSuit: 'H', bids: [0, 0, 0, 0], tricks: [0, 3, 7, 1] },
  { handIndex: 3, cardsPerPlayer: 10, dealer: 3, trumpSuit: 'C', bids: [0, 0, 0, 0], tricks: [2, 2, 2, 4] },
  { handIndex: 4, cardsPerPlayer: 9, dealer: 0, trumpSuit: 'D', bids: [0, 0, 0, 0], tricks: [1, 3, 4, 1] },
  { handIndex: 5, cardsPerPlayer: 8, dealer: 1, trumpSuit: 'H', bids: [0, 0, 0, 0], tricks: [1, 1, 1, 5] },
  { handIndex: 6, cardsPerPlayer: 7, dealer: 2, trumpSuit: 'H', bids: [0, 0, 0, 0], tricks: [1, 2, 3, 1] },
  { handIndex: 7, cardsPerPlayer: 6, dealer: 3, trumpSuit: 'C', bids: [0, 0, 0, 0], tricks: [1, 2, 1, 2] },
  { handIndex: 8, cardsPerPlayer: 5, dealer: 0, trumpSuit: 'C', bids: [0, 0, 0, 0], tricks: [2, 0, 1, 2] },
  { handIndex: 9, cardsPerPlayer: 4, dealer: 1, trumpSuit: 'C', bids: [0, 0, 0, 0], tricks: [1, 0, 1, 2] },
  { handIndex: 10, cardsPerPlayer: 4, dealer: 2, trumpSuit: 'D', bids: [0, 0, 0, 0], tricks: [0, 0, 0, 4] },
  { handIndex: 11, cardsPerPlayer: 4, dealer: 3, trumpSuit: 'C', bids: [0, 0, 0, 0], tricks: [1, 0, 0, 3] },
  { handIndex: 12, cardsPerPlayer: 4, dealer: 0, trumpSuit: 'S', bids: [0, 0, 0, 0], tricks: [0, 3, 1, 0] },
  { handIndex: 13, cardsPerPlayer: 5, dealer: 1, trumpSuit: 'S', bids: [0, 0, 0, 0], tricks: [0, 1, 1, 3] },
  { handIndex: 14, cardsPerPlayer: 6, dealer: 2, trumpSuit: 'C', bids: [0, 0, 0, 0], tricks: [1, 0, 1, 4] },
  { handIndex: 15, cardsPerPlayer: 7, dealer: 3, trumpSuit: 'C', bids: [0, 0, 0, 0], tricks: [3, 1, 2, 1] },
  { handIndex: 16, cardsPerPlayer: 8, dealer: 0, trumpSuit: 'S', bids: [0, 0, 0, 0], tricks: [2, 4, 0, 2] },
  { handIndex: 17, cardsPerPlayer: 9, dealer: 1, trumpSuit: 'H', bids: [0, 0, 0, 0], tricks: [2, 0, 4, 3] },
  { handIndex: 18, cardsPerPlayer: 10, dealer: 2, trumpSuit: 'H', bids: [0, 0, 0, 0], tricks: [4, 0, 4, 2] },
  { handIndex: 19, cardsPerPlayer: 11, dealer: 3, trumpSuit: 'S', bids: [0, 0, 0, 0], tricks: [0, 0, 4, 7] },
  { handIndex: 20, cardsPerPlayer: 12, dealer: 0, trumpSuit: 'C', bids: [0, 0, 0, 0], tricks: [5, 2, 4, 1] },
  { handIndex: 21, cardsPerPlayer: 13, dealer: 1, trumpSuit: 'C', bids: [0, 0, 0, 0], tricks: [0, 2, 7, 4] },
];

describe('VC-237 golden fixture (argentina-fidepo, 4 seats, seed golden-seed)', () => {
  const start = newGame('argentina-fidepo', 4, SEED);

  it('was recorded with the current ENGINE_VERSION (bump both together)', () => {
    expect(ENGINE_VERSION).toBe(GOLDEN_ENGINE_VERSION);
  });

  it('hand 0: dealer, trump card and every seat’s cards', () => {
    const hand = start.state.hand!;
    expect(hand.dealer).toBe(HAND0_DEALER);
    expect(cardId(hand.trumpCard)).toBe(HAND0_TRUMP);
    expect(hand.trumpCardInDealerHand).toBe(true);
    expect(hand.hands.map((h) => h.map(cardId).join(' '))).toEqual(HAND0_HANDS);
  });

  it('the literals agree with an independent recomputation of the hand-0 deal', () => {
    const rules = getPreset('argentina-fidepo');
    const rng = deriveRng(SEED, 'deal', 0);
    const dealer = rng.int(0, 3);
    const shuffled = rng.shuffle(buildDeck(rules.deck, 4));
    const hands: Card[][] = [[], [], [], []];
    for (let k = 0; k < 52; k++) hands[(dealer + 1 + k) % 4].push(shuffled[k]);
    const key = (c: Card) =>
      rules.deck.suits.indexOf(c.suit) * 100 + rules.deck.ranksHighToLow.indexOf(c.rank);
    const ids = hands.map((h) =>
      [...h]
        .sort((a, b) => key(a) - key(b))
        .map(cardId)
        .join(' '),
    );
    expect(dealer).toBe(HAND0_DEALER);
    expect(cardId(shuffled[51])).toBe(HAND0_TRUMP);
    expect(ids).toEqual(HAND0_HANDS);
  });

  it('completedHands after playing the whole game by first legal move', () => {
    const game = playGame(start, firstMove);
    expect(game.final.phase).toBe('game-over');
    expect(game.final.completedHands).toEqual(COMPLETED_HANDS);
  });
});
