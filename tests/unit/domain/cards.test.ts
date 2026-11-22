// Cards and ranks (spec 01 FR-101 to FR-105, BR-105; VC-101 to VC-105).
import { describe, expect, it } from 'vitest';
import { InvalidCardError, cardId, compareRanks, parseCard, type Card } from '@/src/domain/cards';
import { FRENCH_52, SPANISH_40, buildDeck, type DeckDefinition } from '@/src/domain/decks';

const DECKS: [string, DeckDefinition][] = [
  ['FRENCH_52', FRENCH_52],
  ['SPANISH_40', SPANISH_40],
];

describe('VC-101 cardId', () => {
  it.each<[Card, string]>([
    [{ rank: '7', suit: 'H' }, '7H'],
    [{ rank: '10', suit: 'S' }, '10S'],
    [{ rank: '3', suit: 'O' }, '3O'],
    [{ rank: 'C', suit: 'C' }, 'CC'],
  ])('cardId(%o) is %s', (card, expected) => {
    expect(cardId(card)).toBe(expected);
  });
});

describe('VC-102 parseCard', () => {
  it.each(DECKS)('every card of buildDeck(%s, 4) round-trips through cardId', (_name, deck) => {
    for (const card of buildDeck(deck, 4)) {
      expect(parseCard(cardId(card), deck)).toEqual(card);
    }
  });

  it("parseCard('10S', FRENCH_52) is { rank: '10', suit: 'S' }", () => {
    expect(parseCard('10S', FRENCH_52)).toEqual({ rank: '10', suit: 'S' });
  });

  it("parseCard('CC', SPANISH_40) is { rank: 'C', suit: 'C' }", () => {
    expect(parseCard('CC', SPANISH_40)).toEqual({ rank: 'C', suit: 'C' });
  });
});

describe('VC-103 parseCard rejects invalid ids', () => {
  it.each<[string, string, DeckDefinition]>([
    ['', 'FRENCH_52', FRENCH_52],
    ['H', 'FRENCH_52', FRENCH_52],
    ['10', 'FRENCH_52', FRENCH_52],
    ['1H', 'FRENCH_52', FRENCH_52],
    ['7h', 'FRENCH_52', FRENCH_52],
    ['3O', 'FRENCH_52', FRENCH_52],
    ['KO', 'SPANISH_40', SPANISH_40],
    ['10O', 'SPANISH_40', SPANISH_40],
    ['7H', 'SPANISH_40', SPANISH_40],
  ])('parseCard(%j, %s) throws InvalidCardError naming the input', (id, _name, deck) => {
    let thrown: unknown;
    try {
      parseCard(id, deck);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvalidCardError);
    expect((thrown as InvalidCardError).message).toContain(`"${id}"`);
  });
});

describe('VC-104 compareRanks', () => {
  it.each<[string, DeckDefinition, string, string, 'gt' | 'lt' | 'eq']>([
    ['FRENCH_52', FRENCH_52, 'A', 'K', 'gt'],
    ['FRENCH_52', FRENCH_52, '2', '3', 'lt'],
    ['FRENCH_52', FRENCH_52, '10', 'J', 'lt'],
    ['FRENCH_52', FRENCH_52, 'Q', 'Q', 'eq'],
    ['SPANISH_40', SPANISH_40, '3', 'R', 'gt'],
    ['SPANISH_40', SPANISH_40, 'A', '3', 'gt'],
    ['SPANISH_40', SPANISH_40, 'S', '7', 'gt'],
    ['SPANISH_40', SPANISH_40, '2', '4', 'lt'],
  ])('compareRanks(%s, %s, %s) is %s', (_name, deck, a, b, expected) => {
    const result = compareRanks(deck, a, b);
    if (expected === 'gt') expect(result).toBeGreaterThan(0);
    if (expected === 'lt') expect(result).toBeLessThan(0);
    if (expected === 'eq') expect(result).toBe(0);
  });

  it.each(DECKS)('sorting %s ranks descending reproduces ranksHighToLow', (_name, deck) => {
    const shuffled = [...deck.ranksHighToLow].reverse();
    shuffled.push(...shuffled.splice(0, 3));
    const sorted = shuffled.sort((a, b) => compareRanks(deck, b, a));
    expect(sorted).toEqual(deck.ranksHighToLow);
  });
});

describe('VC-105 compareRanks rejects ranks not in the deck', () => {
  it.each<[string, DeckDefinition, string, string]>([
    ['SPANISH_40', SPANISH_40, 'K', 'A'],
    ['FRENCH_52', FRENCH_52, 'R', 'A'],
  ])('compareRanks(%s, %s, %s) throws InvalidCardError', (_name, deck, a, b) => {
    expect(() => compareRanks(deck, a, b)).toThrow(InvalidCardError);
  });
});
