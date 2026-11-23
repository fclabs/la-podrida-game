// ObjectStore contract run against FileObjectStore (spec 05 FR-512, FR-515): a fresh
// `fs.mkdtemp` folder under `os.tmpdir()` per test, removed afterwards.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FileObjectStore } from '@/src/storage/file-store';
import { runObjectStoreContract } from './object-store.contract';

runObjectStoreContract(
  'file',
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lp-store-'));
    return {
      store: new FileObjectStore(root),
      cleanup: () => fs.rm(root, { recursive: true, force: true }),
    };
  },
  { exactCursor: true },
);
