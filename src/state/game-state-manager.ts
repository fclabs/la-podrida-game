import {
  CorruptObjectError,
  getJson,
  ObjectExistsError,
  putJson,
  type ObjectStore,
} from '@/src/storage/object-store';
import type { GameEvent, ScoreBoard } from '@/src/domain/types';
import {
  CommitConflictError,
  CommitNotFoundError,
  GameExistsError,
  GameNotFoundError,
  InvalidCommitError,
} from './errors';
import {
  assertValidGameId,
  commitKey,
  commitsPrefix,
  finalScoresKey,
  headKey,
  indexCreatedKey,
  MAX_COMMIT_VERSION,
  metaKey,
  parseCommitKey,
} from './keys';
import {
  CommitSchema,
  FinalScoresSchema,
  firstIssuePath,
  GameMetaSchema,
  HeadSchema,
  ScoreBoardSchema,
  type Commit,
  type CommitBody,
  type FinalScores,
  type GameMeta,
} from './schemas';

/*
 * The Game State Manager (architecture §6.2–§6.5): creates games in a fixed write order, loads
 * meta, any version and the tip, appends commits, reads missed events and keeps the final scores,
 * over any `ObjectStore`. Commits are the truth; `head.json` is
 * only a hint, so the tip is found by probing forward from it. Create-only writes are the only
 * ordering guard, and a create-only write that finds identical bytes (a retried write of our own)
 * counts as success.
 */

/** The tip of a game: its last commit reached by forward probing, and that commit's version. */
interface Tip {
  version: number;
  commit: Commit;
}

/** The most commit reads `eventsSince` keeps in flight at once. */
const EVENTS_READ_CONCURRENCY = 8;

const encoder = new TextEncoder();

/** Encodes a JSON document as UTF-8 bytes, once, so the same bytes are written and compared. */
function encodeJson(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

/*
 * Serialization: the top-level keys follow the documented order; nested values are the caller's
 * validated input as given (`JSON.stringify` keeps their key order), so the stored bytes equal
 * `JSON.stringify` of the caller's document with its top-level keys in the documented order.
 */

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

/**
 * Maps `items` through `fn` with at most `limit` calls pending at once. Results keep the order of
 * `items`. Rejects with the first rejection and starts no further calls after it.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
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
    await this.#createOrMatch(gameId, metaKey(gameId), serializeMeta(meta));
    await this.#createOrMatch(
      gameId,
      commitKey(gameId, 0),
      serializeCommit({ schemaVersion: 1, ...initial }),
    );
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
   * Appends commit `next.version` with a create-only write, then sets `head.json` (best-effort).
   * Does not check that the game exists or that `next.version` is the tip + 1: the create-only
   * write is the only ordering guard. When the commit key already holds identical bytes (our own
   * retried write landed), it counts as success; different or vanished bytes reject with
   * `CommitConflictError`. Other storage errors propagate.
   */
  async commit(gameId: string, next: CommitBody): Promise<Commit> {
    assertValidGameId(gameId);
    const parsed = CommitSchema.safeParse({ schemaVersion: 1, ...next });
    if (!parsed.success) {
      throw new InvalidCommitError(`commit-schema:${firstIssuePath(parsed.error)}`);
    }
    const commit = parsed.data;
    if (commit.version < 1) throw new InvalidCommitError('commit-version');
    if (commit.state.version !== commit.version) throw new InvalidCommitError('state-version');
    if (commit.state.gameId !== gameId) throw new InvalidCommitError('state-game-id');

    const key = commitKey(gameId, commit.version);
    const bytes = serializeCommit({ schemaVersion: 1, ...next });
    try {
      await this.#store.put(key, bytes, { mode: 'create-only', contentType: 'application/json' });
    } catch (err) {
      if (!(err instanceof ObjectExistsError)) throw err;
      const stored = await this.#store.get(key);
      if (stored === null || !bytesEqual(stored.body, bytes)) {
        throw new CommitConflictError(gameId, commit.version);
      }
    }
    await this.#writeHead(gameId, commit.version);
    return commit;
  }

  /**
   * The events of commits `version + 1 … tip`, concatenated in version order; `[]` when `version`
   * is at or past the tip. Reads at most `EVENTS_READ_CONCURRENCY` commits at once.
   * `CommitNotFoundError` when a commit in that range is missing.
   */
  async eventsSince(gameId: string, version: number): Promise<GameEvent[]> {
    assertValidGameId(gameId);
    if (!Number.isInteger(version) || version < 0) {
      throw new RangeError(`Invalid version ${version}: version must be an integer >= 0`);
    }
    const tip = await this.#findTip(gameId);
    if (version >= tip.version) return [];
    const missed: number[] = [];
    for (let v = version + 1; v < tip.version; v++) missed.push(v);
    const commits = await mapLimit(missed, EVENTS_READ_CONCURRENCY, async (v) => {
      const commit = await this.#readCommit(gameId, v);
      if (commit === null) throw new CommitNotFoundError(gameId, v);
      return commit;
    });
    commits.push(tip.commit);
    return commits.flatMap((commit) => commit.events);
  }

  /**
   * Writes `final.json` from `board` (create-only), best-effort: every storage error, including
   * an existing file, is swallowed. Invalid input rejects with `InvalidCommitError` before I/O.
   */
  async writeFinalScores(gameId: string, version: number, board: ScoreBoard): Promise<void> {
    assertValidGameId(gameId);
    const parsed = ScoreBoardSchema.safeParse(board);
    if (!parsed.success) {
      throw new InvalidCommitError(`board-schema:${firstIssuePath(parsed.error)}`);
    }
    if (!FinalScoresSchema.shape.version.safeParse(version).success) {
      throw new InvalidCommitError('final-version');
    }
    const { ranking, totals, madeCount, missedCount } = parsed.data;
    const document: FinalScores = {
      schemaVersion: 1,
      gameId,
      version,
      ranking,
      totals,
      madeCount,
      missedCount,
    };
    try {
      await putJson(this.#store, finalScoresKey(gameId), document, { mode: 'create-only' });
    } catch {
      // final.json is a cache of the terminal commit; the commit stays the truth.
    }
  }

  /**
   * The validated `final.json`, or `null` when it is missing. `CorruptObjectError` when it fails
   * its schema or names another game.
   */
  async readFinalScores(gameId: string): Promise<FinalScores | null> {
    const key = finalScoresKey(gameId);
    const scores = await getJson(this.#store, key, FinalScoresSchema);
    if (scores !== null && scores.gameId !== gameId) {
      throw new CorruptObjectError(key, 'schema', 'gameId');
    }
    return scores;
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
