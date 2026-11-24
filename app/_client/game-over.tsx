import type { PlayerView } from '@/src/domain/types';
import Link from 'next/link';
import { COPY } from './copy';
import styles from './game-over.module.css';

interface GameOverProps {
  /** `finalRanking` of the shown view (FR-926). */
  ranking: NonNullable<PlayerView['finalRanking']>;
  seats: { seat: number; name: string }[];
}

/** The game-over screen (FR-926): ranking in ascending place order, ties share a place. */
export function GameOver({ ranking, seats }: GameOverProps) {
  const nameOf = (seat: number): string =>
    seats.find((s) => s.seat === seat)?.name ?? COPY.seatFallback(seat);
  // Array.prototype.sort is stable: tied seats keep the order the server gave them.
  const rows = [...ranking].sort((a, b) => a.place - b.place);
  return (
    <section className={styles.over} aria-label={COPY.gameOverTitle}>
      <h2 className={styles.title}>{COPY.gameOverTitle}</h2>
      <ol className={styles.rows}>
        {rows.map((r) => (
          <li key={r.seat} className={styles.row} data-seat={r.seat}>
            <span className={styles.place}>{r.place}</span>
            <span className={styles.name}>{nameOf(r.seat)}</span>
            <span className={styles.total}>{r.total}</span>
          </li>
        ))}
      </ol>
      <Link className={styles.link} href="/">
        {COPY.newGame}
      </Link>
    </section>
  );
}
