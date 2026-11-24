import { COPY } from './copy';
import type { Banner as BannerData, DisplayModel } from './display';
import styles from './banner.module.css';

interface BannerProps {
  banner: BannerData;
  seats: DisplayModel['seats'];
}

/** The hand-completed banner (FR-921): `Fin de la mano N` with each seat's bid and tricks. */
export function Banner({ banner, seats }: BannerProps) {
  const nameOf = (seat: number): string =>
    seats.find((s) => s.seat === seat)?.name ?? COPY.seatFallback(seat);
  return (
    <div className={styles.banner} role="status" data-testid="hand-banner">
      <strong>{COPY.handCompleted(banner.handIndex)}</strong>
      <ul className={styles.list}>
        {banner.perSeat.map((p) => (
          <li key={p.seat}>
            {nameOf(p.seat)}: {COPY.seatBid} {p.bid} · {COPY.seatTricks} {p.tricks}
          </li>
        ))}
      </ul>
    </div>
  );
}
