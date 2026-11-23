// Player model (spec 04 FR-400, FR-401, FR-402; VC-401).
import { describe, expect, it } from 'vitest';
import type { DecisionContext, LegalMove, PlayerView, Rng } from '@/src/domain/types';
import { deriveRng } from '@/src/engine/rng';
import { createAiPlayer } from '@/src/players/ai-player';
import { createHumanPlayer } from '@/src/players/human-player';
import type { AIStrategy } from '@/src/players/player';

const MOVES: LegalMove[] = [
  { id: 'bid:0', move: { type: 'bid', seat: 2, tricks: 0 } },
  { id: 'bid:1', move: { type: 'bid', seat: 2, tricks: 1 } },
  { id: 'bid:2', move: { type: 'bid', seat: 2, tricks: 2 } },
];

function makeCtx(): DecisionContext {
  return {
    view: { gameId: 'g', phase: 'bidding' } as unknown as PlayerView,
    legalMoves: MOVES.map((m) => ({ ...m })),
    rng: deriveRng('players-test', 'ai', 2, 0),
  };
}

describe('VC-401 createHumanPlayer', () => {
  it('returns a human player that always awaits', () => {
    const player = createHumanPlayer(1, 'Ana');
    expect(player).toMatchObject({ seat: 1, name: 'Ana', kind: 'human' });
    expect(player.requestDecision(makeCtx())).toEqual({ type: 'await' });
    expect(player.requestDecision({ ...makeCtx(), legalMoves: [] })).toEqual({ type: 'await' });
  });
});

describe('VC-401 createAiPlayer', () => {
  it('asks the strategy with exactly the context parts and answers with the move id', () => {
    const calls: [PlayerView, LegalMove[], Rng][] = [];
    const stub: AIStrategy = {
      name: 'stub',
      choose: (view, moves, rng) => {
        calls.push([view, moves, rng]);
        return moves[1];
      },
    };
    const player = createAiPlayer(2, 'Bot', stub);
    expect(player).toMatchObject({ seat: 2, name: 'Bot', kind: 'ai' });

    const ctx = makeCtx();
    expect(player.requestDecision(ctx)).toEqual({ type: 'move', moveId: ctx.legalMoves[1].id });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(ctx.view);
    expect(calls[0][1]).toBe(ctx.legalMoves);
    expect(calls[0][2]).toBe(ctx.rng);
  });

  it('players are plain objects, not class instances', () => {
    const stub: AIStrategy = { name: 'stub', choose: (_v, moves) => moves[0] };
    for (const player of [createHumanPlayer(0, 'A'), createAiPlayer(1, 'B', stub)]) {
      expect(Object.getPrototypeOf(player)).toBe(Object.prototype);
    }
  });
});
