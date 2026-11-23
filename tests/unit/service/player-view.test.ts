// Player view (spec 04 FR-406, FR-407, BR-401; VC-404, VC-405).
import { describe, expect, it } from 'vitest';
import { cardId, type Card } from '@/src/domain/cards';
import { getPreset } from '@/src/domain/presets';
import type { GameState, PlayerView } from '@/src/domain/types';
import { createGame } from '@/src/engine/engine';
import { tableViewFor } from '@/src/engine/view';
import { evaluate } from '@/src/score/score-engine';
import { buildPlayerView } from '@/src/service/player-view';
import { makeSeats, newGame, playGame } from '../engine/helpers';

/** Every object in `value` (recursively) whose own keys are exactly `rank` and `suit`. */
function collectCards(value: unknown, out: Card[] = []): Card[] {
  if (Array.isArray(value)) {
    for (const item of value) collectCards(item, out);
  } else if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (
      keys.length === 2 &&
      keys[0] === 'rank' &&
      keys[1] === 'suit' &&
      typeof record.rank === 'string' &&
      typeof record.suit === 'string'
    ) {
      out.push(record as unknown as Card);
    } else {
      for (const item of Object.values(record)) collectCards(item, out);
    }
  }
  return out;
}

/** Every own key of every object in `value` (recursively). */
function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.add(key);
      collectKeys(item, out);
    }
  }
  return out;
}

/** Ids of view cards held in another seat's hand, other than the trump card (empty = no leak). */
function leakedCards(state: GameState, view: PlayerView, viewer: number | 'spectator'): string[] {
  if (state.hand === null) return [];
  const trump = cardId(state.hand.trumpCard);
  const others = new Set<string>();
  state.hand.hands.forEach((cards, seat) => {
    if (seat !== viewer) for (const c of cards) if (cardId(c) !== trump) others.add(cardId(c));
  });
  return collectCards(view)
    .map(cardId)
    .filter((id) => others.has(id));
}

describe('VC-404 buildPlayerView composes the table view and the scoreboard', () => {
  const game = playGame(newGame('argentina-fidepo', 4));

  it('bidding state, seat 1: table view + scoreboard, no finalRanking property', () => {
    const state = game.states[0];
    expect(state.phase).toBe('bidding');
    const view = buildPlayerView(state, 1);
    expect(view).toEqual({ ...tableViewFor(state, 1), scoreboard: evaluate(state) });
    expect('finalRanking' in view).toBe(false);
  });

  it('every non-final state has no finalRanking property', () => {
    for (const state of game.states.slice(0, -1)) {
      expect(state.phase).not.toBe('game-over');
      expect('finalRanking' in buildPlayerView(state, 0)).toBe(false);
    }
  });

  it('game-over state: finalRanking equals the scoreboard ranking', () => {
    const state = game.final;
    expect(state.phase).toBe('game-over');
    for (const viewer of [0, 1, 2, 3, 'spectator'] as const) {
      const view = buildPlayerView(state, viewer);
      expect(view.finalRanking).toEqual(view.scoreboard.ranking);
      expect(view).toEqual({
        ...tableViewFor(state, viewer),
        scoreboard: evaluate(state),
        finalRanking: evaluate(state).ranking,
      });
    }
  });

  it('spectator: you is null', () => {
    expect(buildPlayerView(game.states[0], 'spectator').you).toBeNull();
    expect(buildPlayerView(game.final, 'spectator').you).toBeNull();
  });

  it('a seat outside 0 … N − 1 throws RangeError', () => {
    expect(() => buildPlayerView(game.states[0], 4)).toThrow(RangeError);
  });
});

describe('VC-405 no view leaks another hand, the seed, the rules or aiDecisionCount', () => {
  // P-3: the seed never reaches the view through gameId.
  const SEED = 'secret-view-seed';
  const game = playGame(
    createGame({
      gameId: 'view-game',
      rules: getPreset('argentina-fidepo'),
      seats: makeSeats(4),
      seed: SEED,
    }),
  );
  const viewers: (number | 'spectator')[] = [0, 1, 2, 3, 'spectator'];

  it('the game covers a stock-trump hand and a whole-deck hand', () => {
    const hands = game.states.flatMap((s) => (s.hand === null ? [] : [s.hand]));
    expect(hands.some((h) => !h.trumpCardInDealerHand)).toBe(true);
    expect(hands.some((h) => h.trumpCardInDealerHand && h.cardsPerPlayer === 13)).toBe(true);
    expect(game.final.phase).toBe('game-over');
  });

  it('for every state and viewer: no foreign card, no seed, no rules/seed/aiDecisionCount key', () => {
    for (const state of game.states) {
      for (const viewer of viewers) {
        const view = buildPlayerView(state, viewer);
        const leaked = leakedCards(state, view, viewer);
        if (leaked.length > 0) expect({ version: state.version, viewer, leaked }).toBeNull();
        if (JSON.stringify(view).includes(SEED))
          expect({ version: state.version, viewer }).toBeNull();
        const keys = collectKeys(view);
        for (const key of ['rules', 'seed', 'aiDecisionCount']) {
          if (keys.has(key)) expect({ version: state.version, viewer, key }).toBeNull();
        }
      }
    }
  });
});
