import type { PlayerView } from '@/src/domain/types';
import type { ReactNode } from 'react';
import { Banner } from './banner';
import { CardView } from './card-view';
import { COPY } from './copy';
import type { DisplayModel } from './display';
import styles from './table.module.css';

type Play = PlayerView['currentTrick'][number];

interface TableProps {
  model: DisplayModel;
  /** The seat to act, from the adopted view; `null` while events play (FR-937). */
  toAct: number | null;
  deck: string | undefined;
  /** Replaces the plain hand list (the page passes the interactive `Hand`, FR-913/FR-915). */
  hand?: ReactNode;
}

/** The table (FR-925): seats, trump, tricks, hand line and the human's hand. */
export function Table({ model, toAct, deck, hand }: TableProps) {
  const nameOf = (seat: number): string =>
    model.seats.find((s) => s.seat === seat)?.name ?? COPY.seatFallback(seat);

  const plays = (list: Play[]) => (
    <ul className={styles.plays}>
      {list.map((p, i) => (
        <li key={`${p.seat}-${i}`} className={styles.play}>
          <span className={styles.playSeat}>{nameOf(p.seat)}</span>
          <CardView card={p.card} deck={deck} />
        </li>
      ))}
    </ul>
  );

  return (
    <section className={styles.table}>
      {model.dealt && (
        <h2 className={styles.handLine}>
          {COPY.handLine(
            model.handIndex,
            model.handPlan.length,
            model.handPlan[model.handIndex] ?? 0,
          )}
        </h2>
      )}

      {model.banner !== null && <Banner banner={model.banner} seats={model.seats} />}

      <ul className={styles.seats}>
        {model.seats.map((s) => (
          <li
            key={s.seat}
            data-seat={s.seat}
            data-highlight={model.highlightSeat === s.seat ? 'true' : undefined}
            className={`${styles.seat} ${model.highlightSeat === s.seat ? styles.highlight : ''}`}
          >
            <span className={styles.name}>
              {s.name}
              {model.you === s.seat ? ` ${COPY.you}` : ''}
            </span>
            <span>
              {COPY.seatCards}: {s.cardCount}
            </span>
            <span>
              {COPY.seatBid}: {s.bid === null ? COPY.noBid : s.bid}
            </span>
            <span>
              {COPY.seatTricks}: {s.tricksWon}
            </span>
            {model.dealt && model.dealer === s.seat && (
              <span className={styles.marker}>{COPY.dealerMarker}</span>
            )}
            {toAct === s.seat && <span className={styles.marker}>{COPY.turnMarker}</span>}
          </li>
        ))}
      </ul>

      {model.trumpCard !== null && (
        <div className={styles.trump}>
          <span>{COPY.trumpLabel}</span>
          <CardView card={model.trumpCard} deck={deck} />
          {model.trumpCardInDealerHand && <span>{COPY.trumpInDealerHand}</span>}
        </div>
      )}

      <div className={styles.trick}>
        <h3>{COPY.currentTrickLabel}</h3>
        {plays(model.currentTrick)}
      </div>

      {model.lastTrick !== null && (
        <div className={styles.trick}>
          <h3>{COPY.lastTrickLabel}</h3>
          <p>{COPY.lastTrickWinner(nameOf(model.lastTrick.winner))}</p>
          {plays(model.lastTrick.plays)}
        </div>
      )}

      <div className={styles.hand}>
        <h3>{COPY.yourHandLabel}</h3>
        {hand ?? (
          <ul className={styles.cards}>
            {model.yourHand.map((c, i) => (
              <li key={`${c.rank}${c.suit}-${i}`}>
                <CardView card={c} deck={deck} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
