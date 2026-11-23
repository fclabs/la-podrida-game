// Trick resolution (spec 02 FR-225; VC-221).
import { describe, expect, it } from 'vitest';
import { FRENCH_52, SPANISH_40 } from '@/src/domain/decks';
import { trickWinner } from '@/src/engine/trick';
import { trick } from './helpers';

describe('VC-221 trickWinner', () => {
  it.each([
    // [description, leader, plays in order, trump suit, winning seat]
    ['no trump: highest led-suit card wins, off-suit AD does not', 0, '9H AD KH 2H', 'S', 2],
    ['one trump wins over led aces', 0, 'AH 2S AD KH', 'S', 1],
    ['two trumps → the higher trump wins', 0, 'AH 2S 10S KH', 'S', 2],
    ['trump led: highest trump wins', 0, '5S AH QS 9S', 'S', 2],
    ['led card wins when nothing beats it', 1, 'KH 9H AD QC', 'S', 1],
    ['leader ≠ seat 0: returns the seat, not the play index', 2, '3H AH 2S 10H', 'S', 0],
    ['leader ≠ seat 0 and the first play wins', 3, 'AH KH QH JH', 'S', 3],
  ] as const)('%s', (_name, leader, ids, trump, winner) => {
    expect(trickWinner(trick(leader, ids), trump, FRENCH_52)).toBe(winner);
  });

  it('Spanish deck ranks: 3O beats RO with oros led; off-suit AC does not win', () => {
    // Leader seat 2: RO (seat 2), 3O (seat 3), AC (seat 0), 7O (seat 1); trump espadas.
    expect(trickWinner(trick(2, 'RO 3O AC 7O', 4, SPANISH_40), 'E', SPANISH_40)).toBe(3);
  });

  it('Spanish deck with a trump: a low trump beats the led ace', () => {
    expect(trickWinner(trick(1, 'AO 2E 3O', 3, SPANISH_40), 'E', SPANISH_40)).toBe(2);
  });

  it('throws RangeError for an empty trick', () => {
    expect(() => trickWinner([], 'S', FRENCH_52)).toThrow(RangeError);
  });
});
