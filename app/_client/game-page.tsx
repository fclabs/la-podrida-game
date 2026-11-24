'use client';

import type { PlayerUpdate } from '@/src/domain/types';
import Link from 'next/link';
import { useEffect, useReducer, useRef, useState } from 'react';
import { getUpdate, submitMove } from './api';
import { BidBar } from './bid-bar';
import { COPY } from './copy';
import { type ClientDeps, useClientDeps, WithClientDeps } from './deps';
import { applyEvent, emptyTable, eventDelayMs, viewToDisplay, type DisplayModel } from './display';
import { type UpdateSource, captureAction, isAnimated, shouldAdopt } from './game-state';
import { GameOver } from './game-over';
import { Hand } from './hand';
import styles from './game-page.module.css';
import { takeKeptUpdate } from './kept-update';
import { getMemorySlot, setMemorySlot } from './memory-slot';
import { Notice } from './notice';
import { ScoreSheet } from './score-sheet';
import { type GameSlot, clearSlot, readSlot, writeSlot } from './slot';
import { Table } from './table';
import type { PlayerView } from '@/src/domain/types';

/** How the page loaded; everything but `ready` shows a message instead of the table. */
export type LoadStatus =
  'init' | 'loading' | 'ready' | 'no-access' | 'invalid' | 'gone' | 'unsupported' | 'failed';

/**
 * The P-5 reducer state. `queue` holds the events not yet finished: its head is the event being
 * shown (applied to `display` when it started, held for `eventDelayMs`). `shownBefore` is the view
 * shown before the adoption (`null` for a 201, which starts from the empty table).
 */
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
  | { type: 'adopt'; update: PlayerUpdate; source: UpdateSource }
  // Move pipeline (FR-913, FR-916-FR-919). `request` is 'in-flight' from a click or a send,
  // 'retry-wait' during the 1/2/4 s back-off, 'failed' once Reintentar is offered.
  | { type: 'move-start' } // a new action: in flight, previous notice cleared (FR-919)
  | { type: 'move-send' } // a retry send: in flight again
  | { type: 'move-wait' }
  | { type: 'move-failed' }
  | { type: 'move-settled' } // request back to idle
  | { type: 'notice'; message: string }
  | { type: 'notice-clear' }
  // Queue playback (FR-920, FR-923): the head's delay ended / `Saltar`.
  | { type: 'tick' }
  | { type: 'skip' };

type MoveBody = ReturnType<typeof captureAction>;

export const initialGameState: GameState = {
  load: 'init',
  adopted: null,
  shownBefore: null,
  queue: [],
  display: null,
  request: 'idle',
  notice: null,
};

/** FR-910/FR-911: 201 and 200 adoptions queue their events; every other source jumps. */
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
      const { update, source } = action;
      const jump = {
        ...state,
        load: 'ready' as const,
        adopted: update,
        shownBefore: update.view,
        queue: [],
        display: null,
      };
      const first = update.events[0];
      if (!isAnimated(source) || first === undefined) return jump;
      // The view shown before the adoption: the adopted view, or the one a running queue began from.
      const before = state.queue.length > 0 ? state.shownBefore : (state.adopted?.view ?? null);
      const start = source === 'create' || before === null ? null : viewToDisplay(before);
      const model = start ?? emptyTable(update.view);
      return {
        ...state,
        load: 'ready',
        adopted: update,
        shownBefore: source === 'create' ? null : before,
        queue: update.events,
        display: applyEvent(model, first, update.view),
      };
    }
    case 'tick': {
      if (state.queue.length === 0 || state.adopted === null) return state;
      const rest = state.queue.slice(1);
      const next = rest[0];
      if (next === undefined) {
        return { ...state, queue: [], display: null, shownBefore: state.adopted.view };
      }
      const base = state.display ?? viewToDisplay(state.adopted.view);
      return { ...state, queue: rest, display: applyEvent(base, next, state.adopted.view) };
    }
    case 'skip':
      if (state.queue.length === 0) return state;
      return { ...state, queue: [], display: null, shownBefore: state.adopted?.view ?? null };
    case 'move-start':
      return { ...state, request: 'in-flight', notice: null };
    case 'move-send':
      return { ...state, request: 'in-flight' };
    case 'move-wait':
      return { ...state, request: 'retry-wait' };
    case 'move-failed':
      return { ...state, request: 'failed' };
    case 'move-settled':
      return { ...state, request: 'idle' };
    case 'notice':
      return { ...state, notice: action.message };
    case 'notice-clear':
      return state.notice === null ? state : { ...state, notice: null };
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

