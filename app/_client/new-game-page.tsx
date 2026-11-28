'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createGame, getPresets } from './api';
import { COPY } from './copy';
import { useClientDeps, WithClientDeps } from './deps';
import { keepUpdate } from './kept-update';
import { setMemorySlot } from './memory-slot';
import styles from './new-game-page.module.css';
import { RulesButton } from './rules-button';
import { type GameSlot, readSlot, writeSlot } from './slot';

const AI_COUNTS = [2, 3, 4, 5] as const;

function NewGameForm() {
  const deps = useClientDeps();
  const [name, setName] = useState('');
  const [aiCount, setAiCount] = useState<number>(3);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [continueSlot, setContinueSlot] = useState<GameSlot | null>(null);
  const inFlight = useRef(false);

  // FR-932: the slot is read after mount only.
  useEffect(() => {
    setContinueSlot(readSlot(deps.storage()));
  }, [deps]);

  const trimmed = name.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (trimmed === '' || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    const fail = (text: string) => {
      inFlight.current = false;
      setBusy(false);
      setMessage(text);
    };

    const presets = await getPresets(deps);
    if (presets.kind !== 'ok') return fail(COPY.createFailed);
    const { defaultPresetId } = presets.body;
    const deck = presets.body.presets.find((p) => p.id === defaultPresetId)?.deck;
    if (deck === undefined) return fail(COPY.createFailed);

    const created = await createGame(deps, {
      humanName: trimmed,
      aiCount,
      rulesPreset: defaultPresetId,
    });
    if (created.kind === 'error' && created.status === 400) return fail(COPY.createInvalid);
    if (created.kind !== 'ok') return fail(COPY.createFailed);

    const { gameId, seatToken, update } = created.body;
    const slot: GameSlot = { gameId, seatToken, deck, finished: false };
    // FR-931: when the slot cannot be stored, keep it in memory for this tab session.
    setMemorySlot(writeSlot(deps.storage(), slot) ? null : slot);
    keepUpdate(gameId, update);
    deps.navigate(`/game/${gameId}`);
  }

  return (
    <main className={styles.page}>
      <h1>{COPY.title}</h1>
      {continueSlot !== null && !continueSlot.finished && (
        <p>
          <Link className={styles.link} href={`/game/${continueSlot.gameId}`}>
            {COPY.continueGame}
          </Link>
        </p>
      )}
      <form className={styles.form} onSubmit={(e) => void submit(e)}>
        <label className={styles.field}>
          <span>{COPY.nameLabel}</span>
          <input
            type="text"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className={styles.field}>
          <span>{COPY.aiCountLabel}</span>
          <select value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>
            {AI_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={styles.submit} disabled={trimmed === '' || busy}>
          {COPY.startGame}
        </button>
        {message !== null && (
          <p role="alert" className={styles.error}>
            {message}
          </p>
        )}
      </form>
      <p>
        <RulesButton />
      </p>
    </main>
  );
}

/** `/`: the new-game form and the continue link (FR-900–FR-904). */
export function NewGamePage() {
  return (
    <WithClientDeps>
      <NewGameForm />
    </WithClientDeps>
  );
}
