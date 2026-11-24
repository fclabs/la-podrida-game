'use client';

import type { PlayerUpdate } from '@/src/domain/types';
import Link from 'next/link';
import { useEffect, useReducer, useRef, useState } from 'react';
import { getUpdate } from './api';
import { COPY } from './copy';
import { type ClientDeps, useClientDeps, WithClientDeps } from './deps';
import { viewToDisplay, type DisplayModel } from './display';
import { type UpdateSource, shouldAdopt } from './game-state';
import styles from './game-page.module.css';
import { takeKeptUpdate } from './kept-update';
import { getMemorySlot, setMemorySlot } from './memory-slot';
import { type GameSlot, clearSlot, readSlot } from './slot';
import { Table } from './table';
import type { PlayerView } from '@/src/domain/types';

/** How the page loaded; everything but `ready` shows a message instead of the table. */
export type LoadStatus =
  'init' | 'loading' | 'ready' | 'no-access' | 'invalid' | 'gone' | 'unsupported' | 'failed';

/** The P-5 reducer state. `queue`, `display`, `request` and `notice` are wired in Iterations 5-6. */
export interface GameState {
  load: LoadStatus;
  adopted: PlayerUpdate | null;
  shownBefore: PlayerView | null;
  queue: PlayerUpdate['events'];
  display: DisplayModel | null;
  request: 'idle' | 'in-flight' | 'retry-wait' | 'failed';
  notice: string | null;
}

export type GameAction =
  | { type: 'load-start' }
  | { type: 'load-failed' }
  | { type: 'denied'; status: 401 | 404 | 410 }
  | { type: 'no-access' }
  | { type: 'adopt'; update: PlayerUpdate; source: UpdateSource };

export const initialGameState: GameState = {
  load: 'init',
  adopted: null,
  shownBefore: null,
  queue: [],
  display: null,
  request: 'idle',
  notice: null,
};

/** FR-910/FR-911: only the non-animated adoption exists so far (animation arrives in Iteration 6). */
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'load-start':
      return { ...state, load: 'loading' };
    case 'load-failed':
      return { ...state, load: 'failed' };
    case 'no-access':
      return { ...state, load: 'no-access' };
    case 'denied': {
      const load =
        action.status === 401 ? 'invalid' : action.status === 404 ? 'gone' : 'unsupported';
      return { ...state, load };
    }
    case 'adopt': {
      if (!shouldAdopt(state.adopted, action.update)) return state;
      return {
        ...state,
        load: 'ready',
        adopted: action.update,
        shownBefore: action.update.view,
        queue: [],
        display: null,
      };
    }
  }
}

/** The slot this page may use: the stored one if it matches `id`, else the in-memory one (FR-931). */
function resolveSlot(deps: ClientDeps, id: string): GameSlot | null {
  const stored = readSlot(deps.storage());
  if (stored !== null && stored.gameId === id) return stored;
  const memory = getMemorySlot();
  return memory !== null && memory.gameId === id ? memory : null;
}

/** FR-907/FR-938: clears the slot only when it belongs to this page's game, re-read just before. */
function clearOwnSlot(deps: ClientDeps, id: string): void {
  const storage = deps.storage();
  const stored = readSlot(storage);
  if (stored !== null && stored.gameId === id) clearSlot(storage);
  if (getMemorySlot()?.gameId === id) setMemorySlot(null);
}

const MESSAGES: Record<'no-access' | 'invalid' | 'gone' | 'unsupported', string> = {
  'no-access': COPY.noAccess,
  invalid: COPY.accessInvalid,
  gone: COPY.gameGone,
  unsupported: COPY.gameUnsupported,
};

function NewGameLink() {
  return (
    <Link className={styles.link} href="/">
      {COPY.newGame}
    </Link>
  );
}

function Game({ id }: { id: string }) {
  const deps = useClientDeps();
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const [attempt, setAttempt] = useState(0);
  const slotRef = useRef<GameSlot | null>(null);
  // P-4: take the kept 201 update once per instance; Strict Mode's second effect run reuses it.
  const keptRef = useRef<{ id: string; update: PlayerUpdate | null } | undefined>(undefined);
  // Dedupes the load when Strict Mode runs the effect twice for the same attempt.
  const startedRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${id}:${attempt}`;
    if (startedRef.current === key) return;
    startedRef.current = key;

    const slot = resolveSlot(deps, id);
    if (slot === null) {
      dispatch({ type: 'no-access' });
      return;
    }
    slotRef.current = slot;

    if (keptRef.current === undefined || keptRef.current.id !== id) {
      keptRef.current = { id, update: takeKeptUpdate(id) };
    }
    const kept = keptRef.current.update;
    if (kept !== null && attempt === 0) {
      // Iteration 4: adopted at once; the opening animation arrives in Iteration 6.
      dispatch({ type: 'adopt', update: kept, source: 'load' });
      return;
    }

    dispatch({ type: 'load-start' });
    void getUpdate(deps, id, slot.seatToken).then((result) => {
      if (result.kind === 'ok') {
        dispatch({ type: 'adopt', update: result.body, source: 'load' });
      } else if (
        result.kind === 'error' &&
        (result.status === 401 || result.status === 404 || result.status === 410)
      ) {
        clearOwnSlot(deps, id);
        dispatch({ type: 'denied', status: result.status });
      } else {
        dispatch({ type: 'load-failed' });
      }
    });
  }, [deps, id, attempt]);

  const { load } = state;
  if (load === 'init' || load === 'loading') {
    return (
      <main className={styles.page}>
        <p role="status">{COPY.loading}</p>
      </main>
    );
  }
  if (load === 'failed') {
    return (
      <main className={styles.page}>
        <p role="alert">{COPY.loadFailed}</p>
        <button
          type="button"
          className={styles.button}
          onClick={() => {
            dispatch({ type: 'load-start' });
            setAttempt((a) => a + 1);
          }}
        >
          {COPY.retry}
        </button>
      </main>
    );
  }
  if (load !== 'ready' || state.adopted === null) {
    return (
      <main className={styles.page}>
        <p role="alert">{MESSAGES[load === 'ready' ? 'no-access' : load]}</p>
        <NewGameLink />
      </main>
    );
  }

  const view = state.adopted.view;
  const model = state.display ?? viewToDisplay(view);
  return (
    <main className={styles.page}>
      <Table
        model={model}
        toAct={state.queue.length === 0 ? view.toAct : null}
        deck={slotRef.current?.deck}
      />
    </main>
  );
}

/** `/game/[id]`: loads and shows the table (FR-905–FR-908, FR-925). Nothing is playable yet. */
export function GamePage({ id }: { id: string }) {
  return (
    <WithClientDeps>
      <Game id={id} />
    </WithClientDeps>
  );
}
