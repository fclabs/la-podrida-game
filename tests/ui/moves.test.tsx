import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@/app/_client/copy';
import { GamePage } from '@/app/_client/game-page';
import { setMemorySlot } from '@/app/_client/memory-slot';
import { SLOT_KEY } from '@/app/_client/slot';
import { makeInProcessApi } from './support/in-process-api';
import { makeUpdate } from './support/fixtures';
import { armLoad, armMove, bid, errorBody, flush, moveCalls, play } from './support/moves';
import { createStoredGame, renderWithDeps, resetClientState } from './support/render';

beforeEach(() => {
  resetClientState();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const biddingUpdate = (version = 7) =>
  makeUpdate({
    view: { version, phase: 'bidding', toAct: 0 },
    legalMoves: [bid(0), bid(2), bid(3)],
  });
const playingUpdate = (version = 5) =>
  makeUpdate({
    view: { version, toAct: 0 },
    legalMoves: [play('2', 'S'), play('K', 'D')],
  });

/** Renders the page for fixture game `game-1` whose load answers with `update`. */
async function open(update = biddingUpdate(), api = makeInProcessApi()) {
  armLoad(api, update);
  const result = renderWithDeps(<GamePage id="game-1" />, { api });
  await flush();
  return { ...result, api };
}

const bidButtons = () => screen.queryAllByRole('button').map((b) => b.textContent);
const click = (el: HTMLElement) => fireEvent.click(el);

describe('bidding and playing controls (VC-921, VC-922, VC-923)', () => {
  it('VC-921: one button per legal bid, ascending, none for the forbidden value', async () => {
    await open(
      makeUpdate({
        view: { phase: 'bidding' },
        legalMoves: [bid(3), bid(0), bid(2)],
      }),
    );
    expect(bidButtons()).toEqual(['0', '2', '3']);
  });

  it('VC-922: legal cards are enabled buttons, the others are dimmed and send nothing', async () => {
    const { api } = await open(playingUpdate());
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      '2 de picas',
      'Rey de diamantes',
    ]);
    expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    const dimmed = screen.getByRole('img', { name: '5 de corazones' });
    click(dimmed);
    await flush();
    expect(moveCalls(api)).toHaveLength(0);
  });

  it('VC-923: no buttons when legalMoves is empty (hand dimmed, not clickable)', async () => {
    await open(makeUpdate({ legalMoves: [] }));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getAllByRole('img', { name: /de/ }).length).toBeGreaterThan(0);
  });

  it('VC-923: controls are rendered but disabled while a move is in flight', async () => {
    const { api } = await open();
    api.failNext('hang', { method: 'POST' });
    click(screen.getByRole('button', { name: '2' }));
    await flush();
    const buttons = screen.getAllByRole('button') as HTMLButtonElement[];
    expect(buttons).toHaveLength(3);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    click(buttons[0] as HTMLButtonElement);
    await flush();
    expect(moveCalls(api)).toHaveLength(1);
  });

  it('VC-923: controls are disabled while a retry is pending and once Reintentar is shown', async () => {
    const { api } = await open(playingUpdate());
    api.failNext('reject-before', { method: 'POST' });
    click(screen.getByRole('button', { name: '2 de picas' }));
    await flush(500); // inside the 1 s back-off
    expect((screen.getByRole('button', { name: '2 de picas' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('action capture (VC-924, FR-916, BR-903)', () => {
  it('sends { version, moveId, clientRequestId } and a new id for each new action', async () => {
    const { api } = await open(biddingUpdate(7));
    armMove(api, 200, biddingUpdate(8));
    click(screen.getByRole('button', { name: '2' }));
    await flush();
    armMove(api, 200, biddingUpdate(9));
    click(screen.getByRole('button', { name: '3' }));
    await flush();
    const [first, second] = moveCalls(api);
    expect(first?.body).toEqual({ version: 7, moveId: 'bid:2', clientRequestId: 'id-1' });
    expect(second?.body).toEqual({ version: 8, moveId: 'bid:3', clientRequestId: 'id-2' });
    expect(first?.headers.authorization).toBe('Bearer tok');
    expect(first?.path).toBe('/api/games/game-1/moves');
    expect(first?.path).not.toContain('tok');
  });
});

describe('retries (VC-925, VC-926, FR-917)', () => {
  it('VC-925: a lost response is retried with the identical body and applied once', async () => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api);
    renderWithDeps(<GamePage id={game.gameId} />, { api });
    await flush();
    const version = game.update.version;
    const legal = screen.getAllByRole('button');
    expect(legal.length).toBeGreaterThan(0);
    api.failNext('reject-after', { method: 'POST' });
    click(legal[0] as HTMLElement);
    await flush();
    expect(moveCalls(api)).toHaveLength(1);
    expect(moveCalls(api)[0]?.status).toBeNull();
    await flush(999);
    expect(moveCalls(api)).toHaveLength(1);
    await flush(1);
    const [first, second] = moveCalls(api);
    expect(second?.body).toEqual(first?.body);
    expect(second?.status).toBe(200);

    // The server tip advanced exactly once.
    const tip = await api.api.service.getUpdate(game.gameId, game.seatToken);
    expect(tip.version).toBe(version + 1);

    // The UI adopted v + 1: its next action is captured at that version.
    const next = screen.getAllByRole('button');
    expect(next.length).toBeGreaterThan(0);
    api.failNext({ status: 500, body: {} }, { method: 'POST' });
    click(next[0] as HTMLElement);
    await flush();
    expect((moveCalls(api)[2]?.body as { version: number }).version).toBe(version + 1);
  });

  it('VC-926: four rejects send at 0, 1, 3, 7 s with identical bodies, then Reintentar', async () => {
    const api = makeInProcessApi();
    const times: number[] = [];
    armLoad(api, biddingUpdate(7));
    renderWithDeps(<GamePage id="game-1" />, {
      api,
      overrides: {
        fetch: (input, init) => {
          if (init?.method === 'POST') times.push(Date.now());
          return api.fetch(input, init);
        },
      },
    });
    await flush();
    for (let i = 0; i < 4; i++) api.failNext('reject-before', { method: 'POST' });
    const t0 = Date.now();
    click(screen.getByRole('button', { name: '2' }));
    await flush(0);
    await flush(1000);
    await flush(2000);
    await flush(4000);
    expect(times.map((t) => t - t0)).toEqual([0, 1000, 3000, 7000]);
    const bodies = moveCalls(api).map((c) => c.body);
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(screen.getByText(COPY.moveFailed)).toBeTruthy();
    const retry = screen.getByRole('button', { name: COPY.retry });

    armMove(api, 200, biddingUpdate(8));
    click(retry);
    await flush();
    expect(moveCalls(api)).toHaveLength(5);
    expect(moveCalls(api)[4]?.body).toEqual(bodies[0]);
    expect(screen.queryByText(COPY.moveFailed)).toBeNull();
  });

  it('VC-926: a send that never resolves is aborted at 20 s and retried after 1 s', async () => {
    const { api } = await open();
    api.failNext('hang', { method: 'POST' });
    click(screen.getByRole('button', { name: '2' }));
    await flush(19_999);
    expect(moveCalls(api)).toHaveLength(1);
    armMove(api, 200, biddingUpdate(8));
    await flush(1); // abort fires, back-off starts
    await flush(999);
    expect(moveCalls(api)).toHaveLength(1);
    await flush(1);
    expect(moveCalls(api)).toHaveLength(2);
  });

  it.each([
    ['503', 503, {}],
    ['200 with a bad shape', 200, { version: 9 }],
    ['409 without update', 409, errorBody('version_conflict')],
    ['409 with an invalid update', 409, { update: {} }],
    ['302', 302, {}],
  ])('VC-926: %s counts as a transport failure (retry after 1 s)', async (_n, status, body) => {
    const { api } = await open();
    armMove(api, status, body);
    click(screen.getByRole('button', { name: '2' }));
    await flush();
    expect(moveCalls(api)).toHaveLength(1);
    expect(screen.queryByText(COPY.moveConflict)).toBeNull();
    armMove(api, 200, biddingUpdate(8));
    await flush(1000);
    expect(moveCalls(api)).toHaveLength(2);
    expect(moveCalls(api)[1]?.body).toEqual(moveCalls(api)[0]?.body);
  });
});

describe('move responses (VC-920, VC-927, VC-928, VC-929)', () => {
  it('VC-920: a response with a lower version changes nothing', async () => {
    const { api } = await open(playingUpdate(5));
    armMove(
      api,
      200,
      makeUpdate({
        view: { version: 3, yourHand: [{ rank: 'A', suit: 'S' }] },
        legalMoves: [],
      }),
    );
    click(screen.getByRole('button', { name: '2 de picas' }));
    await flush();
    expect(screen.getByRole('img', { name: '5 de corazones' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'As de picas' })).toBeNull();
    // Still the adopted update: the legal cards are enabled again.
    expect((screen.getByRole('button', { name: '2 de picas' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('VC-927: a 409 adopts its update at once, with a notice', async () => {
    const { api } = await open(playingUpdate(5));
    const tip = makeUpdate({
      view: { version: 8, yourHand: [{ rank: 'A', suit: 'S' }], toAct: 0 },
      legalMoves: [play('A', 'S')],
      events: [{ type: 'bid-made', seat: 1, tricks: 1 }] as never,
    });
    armMove(api, 409, { error: { code: 'version_conflict', message: 'x' }, update: tip });
    click(screen.getByRole('button', { name: '2 de picas' }));
    await flush();
    expect(screen.getByText(COPY.moveConflict)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'As de picas' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: '5 de corazones' })).toBeNull();
  });

  it.each([
    [403, COPY.moveIllegal],
    [422, COPY.moveIllegal],
    [400, COPY.moveUnexpected],
    [413, COPY.moveUnexpected],
  ])('VC-928: %i recovers with GET ?since and shows its notice', async (status, message) => {
    const { api } = await open(playingUpdate(5));
    armMove(api, status, errorBody('x'));
    api.failNext(
      {
        status: 200,
        body: makeUpdate({
          view: { version: 9, yourHand: [{ rank: 'A', suit: 'S' }] },
          legalMoves: [play('A', 'S')],
        }),
      },
      { method: 'GET' },
    );
    click(screen.getByRole('button', { name: '2 de picas' }));
    await flush();
    const gets = api.calls.filter((c) => c.method === 'GET');
    expect(gets).toHaveLength(2);
    expect(gets[1]?.path).toBe('/api/games/game-1?since=5');
    expect(gets[1]?.headers.authorization).toBe('Bearer tok');
    expect(screen.getByText(message)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'As de picas' })).toBeTruthy();
  });

  it('VC-928: a failing recovery GET shows the load message; Reintentar repeats it', async () => {
    const { api } = await open(playingUpdate(5));
    armMove(api, 422, errorBody('illegal_move'));
    api.failNext('reject-before', { method: 'GET' });
    click(screen.getByRole('button', { name: '2 de picas' }));
    await flush();
    expect(screen.getByText(COPY.loadFailed)).toBeTruthy();
    api.failNext(
      { status: 200, body: makeUpdate({ view: { version: 9 }, legalMoves: [] }) },
      { method: 'GET' },
    );
    click(screen.getByRole('button', { name: COPY.retry }));
    await flush();
    const gets = api.calls.filter((c) => c.method === 'GET');
    expect(gets.map((c) => c.path)).toEqual([
      '/api/games/game-1',
      '/api/games/game-1?since=5',
      '/api/games/game-1?since=5',
    ]);
    expect(screen.queryByText(COPY.loadFailed)).toBeNull();
    expect(screen.getByText(COPY.moveIllegal)).toBeTruthy();
  });

  it('VC-928: a recovery GET answering 404 shows FR-907 and clears the slot', async () => {
    const { api } = await open(playingUpdate(5));
    armMove(api, 403, errorBody('forbidden'));
    api.failNext({ status: 404, body: errorBody('game_not_found') }, { method: 'GET' });
    click(screen.getByRole('button', { name: '2 de picas' }));
    await flush();
    expect(screen.getByText(COPY.gameGone)).toBeTruthy();
    expect(window.localStorage.getItem(SLOT_KEY)).toBeNull();
  });

  it.each([
    [401, COPY.accessInvalid],
    [404, COPY.gameGone],
    [410, COPY.gameUnsupported],
  ])('VC-929: a move answering %i shows its message and clears the slot', async (status, text) => {
    const { api } = await open(playingUpdate(5));
    armMove(api, status, errorBody('x'));
    click(screen.getByRole('button', { name: '2 de picas' }));
    await flush();
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByRole('link', { name: COPY.newGame })).toBeTruthy();
    expect(window.localStorage.getItem(SLOT_KEY)).toBeNull();
  });
});

describe('notices (VC-930, FR-919)', () => {
  const conflict = (api: ReturnType<typeof makeInProcessApi>, version: number) =>
    armMove(api, 409, {
      error: { code: 'version_conflict', message: 'x' },
      update: biddingUpdate(version),
    });

  it('disappears after 4 s', async () => {
    const { api } = await open();
    conflict(api, 12);
    click(screen.getByRole('button', { name: '2' }));
    await flush();
    expect(screen.getByText(COPY.moveConflict)).toBeTruthy();
    await flush(3999);
    expect(screen.getByText(COPY.moveConflict)).toBeTruthy();
    await flush(1);
    expect(screen.queryByText(COPY.moveConflict)).toBeNull();
  });

  it('disappears when the next action starts', async () => {
    const { api } = await open();
    conflict(api, 12);
    click(screen.getByRole('button', { name: '2' }));
    await flush();
    expect(screen.getByText(COPY.moveConflict)).toBeTruthy();
    api.failNext('hang', { method: 'POST' });
    click(screen.getByRole('button', { name: '3' }));
    await act(async () => {});
    expect(screen.queryByText(COPY.moveConflict)).toBeNull();
  });
});

describe('in-memory slot (VC-905 completion, FR-931)', () => {
  it('plays a move from the in-memory slot when localStorage cannot be written', async () => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api, { store: false });
    setMemorySlot(game.slot);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    renderWithDeps(<GamePage id={game.gameId} />, { api });
    await flush();
    const buttons = screen.getAllByRole('button');
    click(buttons[0] as HTMLElement);
    await flush();
    const [move] = moveCalls(api);
    expect(move?.status).toBe(200);
    expect(move?.headers.authorization).toBe(`Bearer ${game.seatToken}`);
    // The table is still there (no access message) and shows the human.
    expect(within(document.body).getByText(`Ana ${COPY.you}`)).toBeTruthy();
  });
});
