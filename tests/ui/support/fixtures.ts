// Fixture builders for UI tests: hand-built views, updates and scoreboards. When a test needs
// consistency with the server, use real updates from `makeInProcessApi` instead.
import type { PlayerUpdate, PlayerView, ScoreBoard } from '@/src/domain/types';

export type Card = PlayerView['yourHand'][number];

export function card(rank: string, suit: string): Card {
  return { rank, suit };
}

/** An empty scoreboard for `seats` seats (no completed hands). */
export function makeScoreboard(overrides: Partial<ScoreBoard> = {}, seats = 4): ScoreBoard {
  const zeros = Array.from({ length: seats }, () => 0);
  return {
    hands: [],
    totals: zeros,
    madeCount: zeros,
    missedCount: zeros,
    ranking: zeros.map((total, seat) => ({ seat, total, place: 1 })),
    ...overrides,
  };
}

/**
 * A mid-hand bidding/playing view: 4 seats (human seat 0), hand 1 of `[3, 2, 1]` with 3 cards each
 * dealt, dealer 3, trump 9H. Seat 0 holds 2S, 5H, KD. Override any field.
 */
export function makeView(overrides: Partial<PlayerView> = {}): PlayerView {
  return {
    gameId: 'game-1',
    version: 5,
    phase: 'playing',
    you: 0,
    seats: [
      { seat: 0, name: 'Ana', kind: 'human', cardCount: 3, bid: 1, tricksWon: 0 },
      { seat: 1, name: 'Bot 1', kind: 'ai', cardCount: 3, bid: 0, tricksWon: 0 },
      { seat: 2, name: 'Bot 2', kind: 'ai', cardCount: 3, bid: 1, tricksWon: 0 },
      { seat: 3, name: 'Bot 3', kind: 'ai', cardCount: 3, bid: 1, tricksWon: 0 },
    ],
    handIndex: 0,
    handPlan: [3, 2, 1],
    dealer: 3,
    toAct: 0,
    trumpCard: card('9', 'H'),
    trumpCardInDealerHand: false,
    yourHand: [card('2', 'S'), card('5', 'H'), card('K', 'D')],
    currentTrick: [],
    lastTrick: null,
    scoreboard: makeScoreboard(),
    ...overrides,
  };
}

/** An update whose `version` follows the view's unless overridden; `view` accepts partial fields. */
export function makeUpdate(
  overrides: Partial<Omit<PlayerUpdate, 'view'>> & { view?: Partial<PlayerView> } = {},
): PlayerUpdate {
  const { view: viewOverrides, ...rest } = overrides;
  const view = makeView(viewOverrides);
  return { version: view.version, events: [], view, legalMoves: [], ...rest };
}
