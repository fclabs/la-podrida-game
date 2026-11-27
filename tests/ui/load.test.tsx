import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@/app/_client/copy';
import { GamePage } from '@/app/_client/game-page';
import { keepUpdate, takeKeptUpdate } from '@/app/_client/kept-update';
import { NewGamePage } from '@/app/_client/new-game-page';
import { SLOT_KEY, readSlot, writeSlot } from '@/app/_client/slot';
import { makeInProcessApi } from './support/in-process-api';
import { createStoredGame, renderWithDeps, resetClientState } from './support/render';

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const errorBody = (code: string) => ({ error: { code, message: 'x' } });

describe('no slot (VC-910, FR-905)', () => {
  it.each(['none', 'other game'])('%s: message, link to /, zero fetch calls', (kind) => {
    if (kind === 'other game') {
      writeSlot(window.localStorage, {
        gameId: 'Y',
        seatToken: 't',
        deck: 'french-52',
        finished: false,
      });
    }
    const { api } = renderWithDeps(<GamePage id="X" />);
    expect(screen.getByText(COPY.noAccess)).toBeTruthy();
    expect(screen.getByRole('link', { name: COPY.newGame }).getAttribute('href')).toBe('/');
    expect(api.calls).toHaveLength(0);
  });
});

describe('load (VC-911, FR-906)', () => {
  it('GETs once without since, with the bearer token, and shows the table', async () => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api);
    api.calls.length = 0;
    renderWithDeps(<GamePage id={game.gameId} />, { api });
    expect(await screen.findByText(`Ana ${COPY.you}`)).toBeTruthy();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.method).toBe('GET');
    expect(api.calls[0]?.path).toBe(`/api/games/${game.gameId}`);
    expect(api.calls[0]?.headers.authorization).toBe(`Bearer ${game.seatToken}`);
  });

  it('adopts the kept 201 update without a GET; a later mount makes exactly one GET', async () => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api);
    api.calls.length = 0;
    keepUpdate(game.gameId, game.update);
    const first = renderWithDeps(<GamePage id={game.gameId} />, { api });
    expect(await screen.findByText(`Ana ${COPY.you}`)).toBeTruthy();
    expect(api.calls).toHaveLength(0);
    first.unmount();

    // Client-side navigation away and back: the kept update was taken, so the page loads.
    renderWithDeps(<GamePage id={game.gameId} />, { api });
    expect(await screen.findByText(`Ana ${COPY.you}`)).toBeTruthy();
    expect(api.calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('a kept update for A is not used on route B: one GET for B, and A is cleared', async () => {
    const api = makeInProcessApi();
    const a = await createStoredGame(api, { store: false });
    const b = await createStoredGame(api);
    api.calls.length = 0;
    keepUpdate(a.gameId, a.update);
    renderWithDeps(<GamePage id={b.gameId} />, { api });
    expect(await screen.findByText(`Ana ${COPY.you}`)).toBeTruthy();
    expect(api.calls.map((c) => c.path)).toEqual([`/api/games/${b.gameId}`]);
    expect(takeKeptUpdate(a.gameId)).toBeNull();
  });

  it('under Strict Mode the kept-update path makes zero GETs', async () => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api);
    api.calls.length = 0;
    keepUpdate(game.gameId, game.update);
    renderWithDeps(<GamePage id={game.gameId} />, { api, strict: true });
    expect(await screen.findByText(`Ana ${COPY.you}`)).toBeTruthy();
    expect(api.calls).toHaveLength(0);
  });

  it('under Strict Mode the load path makes a single GET', async () => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api);
    api.calls.length = 0;
    renderWithDeps(<GamePage id={game.gameId} />, { api, strict: true });
    expect(await screen.findByText(`Ana ${COPY.you}`)).toBeTruthy();
    expect(api.calls).toHaveLength(1);
  });
});

describe('denied loads (VC-912, FR-907, FR-938)', () => {
  it.each([
    [401, 'unauthorized', COPY.accessInvalid],
    [404, 'game_not_found', COPY.gameGone],
    [410, 'game_unsupported', COPY.gameUnsupported],
  ])('%i shows its message with a link and clears the slot', async (status, code, text) => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api);
    api.failNext({ status, body: errorBody(code) });
    renderWithDeps(<GamePage id={game.gameId} />, { api });
    expect(await screen.findByText(text)).toBeTruthy();
    expect(screen.getByRole('link', { name: COPY.newGame }).getAttribute('href')).toBe('/');
    expect(window.localStorage.getItem(SLOT_KEY)).toBeNull();
  });

  it('leaves a stored slot of another game untouched (page uses the in-memory slot)', async () => {
    const api = makeInProcessApi();
    const other = { gameId: 'Y', seatToken: 'ty', deck: 'french-52', finished: false };
    writeSlot(window.localStorage, other);
    const { setMemorySlot } = await import('@/app/_client/memory-slot');
    setMemorySlot({ gameId: 'X', seatToken: 'tx', deck: 'french-52', finished: false });
    api.failNext({ status: 401, body: errorBody('unauthorized') });
    renderWithDeps(<GamePage id="X" />, { api });
    expect(await screen.findByText(COPY.accessInvalid)).toBeTruthy();
    expect(readSlot(window.localStorage)).toEqual(other);
  });
});

