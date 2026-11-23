// Determinism (spec 02 BR-201, BR-202, FR-206; VC-231, VC-232).
import { describe, expect, it } from 'vitest';
import { cardId } from '@/src/domain/cards';
import type { GameEvent, GameState } from '@/src/domain/types';
import { applyMove } from '@/src/engine/engine';
import { firstMove, lastMove, newGame, playGame, type PlayedGame } from './helpers';

/** The move id an applied-move event stands for, or `null` for automatic events. */
function moveIdOf(event: GameEvent): { seat: number; moveId: string } | null {
  if (event.type === 'bid-made') return { seat: event.seat, moveId: `bid:${event.tricks}` };
  if (event.type === 'card-played')
    return { seat: event.seat, moveId: `play:${cardId(event.card)}` };
  return null;
}

describe('VC-231 same seed + same moves → same states and events (BR-201)', () => {
  const seed = 'determinism-seed';
  const run1 = playGame(newGame('gamerules', 5, seed), firstMove);

  it('two runs are deep-equal after every move', () => {
    const run2 = newGame('gamerules', 5, seed);
    expect(run2.state).toEqual(run1.states[0]);
    expect(run2.events).toEqual(run1.events.slice(0, run2.events.length));
    let state = run2.state;
    run1.moves.forEach((m, i) => {
      const t = applyMove(state, m.seat, m.moveId);
      expect(t.state).toEqual(run1.states[i + 1]);
      expect(t.events).toEqual(m.events);
      state = t.state;
    });
    expect(state.phase).toBe('game-over');
  });

  it("replaying only run 1's bid-made / card-played events reproduces its final state", () => {
    const replay = run1.events.map(moveIdOf).filter((m) => m !== null);
    expect(replay).toHaveLength(run1.moves.length);
    let state = newGame('gamerules', 5, seed).state;
    for (const { seat, moveId } of replay) state = applyMove(state, seat, moveId).state;
    expect(state).toEqual(run1.final);
  });
});

/** The `hand.hands` of every freshly dealt hand, in hand order. */
function freshHands(game: PlayedGame): GameState['hand'][] {
  const dealt = [game.states[0].hand];
  game.moves.forEach((m, i) => {
    if (m.events.some((e) => e.type === 'hand-dealt')) dealt.push(game.states[i + 1].hand);
  });
  return dealt.map((h) => structuredClone(h));
}

describe('VC-232 deals do not depend on the moves chosen (BR-202)', () => {
  it.each([
    ['argentina-fidepo', 4],
    ['spain-ludoteka', 3],
  ] as const)('%s, %i players: first vs last legal move', (id, players) => {
    const a = playGame(newGame(id, players, 'policy-seed'), firstMove);
    const b = playGame(newGame(id, players, 'policy-seed'), lastMove);
    const dealtA = a.events.filter((e) => e.type === 'hand-dealt');
    const dealtB = b.events.filter((e) => e.type === 'hand-dealt');
    expect(dealtA).toHaveLength(a.final.handPlan.length);
    expect(dealtB).toEqual(dealtA);
    const handsA = freshHands(a).map((h) => h!.hands);
    const handsB = freshHands(b).map((h) => h!.hands);
    expect(handsA).toHaveLength(a.final.handPlan.length);
    expect(handsB).toEqual(handsA);
    expect(b.final.completedHands.map((r) => r.bids)).not.toEqual(
      a.final.completedHands.map((r) => r.bids),
    );
  });
});
