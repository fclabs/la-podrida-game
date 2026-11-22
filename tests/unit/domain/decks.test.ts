// Decks (spec 01 FR-106 to FR-109; VC-106 to VC-108), plus the deck and card schemas they feed.
import { describe, expect, it } from 'vitest';
import { cardId } from '@/src/domain/cards';
import { FRENCH_52, SPANISH_40, buildDeck, type DeckDefinition } from '@/src/domain/decks';
import { CardSchema, DeckDefinitionSchema } from '@/src/domain/schemas';

const DECKS: [string, DeckDefinition][] = [
  ['FRENCH_52', FRENCH_52],
  ['SPANISH_40', SPANISH_40],
];

describe('VC-106 deck definitions', () => {
  it('FRENCH_52 matches FR-106', () => {
    expect(FRENCH_52).toEqual({
      id: 'french-52',
      suits: ['S', 'H', 'D', 'C'],
      ranksHighToLow: ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'],
      removeRanksForPlayers: {},
    });
  });

  it('SPANISH_40 matches FR-107', () => {
    expect(SPANISH_40).toEqual({
      id: 'spanish-40',
      suits: ['O', 'C', 'E', 'B'],
      ranksHighToLow: ['A', '3', 'R', 'C', 'S', '7', '6', '5', '4', '2'],
      removeRanksForPlayers: { '3': ['2'], '6': ['2'] },
    });
  });

  it.each(DECKS)('%s is deeply frozen', (_name, deck) => {
    expect(Object.isFrozen(deck)).toBe(true);
    expect(Object.isFrozen(deck.suits)).toBe(true);
    expect(Object.isFrozen(deck.ranksHighToLow)).toBe(true);
    expect(Object.isFrozen(deck.removeRanksForPlayers)).toBe(true);
    for (const ranks of Object.values(deck.removeRanksForPlayers)) {
      expect(Object.isFrozen(ranks)).toBe(true);
    }
  });

  it.each(DECKS)('%s parses with DeckDefinitionSchema and equals itself', (_name, deck) => {
    expect(DeckDefinitionSchema.parse(deck)).toEqual(deck);
  });
});

describe('VC-107 buildDeck', () => {
  it.each([3, 4, 5, 6, 7])('buildDeck(FRENCH_52, %i) has 52 cards', (players) => {
    expect(buildDeck(FRENCH_52, players)).toHaveLength(52);
  });

  it.each([
    [3, 36],
    [4, 40],
    [5, 40],
    [6, 36],
  ])('buildDeck(SPANISH_40, %i) has %i cards', (players, size) => {
    expect(buildDeck(SPANISH_40, players)).toHaveLength(size);
  });

  it.each(DECKS)('buildDeck(%s, n) has no duplicate card ids for n = 3..7', (_name, deck) => {
    for (const players of [3, 4, 5, 6, 7]) {
      const ids = buildDeck(deck, players).map(cardId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it.each([3, 6])('buildDeck(SPANISH_40, %i) contains no rank 2', (players) => {
    expect(buildDeck(SPANISH_40, players).some((card) => card.rank === '2')).toBe(false);
  });

  it('the first three cards of buildDeck(FRENCH_52, 4) are AS, KS, QS', () => {
    expect(buildDeck(FRENCH_52, 4).slice(0, 3).map(cardId)).toEqual(['AS', 'KS', 'QS']);
  });

  it('orders cards by suit (deck order) then rank (high to low)', () => {
    const expected = SPANISH_40.suits.flatMap((suit) =>
      SPANISH_40.ranksHighToLow.map((rank) => `${rank}${suit}`),
    );
    expect(buildDeck(SPANISH_40, 4).map(cardId)).toEqual(expected);
  });

  it('mutating a returned array does not change the next result', () => {
    const first = buildDeck(FRENCH_52, 4);
    first[0].rank = '2';
    first.pop();
    first.push({ suit: 'X', rank: 'X' });
    const second = buildDeck(FRENCH_52, 4);
    expect(second).toHaveLength(52);
    expect(second[0]).toEqual({ suit: 'S', rank: 'A' });
    expect(second.at(-1)).toEqual({ suit: 'C', rank: '2' });
  });

  it.each(DECKS)('every card of buildDeck(%s, 4) parses with CardSchema', (_name, deck) => {
    for (const card of buildDeck(deck, 4)) {
      expect(CardSchema.parse(card)).toEqual(card);
    }
  });
});

describe('VC-108 buildDeck rejects invalid player counts', () => {
  it.each([0, -1, 2.5, NaN])('buildDeck(FRENCH_52, %d) throws RangeError', (players) => {
    expect(() => buildDeck(FRENCH_52, players)).toThrow(RangeError);
  });
});
