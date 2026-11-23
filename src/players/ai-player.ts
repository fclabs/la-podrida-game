import type { AIStrategy, Player } from './player';

/**
 * An AI player (FR-402): `requestDecision(ctx)` asks `strategy.choose(ctx.view, ctx.legalMoves,
 * ctx.rng)` and answers with that move's id.
 */
export function createAiPlayer(seat: number, name: string, strategy: AIStrategy): Player {
  return {
    seat,
    name,
    kind: 'ai',
    requestDecision: (ctx) => ({
      type: 'move',
      moveId: strategy.choose(ctx.view, ctx.legalMoves, ctx.rng).id,
    }),
  };
}
