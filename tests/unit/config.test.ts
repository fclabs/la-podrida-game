// Configuration (spec 00 FR-022–FR-027, BR-005; VC-022–VC-027, VC-031 via VC-024/025).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '@/src/config';

type Env = Record<string, string | undefined>;

/** Runs `loadConfig(env)`, expects a `ConfigError`, and returns it. */
function configError(env: Env): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return error as ConfigError;
  }
  throw new Error(`expected loadConfig(${JSON.stringify(env)}) to throw ConfigError`);
}

/** The environment variable names listed in a `ConfigError` message, one per `  - NAME` line. */
function listedVariables(error: ConfigError): string[] {
  return [...error.message.matchAll(/^ {2}- ([A-Z_]+) /gm)].map((m) => m[1]).sort();
}

const OPTIONAL_FIELDS = [
  'blobStoreId',
  'vercelOidcToken',
  'blobReadWriteToken',
  'cronSecret',
  'vercelEnv',
] as const;

describe('VC-022 getConfig()', () => {
  const TOUCHED = ['LOG_LEVEL', 'VERCEL_ENV', 'CRON_SECRET', 'STORAGE_DRIVER', 'RETENTION_DAYS'];
  const saved = Object.fromEntries(TOUCHED.map((name) => [name, process.env[name]]));

  beforeEach(() => {
    vi.resetModules();
    for (const name of TOUCHED) delete process.env[name];
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('returns the same frozen object on later calls', async () => {
    const { getConfig } = await import('@/src/config');
    const first = getConfig();
    expect(getConfig()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it('does not cache a thrown ConfigError; the next call re-validates', async () => {
    const { getConfig, ConfigError: FreshConfigError } = await import('@/src/config');
    process.env.LOG_LEVEL = 'trace';
    expect(() => getConfig()).toThrow(FreshConfigError);
    process.env.LOG_LEVEL = 'warn';
    const config = getConfig();
    expect(config.logLevel).toBe('warn');
    expect(getConfig()).toBe(config);
  });
});

describe('VC-023 defaults', () => {
  it('loadConfig({}) returns the documented defaults with optional fields undefined', () => {
    const config = loadConfig({});
    expect(config).toEqual({
      storageDriver: 'file',
      fileStoreDir: '.data/',
      defaultRulesPreset: 'argentina-fidepo',
      logLevel: 'info',
      retentionDays: 365,
    });
    for (const field of OPTIONAL_FIELDS) expect(config[field]).toBeUndefined();
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("defaults storageDriver to 'blob' when VERCEL is '1'", () => {
    expect(loadConfig({ VERCEL: '1' }).storageDriver).toBe('blob');
  });
});

describe('VC-024 invalid values (FR-024, BR-005)', () => {
  it.each([
    ['STORAGE_DRIVER', 's3'],
    ['LOG_LEVEL', 'trace'],
    ['DEFAULT_RULES_PRESET', 'foo'],
    ['RETENTION_DAYS', '0'],
    ['RETENTION_DAYS', '3651'],
    ['RETENTION_DAYS', '1.5'],
    ['RETENTION_DAYS', 'abc'],
    ['RETENTION_DAYS', ' 365'],
    ['VERCEL_ENV', 'staging'],
  ])('%s=%j throws ConfigError naming that variable', (name, value) => {
    expect(listedVariables(configError({ [name]: value }))).toEqual([name]);
  });

  it.each([
    ['1', 1],
    ['3650', 3650],
  ])('RETENTION_DAYS=%j is accepted', (value, expected) => {
    expect(loadConfig({ RETENTION_DAYS: value }).retentionDays).toBe(expected);
  });

  it('one ConfigError names every invalid variable', () => {
    const error = configError({ STORAGE_DRIVER: 's3', LOG_LEVEL: 'trace' });
    expect(listedVariables(error)).toEqual(['LOG_LEVEL', 'STORAGE_DRIVER']);
  });

  it('empty strings count as unset and take the default', () => {
    const config = loadConfig({ LOG_LEVEL: '', FILE_STORE_DIR: '' });
    expect(config.logLevel).toBe('info');
    expect(config.fileStoreDir).toBe('.data/');
  });
});

describe('VC-025 CRON_SECRET required in preview/production (FR-025)', () => {
  it.each<Env>([{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production', CRON_SECRET: '' }])(
    '%j throws ConfigError naming CRON_SECRET',
    (env) => {
      expect(listedVariables(configError(env))).toEqual(['CRON_SECRET']);
    },
  );

  it('accepts a non-empty CRON_SECRET in production', () => {
    expect(loadConfig({ VERCEL_ENV: 'production', CRON_SECRET: 's3cret' }).cronSecret).toBe(
      's3cret',
    );
  });

  it('reports the CRON_SECRET check alongside field errors in one ConfigError', () => {
    const error = configError({ VERCEL_ENV: 'production', LOG_LEVEL: 'trace' });
    expect(listedVariables(error)).toEqual(['CRON_SECRET', 'LOG_LEVEL']);
  });
});

describe('VC-026 CRON_SECRET optional outside preview/production (FR-026)', () => {
  it.each<Env>([{}, { VERCEL_ENV: 'development' }, { CRON_SECRET: '' }])(
    '%j succeeds with cronSecret undefined',
    (env) => {
      expect(loadConfig(env).cronSecret).toBeUndefined();
    },
  );
});

describe('VC-027 secrets never appear in ConfigError messages (FR-027)', () => {
  it('omits BLOB_READ_WRITE_TOKEN and VERCEL_OIDC_TOKEN values', () => {
    const error = configError({
      VERCEL_ENV: 'production',
      CRON_SECRET: '',
      BLOB_READ_WRITE_TOKEN: 'tok-SECRET-1',
      VERCEL_OIDC_TOKEN: 'oidc-SECRET-2',
      LOG_LEVEL: 'trace',
    });
    expect(error.message).not.toContain('tok-SECRET-1');
    expect(error.message).not.toContain('oidc-SECRET-2');
    expect(listedVariables(error)).toEqual(['CRON_SECRET', 'LOG_LEVEL']);
  });

  it('never echoes a received value, including a CRON_SECRET set alongside other errors', () => {
    const error = configError({
      CRON_SECRET: 'cron-SECRET-3',
      LOG_LEVEL: 'trace-VALUE-4',
      RETENTION_DAYS: 'days-VALUE-5',
    });
    for (const value of ['cron-SECRET-3', 'trace-VALUE-4', 'days-VALUE-5']) {
      expect(error.message).not.toContain(value);
    }
  });
});
