// Game-over screen (FR-926): VC-941 (screen part; the slot part is in slot-ownership.test.tsx).
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@/app/_client/copy';
import { GamePage } from '@/app/_client/game-page';
import { readSlot } from '@/app/_client/slot';
import { makeUpdate } from './support/fixtures';
import { makeInProcessApi } from './support/in-process-api';
import { armLoad, flush } from './support/moves';
import { renderWithDeps, resetClientState } from './support/render';

beforeEach(() => {
  resetClientState();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('VC-941: game-over screen with a tie for first', () => {
  it('lists the ranking in place order, ties share place 1, Nueva partida, no input', async () => {
    const update = makeUpdate({
      view: {
        phase: 'game-over',
        toAct: null,
        yourHand: [],
        finalRanking: [
          { seat: 2, total: 30, place: 1 },
          { seat: 0, total: 30, place: 1 },
          { seat: 1, total: 20, place: 3 },
          { seat: 3, total: 10, place: 4 },
        ],
      },
      legalMoves: [],
    });
    const api = makeInProcessApi();
    armLoad(api, update);
    renderWithDeps(<GamePage id="game-1" />, { api });
    await flush();

    const rows = [...document.querySelectorAll('[data-seat]')].filter(
      (e) => e.tagName === 'LI' && e.closest('ol') !== null,
    );
    expect(rows.map((r) => r.textContent)).toEqual(['1Bot 230', '1Ana30', '3Bot 120', '4Bot 310']);
    const link = screen.getByRole('link', { name: COPY.newGame });
    expect(link.getAttribute('href')).toBe('/');
    // Only the page chrome is a button: no bid buttons, no clickable cards.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([COPY.scoreSheet]);
    expect(readSlot(window.localStorage)?.finished).toBe(true);
  });
});
