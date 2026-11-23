// Test-only ObjectStore wrapper (spec 06 scope: "a test-only failing-store wrapper"; plan P-10).
import type {
  ListOptions,
  ListResult,
  ObjectStore,
  PutOptions,
  StoredObject,
} from '@/src/storage/object-store';

export type StoreMethod = 'get' | 'put' | 'exists' | 'list' | 'delete';

/** One recorded call. `mode` is the effective put mode (`'create-only'` when omitted). */
export interface RecordedCall {
  method: StoreMethod;
  key?: string;
  prefix?: string;
  keys?: readonly string[];
  mode?: 'create-only' | 'overwrite';
}

/**
 * Per-method overrides. Each receives the call's arguments and the wrapped store, and replaces
 * the default (delegate to `inner`). Calls are recorded before the hook runs.
 */
export interface StoreHooks {
  get(args: { key: string }, inner: ObjectStore): Promise<StoredObject | null>;
  put(
    args: { key: string; body: Uint8Array | string; opts?: PutOptions },
    inner: ObjectStore,
  ): Promise<void>;
  exists(args: { key: string }, inner: ObjectStore): Promise<boolean>;
  list(args: { prefix: string; opts?: ListOptions }, inner: ObjectStore): Promise<ListResult>;
  delete(args: { keys: readonly string[] }, inner: ObjectStore): Promise<void>;
}

/**
 * Wraps a store, records every call in `calls` (in invocation order) and tracks the highest
 * number of `get`s in flight at once in `maxConcurrentGets`. Failing, retry-simulating and
 * list-rewriting stores are built from `hooks`.
 */
export class RecordingStore implements ObjectStore {
  readonly calls: RecordedCall[] = [];
  maxConcurrentGets = 0;
  #getsInFlight = 0;

  constructor(
    readonly inner: ObjectStore,
    readonly hooks: Partial<StoreHooks> = {},
  ) {}

  /** The recorded calls of one method (all calls when `method` is omitted). */
  callsOf(method?: StoreMethod): RecordedCall[] {
    return method === undefined ? [...this.calls] : this.calls.filter((c) => c.method === method);
  }

  /** Forgets every recorded call and resets `maxConcurrentGets`. */
  reset(): void {
    this.calls.length = 0;
    this.maxConcurrentGets = 0;
  }

  async get(key: string): Promise<StoredObject | null> {
    this.calls.push({ method: 'get', key });
    this.#getsInFlight++;
    this.maxConcurrentGets = Math.max(this.maxConcurrentGets, this.#getsInFlight);
    try {
      return await (this.hooks.get ? this.hooks.get({ key }, this.inner) : this.inner.get(key));
    } finally {
      this.#getsInFlight--;
    }
  }

  async put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    this.calls.push({ method: 'put', key, mode: opts?.mode ?? 'create-only' });
    return this.hooks.put
      ? this.hooks.put({ key, body, opts }, this.inner)
      : this.inner.put(key, body, opts);
  }

  async exists(key: string): Promise<boolean> {
    this.calls.push({ method: 'exists', key });
    return this.hooks.exists ? this.hooks.exists({ key }, this.inner) : this.inner.exists(key);
  }

  async list(prefix: string, opts?: ListOptions): Promise<ListResult> {
    this.calls.push({ method: 'list', prefix });
    return this.hooks.list
      ? this.hooks.list({ prefix, opts }, this.inner)
      : this.inner.list(prefix, opts);
  }

  async delete(keys: readonly string[]): Promise<void> {
    this.calls.push({ method: 'delete', keys: [...keys] });
    return this.hooks.delete ? this.hooks.delete({ keys }, this.inner) : this.inner.delete(keys);
  }
}
