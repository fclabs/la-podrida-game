// VC-907 (FR-938, R-043), VC-941 slot part (FR-912): a game page changes the stored slot only when
// the stored `gameId` equals its route id, re-reading the slot just before the change.
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@/app/_client/copy';
import { GamePage } from '@/app/_client/game-page';
import { setMemorySlot } from '@/app/_client/memory-slot';
import { type GameSlot, SLOT_KEY, readSlot, writeSlot } from '@/app/_client/slot';
import { makeUpdate } from './support/fixtures';
import { makeInProcessApi } from './support/in-process-api';
import { armLoad, armMove, bid, errorBody, flush } from './support/moves';
import { renderWithDeps, resetClientState } from './support/render';

beforeEach(() => {
  resetClientState();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const slotOf = (gameId: string): GameSlot => ({
  gameId,
  seatToken: `tok-${gameId}`,
  deck: 'french-52',
  finished: false,
});

const biddingUpdate = makeUpdate({
  view: { version: 7, phase: 'bidding' },
  legalMoves: [bid(0), bid(1)],
});
const gameOverUpdate = makeUpdate({
  view: {
    version: 8,
    phase: 'game-over',
    toAct: null,
    finalRanking: [{ seat: 0, total: 10, place: 1 }],
  },
  legalMoves: [],
});

type Finish = 'game-over' | '401';

/** Opens page `X`, optionally lets `beforeMove` change storage, then ends the game or answers 401. */
async function run(
  finish: Finish,
  setup: (api: ReturnType<typeof makeInProcessApi>) => void,
  beforeMove: () => void = () => {},
) {
  const api = makeInProcessApi();
  setup(api);
  api.failNext({ status: 200, body: biddingUpdate }, { method: 'GET' });
  renderWithDeps(<GamePage id="X" />, { api });
  await flush();
  beforeMove();
  if (finish === 'game-over') armMove(api, 200, gameOverUpdate);
  else armMove(api, 401, errorBody('unauthorized'));
  fireEvent.click(screen.getByRole('button', { name: '0' }));
  await flush();
  return api;
}

describe.each<Finish>(['game-over', '401'])('slot ownership on %s (VC-907)', (finish) => {
  it('stored slot of another game stays untouched (page uses the in-memory slot)', async () => {
    const y = slotOf('Y');
    await run(finish, () => {
      writeSlot(window.localStorage, y);
      setMemorySlot(slotOf('X'));
    });
    expect(readSlot(window.localStorage)).toEqual(y);
  });

  it('R-043: storage overwritten with Y after mount is not touched', async () => {
    const y = slotOf('Y');
    await run(
      finish,
      () => writeSlot(window.localStorage, slotOf('X')),
      () => writeSlot(window.localStorage, y),
    );
    expect(readSlot(window.localStorage)).toEqual(y);
  });
});

describe('slot owned by the page', () => {
  it('VC-941/FR-912: reaching game over sets finished: true and keeps the other fields', async () => {
    await run('game-over', () => writeSlot(window.localStorage, slotOf('X')));
    expect(readSlot(window.localStorage)).toEqual({ ...slotOf('X'), finished: true });
  });

  it('FR-912: a game that loads already finished marks the slot finished', async () => {
    const api = makeInProcessApi();
    armLoad(api, gameOverUpdate, 'X');
    renderWithDeps(<GamePage id="X" />, { api });
    await flush();
    expect(readSlot(window.localStorage)?.finished).toBe(true);
  });

  it('FR-907: a 401 on a move clears the slot', async () => {
    await run('401', () => writeSlot(window.localStorage, slotOf('X')));
    expect(window.localStorage.getItem(SLOT_KEY)).toBeNull();
    expect(screen.getByText(COPY.accessInvalid)).toBeTruthy();
  });
});
