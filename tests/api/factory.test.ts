// The config-wired service factory (spec FR-812; VC-824 factory part). Each test gets fresh module
// state: `vi.resetModules()` drops the cached service and the memoised config, and the factory and
// `GameService` are imported dynamically afterwards so they come from the same module graph.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeService } from '../unit/service/support/service-fixtures';

const ENV_KEYS = [
  'STORAGE_DRIVER',
  'VERCEL',
  'VERCEL_ENV',
  'CRON_SECRET',
  'LOG_LEVEL',
  'DEFAULT_RULES_PRESET',
  'RETENTION_DAYS',
  'BLOB_READ_WRITE_TOKEN',
  'BLOB_STORE_ID',
  'VERCEL_OIDC_TOKEN',
];

async function loadFactory() {
  const factory = await import('@/app/api/_lib/service-factory');
  const { GameService } = await import('@/src/service/game-service');
  const { ConfigError } = await import('@/src/config');
  return { getService: factory.getService, GameService, ConfigError };
}

beforeEach(() => {
  vi.resetModules();
  // An empty value counts as unset in `loadConfig`, so the host env cannot leak in.
  for (const key of ENV_KEYS) vi.stubEnv(key, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('VC-824 (factory part): getService', () => {
  it('throws on an invalid env, then builds once the env is fixed, and caches the instance', async () => {
    const { getService, GameService, ConfigError } = await loadFactory();

    vi.stubEnv('STORAGE_DRIVER', 'bogus');
    expect(() => getService()).toThrow(ConfigError);

    vi.stubEnv('STORAGE_DRIVER', 'memory');
    const first = getService();
    expect(first).toBeInstanceOf(GameService);
    expect(getService()).toBe(first);
  });

  it('wires the configured default preset into the service', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'memory');
    vi.stubEnv('DEFAULT_RULES_PRESET', 'spain-ludoteka');
    const { getService } = await loadFactory();
    const req = { humanName: 'Ana', aiCount: 2 };
    const created = await getService().createGame(req);
    const reference = await makeService(undefined, {
      defaultPresetId: 'spain-ludoteka',
    }).service.createGame(req);
    expect(created.update.view.handPlan).toEqual(reference.update.view.handPlan);
    const fallback = await makeService().service.createGame(req);
    expect(created.update.view.handPlan).not.toEqual(fallback.update.view.handPlan);
  });

  it('a fresh module instance builds a new service', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'memory');
    const a = (await loadFactory()).getService();
    vi.resetModules();
    const b = (await loadFactory()).getService();
    expect(b).not.toBe(a);
  });
});
