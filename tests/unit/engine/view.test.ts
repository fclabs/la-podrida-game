// Table view (spec 02 FR-219 for tableViewFor, FR-236 to FR-238, BR-205; VC-216 view part,
// VC-218 tableViewFor rows, VC-228, VC-229, VC-230).
import { describe, expect, it } from 'vitest';
import { cardId, type Card } from '@/src/domain/cards';
import type { GameState, TableView } from '@/src/domain/types';
import { currentActor } from '@/src/engine/engine';
import { tableViewFor } from '@/src/engine/view';
import { newGame, playGame, type PlayedGame } from './helpers';

const SEED = 'view-secret-seed-7f3a';

/** Every object in `value` (recursively) whose own keys are exactly the strings `suit` and `rank`. */
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

const ids = (cards: readonly Card[]) => cards.map(cardId);

/** The viewers of an N-seat game: every seat and the spectator. */
const viewers = (n: number): (number | 'spectator')[] => [
  ...Array.from({ length: n }, (_, i) => i),
  'spectator',
];

/**
 * Leak check (FR-238, BR-205): ids of view cards that belong to another seat's hand, other than
 * the trump card. Empty when nothing leaks.
 */
function leakedCards(state: GameState, view: TableView, viewer: number | 'spectator'): string[] {
  if (state.hand === null) return [];
  const trump = cardId(state.hand.trumpCard);
  const others = new Set<string>();
  state.hand.hands.forEach((cards, seat) => {
    if (seat !== viewer) for (const id of ids(cards)) if (id !== trump) others.add(id);
  });
  return ids(collectCards(view)).filter((id) => others.has(id));
}

const TABLE_VIEW_KEYS = [
  'currentTrick',
  'dealer',
  'gameId',
  'handIndex',
  'handPlan',
  'lastTrick',
  'phase',
  'seats',
  'toAct',
  'trumpCard',
  'trumpCardInDealerHand',
  'version',
  'you',
  'yourHand',
].sort();

let argentina4: PlayedGame | undefined;
/** One argentina-fidepo 4-player game played by first legal move (memoised). */
function argentinaGame(): PlayedGame {
  argentina4 ??= playGame(newGame('argentina-fidepo', 4, SEED));
  return argentina4;
}

/** The state right after hand `index` was dealt. */
function stateAfterDeal(game: PlayedGame, index: number): GameState {
  if (index === 0) return game.states[0];
  const j = game.moves.findIndex((m) =>
    m.events.some((e) => e.type === 'hand-dealt' && e.handIndex === index),
  );
  expect(j).toBeGreaterThanOrEqual(0);
  return game.states[j + 1];
}

describe('VC-216 whole-deck hand: the dealer’s trump is shown, nothing else of the dealer leaks', () => {
  it.each([0, 21])('argentina-fidepo 4 players, hand %i (13 × 4 = 52)', (index) => {
    const state = stateAfterDeal(argentinaGame(), index);
    const hand = state.hand!;
    expect(hand.cardsPerPlayer).toBe(13);
    expect(hand.trumpCardInDealerHand).toBe(true);
    const trump = cardId(hand.trumpCard);
    const dealerCards = new Set(ids(hand.hands[hand.dealer]));
    expect(dealerCards.has(trump)).toBe(true);

    for (const viewer of viewers(4)) {
      const view = tableViewFor(state, viewer);
      expect(view.trumpCard).toEqual(hand.trumpCard);
      expect(view.trumpCardInDealerHand).toBe(true);
      const fromDealer = ids(collectCards(view)).filter((id) => dealerCards.has(id));
      if (viewer === hand.dealer) {
        expect(new Set(fromDealer)).toEqual(dealerCards);
      } else {
        expect(new Set(fromDealer)).toEqual(new Set([trump]));
      }
    }
  });
});

