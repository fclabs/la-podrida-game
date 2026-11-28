// Game-level tests (spec 12 VC-1204, VC-1206, VC-1248, per-game checks FR-1212/1213).
import { describe, expect, it } from 'vitest';
import { getPreset } from '@/src/domain/presets';
import { applyMove, createGame } from '@/src/engine/engine';
import { createAiPlayer } from '@/src/players/ai-player';
import { getStrategy } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { type AiLoopResult, runAiLoop } from '@/src/service/ai-loop';
import { buildPlayerView } from '@/src/service/player-view';
import {
  GameFailure,
  type PlayRecordedGameOptions,
  gameSeed,
  playRecordedGame,
} from '../../../scripts/datagen/game';

function opts(over: Partial<PlayRecordedGameOptions> = {}): PlayRecordedGameOptions {
  return {
    run_id: 'gt',
    shard: 2,
    index: 3,
    preset: 'argentina-fidepo',
    strategies: ['random', 'random', 'random'],
    replay_every: 100,
    ...over,
  };
}

function failureOf(fn: () => unknown): GameFailure {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(GameFailure);
    return error as GameFailure;
  }
  throw new Error('expected a GameFailure');
}

describe('gameSeed and ids (VC-1204)', () => {
  it('formats R-s-i', () => {
    expect(gameSeed('run-a', 0, 0)).toBe('run-a-0-0');
    expect(gameSeed('run-a', 12, 345)).toBe('run-a-12-345');
  });

  it('game_id == seed == R-s-i in every row', () => {
    const t = playRecordedGame(opts());
    expect(t.games.game_id).toBe('gt-2-3');
    expect(t.games.seed).toBe('gt-2-3');
    expect(t.games.run_id).toBe('gt');
    expect(t.games.shard).toBe(2);
    expect(t.hands.every((h) => h.game_id === 'gt-2-3')).toBe(true);
    expect(t.decisions.every((d) => d.game_id === 'gt-2-3')).toBe(true);
  });
});

describe('VC-1206: strategies and replay by hand', () => {
  it('strategy_by_seat equals the list and a hand replay reproduces the totals', () => {
    const strategies = ['random', 'random', 'random', 'random'];
    const t = playRecordedGame(opts({ strategies }));
    expect(t.games.strategy_by_seat).toEqual(strategies);
    const seats = strategies.map((strategy, k) => ({
      seat: k,
      playerId: `ai-${k}`,
      name: `ai-${k}`,
      kind: 'ai' as const,
      strategy,
    }));
    const start = createGame({
      gameId: 'gt-2-3',
      rules: getPreset('argentina-fidepo'),
      seats,
      seed: 'gt-2-3',
    });
    const players = seats.map((s) => createAiPlayer(s.seat, s.name, getStrategy(s.strategy)));
    const result = runAiLoop(start.state, players);
    expect(evaluate(result.state).totals).toEqual(t.games.final_total_by_seat);
    expect(t.decisions).toHaveLength(result.moves);
  });
});

describe('VC-1248: view columns agree with a replay of the seed', () => {
  it('20 games, every decision row', () => {
    for (let i = 0; i < 20; i++) {
      const t = playRecordedGame(opts({ index: i, run_id: 'vc1248' }));
      const seats = t.games.strategy_by_seat.map((strategy, k) => ({
        seat: k,
        playerId: `ai-${k}`,
        name: `ai-${k}`,
        kind: 'ai' as const,
        strategy,
      }));
      const seed = t.games.seed;
      let state = createGame({
        gameId: seed,
        rules: getPreset('argentina-fidepo'),
        seats,
        seed,
      }).state;
      let trickNumber = 0;
      let sinceTrick: { seat: number; card: string }[] = [];
      for (const d of t.decisions) {
        const hand = t.hands[d.hand_index];
        expect(d.dealer).toBe(hand.dealer);
        expect(d.trump_card).toBe(hand.trump_card);
        expect(d.trump_in_dealer_hand).toBe(hand.trump_in_dealer_hand);
        expect(d.cards_dealt).toBe(hand.cards_dealt);
        const view = buildPlayerView(state, d.seat);
        expect(d.bids_so_far).toEqual(view.seats.map((s) => s.bid));
        expect(d.tricks_won_so_far).toEqual(view.seats.map((s) => s.tricksWon));
        expect(d.score_totals).toEqual([...view.scoreboard.totals]);
        expect(d.trick_number).toBe(trickNumber);
        expect(d.current_trick).toEqual(sinceTrick);
        const transition = applyMove(state, d.seat, d.chosen_move_id);
        for (const e of transition.events) {
          if (e.type === 'hand-dealt') trickNumber = 0;
          else if (e.type === 'trick-won') {
            trickNumber += 1;
            sinceTrick = [];
          } else if (e.type === 'card-played') {
            sinceTrick.push({ seat: e.seat, card: d.chosen_move_id.slice(5) });
          }
        }
        state = transition.state;
      }
      expect(state.phase).toBe('game-over');
    }
  });
});

