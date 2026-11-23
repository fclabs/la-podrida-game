// Test-only wrapper that isolates one contract test inside a shared store (spec 05 FR-515).
// Keys and prefixes are validated unprefixed, then `namespace` (e.g. `contract/<runId>/<testId>/`)
// is prepended; listed keys and a rethrown `ObjectExistsError` carry the unprefixed key again.
import {
  assertValidKey,
  assertValidPrefix,
  ObjectExistsError,
  type ListOptions,
  type ListResult,
  type ObjectStore,
  type PutOptions,
  type StoredObject,
} from '@/src/storage/object-store';

export class PrefixedObjectStore implements ObjectStore {
  readonly #inner: ObjectStore;
  readonly #namespace: string;

  /** `namespace` must be a valid prefix ending in `/`. */
  constructor(inner: ObjectStore, namespace: string) {
    assertValidPrefix(namespace);
    this.#inner = inner;
    this.#namespace = namespace;
  }

  async get(key: string): Promise<StoredObject | null> {
    assertValidKey(key);
    return this.#inner.get(this.#namespace + key);
  }

  async put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    assertValidKey(key);
    try {
      await this.#inner.put(this.#namespace + key, body, opts);
    } catch (error) {
      if (error instanceof ObjectExistsError) throw new ObjectExistsError(key);
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    assertValidKey(key);
    return this.#inner.exists(this.#namespace + key);
  }

  async list(prefix: string, opts?: ListOptions): Promise<ListResult> {
    assertValidPrefix(prefix);
    const page = await this.#inner.list(this.#namespace + prefix, opts);
    const keys = page.keys.map((key) => key.slice(this.#namespace.length));
    return page.cursor !== undefined ? { keys, cursor: page.cursor } : { keys };
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) assertValidKey(key);
    await this.#inner.delete(keys.map((key) => this.#namespace + key));
  }
}
