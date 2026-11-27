import type { LegalMove } from '@/src/domain/types';
import styles from './bid-bar.module.css';

interface BidBarProps {
  legalMoves: LegalMove[];
  /** True while a move request is in flight or awaiting retry (FR-913). */
  disabled: boolean;
  onBid: (moveId: string) => void;
}

/** FR-914: one button per legal bid, labelled with its `tricks`, ascending. Nothing for plays. */
export function BidBar({ legalMoves, disabled, onBid }: BidBarProps) {
  const bids = legalMoves
    .flatMap((m) => (m.move.type === 'bid' ? [{ id: m.id, tricks: m.move.tricks }] : []))
    .sort((a, b) => a.tricks - b.tricks);
  if (bids.length === 0) return null;
  return (
    <div className={styles.bar} role="group">
      {bids.map((b) => (
        <button
          key={b.id}
          type="button"
          className={styles.bid}
          disabled={disabled}
          onClick={() => onBid(b.id)}
        >
          {b.tricks}
        </button>
      ))}
    </div>
  );
}
