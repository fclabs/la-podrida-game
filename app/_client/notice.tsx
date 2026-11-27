import styles from './notice.module.css';

/** A transient message (FR-918/FR-919); the page clears it after 4 s or at the next action. */
export function Notice({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p className={styles.notice} role="status">
      {message}
    </p>
  );
}