describe('VC-218 tableViewFor rejects seats outside 0 … N − 1', () => {
  const bidding = newGame('argentina-fidepo', 4, SEED).state;
  const gameOver = argentinaGame().final;

  it.each([4, -1, 1.5, Number.NaN])('bidding state, seat %s → RangeError', (seat) => {
    expect(bidding.phase).toBe('bidding');
    expect(() => tableViewFor(bidding, seat)).toThrow(RangeError);
  });

  it.each([4, -1, 1.5])('game-over state, seat %s → RangeError', (seat) => {
    expect(gameOver.phase).toBe('game-over');
    expect(() => tableViewFor(gameOver, seat)).toThrow(RangeError);
  });

  it('every valid seat and the spectator are accepted', () => {
    for (const viewer of viewers(4)) {
      expect(() => tableViewFor(bidding, viewer)).not.toThrow();
      expect(() => tableViewFor(gameOver, viewer)).not.toThrow();
    }
  });
});

describe('VC-228 mid-trick view', () => {
  const game = argentinaGame();
  // A playing state with a partial trick (1 … N − 1 plays) and a previous trick in the hand.
  const state = game.states.find(
    (s) =>
      s.phase === 'playing' &&
      s.hand !== null &&
      s.hand.currentTrick.plays.length >= 1 &&
      s.hand.currentTrick.plays.length < 4 &&
      s.hand.lastTrick !== undefined,
  )!;
  const hand = state.hand!;

  it('found a mid-trick state with a last trick', () => {
    expect(state).toBeDefined();
    expect(hand.currentTrick.plays.length).toBeGreaterThan(0);
  });

  it('seat 1 sees its own hand, counts, bids, tricks, the table and the actor', () => {
    const view = tableViewFor(state, 1);
    expect(Object.keys(view).sort()).toEqual(TABLE_VIEW_KEYS);
    expect(view.gameId).toBe(state.gameId);
    expect(view.version).toBe(state.version);
    expect(view.phase).toBe('playing');
    expect(view.handIndex).toBe(state.handIndex);
    expect(view.handPlan).toEqual(state.handPlan);
    expect(view.you).toBe(1);
    expect(view.yourHand).toEqual(hand.hands[1]);
    expect(view.seats).toEqual(
      state.seats.map((info, i) => ({
        seat: i,
        name: info.name,
        kind: info.kind,
        cardCount: hand.hands[i].length,
        bid: hand.bids[i],
        tricksWon: hand.tricksWon[i],
      })),
    );
    expect(view.dealer).toBe(hand.dealer);
    expect(view.toAct).toBe(currentActor(state));
    expect(view.toAct).toBe(hand.toAct);
    expect(view.trumpCard).toEqual(hand.trumpCard);
    expect(view.trumpCardInDealerHand).toBe(hand.trumpCardInDealerHand);
    expect(view.currentTrick).toEqual(hand.currentTrick.plays);
    expect(view.lastTrick).toEqual(hand.lastTrick);
  });

  it('a spectator has you null and an empty hand, and sees the same table', () => {
    const view = tableViewFor(state, 'spectator');
    const seatView = tableViewFor(state, 1);
    expect(view.you).toBeNull();
    expect(view.yourHand).toEqual([]);
    expect({ ...view, you: 1, yourHand: seatView.yourHand }).toEqual(seatView);
  });

  it('lastTrick is null before the first trick of a hand completes', () => {
    const fresh = stateAfterDeal(game, 1);
    expect(fresh.hand!.lastTrick).toBeUndefined();
    expect(tableViewFor(fresh, 0).lastTrick).toBeNull();
    expect(tableViewFor(fresh, 0).currentTrick).toEqual([]);
  });

  it('mutating the view does not change the state', () => {
    const before = structuredClone(state);
    const view = tableViewFor(state, 1);
    view.handPlan.push(99);
    view.handPlan[0] = -1;
    view.seats[0].name = 'changed';
    view.seats[1].cardCount = 99;
    view.yourHand[0].rank = 'X' as never;
    view.yourHand.pop();
    view.trumpCard!.suit = 'X' as never;
    view.currentTrick[0].card.rank = 'X' as never;
    view.currentTrick[0].seat = 99;
    view.currentTrick.push(view.currentTrick[0]);
    view.lastTrick!.winner = 99;
    view.lastTrick!.plays[0].card.suit = 'X' as never;
    view.lastTrick!.plays.pop();
    expect(state).toEqual(before);
  });

  it('shares no object with the state', () => {
    const fromState = new Set<object>();
    const walk = (value: unknown, sink: (o: object) => void) => {
      if (value !== null && typeof value === 'object') {
        sink(value);
        for (const item of Object.values(value)) walk(item, sink);
      }
    };
    walk(state, (o) => fromState.add(o));
    for (const viewer of viewers(4)) {
      walk(tableViewFor(state, viewer), (o) => expect(fromState.has(o)).toBe(false));
    }
  });
});