describe('transport failures (VC-913, FR-908)', () => {
  it('rejects, then 500, each keeps the slot; Reintentar repeats the GET and a 200 shows the table', async () => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api);
    api.calls.length = 0;
    api.failNext('reject-before');
    renderWithDeps(<GamePage id={game.gameId} />, { api });
    expect(await screen.findByText(COPY.loadFailed)).toBeTruthy();
    expect(readSlot(window.localStorage)).toEqual(game.slot);

    api.failNext({ status: 500, body: errorBody('internal') });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: COPY.retry }));
    await waitFor(() => expect(api.calls).toHaveLength(2));
    expect(await screen.findByText(COPY.loadFailed)).toBeTruthy();
    expect(readSlot(window.localStorage)).toEqual(game.slot);

    await user.click(screen.getByRole('button', { name: COPY.retry }));
    expect(await screen.findByText(`Ana ${COPY.you}`)).toBeTruthy();
    expect(api.calls.map((c) => c.path)).toEqual(Array(3).fill(`/api/games/${game.gameId}`));
  });

  it('a GET that never resolves is aborted at 20 s with the same message', async () => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api);
    vi.useFakeTimers();
    api.failNext('hang');
    renderWithDeps(<GamePage id={game.gameId} />, { api });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(screen.queryByText(COPY.loadFailed)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText(COPY.loadFailed)).toBeTruthy();
    expect(readSlot(window.localStorage)).toEqual(game.slot);
    fireEvent.click(screen.getByRole('button', { name: COPY.retry }));
    expect(screen.queryByText(COPY.loadFailed)).toBeNull();
  });
});

describe('in-memory slot (VC-905, FR-931)', () => {
  it('plays on from memory when setItem throws; after a reload there is no access', async () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    } as unknown as Storage;
    const user = userEvent.setup();
    const api = makeInProcessApi();
    const home = renderWithDeps(<NewGamePage />, { api, overrides: { storage: () => throwing } });
    await user.type(screen.getByLabelText(COPY.nameLabel), 'Ana');
    await user.click(screen.getByRole('button', { name: COPY.startGame }));
    await waitFor(() => expect(home.navigated).toHaveLength(1));
    const path = home.navigated[0] ?? '';
    const id = path.replace('/game/', '');
    home.unmount();
    api.calls.length = 0;

    // Same tab session: the kept update and the in-memory slot make the table available.
    const game = renderWithDeps(<GamePage id={id} />, {
      api,
      overrides: { storage: () => throwing },
    });
    expect(await screen.findByText(`Ana ${COPY.you}`)).toBeTruthy();
    expect(api.calls).toHaveLength(0);
    game.unmount();

    // Mounted again in the same session (kept update gone): a GET with the in-memory token.
    const again = renderWithDeps(<GamePage id={id} />, {
      api,
      overrides: { storage: () => throwing },
    });
    expect(await screen.findByText(`Ana ${COPY.you}`)).toBeTruthy();
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]?.headers.authorization).toMatch(/^Bearer .{43}$/);
    again.unmount();

    // A reload loses the in-memory slot.
    resetClientState();
    renderWithDeps(<GamePage id={id} />, { api, overrides: { storage: () => throwing } });
    expect(screen.getByText(COPY.noAccess)).toBeTruthy();
    // Moving a card is covered in Iteration 5 (VC-905 completes there).
  });
});

describe('FR-932 (VC-906, GamePage)', () => {
  it('reads localStorage only after the mount effect', async () => {
    const api = makeInProcessApi();
    const game = await createStoredGame(api);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    getItem.mockClear();
    const seen: number[] = [];
    function Probe() {
      seen.push(getItem.mock.calls.length);
      return <GamePage id={game.gameId} />;
    }
    renderWithDeps(<Probe />, { api });
    expect(seen[0]).toBe(0);
    await screen.findByText(`Ana ${COPY.you}`);
    expect(getItem.mock.calls.length).toBeGreaterThan(0);
    expect(within(document.body).queryByText(COPY.noAccess)).toBeNull();
  });
});
