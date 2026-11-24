import type { ScoreBoard } from '@/src/domain/types';
import { COPY } from './copy';
import styles from './score-sheet.module.css';

interface ScoreSheetProps {
  /** The shown view's scoreboard; `null` on the empty table before the first adoption (FR-937). */
  scoreboard: ScoreBoard | null;
  handPlan: number[];
  /** The shown view's `handIndex`: the row that shows `scoreboard.live` (FR-928). */
  handIndex: number;
  seats: { seat: number; name: string }[];
  onClose: () => void;
}

const empty = (n: number) => Array.from({ length: n }, (_, i) => <td key={i} />);

/** The score sheet panel (FR-927, FR-928): one row per `handPlan` entry, running totals. */
export function ScoreSheet({ scoreboard, handPlan, handIndex, seats, onClose }: ScoreSheetProps) {
  const hands = scoreboard?.hands ?? [];
  const live = scoreboard?.live;
  // Running total per seat, accumulated row by row over the completed hands (FR-927).
  const running = new Map<number, number>();
  return (
    <section className={styles.panel} role="dialog" aria-label={COPY.scoreSheet}>
      <div className={styles.head}>
        <h2 className={styles.title}>{COPY.scoreSheet}</h2>
        <button type="button" className={styles.close} onClick={onClose}>
          {COPY.close}
        </button>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th rowSpan={2}>{COPY.handNumber}</th>
              <th rowSpan={2}>{COPY.seatCards}</th>
              {seats.map((s) => (
                <th key={s.seat} colSpan={4}>
                  {s.name}
                </th>
              ))}
            </tr>
            <tr>
              {seats.map((s) => [
                <th key={`${s.seat}b`}>{COPY.seatBid}</th>,
                <th key={`${s.seat}t`}>{COPY.seatTricks}</th>,
                <th key={`${s.seat}p`}>{COPY.points}</th>,
                <th key={`${s.seat}s`}>{COPY.total}</th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {handPlan.map((cards, i) => {
              const done = hands.find((h) => h.handIndex === i);
              const showLive = done === undefined && live !== undefined && i === handIndex;
              return (
                <tr key={i} data-row={i} data-state={done ? 'done' : showLive ? 'live' : 'empty'}>
                  <td>{i + 1}</td>
                  <td>{cards}</td>
                  {seats.map((s) => {
                    if (done) {
                      const p = done.perSeat.find((x) => x.seat === s.seat);
                      if (!p) return empty(4);
                      const sum = (running.get(s.seat) ?? 0) + p.points;
                      running.set(s.seat, sum);
                      return [
                        <td key={`${s.seat}b`}>{p.bid}</td>,
                        <td key={`${s.seat}t`}>{p.tricks}</td>,
                        <td key={`${s.seat}p`}>{p.points}</td>,
                        <td key={`${s.seat}s`}>{sum}</td>,
                      ];
                    }
                    const l = showLive ? live.find((x) => x.seat === s.seat) : undefined;
                    if (!l) return empty(4);
                    return [
                      <td key={`${s.seat}b`}>{l.bid === null ? COPY.noBid : l.bid}</td>,
                      <td key={`${s.seat}t`}>{l.tricksWon}</td>,
                      <td key={`${s.seat}p`}>{COPY.liveStatus[l.status]}</td>,
                      <td key={`${s.seat}s`} />,
                    ];
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr data-row="totals">
              <th colSpan={2}>{COPY.total}</th>
              {seats.map((s) => [
                <td key={`${s.seat}b`} />,
                <td key={`${s.seat}t`} />,
                <td key={`${s.seat}p`} />,
                <td key={`${s.seat}s`}>{scoreboard ? (scoreboard.totals[s.seat] ?? 0) : ''}</td>,
              ])}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
