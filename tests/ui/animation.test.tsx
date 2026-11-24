// Event animation (FR-902, FR-911, FR-920–FR-924, FR-937): VC-901 (animation part), VC-923 (queue
// case), VC-932–VC-935. Fake timers; `fireEvent` and `flush` as in D-020. One `flush(ms)` fires
// at most one queue tick, so tests step the clock event by event.
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@/app/_client/copy';
import { GamePage } from '@/app/_client/game-page';
import { keepUpdate } from '@/app/_client/kept-update';
import type { GameEvent, PlayerUpdate } from '@/src/domain/types';
import { card, makeScoreboard, makeUpdate } from './support/fixtures';
import { makeInProcessApi } from './support/in-process-api';
import { armLoad, armMove, bid, flush, play } from './support/moves';
import { createStoredGame, renderWithDeps, resetClientState } from './support/render';

beforeEach(() => {
  resetClientState();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const click = (el: HTMLElement) => fireEvent.click(el);
const controls = () =>
  screen
    .queryAllByRole('button')
    .filter((b) => b.textContent !== COPY.scoreSheet && b.textContent !== COPY.skip);
const seatText = (seat: number) =>
  document.querySelector(`[data-seat="${seat}"]`)?.textContent ?? '';
const tableHtml = () => screen.getByText(COPY.yourHandLabel).closest('section')?.innerHTML;
const section = (label: string) => screen.getByText(label).parentElement as HTMLElement;
const skipButton = () => screen.queryByRole('button', { name: COPY.skip });

const seatsAfter = (cards: number, bids: (number | null)[]) =>
  ['Ana', 'Bot 1', 'Bot 2', 'Bot 3'].map((name, seat) => ({
    seat,
    name,
    kind: seat === 0 ? ('human' as const) : ('ai' as const),
    cardCount: cards,
    bid: bids[seat] ?? null,
    tricksWon: 0,
  }));

const result = {
  handIndex: 0,
  cardsPerPlayer: 3,
  dealer: 3,
  trumpSuit: 'H',
  bids: [1, 0, 1, 1],
  tricks: [0, 1, 1, 1],
};
/** The spec's VC-932 queue. */
const events7: GameEvent[] = [
  { type: 'card-played', seat: 0, card: card('2', 'S') },
  { type: 'card-played', seat: 1, card: card('3', 'S') },
  { type: 'card-played', seat: 2, card: card('4', 'S') },
  { type: 'trick-won', seat: 1, trickNumber: 1 },
  { type: 'hand-completed', handIndex: 0, result },
  {
    type: 'hand-dealt',
    handIndex: 1,
    dealer: 0,
    cardsPerPlayer: 2,
    trumpCard: card('7', 'C'),
    trumpCardInDealerHand: false,
  },
  { type: 'bid-made', seat: 1, tricks: 1 },
];

const before = () =>
  makeUpdate({
    view: { version: 5, toAct: 0 },
    legalMoves: [play('2', 'S'), play('K', 'D')],
  });
const adopted = (events: GameEvent[]): PlayerUpdate =>
  makeUpdate({
    events,
    view: {
      version: 6,
      phase: 'bidding',
      toAct: 2,
      handIndex: 1,
      dealer: 0,
      trumpCard: card('7', 'C'),
      yourHand: [card('3', 'S'), card('4', 'D')],
      seats: seatsAfter(2, [null, 1, null, null]),
      scoreboard: makeScoreboard({
        hands: [
          {
            handIndex: 0,
            perSeat: [0, 1, 2, 3].map((seat) => ({
              seat,
              bid: result.bids[seat] ?? 0,
              tricks: result.tricks[seat] ?? 0,
              made: false,
              points: 5,
            })),
          },
        ],
        totals: [5, 5, 5, 5],
      }),
    },
    legalMoves: [bid(0), bid(1), bid(2)],
  });

/** Opens game-1 on `first`, then answers the first click's move with `response`. */
async function playOne(first: PlayerUpdate, response: PlayerUpdate, clickName = '2 de picas') {
  const api = makeInProcessApi();
  armLoad(api, first);
  renderWithDeps(<GamePage id="game-1" />, { api });
  await flush();
  armMove(api, 200, response);
  click(screen.getByRole('button', { name: clickName }));
  await flush(); // response adopted; the first event starts here (t = 0)
  return api;
}

describe('VC-932: the 7-event queue on a 200', () => {
  it('shows each effect at its start time, keeps the old state, then equals the adopted view', async () => {
    const response = adopted(events7);
    await playOne(before(), response);
    click(screen.getByRole('button', { name: COPY.scoreSheet }));
    const sheet = within(screen.getByRole('dialog'));
    const noTurnNoInput = () => {
      expect(screen.queryByText(COPY.turnMarker)).toBeNull();
      expect(controls().filter((b) => b.closest('[role="dialog"]') === null)).toHaveLength(0);
      // Pre-move scoreboard: no completed row yet.
      expect(sheet.getAllByRole('row').length).toBeGreaterThan(0);
      expect(document.querySelectorAll('tbody tr[data-state="done"]')).toHaveLength(0);
    };
    const trickCards = () => within(section(COPY.currentTrickLabel)).queryAllByRole('img');

    // t = 0: the human's card is played.
    expect(seatText(0)).toContain(`${COPY.seatCards}: 2`);
    expect(trickCards()).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: '2 de picas' })).toHaveLength(1);
    noTurnNoInput();

    await flush(600); // t = 600
    expect(seatText(1)).toContain(`${COPY.seatCards}: 2`);
    expect(trickCards()).toHaveLength(2);
    noTurnNoInput();

    await flush(600); // t = 1200
    expect(seatText(2)).toContain(`${COPY.seatCards}: 2`);
    expect(trickCards()).toHaveLength(3);

    await flush(600); // t = 1800: trick won by seat 1
    expect(seatText(1)).toContain(`${COPY.seatTricks}: 1`);
    expect(trickCards()).toHaveLength(0);
    expect(screen.getByText(COPY.lastTrickWinner('Bot 1'))).toBeTruthy();
    expect(screen.queryByText(COPY.handCompleted(0))).toBeNull();
    noTurnNoInput();

    await flush(1199); // t = 2999
    expect(screen.queryByText(COPY.handCompleted(0))).toBeNull();
    await flush(1); // t = 3000: hand completed banner
    expect(screen.getByText(COPY.handCompleted(0))).toBeTruthy();
    noTurnNoInput();

    await flush(1199); // t = 4199
    expect(screen.getByText(COPY.handCompleted(0))).toBeTruthy();
    await flush(1); // t = 4200: next hand dealt, banner gone, hand = adopted yourHand
    expect(screen.queryByText(COPY.handCompleted(0))).toBeNull();
    expect(screen.getByText(COPY.handLine(1, 3, 2))).toBeTruthy();
    expect(screen.getAllByRole('img', { name: '3 de picas' })).toHaveLength(1);
    expect(screen.getAllByRole('img', { name: '4 de diamantes' })).toHaveLength(1);
    expect(seatText(1)).toContain(`${COPY.seatBid}: ${COPY.noBid}`);
    noTurnNoInput();

    await flush(600); // t = 4800: seat 1 bids 1
    expect(seatText(1)).toContain(`${COPY.seatBid}: 1`);
    noTurnNoInput();

    await flush(600); // t = 5400: queue empty
    expect(skipButton()).toBeNull();
    expect(controls().filter((b) => b.closest('[role="dialog"]') === null)).toHaveLength(3);
    expect(document.querySelectorAll('tbody tr[data-state="done"]')).toHaveLength(1);
    expect(screen.getByText(COPY.turnMarker)).toBeTruthy();
    const animated = tableHtml();

    // The shown view equals the adopted view: same table as a fresh load of that update.
    document.body.innerHTML = '';
    const api2 = makeInProcessApi();
    armLoad(api2, response);
    renderWithDeps(<GamePage id="game-1" />, { api: api2 });
    await flush();
    expect(tableHtml()).toBe(animated);
  });
});

