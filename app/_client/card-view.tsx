import { cardLabel } from './cards';
import styles from './card-view.module.css';
import type { PlayerView } from '@/src/domain/types';

type Card = PlayerView['yourHand'][number];

interface CardViewProps {
  card: Card;
  deck: string | undefined;
  /** When given the card is a `<button>` (FR-934); otherwise a non-interactive element. */
  onClick?: () => void;
  disabled?: boolean;
  dimmed?: boolean;
}

/** A card drawn as a CSS box with rank and suit (FR-933) and an accessible name (FR-934). */
export function CardView({ card, deck, onClick, disabled, dimmed }: CardViewProps) {
  const label = cardLabel(card, deck);
  const className = [styles.card, styles[label.colour], dimmed ? styles.dimmed : '']
    .filter(Boolean)
    .join(' ');
  const face = (
    <>
      <span className={styles.rank} aria-hidden="true">
        {label.rank}
      </span>
      <span className={styles.suit} aria-hidden="true">
        {label.suit}
      </span>
    </>
  );
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        className={className}
        aria-label={label.name}
        onClick={onClick}
        disabled={disabled}
      >
        {face}
      </button>
    );
  }
  return (
    <span className={className} role="img" aria-label={label.name}>
      {face}
    </span>
  );
}
