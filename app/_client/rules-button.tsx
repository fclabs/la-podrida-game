'use client';

import { useEffect, useRef, useState } from 'react';
import { COPY } from './copy';
import styles from './rules-button.module.css';

/** A button that opens a dialog with the rules of the game, in Spanish. */
export function RulesButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  // The dialog is mounted only while open, so the closed page carries no extra controls.
  useEffect(() => {
    if (open && ref.current !== null && !ref.current.open) ref.current.showModal?.();
  }, [open]);

  return (
    <>
      <button type="button" className={className ?? styles.button} onClick={() => setOpen(true)}>
        {COPY.rules}
      </button>
      {open && (
        <dialog ref={ref} className={styles.dialog} onClose={() => setOpen(false)}>
          <h2>{COPY.rulesTitle}</h2>
          {COPY.rulesSections.map((section) => (
            <section key={section.heading}>
              <h3>{section.heading}</h3>
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
          <button type="button" className={styles.button} onClick={() => setOpen(false)}>
            {COPY.close}
          </button>
        </dialog>
      )}
    </>
  );
}