describe('VC-933 / VC-934 / VC-935', () => {
  it('VC-933 (page): a 200 ending with hand-dealt and two AI bids shows yourHand from the deal on', async () => {
    const evs: GameEvent[] = [
      { type: 'card-played', seat: 0, card: card('2', 'S') },
      { ...(events7[5] as GameEvent) },
      { type: 'bid-made', seat: 1, tricks: 1 },
      { type: 'bid-made', seat: 2, tricks: 0 },
    ];
    await playOne(before(), adopted(evs));
    expect(screen.queryByRole('img', { name: '3 de picas' })).toBeNull();
    expect(screen.getByRole('img', { name: '5 de corazones' })).toBeTruthy();
    await flush(600); // hand-dealt
    expect(screen.getByRole('img', { name: '3 de picas' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '4 de diamantes' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: '5 de corazones' })).toBeNull();
    await flush(600);
    await flush(600);
    expect(screen.getByRole('img', { name: '3 de picas' })).toBeTruthy();
    expect(seatText(2)).toContain(`${COPY.seatBid}: 0`);
  });

  it('VC-933 (201): the animation starts from the empty table, then deals', async () => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api);
    keepUpdate(game.gameId, game.update);
    renderWithDeps(<GamePage id={game.gameId} />, { api });
    // Right after mounting: the empty table, nothing dealt, no input, `Saltar` offered.
    for (const s of game.update.view.seats)
      expect(seatText(s.seat)).toContain(`${COPY.seatCards}: 0`);
    expect(screen.queryByText(COPY.trumpLabel)).toBeNull();
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(controls()).toHaveLength(0);
    expect(skipButton()).toBeTruthy();
    expect(api.calls.filter((c) => c.method === 'GET')).toHaveLength(0);

    // Step the whole queue: no input until it drains (VC-901, VC-923).
    for (let i = 0; i < 60 && skipButton() !== null; i++) {
      expect(controls()).toHaveLength(0);
      await flush(600);
    }
    expect(skipButton()).toBeNull();
    expect(screen.getByText(COPY.trumpLabel)).toBeTruthy();
    expect(controls().length).toBe(game.update.legalMoves.length);
  });

  it('VC-934: Saltar empties the queue and shows the adopted view, input enabled', async () => {
    const response = adopted(events7);
    await playOne(before(), response);
    await flush(600);
    click(screen.getByRole('button', { name: COPY.skip }));
    await flush();
    expect(skipButton()).toBeNull();
    expect(controls()).toHaveLength(3);
    const skipped = tableHtml();
    document.body.innerHTML = '';
    const api2 = makeInProcessApi();
    armLoad(api2, response);
    renderWithDeps(<GamePage id="game-1" />, { api: api2 });
    await flush();
    expect(tableHtml()).toBe(skipped);
  });

  it('VC-935 / FR-924: the seat that produced the event is highlighted', async () => {
    const evs: GameEvent[] = [
      { type: 'bid-made', seat: 3, tricks: 1 },
      { type: 'bid-made', seat: 1, tricks: 0 },
    ];
    await playOne(before(), adopted(evs));
    const marked = () =>
      [...document.querySelectorAll('[data-highlight="true"]')].map((e) =>
        e.getAttribute('data-seat'),
      );
    expect(marked()).toEqual(['3']);
    await flush(600);
    expect(marked()).toEqual(['1']);
    await flush(600);
    expect(marked()).toEqual([]);
  });
});

