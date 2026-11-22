import { z } from 'zod';

/**
 * Validated runtime configuration (spec 00, Data & Interfaces; architecture §9).
 *
 * `loadConfig(env)` validates an environment map and returns a frozen `Config`, or throws a
 * single `ConfigError` listing every problem. `getConfig()` memoises `loadConfig(process.env)`.
 * Nothing calls `getConfig()` at startup yet; that wiring arrives with its first caller (Phase 8).
 */

export type Config = Readonly<{
  storageDriver: 'memory' | 'file' | 'blob';
  fileStoreDir: string;
  blobStoreId?: string;
  vercelOidcToken?: string;
  blobReadWriteToken?: string;
  defaultRulesPreset: 'argentina-fidepo' | 'spain-ludoteka' | 'gamerules' | 'mexico-bazas';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  retentionDays: number;
  cronSecret?: string;
  vercelEnv?: 'development' | 'preview' | 'production';
}>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const STORAGE_DRIVERS = ['memory', 'file', 'blob'] as const;
const RULES_PRESETS = ['argentina-fidepo', 'spain-ludoteka', 'gamerules', 'mexico-bazas'] as const;
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const VERCEL_ENVS = ['development', 'preview', 'production'] as const;

const ENV_VARS = [
  'STORAGE_DRIVER',
  'FILE_STORE_DIR',
  'BLOB_STORE_ID',
  'VERCEL_OIDC_TOKEN',
  'BLOB_READ_WRITE_TOKEN',
  'DEFAULT_RULES_PRESET',
  'LOG_LEVEL',
  'RETENTION_DAYS',
  'CRON_SECRET',
  'VERCEL_ENV',
  'VERCEL',
] as const;

type EnvVar = (typeof ENV_VARS)[number];

/**
 * Fixed per-variable problem descriptions. Error messages are built only from these, never from
 * Zod's messages or the received values, so no secret can leak into a `ConfigError` (FR-027).
 */
const PROBLEMS: Partial<Record<EnvVar, string>> = {
  STORAGE_DRIVER: `must be one of ${STORAGE_DRIVERS.join(', ')}`,
  DEFAULT_RULES_PRESET: `must be one of ${RULES_PRESETS.join(', ')}`,
  LOG_LEVEL: `must be one of ${LOG_LEVELS.join(', ')}`,
  RETENTION_DAYS: 'must be a decimal integer (digits only) between 1 and 3650',
  VERCEL_ENV: `must be one of ${VERCEL_ENVS.join(', ')}`,
};

const CRON_SECRET_PROBLEM = 'is required when VERCEL_ENV is preview or production';

// Keys are environment variable names, so every Zod issue path names the variable directly.
// Inputs are already normalised: an empty string has been turned into `undefined`.
const envSchema = z.object({
  STORAGE_DRIVER: z.enum(STORAGE_DRIVERS).optional(),
  FILE_STORE_DIR: z.string().default('.data/'),
  BLOB_STORE_ID: z.string().optional(),
  VERCEL_OIDC_TOKEN: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  DEFAULT_RULES_PRESET: z.enum(RULES_PRESETS).default('argentina-fidepo'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  RETENTION_DAYS: z
    .string()
    .regex(/^[0-9]+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(3650))
    .default(365),
  CRON_SECRET: z.string().optional(),
  VERCEL_ENV: z.enum(VERCEL_ENVS).optional(),
  VERCEL: z.string().optional(),
});

function normalise(env: Record<string, string | undefined>): Record<EnvVar, string | undefined> {
  const out = {} as Record<EnvVar, string | undefined>;
  for (const name of ENV_VARS) {
    const value = env[name];
    out[name] = value === '' ? undefined : value;
  }
  return out;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const input = normalise(env);
  const problems = new Map<string, string>();

  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = String(issue.path[0]) as EnvVar;
      if (!problems.has(name)) problems.set(name, PROBLEMS[name] ?? 'is invalid');
    }
  }

  // Cross-field rule, checked on the normalised input so it runs even when other fields fail.
  const needsCronSecret = input.VERCEL_ENV === 'preview' || input.VERCEL_ENV === 'production';
  if (needsCronSecret && input.CRON_SECRET === undefined) {
    problems.set('CRON_SECRET', CRON_SECRET_PROBLEM);
  }

  if (!parsed.success || problems.size > 0) {
    const lines = [...problems].map(([name, problem]) => `  - ${name} ${problem}`);
    throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }

  const e = parsed.data;
  return Object.freeze({
    storageDriver: e.STORAGE_DRIVER ?? (e.VERCEL === '1' ? 'blob' : 'file'),
    fileStoreDir: e.FILE_STORE_DIR,
    blobStoreId: e.BLOB_STORE_ID,
    vercelOidcToken: e.VERCEL_OIDC_TOKEN,
    blobReadWriteToken: e.BLOB_READ_WRITE_TOKEN,
    defaultRulesPreset: e.DEFAULT_RULES_PRESET,
    logLevel: e.LOG_LEVEL,
    retentionDays: e.RETENTION_DAYS,
    cronSecret: e.CRON_SECRET,
    vercelEnv: e.VERCEL_ENV,
  });
}

let cached: Config | undefined;

/** Returns `loadConfig(process.env)`, memoised after the first success. Errors are not cached. */
export function getConfig(): Config {
  cached ??= loadConfig(process.env);
  return cached;
}
