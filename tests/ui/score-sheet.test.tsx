// Score sheet (FR-927, FR-928): VC-942, VC-943.
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@/app/_client/copy';
import { GamePage } from '@/app/_client/game-page';
import type { PlayerUpdate, ScoreBoard } from '@/src/domain/types';
import { makeScoreboard, makeUpdate } from './support/fixtures';
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

const hand = (handIndex: number, points: number[]): ScoreBoard['hands'][number] => ({
  handIndex,
  perSeat: points.map((p, seat) => ({ seat, bid: seat, tricks: seat + 1, made: false, points: p })),
});

async function open(update: PlayerUpdate) {
  const api = makeInProcessApi();
  armLoad(api, update);
  renderWithDeps(<GamePage id="game-1" />, { api });
  await flush();
  fireEvent.click(screen.getByRole('button', { name: COPY.scoreSheet }));
  return within(screen.getByRole('dialog'));
}

const rows = () => [...document.querySelectorAll('tbody tr')] as HTMLElement[];
const cells = (row: Element) => [...row.querySelectorAll('td')].map((c) => c.textContent);
/** Column of seat `s` in a body row: two leading cells, then four per seat (bid/tricks/points/total). */
const col = (s: number, k: 0 | 1 | 2 | 3) => 2 + s * 4 + k;

describe('VC-942: score sheet rows and totals', () => {
  const board = makeScoreboard({
    hands: [hand(0, [11, 0, 12, 11]), hand(1, [0, 12, 11, 0])],
    totals: [11, 12, 23, 11],
  });
  const update = makeUpdate({
    view: { handIndex: 2, handPlan: [3, 2, 1, 2, 3], scoreboard: board },
    legalMoves: [],
  });

  it('opens with Planilla and closes with Cerrar', async () => {
    await open(update);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: COPY.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has one row per handPlan entry, 2 filled, running totals and the totals row', async () => {
    await open(update);
    const body = rows();
    expect(body).toHaveLength(5);
    expect(body.map((r) => r.getAttribute('data-state'))).toEqual([
      'done',
      'done',
      'empty',
      'empty',
      'empty',
    ]);
    // Hand number and cards.
    expect(body.map((r) => cells(r).slice(0, 2).join('/'))).toEqual([
      '1/3',
      '2/2',
      '3/1',
      '4/2',
      '5/3',
    ]);
    const [r1, r2, r3] = body.map(cells);
    // Row 1: bid, tricks, points and running total of seat 2.
    expect([0, 1, 2, 3].map((k) => r1?.[col(2, k as 0 | 1 | 2 | 3)])).toEqual([
      '2',
      '3',
      '12',
      '12',
    ]);
    // Running totals are cumulative sums of `points` per seat.
    expect([0, 1, 2, 3].map((s) => r1?.[col(s, 3)])).toEqual(['11', '0', '12', '11']);
    expect([0, 1, 2, 3].map((s) => r2?.[col(s, 3)])).toEqual(['11', '12', '23', '11']);
    // Rows 3-5 are empty past the hand number and cards.
    expect(r3?.slice(2).every((c) => c === '')).toBe(true);
    const totals = document.querySelector('tfoot tr') as HTMLElement;
    expect([0, 1, 2, 3].map((s) => cells(totals)[s * 4 + 3])).toEqual(['11', '12', '23', '11']);
  });
});

describe('VC-943: live statuses', () => {
  it('shows En camino, Cumplida and Pasada in the current hand row', async () => {
    const update = makeUpdate({
      view: {
        handIndex: 1,
        handPlan: [3, 2, 1],
        scoreboard: makeScoreboard({
          hands: [hand(0, [10, 10, 10, 10])],
          totals: [10, 10, 10, 10],
          live: [
            { seat: 0, bid: 1, tricksWon: 0, status: 'on-track' },
            { seat: 1, bid: 0, tricksWon: 0, status: 'made-so-far' },
            { seat: 2, bid: 1, tricksWon: 2, status: 'busted' },
            { seat: 3, bid: null, tricksWon: 0, status: 'on-track' },
          ],
        }),
      },
      legalMoves: [],
    });
    await open(update);
    const live = rows()[1] as HTMLElement;
    expect(live.getAttribute('data-state')).toBe('live');
    const c = cells(live);
    expect(c[col(0, 2)]).toBe(COPY.liveStatus['on-track']);
    expect(c[col(1, 2)]).toBe(COPY.liveStatus['made-so-far']);
    expect(c[col(2, 2)]).toBe(COPY.liveStatus.busted);
    expect(c[col(2, 1)]).toBe('2'); // live tricks
    expect(c[col(3, 0)]).toBe(COPY.noBid); // no bid yet
    expect(rows()[2]?.getAttribute('data-state')).toBe('empty');
  });
});
