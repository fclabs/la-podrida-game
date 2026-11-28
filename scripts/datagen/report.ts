// The distribution report printed by `validate` (spec 12 FR-1222, Data & Interfaces). Pure: the
// accumulator is fed row by row and never holds a table in memory.
import type { GamesRow, HandsRow } from './schema';

export type ReportStatus = 'OK' | 'INCOMPLETE';

export interface ReportStats {
  games: number;
  hands: number;
  decisions: number;
  /** Fewest / most decisions in one game (0 when there are no games). */
  minDecisions: number;
  maxDecisions: number;
  madeBids: number;
  bids: number;
  /** Sum of `final_total_by_seat[k]` and the number of games, per seat index. */
  seatTotals: { sum: number; count: number }[];
  /** Same, per strategy name, over every (game, seat). */
  strategyTotals: Map<string, { sum: number; count: number }>;
  /** `cards_dealt` -> bid counts for values `0 … cards_dealt`. */
  bidHistogram: Map<number, number[]>;
}

export interface ReportAccumulator {
  /** One `games` row and the number of `decisions` rows that game has. */
  addGame(game: GamesRow, decisionCount: number): void;
  addHand(hand: HandsRow): void;
  stats(): ReportStats;
}

/** One decimal, never `-0.0`. */
export function oneDecimal(value: number): string {
  const text = value.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
}

export function createReportAccumulator(): ReportAccumulator {
  const stats: ReportStats = {
    games: 0,
    hands: 0,
    decisions: 0,
    minDecisions: 0,
    maxDecisions: 0,
    madeBids: 0,
    bids: 0,
    seatTotals: [],
    strategyTotals: new Map(),
    bidHistogram: new Map(),
  };
  return {
    addGame(game, decisionCount) {
      stats.minDecisions =
        stats.games === 0 ? decisionCount : Math.min(stats.minDecisions, decisionCount);
      stats.maxDecisions = Math.max(stats.maxDecisions, decisionCount);
      stats.games += 1;
      stats.decisions += decisionCount;
      game.final_total_by_seat.forEach((total, k) => {
        const seat = (stats.seatTotals[k] ??= { sum: 0, count: 0 });
        seat.sum += total;
        seat.count += 1;
        const name = game.strategy_by_seat[k] ?? '?';
        const strategy = stats.strategyTotals.get(name) ?? { sum: 0, count: 0 };
        strategy.sum += total;
        strategy.count += 1;
        stats.strategyTotals.set(name, strategy);
      });
    },
    addHand(hand) {
      stats.hands += 1;
      let histogram = stats.bidHistogram.get(hand.cards_dealt);
      if (histogram === undefined) {
        histogram = new Array<number>(hand.cards_dealt + 1).fill(0);
        stats.bidHistogram.set(hand.cards_dealt, histogram);
      }
      hand.bid_by_seat.forEach((bid, seat) => {
        stats.bids += 1;
        if (hand.made_by_seat[seat]) stats.madeBids += 1;
        if (bid >= 0 && bid < histogram.length) histogram[bid] += 1;
      });
    },
    stats: () => stats,
  };
}

/** The report of the spec, trailing newline included. Labels and order are fixed. */
export function formatReport(runId: string, status: ReportStatus, stats: ReportStats): string {
  const mean = stats.games === 0 ? 0 : stats.decisions / stats.games;
  const rate = stats.bids === 0 ? 0 : (100 * stats.madeBids) / stats.bids;
  const average = (t: { sum: number; count: number }): string => oneDecimal(t.sum / t.count);
  const lines = [
    `validate: ${runId}  status: ${status}`,
    `games: ${stats.games}  hands: ${stats.hands}  decisions: ${stats.decisions}`,
    `decisions per game: mean ${oneDecimal(mean)}  min ${stats.minDecisions}  max ${stats.maxDecisions}`,
    `made-bid rate: ${oneDecimal(rate)}%`,
    `average final total by seat: ${stats.seatTotals.map((t, k) => `${k}: ${average(t)}`).join('  ')}`,
    `average final total by strategy: ${[...stats.strategyTotals]
      .map(([name, t]) => `${name}: ${average(t)}`)
      .join('  ')}`,
  ];
  for (const dealt of [...stats.bidHistogram.keys()].sort((a, b) => a - b)) {
    const counts = stats.bidHistogram.get(dealt) ?? [];
    lines.push(`bid histogram, ${dealt}: ${counts.map((n, v) => `${v}:${n}`).join(' ')}`);
  }
  return lines.join('\n') + '\n';
}
