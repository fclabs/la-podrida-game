// Scoreboard over engine-played games (spec 03 FR-307, FR-308, FR-310, BR-301, BR-302;
// VC-311, VC-312).
import { describe, expect, it } from 'vitest';
import { getPreset, PRESET_IDS } from '@/src/domain/presets';
import { evaluate } from '@/src/score/score-engine';
import { lastMove, newGame, playGame } from '../engine/helpers';

describe('VC-311 evaluate is pure and deterministic over a full game', () => {
  const { states } = playGame(newGame('spain-ludoteka', 4, 'score-seed'), lastMove);

  it('never mutates the state, repeats exactly, and shares nothing with the state', () => {
    for (const state of states) {
      const before = structuredClone(state);
      const board = evaluate(state);
      expect(state).toEqual(before);
      expect(evaluate(state)).toEqual(board);
      // Scribble over every mutable part of the board: the state must stay untouched.
      for (const hand of board.hands) for (const row of hand.perSeat) row.points = 999;
      board.totals.fill(999);
      board.madeCount.fill(999);
      board.missedCount.fill(999);
      for (const row of board.live ?? []) row.bid = 999;
      for (const row of board.ranking) row.place = 999;
      expect(state).toEqual(before);
    }
  });

  it('mutating a returned board does not change a fresh evaluate', () => {
    const state = states.find((s) => s.completedHands.length > 0 && s.hand !== null);
    if (state === undefined) throw new Error('no mid-game state with a completed hand');
    const expected = evaluate(state);
    const board = evaluate(state);
    board.hands[0].perSeat[0].points = -999;
    board.totals[0] = -999;
    board.live![0].status = 'busted';
    board.live![0].tricksWon = 99;
    expect(evaluate(state)).toEqual(expected);
  });
});

describe('VC-312 evaluate after every move of a full game, each preset at minimum players', () => {
  it.each(PRESET_IDS)('%s', (id) => {
    const players = getPreset(id).players.min;
    const { states, final } = playGame(newGame(id, players, 'score-seed'), lastMove);
    for (const state of states) {
      const board = evaluate(state);
      expect('live' in board).toBe(state.hand !== null);
      expect(board.hands).toHaveLength(state.completedHands.length);
    }
    expect(final.hand).toBeNull();
    const board = evaluate(final);
    expect(board.hands).toHaveLength(final.handPlan.length);
    for (let s = 0; s < players; s++) {
      expect(board.totals[s]).toBe(board.hands.reduce((sum, h) => sum + h.perSeat[s].points, 0));
      expect(board.madeCount[s] + board.missedCount[s]).toBe(board.hands.length);
    }
    expect(board.ranking).toHaveLength(players);
    expect(board.ranking[0].place).toBe(1);
    expect(board.ranking[0].total).toBe(Math.max(...board.totals));
    for (const entry of board.ranking) {
      if (entry.total === Math.max(...board.totals) && getPreset(id).tieBreak === 'shared') {
        expect(entry.place).toBe(1);
      }
    }
  });
});
