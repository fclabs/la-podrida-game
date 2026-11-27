// The cleanup handler (spec 10: VC-1000, VC-1001, VC-1008, VC-1012, VC-1013, VC-1015; plan
// iteration 3). Hand-built deps with a fixed clock and a capturing log sink, on both stores.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type CleanupDeps, cleanupHandler, defaultCleanupDeps } from '@/app/api/_lib/cleanup';
import { ERROR_MESSAGES } from '@/app/api/_lib/errors';
import { type Config, ConfigError, loadConfig } from '@/src/config';
import { createObjectStore } from '@/src/storage';
import type { ObjectStore } from '@/src/storage/object-store';
import { gameKeyPrefix, indexCreatedPrefix } from '@/src/state/keys';
import { getReq } from '../api/support/api-fixtures';
import { RecordingStore } from '../unit/state/support/store-wrappers';
import { failOnNthList, gameId, makeGameKeys, snapshot, storeMatrix } from './support/fixtures';

const NOW = new Date('2026-11-27T03:00:00.000Z');
const SECRET = 'cron-secret-value-0123456789';
const UNAUTHORIZED = { error: { code: 'unauthorized', message: ERROR_MESSAGES.unauthorized } };
const INTERNAL = { error: { code: 'internal', message: ERROR_MESSAGES.internal } };

type Line = { level: string; line: Record<string, unknown> };

function configWith(over: Record<string, string | undefined> = {}): Config {
  return loadConfig({
    STORAGE_DRIVER: 'memory',
    RETENTION_DAYS: '365',
    CRON_SECRET: SECRET,
    ...over,
  });
}

interface Harness {
  deps: CleanupDeps;
  lines: Line[];
  getStoreCalls: () => number;
}

/** Hand-built deps: fixed clock, capturing log, a counting store getter. */
function makeDeps(store: ObjectStore, config: Config = configWith()): Harness {
  const lines: Line[] = [];
  let calls = 0;
  const deps: CleanupDeps = {
    getConfig: () => config,
    getStore: () => {
      calls++;
      return store;
    },
    now: () => NOW,
    log: (level, line) => lines.push({ level, line }),
    batchSize: 500,
    pageSize: 1000,
  };
  return { deps, lines, getStoreCalls: () => calls };
}

const call = (deps: CleanupDeps, auth?: string) =>
  cleanupHandler(
    getReq('/api/cron/cleanup', auth === undefined ? undefined : { authorization: auth }),
    deps,
  );