/** FR-912/FR-938: sets `finished: true` only when the stored slot belongs to this page's game. */
function markFinished(deps: ClientDeps, id: string): void {
  const storage = deps.storage();
  const stored = readSlot(storage);
  if (stored !== null && stored.gameId === id) writeSlot(storage, { ...stored, finished: true });
  const memory = getMemorySlot();
  if (memory !== null && memory.gameId === id) setMemorySlot({ ...memory, finished: true });
}

/** FR-917: automatic retries after a transport failure, then a manual `Reintentar`. */
const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
/** FR-919. */
const NOTICE_MS = 4000;

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const slotRef = useRef<GameSlot | null>(null);
  // P-4: take the kept 201 update once per instance; Strict Mode's second effect run reuses it.
  const keptRef = useRef<{ id: string; update: PlayerUpdate | null } | undefined>(undefined);
  // Dedupes the load when Strict Mode runs the effect twice for the same attempt.
  const startedRef = useRef<string | null>(null);
  // Move pipeline. `pendingRef` is the captured action body, resent verbatim on every retry
  // (BR-903); `busyRef` is a synchronous double-click guard; `recoveryRef` remembers a failed
  // recovery GET so `Reintentar` repeats it (FR-918); `timerRef` is the back-off timer.
  const pendingRef = useRef<MoveBody | null>(null);
  const busyRef = useRef(false);
  const recoveryRef = useRef<{ since: number; message: string } | null>(null);
  const timerRef = useRef<unknown>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) deps.clearTimeout(timerRef.current as never);
    };
  }, [deps]);

  // FR-919: a notice disappears after 4 s (or at the next action, `move-start`).
  const { notice } = state;
  useEffect(() => {
    if (notice === null) return;
    const handle = deps.setTimeout(() => dispatch({ type: 'notice-clear' }), NOTICE_MS);
    return () => deps.clearTimeout(handle as never);
  }, [deps, notice]);

  // FR-920: the head of the queue is held for its delay, then the next event starts.
  const { queue } = state;
  useEffect(() => {
    const head = queue[0];
    if (head === undefined) return;
    const handle = deps.setTimeout(() => dispatch({ type: 'tick' }), eventDelayMs(head));
    return () => deps.clearTimeout(handle as never);
  }, [deps, queue]);

  // FR-912: game over in the adopted view marks the slot finished (FR-938 ownership inside).
  const gameOver = state.adopted?.view.phase === 'game-over';
  useEffect(() => {
    if (gameOver) markFinished(deps, id);
  }, [deps, id, gameOver]);

  /** FR-907/FR-938 outcome shared by the load, the recovery GET and the move responses. */
  const deny = (status: 401 | 404 | 410) => {
    clearOwnSlot(deps, id);
    dispatch({ type: 'denied', status });
  };

  /** FR-918 recovery: GET `?since=<version>`, adopt without animation, then show the notice. */
  const recover = async (since: number, message: string) => {
    const token = slotRef.current?.seatToken ?? '';
    recoveryRef.current = { since, message };
    const result = await getUpdate(deps, id, token, since);
    if (!mountedRef.current) return;
    busyRef.current = false;
    dispatch({ type: 'move-settled' });
    if (result.kind === 'ok') {
      recoveryRef.current = null;
      dispatch({ type: 'adopt', update: result.body, source: 'recovery' });
      dispatch({ type: 'notice', message });
    } else if (
      result.kind === 'error' &&
      (result.status === 401 || result.status === 404 || result.status === 410)
    ) {
      recoveryRef.current = null;
      deny(result.status);
    } else {
      dispatch({ type: 'load-failed' }); // FR-908 treatment: message + Reintentar
    }
  };

  /** One send of the captured action; `retry` counts the automatic retries already used. */
  const send = async (body: MoveBody, retry: number): Promise<void> => {
    const token = slotRef.current?.seatToken ?? '';
    const result = await submitMove(deps, id, token, body);
    if (!mountedRef.current) return;
    if (result.kind === 'transport') {
      const delay = RETRY_DELAYS_MS[retry];
      if (delay === undefined) {
        dispatch({ type: 'move-failed' }); // all retries used: `No se pudo enviar la jugada.`
        return;
      }
      dispatch({ type: 'move-wait' });
      await new Promise<void>((resolve) => {
        timerRef.current = deps.setTimeout(resolve, delay);
      });
      timerRef.current = null;
      if (!mountedRef.current) return;
      dispatch({ type: 'move-send' });
      return send(body, retry + 1);
    }
    if (result.kind === 'ok') {
      busyRef.current = false;
      dispatch({ type: 'move-settled' });
      dispatch({ type: 'adopt', update: result.body, source: 'move' });
    } else if (result.kind === 'conflict') {
      busyRef.current = false;
      dispatch({ type: 'move-settled' });
      dispatch({ type: 'adopt', update: result.update, source: 'conflict' });
      dispatch({ type: 'notice', message: COPY.moveConflict });
    } else if (result.status === 403 || result.status === 422) {
      await recover(body.version, COPY.moveIllegal);
    } else if (result.status === 400 || result.status === 413) {
      await recover(body.version, COPY.moveUnexpected);
    } else {
      busyRef.current = false;
      dispatch({ type: 'move-settled' });
      deny(result.status as 401 | 404 | 410);
    }
  };

  /** A bid or card click (FR-916): capture once, then send; retries reuse the same body. */
  const act = (moveId: string) => {
    if (busyRef.current || state.adopted === null) return;
    busyRef.current = true;
    dispatch({ type: 'move-start' });
    const body = captureAction(state.adopted, moveId, deps.newId);
    pendingRef.current = body;
    void send(body, 0);
  };

  /** `Reintentar` after the retries ran out: the same body once more, no automatic retries. */
  const retryMove = () => {
    const body = pendingRef.current;
    if (body === null) return;
    dispatch({ type: 'move-send' });
    void send(body, RETRY_DELAYS_MS.length);
  };

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
      // FR-902: the kept 201 update animates its events from the empty table.
      dispatch({ type: 'adopt', update: kept, source: 'create' });
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
        deny(result.status);
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
            const recovery = recoveryRef.current;
            if (recovery !== null) {
              // A failed recovery GET (FR-918): repeat that GET, not the plain load.
              busyRef.current = true;
              dispatch({ type: 'move-send' });
              void recover(recovery.since, recovery.message);
            } else {
              setAttempt((a) => a + 1);
            }
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
  const queueEmpty = state.queue.length === 0;
  // FR-937: while events play, the score sheet, phase and game-over screen use the view shown
  // before the adoption (`null`: the empty table of a 201).
  const shown = queueEmpty ? view : state.shownBefore;
  const deck = slotRef.current?.deck;
  const legalMoves = state.adopted.legalMoves;
  const requestBusy = state.request !== 'idle';
  return (
    <main className={styles.page}>
      <div className={styles.bar}>
        <button type="button" className={styles.button} onClick={() => setSheetOpen(true)}>
          {COPY.scoreSheet}
        </button>
        {!queueEmpty && (
          <button
            type="button"
            className={styles.button}
            onClick={() => dispatch({ type: 'skip' })}
          >
            {COPY.skip}
          </button>
        )}
      </div>
      {sheetOpen && (
        <ScoreSheet
          scoreboard={shown?.scoreboard ?? null}
          handPlan={model.handPlan}
          handIndex={shown?.handIndex ?? model.handIndex}
          seats={model.seats}
          onClose={() => setSheetOpen(false)}
        />
      )}
      <Table
        model={model}
        toAct={queueEmpty ? view.toAct : null}
        deck={deck}
        hand={
          <Hand
            cards={model.yourHand}
            deck={deck}
            legalMoves={legalMoves}
            interactive={queueEmpty}
            disabled={requestBusy}
            onPlay={act}
          />
        }
      />
      {shown?.phase === 'game-over' && shown.finalRanking !== undefined && (
        <GameOver ranking={shown.finalRanking} seats={model.seats} />
      )}
      {queueEmpty && legalMoves.length > 0 && (
        <BidBar legalMoves={legalMoves} disabled={requestBusy} onBid={act} />
      )}
      {state.request === 'failed' && (
        <div>
          <p role="alert">{COPY.moveFailed}</p>
          <button type="button" className={styles.button} onClick={retryMove}>
            {COPY.retry}
          </button>
        </div>
      )}
      <Notice message={state.notice} />
    </main>
  );
}

/** `/game/[id]`: loads, shows the table and plays bids and cards (FR-905–FR-919, FR-925). */
export function GamePage({ id }: { id: string }) {
  return (
    <WithClientDeps>
      <Game id={id} />
    </WithClientDeps>
  );
}
