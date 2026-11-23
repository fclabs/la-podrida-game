// Test-only ObjectStore wrapper that holds calls until released (plan P-10; spec VC-720, VC-729).
import type {
  ListOptions,
  ListResult,
  ObjectStore,
  PutOptions,
  StoredObject,
} from '@/src/storage/object-store';

/** Waits for one macrotask turn, so every pending microtask (and promise chain) runs first. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Wraps a store and, while closed (the initial state), holds every call before it reaches `inner`
 * until `release()`. `pending` counts the calls being held. `release()` lets every held call
 * proceed and opens the gate, so later calls pass straight through.
 *
 * `barrierOnCommitPut(n)` opens the gate and instead holds only create-only puts of commit keys
 * (`…/commits/…`) until `n` of them are pending, then releases them together (once). Two racing
 * `submitMove`s thereby both load the same tip before either commits.
 */
export class GatedStore implements ObjectStore {
  #closed = true;
  #held: Array<() => void> = [];
  #barrier: number | null = null;

  constructor(readonly inner: ObjectStore) {}

  /** The number of calls currently held. */
  get pending(): number {
    return this.#held.length;
  }

  /** Releases every held call and opens the gate. */
  release(): void {
    this.#closed = false;
    for (const resume of this.#held.splice(0)) resume();
  }

  /** Opens the gate and holds only create-only commit puts until `n` are pending (see class). */
  barrierOnCommitPut(n: number): void {
    this.#barrier = n;
    this.release();
  }

  /**
   * Resolves once at least `n` calls are held. Rejects after `maxTurns` macrotask turns without
   * reaching `n`.
   */
  async whenPending(n: number, maxTurns = 1000): Promise<void> {
    for (let turn = 0; this.pending < n; turn++) {
      if (turn >= maxTurns) throw new Error(`GatedStore: ${this.pending} pending, expected ${n}`);
      await nextTurn();
    }
  }

  /** Lets `turns` macrotask turns pass, so every call that can start has started. */
  async settle(turns = 5): Promise<void> {
    for (let i = 0; i < turns; i++) await nextTurn();
  }

  async get(key: string): Promise<StoredObject | null> {
    await this.#gate(false);
    return this.inner.get(key);
  }

  async put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    const createOnly = (opts?.mode ?? 'create-only') === 'create-only';
    await this.#gate(createOnly && key.includes('/commits/'));
    return this.inner.put(key, body, opts);
  }

  async exists(key: string): Promise<boolean> {
    await this.#gate(false);
    return this.inner.exists(key);
  }

  async list(prefix: string, opts?: ListOptions): Promise<ListResult> {
    await this.#gate(false);
    return this.inner.list(prefix, opts);
  }

  async delete(keys: readonly string[]): Promise<void> {
    await this.#gate(false);
    return this.inner.delete(keys);
  }

  /** Holds the call while closed, or while it is a commit put waiting at the barrier. */
  #gate(isCommitPut: boolean): Promise<void> {
    if (this.#closed) return new Promise((resolve) => this.#held.push(resolve));
    if (this.#barrier === null || !isCommitPut) return Promise.resolve();
    const held = new Promise<void>((resolve) => this.#held.push(resolve));
    if (this.#held.length >= this.#barrier) {
      this.#barrier = null;
      for (const resume of this.#held.splice(0)) resume();
    }
    return held;
  }
}
