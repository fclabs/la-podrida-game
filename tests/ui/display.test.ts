import { describe, expect, it } from 'vitest';
import {
  applyEvent,
  type DisplayModel,
  emptyTable,
  eventDelayMs,
  viewToDisplay,
} from '@/app/_client/display';
import type { GameEvent, PlayerUpdate, PlayerView } from '@/src/domain/types';
import { card, makeView } from './support/fixtures';
import { makeInProcessApi } from './support/in-process-api';

const NO_TARGET = makeView();

/** A mid-trick model: seat 0 (human) holds 2S 5H KD; nobody has played yet. */
function model(overrides: Partial<PlayerView> = {}): DisplayModel {
  return viewToDisplay(makeView(overrides));
}

describe('eventDelayMs (VC-931, NFR-903)', () => {
  it('returns the FR-921 delays in order', () => {
    const events: GameEvent[] = [
      { type: 'game-started', seats: [], handPlan: [1] } as unknown as GameEvent,
      {
        type: 'hand-dealt',
        handIndex: 0,
        dealer: 0,
        cardsPerPlayer: 1,
        trumpCard: card('9', 'H'),
        trumpCardInDealerHand: false,
      },
      { type: 'bid-made', seat: 1, tricks: 0 },
      { type: 'card-played', seat: 1, card: card('2', 'S') },
      { type: 'trick-won', seat: 1, trickNumber: 1 },
      {
        type: 'hand-completed',
        handIndex: 0,
        result: {
          handIndex: 0,
          cardsPerPlayer: 1,
          dealer: 0,
          trumpSuit: 'H',
          bids: [0],
          tricks: [0],
        },
      },
      { type: 'game-over' },
    ];
    expect(events.map(eventDelayMs)).toEqual([0, 600, 600, 600, 1200, 1200, 0]);
  });
});

describe('applyEvent (VC-931)', () => {
  it('game-started and game-over change nothing visible', () => {
    const m = model();
    expect(applyEvent(m, { type: 'game-over' }, NO_TARGET)).toEqual(m);
    const started = { type: 'game-started', seats: [], handPlan: [3] } as unknown as GameEvent;
    expect(applyEvent(m, started, NO_TARGET)).toEqual(m);
  });

  it('bid-made sets that seat bid and highlights it', () => {
    const m = model({
      seats: makeView().seats.map((s) => ({ ...s, bid: null })),
    });
    const next = applyEvent(m, { type: 'bid-made', seat: 2, tricks: 3 }, NO_TARGET);
    expect(next.seats.map((s) => s.bid)).toEqual([null, null, 3, null]);
    expect(next.highlightSeat).toBe(2);
  });

  it('card-played by seat 2 lowers its count and appends to the trick', () => {
    const m = model();
    const c = card('7', 'C');
    const next = applyEvent(m, { type: 'card-played', seat: 2, card: c }, NO_TARGET);
    expect(next.seats.map((s) => s.cardCount)).toEqual([3, 3, 2, 3]);
    expect(next.currentTrick).toEqual([{ seat: 2, card: c }]);
    expect(next.yourHand).toEqual(m.yourHand);
    expect(next.highlightSeat).toBe(2);
  });

  it('card-played by the human also removes the card from yourHand', () => {
    const m = model();
    const next = applyEvent(m, { type: 'card-played', seat: 0, card: card('5', 'H') }, NO_TARGET);
    expect(next.yourHand).toEqual([card('2', 'S'), card('K', 'D')]);
    expect(next.seats[0]?.cardCount).toBe(2);
    expect(next.currentTrick).toEqual([{ seat: 0, card: card('5', 'H') }]);
  });

  it('trick-won by seat 1 increments its tricks and moves the trick to lastTrick', () => {
    const plays = [
      { seat: 0, card: card('2', 'S') },
      { seat: 1, card: card('9', 'S') },
      { seat: 2, card: card('3', 'S') },
    ];
    const m = model({ currentTrick: plays });
    const next = applyEvent(m, { type: 'trick-won', seat: 1, trickNumber: 1 }, NO_TARGET);
    expect(next.seats.map((s) => s.tricksWon)).toEqual([0, 1, 0, 0]);
    expect(next.lastTrick).toEqual({ winner: 1, plays });
    expect(next.currentTrick).toEqual([]);
    expect(next.highlightSeat).toBe(1);
  });

  it('hand-completed sets the banner from the result and clears the highlight', () => {
    const m = { ...model(), highlightSeat: 1 };
    const next = applyEvent(
      m,
      {
        type: 'hand-completed',
        handIndex: 0,
        result: {
          handIndex: 0,
          cardsPerPlayer: 3,
          dealer: 3,
          trumpSuit: 'H',
          bids: [1, 0, 1, 1],
          tricks: [1, 0, 2, 0],
        },
      },
      NO_TARGET,
    );
    expect(next.banner).toEqual({
      handIndex: 0,
      perSeat: [
        { seat: 0, bid: 1, tricks: 1 },
        { seat: 1, bid: 0, tricks: 0 },
        { seat: 2, bid: 1, tricks: 2 },
        { seat: 3, bid: 1, tricks: 0 },
      ],
    });
    expect(next.highlightSeat).toBeNull();
  });

  it('does not mutate the input model', () => {
    const m = model();
    const snapshot = structuredClone(m);
    applyEvent(m, { type: 'card-played', seat: 0, card: card('5', 'H') }, NO_TARGET);
    applyEvent(m, { type: 'bid-made', seat: 1, tricks: 2 }, NO_TARGET);
    expect(m).toEqual(snapshot);
  });
});

