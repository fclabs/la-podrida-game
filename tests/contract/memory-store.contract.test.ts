// ObjectStore contract run against MemoryObjectStore (spec 05 FR-515), a fresh store per test.
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { runObjectStoreContract } from './object-store.contract';

runObjectStoreContract(
  'memory',
  async () => ({ store: new MemoryObjectStore(), cleanup: async () => {} }),
  { exactCursor: true },
);
