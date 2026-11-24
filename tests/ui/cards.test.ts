import { describe, expect, it } from 'vitest';
import { cardLabel } from '@/app/_client/cards';

describe('cardLabel (VC-944, FR-933, FR-934)', () => {
  it('labels french-52 cards', () => {
    expect(cardLabel({ rank: '10', suit: 'S' }, 'french-52')).toEqual({
      rank: '10',
      suit: '♠',
      name: '10 de picas',
      colour: 'black',
    });
    expect(cardLabel({ rank: 'Q', suit: 'H' }, 'french-52')).toEqual({
      rank: 'Q',
      suit: '♥',
      name: 'Reina de corazones',
      colour: 'red',
    });
    expect(cardLabel({ rank: 'J', suit: 'D' }, 'french-52').colour).toBe('red');
    expect(cardLabel({ rank: 'K', suit: 'C' }, 'french-52').name).toBe('Rey de tréboles');
  });

  it('labels spanish-40 cards', () => {
    expect(cardLabel({ rank: 'R', suit: 'C' }, 'spanish-40')).toEqual({
      rank: '12',
      suit: 'copas',
      name: 'Rey de copas',
      colour: 'copas',
    });
    expect(cardLabel({ rank: 'C', suit: 'O' }, 'spanish-40')).toMatchObject({
      rank: '11',
      name: 'Caballo de oros',
      colour: 'oros',
    });
    expect(cardLabel({ rank: 'S', suit: 'E' }, 'spanish-40')).toMatchObject({
      rank: '10',
      name: 'Sota de espadas',
      colour: 'espadas',
    });
    expect(cardLabel({ rank: 'A', suit: 'B' }, 'spanish-40')).toMatchObject({
      rank: 'A',
      name: 'As de bastos',
      colour: 'bastos',
    });
    expect(cardLabel({ rank: '7', suit: 'O' }, 'spanish-40').name).toBe('7 de oros');
  });

  it('falls back to french-52 for a missing or unknown deck', () => {
    for (const deck of [undefined, 'bogus']) {
      expect(cardLabel({ rank: 'A', suit: 'C' }, deck)).toMatchObject({
        name: 'As de tréboles',
        suit: '♣',
        colour: 'black',
      });
    }
  });

  it('names every rank of both decks', () => {
    const french = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    const spanish = ['A', '3', 'R', 'C', 'S', '7', '6', '5', '4', '2'];
    for (const rank of french) {
      expect(cardLabel({ rank, suit: 'S' }, 'french-52').name).toMatch(/^\S+ de picas$/);
    }
    for (const rank of spanish) {
      expect(cardLabel({ rank, suit: 'O' }, 'spanish-40').name).toMatch(/^\S+ de oros$/);
    }
    expect(cardLabel({ rank: 'A', suit: 'S' }, 'french-52').name).toBe('As de picas');
    expect(cardLabel({ rank: '9', suit: 'S' }, 'french-52').name).toBe('9 de picas');
  });
});
