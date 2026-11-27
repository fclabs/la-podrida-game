// VC-945-VC-949: a whole default-preset game (2 AIs) through the UI against the in-process API.
// One run is recorded, then each invariant is asserted on the record. Real timers; `Saltar` is
// clicked whenever the animation queue plays, so the loop never waits on the 600/1200 ms delays.
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlayerUpdate } from '@/src/domain/types';
import { cardLabel } from '@/app/_client/cards';
import { COPY } from '@/app/_client/copy';
import { GamePage } from '@/app/_client/game-page';
import { NewGamePage } from '@/app/_client/new-game-page';
import { readSlot } from '@/app/_client/slot';
import { makeInProcessApi } from './support/in-process-api';
import { renderWithDeps, resetClientState } from './support/render';

interface Seen {
  status: number;
  method: string;
  path: string;
  update: PlayerUpdate | null;
}

const CHROME = new Set<string>([COPY.scoreSheet, COPY.skip, COPY.retry]);
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/** Every `{ rank, suit }` object anywhere in `value`, as `"<rank>|<suit>"`. */
function collectCards(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const v of value) collectCards(v, into);
  } else if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.rank === 'string' && typeof o.suit === 'string') into.add(`${o.rank}|${o.suit}`);
    for (const v of Object.values(o)) collectCards(v, into);
  }
}

function enabledControls(): HTMLButtonElement[] {
  return screen
    .queryAllByRole('button')
    .filter((b): b is HTMLButtonElement => b instanceof HTMLButtonElement)
    .filter((b) => !CHROME.has(b.textContent ?? '') && !b.disabled);
}

const gameOverShown = () => screen.queryByText(COPY.gameOverTitle) !== null;

const run = {
  seen: [] as Seen[],
  token: '',
  gameId: '',
  tip: 0,
  clicks: 0,
  noticeSeen: false,
  legalMismatches: [] as string[],
  sentOutsideLegal: [] as string[],
  domLeaks: [] as string[],
  unseenCards: [] as string[],
  consoleArgs: [] as string[],
  api: makeInProcessApi(),
  requestBodies: [] as unknown[],
  requestUrls: [] as string[],
  authHeaders: [] as { path: string; authorization: string | undefined }[],
  navigated: [] as string[],
  finalTipFromServer: -1,
  finalRanking: false,
};

