// Real layout end to end (spec 10: VC-1017). A game created through the spec 08 create handler on
// a real `GameService` is deleted by the cleanup handler walking the same store.
import { describe, expect, it } from 'vitest';
import { type CleanupDeps, cleanupHandler } from '@/app/api/_lib/cleanup';
import { getGameHandler } from '@/app/api/_lib/handlers';
import { loadConfig } from '@/src/config';
import { createGameVia, ctx, getReq, makeApi, bearer } from '../api/support/api-fixtures';
import { snapshot } from './support/fixtures';

const SECRET = 'e2e-secret-value';

describe('VC-1017: real layout end to end', () => {
  it('deletes a game created through the service; its GET answers 404 and the store is empty', async () => {
    const api = makeApi();
    const { gameId, seatToken } = await createGameVia(api);
    // The service clock is FIXED_NOW (2026-11-23), so the marker day is 2026-11-23.
    expect(
      (await snapshot(api.store)).some(([key]) => key === `index/created/2026-11-23/${gameId}`),
    ).toBe(true);

    const config = loadConfig({
      STORAGE_DRIVER: 'memory',
      RETENTION_DAYS: '365',
      CRON_SECRET: SECRET,
    });
    const deps: CleanupDeps = {
      getConfig: () => config,
      getStore: () => api.store,
      now: () => new Date('2028-11-23T00:00:00.000Z'),
      log: () => {},
      batchSize: 500,
      pageSize: 1000,
    };
    const res = await cleanupHandler(
      getReq('/api/cron/cleanup', { authorization: `Bearer ${SECRET}` }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gamesDeleted: 1, capReached: false, skippedMarkers: 0 });

    const get = await getGameHandler(
      getReq(`/api/games/${gameId}`, bearer(seatToken)),
      ctx(gameId),
      api.deps,
    );
    expect(get.status).toBe(404);
    const body = (await get.json()) as { error: { code: string } };
    expect(body.error.code).toBe('game_not_found');

    expect(await snapshot(api.store)).toEqual([]);
  });
});