describe('VC-229 game-over view', () => {
  const game = argentinaGame();
  const state = game.final;

  it.each(viewers(4))('viewer %s', (viewer) => {
    expect(state.phase).toBe('game-over');
    expect(state.hand).toBeNull();
    const view = tableViewFor(state, viewer);
    expect(Object.keys(view).sort()).toEqual(TABLE_VIEW_KEYS);
    expect(view.phase).toBe('game-over');
    expect(view.you).toBe(viewer === 'spectator' ? null : viewer);
    expect(view.handIndex).toBe(state.handPlan.length - 1);
    expect(view.handPlan).toEqual(state.handPlan);
    expect(view.toAct).toBeNull();
    expect(view.trumpCard).toBeNull();
    expect(view.lastTrick).toBeNull();
    expect(view.trumpCardInDealerHand).toBe(false);
    expect(view.yourHand).toEqual([]);
    expect(view.currentTrick).toEqual([]);
    expect(view.seats).toEqual(
      state.seats.map((info, i) => ({
        seat: i,
        name: info.name,
        kind: info.kind,
        cardCount: 0,
        bid: null,
        tricksWon: 0,
      })),
    );
    expect(view.dealer).toBe(state.completedHands.at(-1)!.dealer);
  });
});

describe('VC-229 game-over dealer across seeds', () => {
  it('dealer is the last completed hand’s dealer (mexico-bazas 3 players, several seeds)', () => {
    const dealers = new Set<number>();
    for (const seed of ['go-0', 'go-1', 'go-2', 'go-3', 'go-4', 'go-5']) {
      const final = playGame(newGame('mexico-bazas', 3, seed)).final;
      const last = final.completedHands.at(-1)!.dealer;
      for (const viewer of viewers(3)) expect(tableViewFor(final, viewer).dealer).toBe(last);
      dealers.add(last);
    }
    // The check is meaningful only if the last dealers differ between seeds.
    expect(dealers.size).toBeGreaterThan(1);
  });
});

describe('VC-230 no view of any state leaks hidden cards, the seed, the rules or aiDecisionCount', () => {
  const game = argentinaGame();

  it('the game covers both a stock-trump hand and a whole-deck hand', () => {
    const dealt = game.events.filter((e) => e.type === 'hand-dealt');
    expect(dealt.some((e) => e.trumpCardInDealerHand)).toBe(true);
    expect(dealt.some((e) => !e.trumpCardInDealerHand)).toBe(true);
    expect(game.final.phase).toBe('game-over');
  });

  it('every state × every viewer', () => {
    let views = 0;
    for (const state of game.states) {
      for (const viewer of viewers(4)) {
        const view = tableViewFor(state, viewer);
        views += 1;

        // No other seat's card except the trump card.
        const leaks = leakedCards(state, view, viewer);
        if (leaks.length > 0) {
          throw new Error(`move state ${game.states.indexOf(state)}, viewer ${viewer}: ${leaks}`);
        }

        // Every view card is the viewer's own, on the table, in the last trick, or the trump.
        if (state.hand !== null) {
          const allowed = new Set([
            ...ids(viewer === 'spectator' ? [] : state.hand.hands[viewer]),
            ...ids(state.hand.currentTrick.plays.map((p) => p.card)),
            ...ids((state.hand.lastTrick?.plays ?? []).map((p) => p.card)),
            cardId(state.hand.trumpCard),
          ]);
          for (const id of ids(collectCards(view))) expect(allowed.has(id)).toBe(true);
        } else {
          expect(collectCards(view)).toEqual([]);
        }

        // No seed, rules or aiDecisionCount.
        expect(JSON.stringify(view).includes(SEED)).toBe(false);
        const keys = collectKeys(view);
        for (const key of ['seed', 'rules', 'aiDecisionCount']) expect(keys.has(key)).toBe(false);
      }
    }
    expect(views).toBe(game.states.length * 5);
  });
});
