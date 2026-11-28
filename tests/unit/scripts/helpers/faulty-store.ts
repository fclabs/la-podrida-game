// Test helper: wraps any ObjectStore and replaces chosen methods to model a misbehaving store.
// `faultyStore(base, (inner) => ({ put: ... }))`: methods not returned delegate to `base`; the
// override receives the untouched `inner` store so it can fall through selectively.
import type { ObjectStore } from '@/src/storage/object-store';

export function faultyStore(
  base: ObjectStore,
  overrides: (inner: ObjectStore) => Partial<ObjectStore>,
): ObjectStore {
  const patch = overrides(base);
  return {
    get: patch.get ?? ((key) => base.get(key)),
    put: patch.put ?? ((key, body, opts) => base.put(key, body, opts)),
    exists: patch.exists ?? ((key) => base.exists(key)),
    list: patch.list ?? ((prefix, opts) => base.list(prefix, opts)),
    delete: patch.delete ?? ((keys) => base.delete(keys)),
  };
}
