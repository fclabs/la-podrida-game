import type { PlayerView } from '@/src/domain/types';

// `Card` is not exported by `src/domain/types`; derive it from the view (layer rule: types only).
type Card = PlayerView['yourHand'][number];

/** CSS colour token of a card; `globals.css` maps each to a colour. */
export type CardColour = 'red' | 'black' | 'oros' | 'copas' | 'espadas' | 'bastos';

/** What a card shows (FR-933) and its accessible name (FR-934). */
export interface CardLabel {
  rank: string;
  suit: string;
  name: string;
  colour: CardColour;
}

interface SuitInfo {
  /** What is drawn: a symbol for french-52, the word for spanish-40. */
  shown: string;
  /** The word used in the accessible name. */
  word: string;
  colour: CardColour;
}

const FRENCH_SUITS: Record<string, SuitInfo> = {
  S: { shown: '♠', word: 'picas', colour: 'black' },
  H: { shown: '♥', word: 'corazones', colour: 'red' },
  D: { shown: '♦', word: 'diamantes', colour: 'red' },
  C: { shown: '♣', word: 'tréboles', colour: 'black' },
};

const SPANISH_SUITS: Record<string, SuitInfo> = {
  O: { shown: 'oros', word: 'oros', colour: 'oros' },
  C: { shown: 'copas', word: 'copas', colour: 'copas' },
  E: { shown: 'espadas', word: 'espadas', colour: 'espadas' },
  B: { shown: 'bastos', word: 'bastos', colour: 'bastos' },
};

const FRENCH_RANK_NAMES: Record<string, string> = { A: 'As', K: 'Rey', Q: 'Reina', J: 'Jota' };
const SPANISH_RANK_NAMES: Record<string, string> = { A: 'As', R: 'Rey', C: 'Caballo', S: 'Sota' };
const SPANISH_RANK_SHOWN: Record<string, string> = { R: '12', C: '11', S: '10' };

/** Label of `card` in `deck`; a missing or unknown deck means `french-52` (FR-933). */
export function cardLabel(card: Card, deck: string | undefined): CardLabel {
  const spanish = deck === 'spanish-40';
  const suits = spanish ? SPANISH_SUITS : FRENCH_SUITS;
  const suitInfo = suits[card.suit] ?? {
    shown: card.suit,
    word: card.suit,
    colour: 'black' as const,
  };
  const rank = spanish ? (SPANISH_RANK_SHOWN[card.rank] ?? card.rank) : card.rank;
  const rankName = (spanish ? SPANISH_RANK_NAMES : FRENCH_RANK_NAMES)[card.rank] ?? card.rank;
  return {
    rank,
    suit: suitInfo.shown,
    name: `${rankName} de ${suitInfo.word}`,
    colour: suitInfo.colour,
  };
}
