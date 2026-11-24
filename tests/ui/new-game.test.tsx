import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@/app/_client/copy';
import { NewGamePage } from '@/app/_client/new-game-page';
import { SLOT_KEY, readSlot } from '@/app/_client/slot';
import { takeKeptUpdate } from '@/app/_client/kept-update';
import { makeInProcessApi } from './support/in-process-api';
import { renderWithDeps, resetClientState } from './support/render';

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function nameInput() {
  return screen.getByLabelText(COPY.nameLabel);
}
function submitButton() {
  return screen.getByRole('button', { name: COPY.startGame });
}

describe('NewGamePage form (VC-900)', () => {
  it('disables submit until the trimmed name is non-empty; offers 2-5 rivals, default 3', async () => {
    const user = userEvent.setup();
    renderWithDeps(<NewGamePage />);
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    await user.type(nameInput(), '  ');
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    await user.type(nameInput(), 'Ana');
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);

    expect((nameInput() as HTMLInputElement).maxLength).toBe(40);
    const select = screen.getByLabelText(COPY.aiCountLabel) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['2', '3', '4', '5']);
    expect(select.value).toBe('3');
  });
});

describe('NewGamePage submit (VC-901 non-animation part)', () => {
  it('calls presets then create, stores the slot, keeps the update and navigates', async () => {
    const user = userEvent.setup();
    const { api, navigated } = renderWithDeps(<NewGamePage />);
    await user.type(nameInput(), '  Ana ');
    await user.selectOptions(screen.getByLabelText(COPY.aiCountLabel), '4');
    await user.click(submitButton());

    await waitFor(() => expect(navigated).toHaveLength(1));
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /api/presets',
      'POST /api/games',
    ]);
    const presets = (await (await api.fetch('/api/presets')).json()) as {
      defaultPresetId: string;
      presets: { id: string; deck: string }[];
    };
    const deck = presets.presets.find((p) => p.id === presets.defaultPresetId)?.deck;
    expect(api.calls[1]?.body).toEqual({
      humanName: 'Ana',
      aiCount: 4,
      rulesPreset: presets.defaultPresetId,
    });

    const slot = readSlot(window.localStorage);
    expect(slot).not.toBeNull();
    expect(slot?.seatToken).toHaveLength(43);
    expect(slot?.deck).toBe(deck);
    expect(slot?.finished).toBe(false);
    expect(navigated).toEqual([`/game/${slot?.gameId}`]);
    expect(takeKeptUpdate(slot?.gameId ?? '')?.events.length).toBeGreaterThan(0);
  });
});

describe('NewGamePage failures (VC-902)', () => {
  async function submit(fn: (api: ReturnType<typeof makeInProcessApi>) => void) {
    const user = userEvent.setup();
    const api = makeInProcessApi();
    fn(api);
    const view = renderWithDeps(<NewGamePage />, { api });
    await user.type(nameInput(), 'Ana');
    await user.click(submitButton());
    return view;
  }

  it('presets 500: no create call, no slot, message, button enabled', async () => {
    const { api } = await submit((a) =>
      a.failNext({ status: 500, body: {} }, { path: '/api/presets' }),
    );
    expect(await screen.findByText(COPY.createFailed)).toBeTruthy();
    expect(api.calls.map((c) => c.path)).toEqual(['/api/presets']);
    expect(window.localStorage.getItem(SLOT_KEY)).toBeNull();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('create 400 shows the invalid-data message', async () => {
    await submit((a) =>
      a.failNext(
        { status: 400, body: { error: { code: 'invalid_request', message: 'x' } } },
        { method: 'POST' },
      ),
    );
    expect(await screen.findByText(COPY.createInvalid)).toBeTruthy();
    expect(window.localStorage.getItem(SLOT_KEY)).toBeNull();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('create rejects: first message, no slot', async () => {
    const { navigated } = await submit((a) => a.failNext('reject-before', { method: 'POST' }));
    expect(await screen.findByText(COPY.createFailed)).toBeTruthy();
    expect(window.localStorage.getItem(SLOT_KEY)).toBeNull();
    expect(navigated).toEqual([]);
  });

  it('create never resolves: aborted at 20 s, message, button enabled', async () => {
    vi.useFakeTimers();
    const api = makeInProcessApi();
    api.failNext('hang', { method: 'POST' });
    renderWithDeps(<NewGamePage />, { api });
    // RTL's asyncWrapper waits on a real timer, which hangs under Vitest fake timers: use fireEvent.
    fireEvent.change(nameInput(), { target: { value: 'Ana' } });
    fireEvent.click(submitButton());
    expect((submitButton() as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(screen.queryByText(COPY.createFailed)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText(COPY.createFailed)).toBeTruthy();
    expect(window.localStorage.getItem(SLOT_KEY)).toBeNull();
    expect((submitButton() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Continue link (VC-903)', () => {
  const slot = { gameId: 'G1', seatToken: 't', deck: 'french-52', finished: false };

  async function link(raw: string | null) {
    if (raw !== null) window.localStorage.setItem(SLOT_KEY, raw);
    renderWithDeps(<NewGamePage />);
    // The form is always shown; wait for the mount effect to flush.
    await screen.findByRole('button', { name: COPY.startGame });
    return screen.queryByRole('link', { name: COPY.continueGame });
  }

  it('shows the link to the game for an unfinished slot', async () => {
    const a = await link(JSON.stringify(slot));
    expect(a?.getAttribute('href')).toBe('/game/G1');
  });

  it.each([
    ['finished', JSON.stringify({ ...slot, finished: true })],
    ['no key', null],
    ['unparsable', '{'],
    ['wrong type', JSON.stringify({ ...slot, gameId: 1 })],
  ])('shows no link for %s', async (_name, raw) => {
    expect(await link(raw)).toBeNull();
  });
});

describe('FR-932 (VC-906, NewGamePage)', () => {
  it('reads localStorage only after the mount effect', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const calls: number[] = [];
    function Probe() {
      calls.push(getItem.mock.calls.length);
      return <NewGamePage />;
    }
    renderWithDeps(<Probe />);
    expect(calls[0]).toBe(0);
    expect(getItem.mock.calls.length).toBeGreaterThan(0);
  });
});
