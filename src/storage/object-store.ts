import type { z } from 'zod';

/**
 * The object store contract (architecture §6.1): bytes under validated keys, with create-only
 * puts as the single concurrency primitive. Every driver (memory, file, Vercel Blob) implements
 * `ObjectStore`; the JSON helpers below work on any of them.
 */

export interface StoredObject {
  body: Uint8Array;
}

/** `mode` defaults to `'create-only'`. `contentType` is a write-only hint (only Blob forwards it). */
export interface PutOptions {
  mode?: 'create-only' | 'overwrite';
  contentType?: string;
}

/** `limit` is an integer from 1 to `MAX_LIST_LIMIT`, default `MAX_LIST_LIMIT`. */
export interface ListOptions {
  cursor?: string;
  limit?: number;
}

/** `cursor` is present iff another page may follow; pass it back with the same prefix. */
export interface ListResult {
  keys: string[];
  cursor?: string;
}

export interface ObjectStore {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, body: Uint8Array | string, opts?: PutOptions): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string, opts?: ListOptions): Promise<ListResult>;
  delete(keys: readonly string[]): Promise<void>;
}

export const MAX_KEY_LENGTH = 512;
export const MAX_LIST_LIMIT = 1000;

/** A create-only put found the key already stored. */
export class ObjectExistsError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Object already exists: ${key}`);
    this.name = 'ObjectExistsError';
    this.key = key;
  }
}

/** A key or list prefix breaks the key rule (FR-500, FR-501). `key` holds the rejected string. */
export class InvalidKeyError extends Error {
  readonly key: string;

  constructor(key: string, kind: 'key' | 'prefix') {
    super(`Invalid ${kind}: "${key}"`);
    this.name = 'InvalidKeyError';
    this.key = key;
  }
}

/** A stored JSON document could not be decoded or failed its schema. Never carries the body. */
export class CorruptObjectError extends Error {
  readonly key: string;
  readonly reason: 'invalid-json' | 'schema';
  readonly issuePath?: string;

  constructor(key: string, reason: 'invalid-json' | 'schema', issuePath?: string) {
    const detail =
      reason === 'invalid-json'
        ? 'invalid JSON'
        : `schema mismatch at ${issuePath ? issuePath : '(root)'}`;
    super(`Corrupt object ${key}: ${detail}`);
    this.name = 'CorruptObjectError';
    this.key = key;
    this.reason = reason;
    if (reason === 'schema') this.issuePath = issuePath ?? '';
  }
}

const KEY_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function isValidKey(key: string): boolean {
  if (typeof key !== 'string' || key.length < 1 || key.length > MAX_KEY_LENGTH) return false;
  return key.split('/').every((segment) => KEY_SEGMENT.test(segment));
}

/** Throws `InvalidKeyError` unless `key` follows the key rule (FR-500). */
export function assertValidKey(key: string): void {
  if (!isValidKey(key)) throw new InvalidKeyError(key, 'key');
}

/** Throws `InvalidKeyError` unless `prefix` is `''` or `prefix + 'x'` is a valid key (FR-501). */
export function assertValidPrefix(prefix: string): void {
  if (prefix === '') return;
  if (typeof prefix !== 'string' || !isValidKey(`${prefix}x`)) {
    throw new InvalidKeyError(prefix, 'prefix');
  }
}

/**
 * Returns the effective list page size: `limit` itself, or `MAX_LIST_LIMIT` when it is
 * `undefined`. Throws `RangeError` (message names `limit`) unless it is an integer in 1–1000.
 */
export function resolveListLimit(limit: number | undefined): number {
  if (limit === undefined) return MAX_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new RangeError(
      `Invalid list limit ${String(limit)}: limit must be an integer from 1 to ${MAX_LIST_LIMIT}`,
    );
  }
  return limit;
}

/**
 * Validates `list` arguments for drivers whose cursor is the last key of the previous page
 * (memory, file), in order: prefix (`InvalidKeyError`), limit and cursor (`RangeError`).
 * A cursor must be a valid key that starts with `prefix`. Call it before any I/O.
 */
export function checkListArgs(
  prefix: string,
  opts: ListOptions | undefined,
): { limit: number; cursor?: string } {
  assertValidPrefix(prefix);
  const limit = resolveListLimit(opts?.limit);
  const cursor = opts?.cursor;
  if (cursor === undefined) return { limit };
  if (!isValidKey(cursor) || !cursor.startsWith(prefix)) {
    throw new RangeError(`Invalid list cursor for prefix "${prefix}": "${cursor}"`);
  }
  return { limit, cursor };
}

/**
 * Pages already-validated list arguments over every stored key (any order): keeps the keys that
 * start with `prefix` and sort after `cursor`, sorts them in code-unit order and returns at most
 * `limit`. The result carries a cursor (the last key returned) iff more matching keys remain.
 */
export function pageKeys(
  allKeys: Iterable<string>,
  prefix: string,
  args: { limit: number; cursor?: string },
): ListResult {
  const { limit, cursor } = args;
  const matching: string[] = [];
  for (const key of allKeys) {
    if (key.startsWith(prefix) && (cursor === undefined || key > cursor)) matching.push(key);
  }
  matching.sort(compareCodeUnits);
  if (matching.length <= limit) return { keys: matching };
  const keys = matching.slice(0, limit);
  return { keys, cursor: keys[keys.length - 1] };
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stores `JSON.stringify(value)` as `application/json`; create-only unless `mode` says otherwise. */
export async function putJson(
  store: ObjectStore,
  key: string,
  value: unknown,
  opts?: { mode?: PutOptions['mode'] },
): Promise<void> {
  const text = JSON.stringify(value);
  if (text === undefined) {
    throw new TypeError(`putJson ${key}: value is not JSON-serialisable`);
  }
  await store.put(key, text, {
    mode: opts?.mode ?? 'create-only',
    contentType: 'application/json',
  });
}

/**
 * Reads `key` and validates it with `schema`: `null` when missing, the parsed data otherwise.
 * Rejects with `CorruptObjectError` for invalid UTF-8 or JSON (`'invalid-json'`) and for a schema
 * failure (`'schema'`, `issuePath` = the first issue's path joined with `.`).
 */
export async function getJson<S extends z.ZodType>(
  store: ObjectStore,
  key: string,
  schema: S,
): Promise<z.output<S> | null> {
  const stored = await store.get(key);
  if (stored === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stored.body));
  } catch {
    throw new CorruptObjectError(key, 'invalid-json');
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const path = result.error.issues[0]?.path ?? [];
    throw new CorruptObjectError(key, 'schema', path.map(String).join('.'));
  }
  return result.data;
}