describe('hand-dealt and emptyTable (VC-933)', () => {
  const target = makeView({ yourHand: [card('A', 'S'), card('3', 'D')], handIndex: 1 });

  it('hand-dealt sets the target hand and resets the table', () => {
    const m = {
      ...model({
        currentTrick: [{ seat: 0, card: card('2', 'S') }],
        lastTrick: { winner: 1, plays: [{ seat: 1, card: card('9', 'S') }] },
      }),
      banner: { handIndex: 0, perSeat: [{ seat: 0, bid: 1, tricks: 1 }] },
      highlightSeat: 2,
    };
    const next = applyEvent(
      m,
      {
        type: 'hand-dealt',
        handIndex: 1,
        dealer: 0,
        cardsPerPlayer: 2,
        trumpCard: card('4', 'C'),
        trumpCardInDealerHand: true,
      },
      target,
    );
    expect(next.yourHand).toEqual(target.yourHand);
    expect(next.currentTrick).toEqual([]);
    expect(next.lastTrick).toBeNull();
    expect(next.banner).toBeNull();
    expect(next.highlightSeat).toBeNull();
    expect(next.seats.every((s) => s.cardCount === 2 && s.bid === null && s.tricksWon === 0)).toBe(
      true,
    );
    expect(next.handIndex).toBe(1);
    expect(next.dealer).toBe(0);
    expect(next.trumpCard).toEqual(card('4', 'C'));
    expect(next.trumpCardInDealerHand).toBe(true);
    expect(next.dealt).toBe(true);
  });

  it('emptyTable keeps the seats and has nothing dealt', () => {
    const view = makeView();
    const empty = emptyTable(view);
    expect(empty.trumpCard).toBeNull();
    expect(empty.trumpCardInDealerHand).toBe(false);
    expect(empty.yourHand).toEqual([]);
    expect(empty.currentTrick).toEqual([]);
    expect(empty.lastTrick).toBeNull();
    expect(empty.banner).toBeNull();
    expect(empty.highlightSeat).toBeNull();
    expect(empty.dealt).toBe(false);
    expect(empty.seats).toEqual(
      view.seats.map((s) => ({ ...s, cardCount: 0, bid: null, tricksWon: 0 })),
    );
    expect(empty.you).toBe(view.you);
    expect(empty.handPlan).toEqual(view.handPlan);
  });

  it('viewToDisplay carries the view fields, no banner, dealt', () => {
    const view = makeView();
    const m = viewToDisplay(view);
    expect(m).toMatchObject({
      seats: view.seats,
      handIndex: view.handIndex,
      handPlan: view.handPlan,
      dealer: view.dealer,
      trumpCard: view.trumpCard,
      yourHand: view.yourHand,
      currentTrick: [],
      lastTrick: null,
      you: 0,
      banner: null,
      highlightSeat: null,
      dealt: true,
    });
  });
});

const EXACT_QUEUE = [
  'card-played',
  'card-played',
  'card-played',
  'trick-won',
  'hand-completed',
  'hand-dealt',
  'bid-made',
];

/** The fields a `DisplayModel` shares with a view (banner, highlight and dealt aside). */
function shared(m: DisplayModel | PlayerView) {
  return {
    seats: m.seats,
    handIndex: m.handIndex,
    handPlan: m.handPlan,
    dealer: m.dealer,
    trumpCard: m.trumpCard,
    trumpCardInDealerHand: m.trumpCardInDealerHand,
    yourHand: m.yourHand,
    currentTrick: m.currentTrick,
    lastTrick: m.lastTrick,
    you: m.you,
  };
}

function fold(pre: PlayerView | null, update: PlayerUpdate): DisplayModel {
  let m = pre ? viewToDisplay(pre) : emptyTable(update.view);
  for (const event of update.events) m = applyEvent(m, event, update.view);
  return m;
}

describe('folding real events (VC-932)', () => {
  it('the 201 events from an empty table end at the created view', async () => {
    const { fetch } = makeInProcessApi();
    const res = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ humanName: 'Ana', aiCount: 2 }),
    });
    const body = (await res.json()) as { update: PlayerUpdate };
    expect(body.update.events.length).toBeGreaterThan(0);
    expect(shared(fold(null, body.update))).toEqual(shared(body.update.view));
  });

  it('every move response of real games folds from the pre-move view to the adopted view', async () => {
    const seen = new Set<string>();
    let exact = false;
    for (let g = 0; g < 8; g++) {
      const { fetch } = makeInProcessApi();
      const created = (await (
        await fetch('/api/games', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ humanName: 'Ana', aiCount: 2 }),
        })
      ).json()) as { gameId: string; seatToken: string; update: PlayerUpdate };
      let update = created.update;
      let n = 0;
      while (update.view.phase !== 'game-over') {
        // Vary the choice per game so different move sequences occur.
        const move = update.legalMoves[(n + g) % update.legalMoves.length];
        if (!move) throw new Error('no legal move');
        const res = await fetch(`/api/games/${created.gameId}/moves`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${created.seatToken}`,
          },
          body: JSON.stringify({
            version: update.version,
            moveId: move.id,
            clientRequestId: `c-${g}-${n++}`,
          }),
        });
        const next = (await res.json()) as PlayerUpdate;
        const types = next.events.map((e) => e.type);
        if (types.join() === EXACT_QUEUE.join()) exact = true;
        seen.add(types.join());
        // The game-over view clears the trump and the tricks; compare every other response.
        if (next.view.phase !== 'game-over') {
          expect(shared(fold(update.view, next))).toEqual(shared(next.view));
        }
        update = next;
      }
    }
    expect(seen.size).toBeGreaterThan(1);
    // The spec's exact 7-event queue (VC-932) comes out of a real game.
    expect(exact).toBe(true);
  });
});
