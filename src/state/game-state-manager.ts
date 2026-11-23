import {
  CorruptObjectError,
  getJson,
  ObjectExistsError,
  putJson,
  type ObjectStore,
} from '@/src/storage/object-store';
import {
  CommitNotFoundError,
  GameExistsError,
  GameNotFoundError,
  InvalidCommitError,
} from './errors';
import {
  assertValidGameId,
  commitKey,
  commitsPrefix,
  headKey,
  indexCreatedKey,
  MAX_COMMIT_VERSION,
  metaKey,
  parseCommitKey,
} from './keys';
import {
  CommitSchema,
  firstIssuePath,
  GameMetaSchema,
  HeadSchema,
  type Commit,
  type CommitBody,
  type GameMeta,
} from './schemas';

/*
 * The Game State Manager (architecture §6.2–§6.5): creates games in a fixed write order, loads
 * meta, any version and the tip, over any `ObjectStore`. Commits are the truth; `head.json` is
 * only a hint, so the tip is found by probing forward from it. Create-only writes are the only
 * ordering guard, and a create-only write that finds identical bytes (a retried write of our own)
 * counts as success.
 */

/** The tip of a game: its last commit reached by forward probing, and that commit's version. */
interface Tip {
  version: number;
  commit: Commit;
}

const encoder = new TextEncoder();

/** Encodes a JSON document as UTF-8 bytes, once, so the same bytes are written and compared. */
function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

/** `meta.json` bytes, keys in the documented order. */
function serializeMeta(meta: GameMeta): Uint8Array {
  return encodeJson({
    schemaVersion: 1,
    gameId: meta.gameId,
    presetId: meta.presetId,
    engineVersion: meta.engineVersion,
    createdAt: meta.createdAt,
    seats: meta.seats,
    seatTokenHashes: meta.seatTokenHashes,
  });
}

/** Commit bytes, keys in the documented order. */
function serializeCommit(commit: Commit): Uint8Array {
  return encodeJson({
    schemaVersion: 1,
    version: commit.version,
    at: commit.at,
    actorSeat: commit.actorSeat,
    clientRequestId: commit.clientRequestId,
    events: commit.events,
    state: commit.state,
    scoreboard: commit.scoreboard,
  });
}