describe.each(storeMatrix)('cleanupHandler on the $name store', ({ make }) => {
  let store: ObjectStore;
  let release: () => Promise<void>;

  beforeEach(async () => {
    ({ store, cleanup: release } = await make());
  });
  afterEach(async () => {
    await release();
  });

  it('VC-1000: valid secret, empty store: 200 with zeros and the JSON headers', async () => {
    const h = makeDeps(store);
    const res = await call(h.deps, `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ gamesDeleted: 0, capReached: false, skippedMarkers: 0 });
  });

  it('FR-1008: a valid call deletes the expired game and reports it', async () => {
    await makeGameKeys(store, { id: gameId(1), day: '2025-01-01', keys: 3 });
    await makeGameKeys(store, { id: gameId(2), day: '2026-11-27', keys: 3 });
    const res = await call(makeDeps(store).deps, `Bearer ${SECRET}`);
    expect(await res.json()).toEqual({ gamesDeleted: 1, capReached: false, skippedMarkers: 0 });
    expect((await store.list(gameKeyPrefix(gameId(1)))).keys).toEqual([]);
    expect((await store.list(indexCreatedPrefix)).keys).toHaveLength(1);
  });

  const badHeaders: [string, string | undefined][] = [
    ['missing header', undefined],
    ['Bearer wrong', 'Bearer wrong'],
    ['secret plus one extra char', `Bearer ${SECRET}x`],
    ['Bearer + secret without the space', `Bearer${SECRET}`],
    ['lowercase scheme', `bearer ${SECRET}`],
    ['Basic scheme', `Basic ${SECRET}`],
  ];
  it.each(badHeaders)('VC-1001: %s answers 401, no store, no log', async (_name, header) => {
    const h = makeDeps(store);
    const res = await call(h.deps, header);
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(UNAUTHORIZED);
    expect(text).not.toContain(SECRET);
    expect(h.getStoreCalls()).toBe(0);
    expect(h.lines).toEqual([]);
  });

  it('VC-1001: cronSecret unset rejects even a well-formed header (fail closed)', async () => {
    const h = makeDeps(store, configWith({ CRON_SECRET: undefined }));
    const res = await call(h.deps, 'Bearer anything');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(UNAUTHORIZED);
    expect(h.getStoreCalls()).toBe(0);
    expect(h.lines).toEqual([]);
  });

  it('VC-1001: a ConfigError from getConfig answers 500 internal, not 401', async () => {
    const h = makeDeps(store);
    h.deps.getConfig = () => {
      throw new ConfigError(`bad config ${SECRET}`);
    };
    const res = await call(h.deps);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(INTERNAL);
    expect(h.getStoreCalls()).toBe(0);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]!.level).toBe('error');
    expect(h.lines[0]!.line).toMatchObject({ gamesDeleted: 0, errorName: 'ConfigError' });
  });

  it('VC-1008: a store fault answers 500 internal and logs one error line', async () => {
    const id = gameId(1);
    await makeGameKeys(store, { id, day: '2025-01-01', keys: 4 });
    await makeGameKeys(store, { id: gameId(2), day: '2026-11-27', keys: 2 });
    const faulty = new RecordingStore(store, failOnNthList(gameKeyPrefix(id), 2));
    const h = makeDeps(faulty);
    h.deps.pageSize = 1;
    const res = await call(h.deps, `Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(INTERNAL);
    expect(h.lines).toHaveLength(1);
    const { level, line } = h.lines[0]!;
    expect(level).toBe('error');
    expect(Object.keys(line).sort()).toEqual([
      'errorMessage',
      'errorName',
      'gamesDeleted',
      'route',
    ]);
    expect(line).toMatchObject({ route: 'cron/cleanup', gamesDeleted: 0, errorName: 'Error' });
    expect(line.errorMessage).toBe('injected');
    expect((line.errorMessage as string).length).toBeLessThanOrEqual(500);
    for (const out of [text, JSON.stringify(h.lines)]) {
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain(id);
    }
    // Deletions stay; the next run finishes the game.
    const again = await call(makeDeps(store).deps, `Bearer ${SECRET}`);
    expect(await again.json()).toMatchObject({ gamesDeleted: 1 });
  });

  it('FR-1009: errorMessage is clipped to 500 chars and gamesDeleted counts finished games', async () => {
    await makeGameKeys(store, { id: gameId(1), day: '2025-01-01', keys: 1 });
    await makeGameKeys(store, { id: gameId(2), day: '2025-01-02', keys: 1 });
    const faulty = new RecordingStore(store, {
      list: async ({ prefix, opts }, inner) => {
        if (prefix === gameKeyPrefix(gameId(2))) throw new Error('x'.repeat(2000));
        return inner.list(prefix, opts);
      },
    });
    const h = makeDeps(faulty);
    const res = await call(h.deps, `Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]!.line.gamesDeleted).toBe(1);
    expect((h.lines[0]!.line.errorMessage as string).length).toBe(500);
  });

  it('FR-1009: a RangeError from bad options answers 500 internal', async () => {
    const h = makeDeps(store);
    h.deps.batchSize = 0;
    const res = await call(h.deps, `Bearer ${SECRET}`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(INTERNAL);
    expect(h.lines[0]!.line).toMatchObject({ gamesDeleted: 0, errorName: 'RangeError' });
  });

  it('VC-1012: two calls started together reach the single-run state', async () => {
    for (let i = 1; i <= 3; i++)
      await makeGameKeys(store, { id: gameId(i), day: '2025-01-01', keys: 3 });
    await makeGameKeys(store, { id: gameId(9), day: '2026-11-27', keys: 3 });
    const single = await makeStore();
    try {
      for (let i = 1; i <= 3; i++)
        await makeGameKeys(single.store, { id: gameId(i), day: '2025-01-01', keys: 3 });
      await makeGameKeys(single.store, { id: gameId(9), day: '2026-11-27', keys: 3 });
      await call(makeDeps(single.store).deps, `Bearer ${SECRET}`);
      const expected = await snapshot(single.store);

      const [a, b] = await Promise.all([
        call(makeDeps(store).deps, `Bearer ${SECRET}`),
        call(makeDeps(store).deps, `Bearer ${SECRET}`),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const [ja, jb] = [await a.json(), await b.json()] as { gamesDeleted: number }[];
      expect(ja!.gamesDeleted).toBeLessThanOrEqual(3);
      expect(jb!.gamesDeleted).toBeLessThanOrEqual(3);
      expect(ja!.gamesDeleted + jb!.gamesDeleted).toBeGreaterThanOrEqual(3);
      expect(await snapshot(store)).toEqual(expected);
    } finally {
      await single.cleanup();
    }
  });

  it('VC-1013: log level error, successful run: exactly one info line with the six fields', async () => {
    await makeGameKeys(store, { id: gameId(1), day: '2025-01-01', keys: 2 });
    const h = makeDeps(store, configWith({ LOG_LEVEL: 'error' }));
    const res = await call(h.deps, `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(h.lines).toHaveLength(1);
    const { level, line } = h.lines[0]!;
    expect(level).toBe('info');
    expect(Object.keys(line).sort()).toEqual(
      ['capReached', 'durationMs', 'gamesDeleted', 'route', 'skippedMarkers', 'status'].sort(),
    );
    expect(line).toMatchObject({
      route: 'cron/cleanup',
      status: 200,
      gamesDeleted: 1,
      capReached: false,
      skippedMarkers: 0,
    });
    expect(Number.isInteger(line.durationMs)).toBe(true);
  });

  it('VC-1013: durationMs is the wall-clock difference of the injected clock', async () => {
    const times = [1000, 1000, 1250];
    let i = 0;
    const h = makeDeps(store);
    h.deps.now = () => new Date(times[Math.min(i++, times.length - 1)]! + NOW.getTime());
    await call(h.deps, `Bearer ${SECRET}`);
    expect(h.lines[0]!.line.durationMs).toBe(250);
  });

  it('VC-1015: the handler uses the injected clock, not the system clock', async () => {
    // Created 2025-11-28: kept at the real "now" of late 2026 only if the clock is fixed in 2025.
    await makeGameKeys(store, { id: gameId(1), day: '2025-11-28', keys: 2 });
    const h = makeDeps(store);
    h.deps.now = () => new Date('2026-01-01T00:00:00.000Z');
    const res = await call(h.deps, `Bearer ${SECRET}`);
    expect(await res.json()).toMatchObject({ gamesDeleted: 0 });
    expect((await store.list(indexCreatedPrefix)).keys).toHaveLength(1);
  });
});

async function makeStore() {
  return storeMatrix[0]!.make();
}

describe('defaultCleanupDeps', () => {
  it('VC-1015: production defaults', () => {
    expect(defaultCleanupDeps.batchSize).toBe(500);
    expect(defaultCleanupDeps.pageSize).toBe(1000);
    expect(defaultCleanupDeps.getStore).toBe(createObjectStore);
    expect(Math.abs(defaultCleanupDeps.now().getTime() - Date.now())).toBeLessThan(1000);
  });
});