describe('FR-911 / FR-937', () => {
  it('a 409 is adopted at once, without animation (VC-927)', async () => {
    const api = makeInProcessApi();
    armLoad(api, before());
    renderWithDeps(<GamePage id="game-1" />, { api });
    await flush();
    armMove(api, 409, {
      error: { code: 'version_conflict', message: 'x' },
      update: adopted(events7),
    });
    click(screen.getByRole('button', { name: '2 de picas' }));
    await flush();
    expect(skipButton()).toBeNull();
    expect(screen.getByText(COPY.moveConflict)).toBeTruthy();
    expect(controls()).toHaveLength(3);
  });

  it('a load adoption is instant; a stale kept update for another game is not used', async () => {
    const api = makeInProcessApi();
    armLoad(api, adopted(events7));
    renderWithDeps(<GamePage id="game-1" />, { api });
    await flush();
    expect(skipButton()).toBeNull();
  });

  it('the game-over screen waits for the end of the queue and the phase stays the old one', async () => {
    const last = makeUpdate({
      events: [{ type: 'card-played', seat: 0, card: card('2', 'S') }, { type: 'game-over' }],
      view: {
        version: 6,
        phase: 'game-over',
        toAct: null,
        finalRanking: [
          { seat: 0, total: 9, place: 1 },
          { seat: 1, total: 8, place: 2 },
          { seat: 2, total: 7, place: 3 },
          { seat: 3, total: 6, place: 4 },
        ],
      },
      legalMoves: [],
    });
    await playOne(before(), last);
    expect(screen.queryByText(COPY.newGame)).toBeNull();
    await flush(600); // game-over event (0 ms)
    expect(screen.queryByText(COPY.newGame)).toBeNull();
    await flush(0);
    expect(screen.getByText(COPY.newGame)).toBeTruthy();
    expect(skipButton()).toBeNull();
  });
});
