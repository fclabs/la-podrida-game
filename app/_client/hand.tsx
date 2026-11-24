import type { LegalMove, PlayerView } from '@/src/domain/types';
import { CardView } from './card-view';
import styles from './hand.module.css';

type Card = PlayerView['yourHand'][number];

interface HandProps {
  cards: Card[];
  deck: string | undefined;
  /** The adopted update's legal moves; ignored (no input) while `interactive` is false. */
  legalMoves: LegalMove[];
  /** False while the queue is non-empty (FR-913, FR-937): every card is plain. */
  interactive: boolean;
  /** True while a move request is in flight or awaiting retry: legal cards are disabled. */
  disabled: boolean;
  onPlay: (moveId: string) => void;
}

/**
 * The human's hand in `yourHand` order (FR-915): a card that is the `card` of a legal play is an
 * enabled button, every other card is dimmed and not clickable.
 */
export function Hand({ cards, deck, legalMoves, interactive, disabled, onPlay }: HandProps) {
  const plays = interactive ? legalMoves.filter((m) => m.move.type === 'play') : [];
  const idOf = (c: Card): string | undefined =>
    plays.find(
      (m) => m.move.type === 'play' && m.move.card.rank === c.rank && m.move.card.suit === c.suit,
    )?.id;
  // Dimmed: not a legal play while plays exist, or everything when nothing is legal (VC-923).
  const dim = interactive && (plays.length > 0 || legalMoves.length === 0);
  return (
    <ul className={styles.cards}>
      {cards.map((c, i) => {
        const id = idOf(c);
        return (
          <li key={`${c.rank}${c.suit}-${i}`}>
            {id !== undefined ? (
              <CardView card={c} deck={deck} disabled={disabled} onClick={() => onPlay(id)} />
            ) : (
              <CardView card={c} deck={deck} dimmed={dim} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
