import { ConfigError, type Config } from '@/src/config';
import { FileObjectStore } from './file-store';
import { MemoryObjectStore } from './memory-store';
import type { ObjectStore } from './object-store';
import { VercelBlobObjectStore } from './vercel-blob-store';

/** The process-wide memory store: every `memory` call shares it (FR-514). */
let memoryStore: MemoryObjectStore | undefined;

/**
 * Builds the store selected by `config.storageDriver` (FR-514). For `blob`, a read-write token
 * wins; otherwise `BLOB_STORE_ID` selects the SDK's own OIDC authentication. Throws `ConfigError`
 * when `blob` has neither; the message names the variables, never their values.
 */
export function createObjectStore(config: Config): ObjectStore {
  switch (config.storageDriver) {
    case 'memory':
      memoryStore ??= new MemoryObjectStore();
      return memoryStore;
    case 'file':
      return new FileObjectStore(config.fileStoreDir);
    case 'blob':
      if (config.blobReadWriteToken !== undefined) {
        return new VercelBlobObjectStore({ token: config.blobReadWriteToken });
      }
      if (config.blobStoreId !== undefined) return new VercelBlobObjectStore();
      throw new ConfigError(
        'Invalid configuration:\n  - BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID is required when STORAGE_DRIVER is blob',
      );
  }
}