/** True iff `a` and `b` have the same length and the same bytes. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Deep equality of JSON-like values; a key holding `undefined` counts as absent. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => jsonEqual(item, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).filter((k) => left[k] !== undefined);
  const rightKeys = Object.keys(right).filter((k) => right[k] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((k) => Object.hasOwn(right, k) && jsonEqual(left[k], right[k]));
}

export class GameStateManager {
  readonly #store: ObjectStore;

  constructor(store: ObjectStore) {
    this.#store = store;
  }

  /**
   * Validates `meta` and commit 0, then writes, each step after the previous one: the index
   * marker, `meta.json`, commit 0 (all create-only) and `head.json` (overwrite, best-effort).
   * A create-only write that finds the marker, or identical meta/commit bytes, counts as success;
   * different (or vanished) bytes reject with `GameExistsError`. Resolves to commit 0.
   */
  async create(meta: GameMeta, initial: CommitBody): Promise<Commit> {
    assertValidGameId(meta.gameId);
    const parsedMeta = GameMetaSchema.safeParse(meta);
    if (!parsedMeta.success) {
      throw new InvalidCommitError(`meta-schema:${firstIssuePath(parsedMeta.error)}`);
    }
    const parsedCommit = CommitSchema.safeParse({ schemaVersion: 1, ...initial });
    if (!parsedCommit.success) {
      throw new InvalidCommitError(`commit-schema:${firstIssuePath(parsedCommit.error)}`);
    }
    const validMeta = parsedMeta.data;
    const commit = parsedCommit.data;
    if (commit.version !== 0) throw new InvalidCommitError('initial-version');
    if (commit.state.version !== 0) throw new InvalidCommitError('initial-state-version');
    if (commit.state.gameId !== validMeta.gameId) throw new InvalidCommitError('state-game-id');
    if (!jsonEqual(validMeta.seats, commit.state.seats)) {
      throw new InvalidCommitError('seats-mismatch');
    }

    const gameId = validMeta.gameId;
    const markerKey = indexCreatedKey(validMeta.createdAt.slice(0, 10), gameId);
    try {
      await this.#store.put(markerKey, new Uint8Array(0), { mode: 'create-only' });
    } catch (err) {
      if (!(err instanceof ObjectExistsError)) throw err;
    }
    await this.#createOrMatch(gameId, metaKey(gameId), serializeMeta(validMeta));
    await this.#createOrMatch(gameId, commitKey(gameId, 0), serializeCommit(commit));
    await this.#writeHead(gameId, 0);
    return commit;
  }

  /** The validated `meta.json`. `GameNotFoundError` when missing. */
  async loadMeta(gameId: string): Promise<GameMeta> {
    const key = metaKey(gameId);
    const meta = await getJson(this.#store, key, GameMetaSchema);
    if (meta === null) throw new GameNotFoundError(gameId);
    if (meta.gameId !== gameId) throw new CorruptObjectError(key, 'schema', 'gameId');
    return meta;
  }

  /**
   * The validated commit `version`. `CommitNotFoundError` when it is missing but commit 0 exists;
   * `GameNotFoundError` when commit 0 is missing. Does not read `meta.json`.
   */
  async load(gameId: string, version: number): Promise<Commit> {
    commitKey(gameId, version);
    if (version === 0) {
      const initial = await this.#readCommit(gameId, 0);
      if (initial === null) throw new GameNotFoundError(gameId);
      return initial;
    }
    const [commit, initialExists] = await Promise.all([
      this.#readCommit(gameId, version),
      this.#store.exists(commitKey(gameId, 0)),
    ]);
    if (!initialExists) throw new GameNotFoundError(gameId);
    if (commit === null) throw new CommitNotFoundError(gameId, version);
    return commit;
  }

  /** The tip commit (FR-608). Never writes. `GameNotFoundError` without meta and commit 0. */
  async loadLatest(gameId: string): Promise<Commit> {
    const tip = await this.#findTip(gameId);
    return tip.commit;
  }

  /**
   * Finds the tip: checks meta and commit 0 and reads the `head.json` hint in parallel, then
   * probes forward from the hint; if the hint is absent, corrupt or ahead of the commits, from
   * each listed commit (highest first), and finally from 0.
   */
  async #findTip(gameId: string): Promise<Tip> {
    assertValidGameId(gameId);
    const [metaExists, initialExists, hint] = await Promise.all([
      this.#store.exists(metaKey(gameId)),
      this.#store.exists(commitKey(gameId, 0)),
      this.#readHint(gameId),
    ]);
    if (!metaExists || !initialExists) throw new GameNotFoundError(gameId);

    if (hint !== null) {
      const tip = await this.#probeFrom(gameId, hint);
      if (tip !== null) return tip;
    }
    for (const start of await this.#listedVersions(gameId)) {
      const tip = await this.#probeFrom(gameId, start);
      if (tip !== null) return tip;
    }
    const tip = await this.#probeFrom(gameId, 0);
    if (tip === null) throw new GameNotFoundError(gameId);
    return tip;
  }

  /**
   * Forward probe from `start`: reads commit `start` while checking `start + 1`. `null` when
   * commit `start` is missing. Otherwise checks `start + 2, …` one at a time until one is missing
   * and returns the last existing commit (reusing the first read when `start` is the tip).
   */
  async #probeFrom(gameId: string, start: number): Promise<Tip | null> {
    const [commit, nextExists] = await Promise.all([
      this.#readCommit(gameId, start),
      this.#existsCommit(gameId, start + 1),
    ]);
    if (commit === null) return null;
    if (!nextExists) return { version: start, commit };
    let last = start + 1;
    while (await this.#existsCommit(gameId, last + 1)) last++;
    const tip = await this.#readCommit(gameId, last);
    if (tip === null) throw new CommitNotFoundError(gameId, last);
    return { version: last, commit: tip };
  }

  /** `exists` of commit `version`; `false` past `MAX_COMMIT_VERSION` without any call. */
  async #existsCommit(gameId: string, version: number): Promise<boolean> {
    if (version > MAX_COMMIT_VERSION) return false;
    return this.#store.exists(commitKey(gameId, version));
  }

  /** The versions of every listed commit key (all pages), highest first, without duplicates. */
  async #listedVersions(gameId: string): Promise<number[]> {
    const prefix = commitsPrefix(gameId);
    const versions = new Set<number>();
    let cursor: string | undefined;
    do {
      const page = await this.#store.list(prefix, cursor === undefined ? undefined : { cursor });
      for (const key of page.keys) {
        const version = parseCommitKey(gameId, key);
        if (version !== null) versions.add(version);
      }
      cursor = page.cursor;
    } while (cursor !== undefined);
    return [...versions].sort((a, b) => b - a);
  }

  /** The `head.json` version, or `null` when it is missing or corrupt. Other errors propagate. */
  async #readHint(gameId: string): Promise<number | null> {
    try {
      const head = await getJson(this.#store, headKey(gameId), HeadSchema);
      return head === null ? null : head.version;
    } catch (err) {
      if (err instanceof CorruptObjectError) return null;
      throw err;
    }
  }

  /**
   * Reads and validates commit `version`; `null` when missing. Also checks that the commit's
   * `version` and `state.gameId` match its key (`CorruptObjectError` otherwise).
   */
  async #readCommit(gameId: string, version: number): Promise<Commit | null> {
    const key = commitKey(gameId, version);
    const commit = await getJson(this.#store, key, CommitSchema);
    if (commit === null) return null;
    if (commit.version !== version) throw new CorruptObjectError(key, 'schema', 'version');
    if (commit.state.gameId !== gameId) throw new CorruptObjectError(key, 'schema', 'state.gameId');
    return commit;
  }

  /**
   * Create-only write of `bytes`. When the key already exists, re-reads it: identical bytes (our
   * own retried write landed) count as success; different or missing bytes → `GameExistsError`.
   */
  async #createOrMatch(gameId: string, key: string, bytes: Uint8Array): Promise<void> {
    try {
      await this.#store.put(key, bytes, { mode: 'create-only', contentType: 'application/json' });
    } catch (err) {
      if (!(err instanceof ObjectExistsError)) throw err;
      const stored = await this.#store.get(key);
      if (stored === null || !bytesEqual(stored.body, bytes)) throw new GameExistsError(gameId);
    }
  }

  /** Best-effort `head.json` overwrite: any error is swallowed (the hint is only a cache). */
  async #writeHead(gameId: string, version: number): Promise<void> {
    try {
      await putJson(
        this.#store,
        headKey(gameId),
        { schemaVersion: 1, version },
        { mode: 'overwrite' },
      );
    } catch {
      // head.json is a hint; probing finds the tip without it.
    }
  }
}
