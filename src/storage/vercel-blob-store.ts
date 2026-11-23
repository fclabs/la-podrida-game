import * as blob from '@vercel/blob';
import {
  assertValidKey,
  assertValidPrefix,
  ObjectExistsError,
  resolveListLimit,
  type ListOptions,
  type ListResult,
  type ObjectStore,
  type PutOptions,
  type StoredObject,
} from './object-store';

/** Most pathnames sent to one SDK `del` call (FR-513). */
const DELETE_BATCH_SIZE = 1000;

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `ObjectStore` on Vercel Blob (`@vercel/blob` 2.9.0, FR-513). Every write is private, every read
 * and probe is uncached (BR-503). Keys are validated before any SDK call.
 *
 * Caveats for callers: the SDK retries failed requests (`VERCEL_BLOB_RETRIES`, default 10), so a
 * create-only `ObjectExistsError` may also mean the caller's own write landed and its retry
 * collided; and a listing is a hint (architecture §6.3), its cross-page order not yet verified.
 */
export class VercelBlobObjectStore implements ObjectStore {
  /** `{ token }` when a token was given, else `{}` so the SDK's own OIDC authentication applies. */
  readonly #auth: { token?: string };

  constructor(options?: { token?: string }) {
    this.#auth = options?.token !== undefined ? { token: options.token } : {};
  }

  async get(key: string): Promise<StoredObject | null> {
    assertValidKey(key);
    const result = await blob.get(key, { access: 'private', useCache: false, ...this.#auth });
    if (result === null) return null;
    if (result.statusCode !== 200) {
      // Only a conditional read can yield 304, and this driver never sends one.
      throw new Error(`Unexpected Vercel Blob status ${result.statusCode} reading ${key}`);
    }
    return { body: new Uint8Array(await new Response(result.stream).arrayBuffer()) };
  }

  async put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void> {
    assertValidKey(key);
    const mode = opts?.mode ?? 'create-only';
    // The SDK's `PutBody` excludes a plain `Uint8Array`; a `Buffer` view shares its bytes.
    const payload =
      typeof body === 'string' ? body : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
    try {
      await blob.put(key, payload, {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: mode === 'overwrite',
        ...(opts?.contentType !== undefined ? { contentType: opts.contentType } : {}),
        ...this.#auth,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('already exists')) {
        throw new ObjectExistsError(key);
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    assertValidKey(key);
    // Not `head()`: it throws for a missing key and has no uncached option.
    const result = await blob.get(key, { access: 'private', useCache: false, ...this.#auth });
    if (result === null) return false;
    try {
      await result.stream?.cancel();
    } catch {
      // The object exists either way; a failed cancel only leaves the response to be collected.
    }
    return true;
  }

  async list(prefix: string, opts?: ListOptions): Promise<ListResult> {
    assertValidPrefix(prefix);
    const limit = resolveListLimit(opts?.limit);
    const page = await blob.list({
      prefix,
      ...(opts?.cursor !== undefined ? { cursor: opts.cursor } : {}),
      limit,
      mode: 'expanded',
      ...this.#auth,
    });
    const keys = page.blobs.map((item) => item.pathname).sort(compareCodeUnits);
    return page.hasMore && page.cursor !== undefined ? { keys, cursor: page.cursor } : { keys };
  }

  async delete(keys: readonly string[]): Promise<void> {
    for (const key of keys) assertValidKey(key);
    const distinct = [...new Set(keys)];
    for (let start = 0; start < distinct.length; start += DELETE_BATCH_SIZE) {
      try {
        await blob.del(distinct.slice(start, start + DELETE_BATCH_SIZE), { ...this.#auth });
      } catch (error) {
        if (!(error instanceof blob.BlobNotFoundError)) throw error;
      }
    }
  }
}
