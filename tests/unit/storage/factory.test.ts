// createObjectStore (spec 05 FR-514; VC-515). The Blob SDK is mocked (plan P-14), so the token
// checks inspect the options of a stubbed `get` and never reach the network.
import { get } from '@vercel/blob';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, loadConfig } from '@/src/config';
import { createObjectStore } from '@/src/storage';
import { FileObjectStore } from '@/src/storage/file-store';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { VercelBlobObjectStore } from '@/src/storage/vercel-blob-store';

vi.mock('@vercel/blob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@vercel/blob')>()),
  put: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
}));

const getMock = vi.mocked(get);

beforeEach(() => {
  vi.resetAllMocks();
  getMock.mockResolvedValue(null);
});

describe('VC-515 memory', () => {
  it('returns the same MemoryObjectStore instance on every call', () => {
    const config = loadConfig({ STORAGE_DRIVER: 'memory' });
    const first = createObjectStore(config);
    expect(first).toBeInstanceOf(MemoryObjectStore);
    expect(createObjectStore(config)).toBe(first);
    expect(createObjectStore(loadConfig({ STORAGE_DRIVER: 'memory' }))).toBe(first);
  });
});

describe('VC-515 file', () => {
  it('returns a FileObjectStore and creates nothing', () => {
    const store = createObjectStore(loadConfig({ STORAGE_DRIVER: 'file', FILE_STORE_DIR: 'x' }));
    expect(store).toBeInstanceOf(FileObjectStore);
  });

  it('returns a new FileObjectStore per call', () => {
    const config = loadConfig({ STORAGE_DRIVER: 'file', FILE_STORE_DIR: 'x' });
    expect(createObjectStore(config)).not.toBe(createObjectStore(config));
  });
});

describe('VC-515 blob', () => {
  it('with BLOB_READ_WRITE_TOKEN → SDK calls receive that token', async () => {
    const store = createObjectStore(
      loadConfig({ STORAGE_DRIVER: 'blob', BLOB_READ_WRITE_TOKEN: 'tok' }),
    );
    expect(store).toBeInstanceOf(VercelBlobObjectStore);
    await store.get('k');
    expect(getMock.mock.calls[0]![1]).toMatchObject({ token: 'tok' });
  });

  it('the read-write token wins when BLOB_STORE_ID is also set', async () => {
    const store = createObjectStore(
      loadConfig({ STORAGE_DRIVER: 'blob', BLOB_READ_WRITE_TOKEN: 'tok', BLOB_STORE_ID: 'st' }),
    );
    await store.get('k');
    expect(getMock.mock.calls[0]![1]).toMatchObject({ token: 'tok' });
  });

  it('with only BLOB_STORE_ID (no VERCEL_OIDC_TOKEN) → SDK calls receive no token', async () => {
    const store = createObjectStore(loadConfig({ STORAGE_DRIVER: 'blob', BLOB_STORE_ID: 'st' }));
    expect(store).toBeInstanceOf(VercelBlobObjectStore);
    await store.get('k');
    expect(getMock.mock.calls[0]![1]).not.toHaveProperty('token');
  });

  it.each([
    ['only VERCEL_OIDC_TOKEN', { VERCEL_OIDC_TOKEN: 'oidc-123' }],
    ['no Blob credentials', {}],
  ])('with %s → ConfigError naming both variables, no values', (_name, extra) => {
    const config = loadConfig({ STORAGE_DRIVER: 'blob', ...extra });
    let error: unknown;
    try {
      createObjectStore(config);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain('BLOB_READ_WRITE_TOKEN');
    expect(message).toContain('BLOB_STORE_ID');
    expect(message).not.toContain('oidc-123');
    expect(getMock).not.toHaveBeenCalled();
  });
});
