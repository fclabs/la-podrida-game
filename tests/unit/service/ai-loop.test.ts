// AI loop (spec 04 FR-408 to FR-412, BR-403; VC-406 to VC-410).
import { describe, expect, it } from 'vitest';
import { cardId } from '@/src/domain/cards';
import { getPreset, PRESET_IDS } from '@/src/domain/presets';
import type { PresetId } from '@/src/domain/rules';
import type {
  Decision,
  DecisionContext,
  GameEvent,
  GameState,
  SeatInfo,
  Transition,
} from '@/src/domain/types';
import {
  applyMove,
  createGame,
  currentActor,
  IllegalMoveError,
  legalMoves,
} from '@/src/engine/engine';
import { createAiPlayer } from '@/src/players/ai-player';
import { createHumanPlayer } from '@/src/players/human-player';
import type { AIStrategy, Player } from '@/src/players/player';
import { createPlayers } from '@/src/players/registry';
import { randomStrategy } from '@/src/players/strategies/random';
import { AiLoopLimitError, runAiLoop } from '@/src/service/ai-loop';

/** P-4 seats: seat `i` is `{ seat: i, playerId: 'ai-<i>', name: 'AI <i>', kind }` (default all AI). */
function seatsFor(n: number, kinds: SeatInfo['kind'][] = []): SeatInfo[] {
  return Array.from({ length: n }, (_, i) => ({
    seat: i,
    playerId: `ai-${i}`,
    name: `AI ${i}`,
    kind: kinds[i] ?? 'ai',
  }));
}

/** A fresh game of preset `id` (P-4 input, gameId `'sim'`). */
function startGame(id: PresetId, seats: SeatInfo[], seed = 'loop-seed'): GameState {
  return createGame({ gameId: 'sim', rules: getPreset(id), seats, seed }).state;
}

/** A strategy that delegates to `randomStrategy` and counts its `choose` calls. */
function countingStrategy(): AIStrategy & { calls: number } {
  const strategy = {
    name: 'counting',
    calls: 0,
    choose: (...args: Parameters<AIStrategy['choose']>) => {
      strategy.calls += 1;
      return randomStrategy.choose(...args);
    },
  };
  return strategy;
}

/** AI players for `seats` (wrapped with `createAiPlayer`), each with its own counting strategy. */
function countingPlayers(seats: SeatInfo[]): {
  players: Player[];
  strategies: (AIStrategy & { calls: number })[];
} {
  const strategies = seats.map(() => countingStrategy());
  const players = seats.map((s, i) => createAiPlayer(s.seat, s.name, strategies[i]));
  return { players, strategies };
}

/** The move id of the first event of a transition (`bid-made` or `card-played`). */
function appliedMoveId(event: GameEvent): { seat: number; id: string } {
  if (event.type === 'bid-made') return { seat: event.seat, id: `bid:${event.tricks}` };
  if (event.type === 'card-played') return { seat: event.seat, id: `play:${cardId(event.card)}` };
  throw new Error(`unexpected first event ${event.type}`);
}

const isMoveEvent = (e: GameEvent) => e.type === 'bid-made' || e.type === 'card-played';

describe('VC-406 the loop stops when the human must act and continues after their move', () => {
  it('[human, ai, ai, ai] argentina-fidepo: stops at seat 0 every time until game over', () => {
    const seats = seatsFor(4, ['human', 'ai', 'ai', 'ai']);
    const human = createHumanPlayer(0, seats[0].name);
    let humanCalls = 0;
    const players: Player[] = [
      {
        ...human,
        requestDecision: (ctx: DecisionContext): Decision => {
          humanCalls += 1;
          return human.requestDecision(ctx);
        },
      },
      ...createPlayers(seats).slice(1),
    ];
    const onTransition = (prev: GameState, transition: Transition) => {
      const { seat, id } = appliedMoveId(transition.events[0]);
      expect(seat).toBe(currentActor(prev));
      expect(seat).not.toBe(0);
      if (!legalMoves(prev, seat).some((m) => m.id === id)) expect({ seat, id }).toBeNull();
    };

    let state = startGame('argentina-fidepo', seats);
    let stops = 0;
    let calls = 0;
    for (;;) {
      const result = runAiLoop(state, players, { onTransition });
      calls += 1;
      expect(result.moves).toBe(result.events.filter(isMoveEvent).length);
      state = result.state;
      if (state.phase === 'game-over') {
        expect(currentActor(state)).toBeNull();
        break;
      }
      expect(currentActor(state)).toBe(0);
      stops += 1;
      expect(humanCalls).toBe(stops);
      state = applyMove(state, 0, legalMoves(state, 0)[0].id).state;
    }
    expect(stops).toBeGreaterThan(1);
    expect(calls).toBe(stops + 1);
    expect(humanCalls).toBe(stops);
  });
});

