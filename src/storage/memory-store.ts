import {
  assertValidKey,
  checkListArgs,
  ObjectExistsError,
  pageKeys,
  type ListOptions,
  type ListResult,
  type ObjectStore,
  type PutOptions,
  type StoredObject,
} from './object-store';

const encoder = new TextEncoder();

/**
 * In-process object store (FR-511): a `Map` owned by the instance. Bodies are copied on the way
 * in and out, so callers can never mutate a stored object. Every method is `async`, so
 * validation errors arrive as rejections.
 */
export class MemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, Uint8Array>();

  async get(key: string): Promise<StoredObject | null> {
    assertValidKey(key);
    const body = this.#objects.get(key);
    return body === undefined ? null : { body: body.slice() };
  }

  async put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    assertValidKey(key);
    const copy = typeof body === 'string' ? encoder.encode(body) : body.slice();
    // Check and set with no `await` in between: concurrent create-only puts cannot both win.
    if ((opts?.mode ?? 'create-only') === 'create-only' && this.#objects.has(key)) {
      throw new ObjectExistsError(key);
    }
    this.#objects.set(key, copy);
  }

  async exists(key: string): Promise<boolean> {
    assertValidKey(key);
    return this.#objects.has(key);
  }

  async list(prefix: string, opts?: ListOptions): Promise<ListResult> {
    const args = checkListArgs(prefix, opts);
    return pageKeys(this.#objects.keys(), prefix, args);
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) assertValidKey(key);
    for (const key of keys) this.#objects.delete(key);
  }
}