describe('full game through the UI (VC-945-VC-949)', () => {
  const spies: ReturnType<typeof vi.spyOn>[] = [];

  beforeAll(async () => {
    resetClientState();
    for (const m of CONSOLE_METHODS) {
      spies.push(
        vi.spyOn(console, m).mockImplementation((...args: unknown[]) => {
          run.consoleArgs.push(args.map((a) => String(a)).join(' '));
        }),
      );
    }
    const api = run.api;
    const latest = (): PlayerUpdate | null => {
      let best: PlayerUpdate | null = null;
      for (const s of run.seen)
        if (s.update !== null && (best === null || s.update.version >= best.version))
          best = s.update;
      return best;
    };

    // Records every exchange (status, parsed 200/201 update) without altering it.
    const recordingFetch: typeof fetch = async (input, init) => {
      // VC-946: the moveId about to be sent must be a legal move of the newest adopted update.
      if (
        init?.method === 'POST' &&
        String(input).endsWith('/moves') &&
        typeof init.body === 'string'
      ) {
        const moveId = (JSON.parse(init.body) as { moveId?: string }).moveId ?? '';
        const adopted = latest();
        if (!adopted?.legalMoves.some((m) => m.id === moveId))
          run.sentOutsideLegal.push(`${moveId} @v${adopted?.version}`);
      }
      const res = await api.fetch(input, init);
      const path = typeof input === 'string' ? input : String(input);
      let update: PlayerUpdate | null = null;
      if (res.status === 200 || res.status === 201) {
        const body = (await res.clone().json()) as {
          update?: PlayerUpdate;
        } & Partial<PlayerUpdate>;
        const candidate = (body.update ?? body) as PlayerUpdate;
        if (typeof candidate.version === 'number' && Array.isArray(candidate.legalMoves))
          update = candidate;
      }
      run.seen.push({ status: res.status, method: init?.method ?? 'GET', path, update });
      return res;
    };

    // Create through `/`.
    const user = userEvent.setup();
    const first = renderWithDeps(<NewGamePage />, { api, overrides: { fetch: recordingFetch } });
    await user.type(screen.getByLabelText(COPY.nameLabel), 'Ana');
    await user.selectOptions(screen.getByLabelText(COPY.aiCountLabel), '2');
    await user.click(screen.getByRole('button', { name: COPY.startGame }));
    await waitFor(() => expect(first.navigated).toHaveLength(1));
    run.navigated.push(...first.navigated);
    const slot = readSlot(window.localStorage);
    if (slot === null) throw new Error('no slot after create');
    run.token = slot.seatToken;
    run.gameId = slot.gameId;
    first.unmount();

    // Play on `/game/[id]` (the kept 201 update is shown at once, no GET).
    renderWithDeps(<GamePage id={slot.gameId} />, { api, overrides: { fetch: recordingFetch } });

    const knownCards = new Set<string>();
    const everyCardName = new Set<string>();
    for (const suit of ['S', 'H', 'D', 'C'])
      for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'])
        everyCardName.add(cardLabel({ rank, suit }, slot.deck).name);

    const scanDom = () => {
      const html = document.body.innerHTML;
      if (html.includes(run.token)) run.domLeaks.push('token in DOM');
      if (screen.queryByRole('status') !== null) run.noticeSeen = true;
      for (const s of run.seen) if (s.update !== null) collectCards(s.update, knownCards);
      for (const el of document.querySelectorAll('[aria-label]')) {
        const label = el.getAttribute('aria-label') ?? '';
        if (!everyCardName.has(label)) continue;
        const known = [...knownCards].some((k) => {
          const [rank, suit] = k.split('|') as [string, string];
          return cardLabel({ rank, suit }, slot.deck).name === label;
        });
        if (!known) run.unseenCards.push(label);
      }
    };

    const settle = () => act(async () => new Promise<void>((r) => setTimeout(r, 0)));

    for (let guard = 0; guard < 2000 && !gameOverShown(); guard++) {
      scanDom();
      const skip = screen.queryByRole('button', { name: COPY.skip });
      if (skip !== null) {
        fireEvent.click(skip);
        await settle();
        continue;
      }
      const controls = enabledControls();
      if (controls.length === 0) {
        await waitFor(
          () =>
            expect(
              gameOverShown() ||
                screen.queryByRole('button', { name: COPY.skip }) !== null ||
                enabledControls().length > 0,
            ).toBe(true),
          { timeout: 5000 },
        );
        continue;
      }
      // VC-946: every enabled control is a legal move of the adopted update.
      const adopted = latest();
      if (adopted === null) throw new Error('no adopted update');
      const legalNames = new Set<string>(
        adopted.legalMoves.map((m) =>
          m.move.type === 'bid' ? String(m.move.tricks) : cardLabel(m.move.card, slot.deck).name,
        ),
      );
      for (const c of controls) {
        const name = c.getAttribute('aria-label') ?? c.textContent ?? '';
        if (!legalNames.has(name)) run.legalMismatches.push(`v${adopted.version}: ${name}`);
      }
      const before = run.seen.length;
      fireEvent.click(controls[0] as HTMLButtonElement);
      run.clicks++;
      await waitFor(() => expect(run.seen.length).toBeGreaterThan(before), { timeout: 5000 });
      await settle();
    }
    scanDom();
    run.finalRanking = gameOverShown() && document.querySelectorAll('ol li[data-seat]').length > 0;

    run.requestBodies = run.api.calls.map((c) => c.body);
    run.requestUrls = run.api.calls.map((c) => c.path);
    run.authHeaders = run.api.calls.map((c) => ({
      path: c.path,
      authorization: c.headers.authorization,
    }));
    run.tip = latest()?.version ?? -1;
    const tip = await run.api.fetch(`/api/games/${run.gameId}`, {
      headers: { authorization: `Bearer ${run.token}` },
    });
    run.finalTipFromServer = ((await tip.json()) as PlayerUpdate).version;
  }, 240_000);

  afterAll(() => {
    for (const s of spies) s.mockRestore();
  });

  it('VC-945: the game ends with the ranking shown, all requests 200/201, no notice, tip matches', () => {
    expect(run.finalRanking).toBe(true);
    expect(run.clicks).toBeGreaterThan(10);
    expect(run.seen.length).toBeGreaterThan(10);
    for (const s of run.seen) expect([200, 201], `${s.method} ${s.path}`).toContain(s.status);
    expect(run.api.calls.every((c) => c.status === 200 || c.status === 201)).toBe(true);
    expect(run.noticeSeen).toBe(false);
    expect(run.finalTipFromServer).toBe(run.tip);
    expect(readSlot(window.localStorage)?.finished).toBe(true);
  });

  it('VC-946: enabled controls and sent moveIds are legal moves of the adopted update', () => {
    expect(run.api.calls.filter((c) => c.path.endsWith('/moves')).length).toBeGreaterThan(10);
    expect(run.legalMismatches).toEqual([]);
    expect(run.sentOutsideLegal).toEqual([]);
  });

  it('VC-948: the token appears only in Authorization headers', () => {
    expect(run.token).toHaveLength(43);
    expect(run.domLeaks).toEqual([]);
    for (const url of [...run.requestUrls, ...run.navigated]) expect(url).not.toContain(run.token);
    for (const body of run.requestBodies)
      expect(JSON.stringify(body ?? null)).not.toContain(run.token);
    expect(run.consoleArgs.filter((a) => a.includes(run.token))).toEqual([]);
    const withAuth = run.authHeaders.filter((h) => h.authorization !== undefined);
    expect(withAuth.length).toBeGreaterThan(0);
    for (const h of withAuth) expect(h.authorization).toBe(`Bearer ${run.token}`);
    // The create call (no token yet) sends no Authorization header.
    expect(run.authHeaders.find((h) => h.path === '/api/games')?.authorization).toBeUndefined();
  });

  it('VC-949: no rendered card was absent from the adopted updates and queued events', () => {
    expect(run.unseenCards).toEqual([]);
  });
});
