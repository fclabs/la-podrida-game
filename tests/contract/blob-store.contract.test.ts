// ObjectStore contract run against VercelBlobObjectStore (spec 05 FR-513, FR-515; VC-516).
// Skipped (reported as skipped) unless BLOB_READ_WRITE_TOKEN is set; it then talks to a real
// store. Every test gets its own `contract/<runId>/<testId>/` namespace through
// `PrefixedObjectStore`, and `afterAll` deletes everything under `contract/<runId>/`.
//
//   BLOB_READ_WRITE_TOKEN=… pnpm vitest run tests/contract/blob-store.contract.test.ts
import { randomUUID } from 'node:crypto';
import { afterAll, describe } from 'vitest';
import { VercelBlobObjectStore } from '@/src/storage/vercel-blob-store';
import { runObjectStoreContract } from './object-store.contract';
import { PrefixedObjectStore } from './prefixed-store';

const token = process.env.BLOB_READ_WRITE_TOKEN;
const runPrefix = `contract/${randomUUID()}/`;

describe.skipIf(!token)('Vercel Blob (real store)', () => {
  const blobStore = new VercelBlobObjectStore({ token });

  afterAll(async () => {
    // List every page first, then delete page by page, so deletes never disturb the cursor.
    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = await blobStore.list(runPrefix, { cursor });
      pages.push(page.keys);
      cursor = page.cursor;
    } while (cursor !== undefined);
    for (const keys of pages) await blobStore.delete(keys);
  }, 120_000);

  runObjectStoreContract(
    'blob',
    async () => ({
      store: new PrefixedObjectStore(blobStore, `${runPrefix}${randomUUID()}/`),
      cleanup: async () => {},
    }),
    { exactCursor: false },
  );
});
