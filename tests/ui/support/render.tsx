// Render helper for component tests: wraps the tree in a `ClientDeps` provider with fakes, so no
// test mocks `next/navigation`. Pass `overrides` to replace any dep (e.g. `storage`, `newId`).
import { render } from '@testing-library/react';
import { type ReactElement, StrictMode } from 'react';
import { type ClientDeps, ClientDepsProvider } from '@/app/_client/deps';
import { takeKeptUpdate } from '@/app/_client/kept-update';
import { setMemorySlot } from '@/app/_client/memory-slot';
import { type GameSlot, writeSlot } from '@/app/_client/slot';
import { type InProcessApi, makeInProcessApi } from './in-process-api';

export interface RenderOptions {
  /** The in-process API behind `deps.fetch`; a fresh one when omitted. */
  api?: InProcessApi;
  overrides?: Partial<ClientDeps>;
  strict?: boolean;
}

/** Clears the module state the pages share (kept 201 update, in-memory slot). Call in `beforeEach`. */
export function resetClientState(): void {
  takeKeptUpdate('');
  setMemorySlot(null);
}

/** Fake deps over an in-process API. Timers call the globals at call time, so fake timers work. */
export function makeDeps(
  api: InProcessApi,
  overrides: Partial<ClientDeps> = {},
  navigate: (path: string) => void = () => {},
): ClientDeps {
  let n = 0;
  return {
    fetch: (input, init) => api.fetch(input, init),
    setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
    storage: () => window.localStorage,
    newId: () => `id-${++n}`,
    navigate,
    ...overrides,
  };
}

export function renderWithDeps(ui: ReactElement, options: RenderOptions = {}) {
  const api = options.api ?? makeInProcessApi();
  const navigated: string[] = [];
  const deps = makeDeps(api, options.overrides, (path) => navigated.push(path));
  const tree = <ClientDepsProvider value={deps}>{ui}</ClientDepsProvider>;
  const result = render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { ...result, api, deps, navigated };
}

/** Creates a game through the in-process API and stores its slot, as a finished `/` submit would. */
export async function createStoredGame(
  api: InProcessApi,
  options: { aiCount?: number; store?: boolean } = {},
) {
  const res = await api.fetch('/api/games', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ humanName: 'Ana', aiCount: options.aiCount ?? 2 }),
  });
  const body = (await res.json()) as {
    gameId: string;
    seatToken: string;
    update: import('@/src/domain/types').PlayerUpdate;
  };
  const slot: GameSlot = {
    gameId: body.gameId,
    seatToken: body.seatToken,
    deck: 'french-52',
    finished: false,
  };
  if (options.store !== false) writeSlot(window.localStorage, slot);
  return { ...body, slot };
}