describe('VC-1250: array lengths for 3 and 5 players', () => {
  it.each([3, 5])('%i players', (n) => {
    const t = playRecordedGame(opts({ strategies: Array(n).fill('random') }));
    expect(t.games.n_players).toBe(n);
    expect(t.games.final_total_by_seat).toHaveLength(n);
    expect(t.hands[0].points_by_seat).toHaveLength(n);
    expect(t.decisions[0].hidden_hands).toHaveLength(n);
  });
});

describe('per-game checks', () => {
  it('check 1: a non-game-over result fails', () => {
    const early = (state: Parameters<typeof runAiLoop>[0]): AiLoopResult => ({
      state,
      events: [],
      moves: 0,
    });
    const f = failureOf(() => playRecordedGame(opts({ runAiLoop: early })));
    expect(f.seed).toBe('gt-2-3');
    expect(f.message).toContain('check 1');
  });

  it('check 2: removing a hands row fails', () => {
    const f = failureOf(() =>
      playRecordedGame(opts({ transformRows: (t) => ({ ...t, hands: t.hands.slice(1) }) })),
    );
    expect(f.message).toContain('check 2');
  });

  it('check 3: dropping a decisions row fails', () => {
    const f = failureOf(() =>
      playRecordedGame(opts({ transformRows: (t) => ({ ...t, decisions: t.decisions.slice(1) }) })),
    );
    expect(f.message).toContain('check 3');
  });

  it('check 4: a tricks_won sum different from cards_dealt fails', () => {
    const f = failureOf(() =>
      playRecordedGame(
        opts({
          transformRows: (t) => {
            const hands = t.hands.map((h) => ({
              ...h,
              tricks_won_by_seat: [...h.tricks_won_by_seat],
            }));
            hands[0].tricks_won_by_seat[0] += 1;
            return { ...t, hands };
          },
        }),
      ),
    );
    expect(f.message).toContain('check 4');
  });

  it('check 5: a changed hand_points fails', () => {
    const f = failureOf(() =>
      playRecordedGame(
        opts({
          transformRows: (t) => {
            const hands = t.hands.map((h) => ({ ...h, points_by_seat: [...h.points_by_seat] }));
            hands[1].points_by_seat[0] += 1;
            return { ...t, hands };
          },
        }),
      ),
    );
    expect(f.message).toContain('check 5');
  });

  it('identity transform and defaults pass', () => {
    expect(() => playRecordedGame(opts({ transformRows: (t) => t }))).not.toThrow();
  });
});

describe('replay check (FR-1213)', () => {
  it('a replay that differs by one move fails and names the first differing step', () => {
    const differ: typeof runAiLoop = (state, players, options) => {
      // Flip the 7th decision of the replay (a different legal move) by wrapping seat players.
      let calls = 0;
      const wrapped = players.map((p) => ({
        ...p,
        requestDecision: (ctx: Parameters<typeof p.requestDecision>[0]) => {
          calls += 1;
          const d = p.requestDecision(ctx);
          if (calls === 7 && d.type === 'move') {
            const other = ctx.legalMoves.find((m) => m.id !== d.moveId);
            if (other) return { type: 'move' as const, moveId: other.id };
          }
          return d;
        },
      }));
      return runAiLoop(state, wrapped, options);
    };
    const f = failureOf(() => playRecordedGame(opts({ index: 0, replayRunAiLoop: differ })));
    expect(f.seed).toBe('gt-2-0');
    expect(f.message).toMatch(/^replay: step 6 differs/);
  });

  it('the replay loop is used only for indices that are multiples of replay_every', () => {
    const count = (every: number, indices: number[]): number[] => {
      const replayed: number[] = [];
      for (const index of indices) {
        playRecordedGame(
          opts({
            index,
            replay_every: every,
            replayRunAiLoop: (state, players, options) => {
              replayed.push(index);
              return runAiLoop(state, players, options);
            },
          }),
        );
      }
      return replayed;
    };
    const idx = Array.from({ length: 205 }, (_, i) => i);
    // Default 100: only 0, 100, 200. Use few players' games; 205 games is fast enough.
    expect(count(100, idx)).toEqual([0, 100, 200]);
    expect(count(1, [0, 1, 2, 3])).toEqual([0, 1, 2, 3]);
  }, 60_000);

  it('the runAiLoop hook is not used for the replay', () => {
    let own = 0;
    playRecordedGame(
      opts({
        index: 0,
        runAiLoop: (s, p, o) => {
          own += 1;
          return runAiLoop(s, p, o);
        },
      }),
    );
    expect(own).toBe(1);
  });
});
