// Labels and tables tests (spec 12 VC-1213, VC-1217..1220, VC-1250).
import { describe, expect, it } from 'vitest';
import { getPreset } from '@/src/domain/presets';
import { createGame } from '@/src/engine/engine';
import { createAiPlayer } from '@/src/players/ai-player';
import { getStrategy } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { runAiLoop } from '@/src/service/ai-loop';
import { buildTables } from '../../../scripts/datagen/labels';
import { createRecorder } from '../../../scripts/datagen/recorder';
import { DecisionRowSchema, GamesRowSchema, HandsRowSchema } from '../../../scripts/datagen/schema';

function tablesOf(seed: string, n: number, preset = 'argentina-fidepo') {
  const strategies = Array.from({ length: n }, () => 'random');
  const seats = strategies.map((strategy, k) => ({
    seat: k,
    playerId: `ai-${k}`,
    name: `ai-${k}`,
    kind: 'ai' as const,
    strategy,
  }));
  const initial = createGame({ gameId: seed, rules: getPreset(preset), seats, seed }).state;
  const rec = createRecorder(initial);
  const players = seats.map((s) =>
    createAiPlayer(s.seat, s.name, rec.wrapStrategy(s.seat, getStrategy(s.strategy))),
  );
  const result = runAiLoop(initial, players, { onTransition: rec.onTransition });
  const tables = buildTables({
    run_id: 'lab',
    shard: 0,
    preset,
    strategies,
    initial,
    final: result.state,
    events: result.events,
    pending: rec.rows(),
  });
  return { tables, result, initial };
}

const CASES: [string, number][] = [
  ['lab-a', 3],
  ['lab-b', 5],
  ['lab-c', 4],
];

describe('buildTables', () => {
  it('rows parse against their schemas and per-seat arrays have n_players entries (VC-1250)', () => {
    for (const [seed, n] of CASES) {
      const { tables } = tablesOf(seed, n);
      expect(GamesRowSchema.parse(tables.games)).toEqual(tables.games);
      for (const h of tables.hands) expect(HandsRowSchema.parse(h)).toEqual(h);
      for (const d of tables.decisions) expect(DecisionRowSchema.parse(d)).toEqual(d);
      const g = tables.games;
      for (const a of [g.strategy_by_seat, g.final_total_by_seat, g.final_place_by_seat]) {
        expect(a).toHaveLength(n);
      }
      for (const h of tables.hands) {
        for (const a of [h.bid_by_seat, h.tricks_won_by_seat, h.made_by_seat, h.points_by_seat]) {
          expect(a).toHaveLength(n);
        }
      }
      for (const d of tables.decisions) {
        for (const a of [d.bids_so_far, d.tricks_won_so_far, d.score_totals, d.hidden_hands]) {
          expect(a).toHaveLength(n);
        }
      }
    }
  }, 120_000);

  it('VC-1217/1218/1220: hands rows match evaluate; places and totals add up', () => {
    for (const [seed, n] of CASES) {
      const { tables, result } = tablesOf(seed, n);
      const board = evaluate(result.state);
      expect(tables.hands.map((h) => h.hand_index)).toEqual(
        Array.from({ length: result.state.handPlan.length }, (_, i) => i),
      );
      expect(tables.games.n_hands).toBe(result.state.handPlan.length);
      tables.hands.forEach((h) => {
        expect(h.tricks_won_by_seat.reduce((a, b) => a + b, 0)).toBe(h.cards_dealt);
        expect(h.cards_dealt).toBe(result.state.handPlan[h.hand_index]);
        const per = board.hands[h.hand_index].perSeat;
        expect(h.bid_by_seat).toEqual(per.map((p) => p.bid));
        expect(h.tricks_won_by_seat).toEqual(per.map((p) => p.tricks));
        expect(h.made_by_seat).toEqual(per.map((p) => p.made));
        expect(h.points_by_seat).toEqual(per.map((p) => p.points));
      });
      const g = tables.games;
      expect(g.final_place_by_seat.reduce((a, b) => a + b, 0)).toBe(
        board.ranking.reduce((a, r) => a + r.place, 0),
      );
      g.final_total_by_seat.forEach((t, k) => {
        expect(t).toBe(tables.hands.reduce((a, h) => a + h.points_by_seat[k], 0));
      });
    }
  }, 120_000);

  it('VC-1219: decision labels equal the hands/games entries', () => {
    for (const [seed, n] of CASES) {
      const { tables } = tablesOf(seed, n);
      for (const d of tables.decisions) {
        const h = tables.hands[d.hand_index];
        expect(d.hand_bid).toBe(h.bid_by_seat[d.seat]);
        expect(d.hand_tricks_won).toBe(h.tricks_won_by_seat[d.seat]);
        expect(d.hand_made).toBe(h.made_by_seat[d.seat]);
        expect(d.hand_points).toBe(h.points_by_seat[d.seat]);
        expect(d.final_total).toBe(tables.games.final_total_by_seat[d.seat]);
        expect(d.final_place).toBe(tables.games.final_place_by_seat[d.seat]);
      }
    }
  }, 120_000);

  it('VC-1213: won_this_trick follows the next trick-won event', () => {
    for (const [seed, n] of CASES) {
      const { tables, result } = tablesOf(seed, n);
      // Independent walk over the events: winner of each played card.
      const expected: number[] = [];
      let open = 0;
      for (const e of result.events) {
        if (e.type === 'card-played') {
          open += 1;
        } else if (e.type === 'trick-won') {
          for (let i = 0; i < open; i++) expected.push(e.seat);
          open = 0;
        }
      }
      const plays = tables.decisions.filter((d) => d.decision_type === 'play');
      expect(plays).toHaveLength(expected.length);
      plays.forEach((d, i) => expect(d.won_this_trick).toBe(expected[i] === d.seat));
      for (const d of tables.decisions) {
        if (d.decision_type === 'bid') expect(d.won_this_trick).toBeNull();
      }
      // Per hand and seat, the number of true plays equals hand_tricks_won.
      for (const h of tables.hands) {
        for (let seat = 0; seat < n; seat++) {
          const wins = plays.filter(
            (d) => d.hand_index === h.hand_index && d.seat === seat && d.won_this_trick,
          ).length;
          expect(wins).toBe(h.tricks_won_by_seat[seat]);
        }
      }
    }
  }, 120_000);
});