describe('VC-407 onTransition gets (prev, transition) once per move and can abort the loop', () => {
  const seats = seatsFor(3);

  it('is called once per move with the previous state and the next prev', () => {
    const initial = startGame('gamerules', seats);
    const calls: { prev: GameState; transition: Transition }[] = [];
    const result = runAiLoop(initial, createPlayers(seats), {
      onTransition: (prev, transition) => calls.push({ prev, transition }),
    });
    expect(result.state.phase).toBe('game-over');
    expect(calls).toHaveLength(result.moves);
    expect(calls[0].prev).toEqual(initial);
    for (let k = 0; k + 1 < calls.length; k++) {
      expect(calls[k + 1].prev).toEqual(calls[k].transition.state);
    }
    expect(calls[calls.length - 1].transition.state).toEqual(result.state);
    expect(calls.flatMap((c) => c.transition.events)).toEqual(result.events);
  });

  it('an exception on the 5th call propagates with exactly 5 moves applied', () => {
    const { players, strategies } = countingPlayers(seats);
    const boom = new Error('stop at 5');
    let count = 0;
    expect(() =>
      runAiLoop(startGame('gamerules', seats), players, {
        onTransition: () => {
          count += 1;
          if (count === 5) throw boom;
        },
      }),
    ).toThrow(boom);
    expect(count).toBe(5);
    expect(strategies.reduce((sum, s) => sum + s.calls, 0)).toBe(5);
  });
});

describe('VC-408 mismatched players throw RangeError before any move', () => {
  const seats = seatsFor(4);
  const state = startGame('argentina-fidepo', seats);

  it('length mismatch (3 players for 4 seats)', () => {
    const { players, strategies } = countingPlayers(seats);
    expect(() => runAiLoop(state, players.slice(0, 3))).toThrow(RangeError);
    expect(() => runAiLoop(state, players.slice(0, 3))).toThrow(/length 3.*4 seats/);
    expect(strategies.map((s) => s.calls)).toEqual([0, 0, 0, 0]);
  });

  it('players[2].seat = 3', () => {
    const { players, strategies } = countingPlayers(seats);
    const bad = [...players];
    bad[2] = createAiPlayer(3, 'AI 2', strategies[2]);
    expect(() => runAiLoop(state, bad)).toThrow(RangeError);
    expect(() => runAiLoop(state, bad)).toThrow(/^seat 2:/);
    expect(strategies.map((s) => s.calls)).toEqual([0, 0, 0, 0]);
  });

  it("players[1].kind = 'human' for an AI seat", () => {
    const { players, strategies } = countingPlayers(seats);
    const bad = [...players];
    bad[1] = createHumanPlayer(1, 'AI 1');
    expect(() => runAiLoop(state, bad)).toThrow(RangeError);
    expect(() => runAiLoop(state, bad)).toThrow(/^seat 1:.*kind/);
    expect(strategies.map((s) => s.calls)).toEqual([0, 0, 0, 0]);
  });
});

describe('VC-409 the move cap and illegal moves', () => {
  it('maxMoves 50 → AiLoopLimitError with moves 50 and the state after 50 moves', () => {
    const seats = seatsFor(3);
    const initial = startGame('argentina-fidepo', seats);
    const states: GameState[] = [];
    let error: unknown;
    try {
      runAiLoop(initial, createPlayers(seats), {
        maxMoves: 50,
        onTransition: (_prev, t) => states.push(t.state),
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(AiLoopLimitError);
    const limit = error as AiLoopLimitError;
    expect(limit.name).toBe('AiLoopLimitError');
    expect(limit.moves).toBe(50);
    expect(states).toHaveLength(50);
    expect(limit.state).toEqual(states[49]);
    const actor = currentActor(limit.state);
    expect(actor).not.toBeNull();
    expect(limit.state.seats[actor as number].kind).toBe('ai');
  });

  it("a strategy answering 'bid:99' → IllegalMoveError 'unknown-move', unchanged", () => {
    const seats = seatsFor(3);
    const bogus: AIStrategy = {
      name: 'bogus',
      choose: (_view, moves) => ({ ...moves[0], id: 'bid:99' }),
    };
    const players = seats.map((s) => createAiPlayer(s.seat, s.name, bogus));
    let error: unknown;
    try {
      runAiLoop(startGame('argentina-fidepo', seats), players);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(IllegalMoveError);
    expect((error as IllegalMoveError).reason).toBe('unknown-move');
    expect((error as IllegalMoveError).moveId).toBe('bid:99');
  });
});

describe('VC-410 an all-AI game plays to game over in one call', () => {
  const cases = PRESET_IDS.flatMap((id) => {
    const { min, max } = getPreset(id).players;
    return [min, max].map((n) => [id, n] as const);
  });

  it.each(cases)('%s with %i players', (id, n) => {
    const seats = seatsFor(n);
    const result = runAiLoop(startGame(id, seats, `vc410-${id}-${n}`), createPlayers(seats));
    expect(result.state.phase).toBe('game-over');
    expect(currentActor(result.state)).toBeNull();
    expect(result.moves).toBe(result.events.filter(isMoveEvent).length);
    expect(result.events[result.events.length - 1]).toEqual({ type: 'game-over' });
  });

  it('argentina-fidepo with 3 players takes exactly 981 moves', () => {
    const seats = seatsFor(3);
    const result = runAiLoop(startGame('argentina-fidepo', seats), createPlayers(seats));
    expect(result.state.phase).toBe('game-over');
    expect(result.moves).toBe(981);
  });
});
