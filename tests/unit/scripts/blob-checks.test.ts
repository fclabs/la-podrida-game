// blob-checks (spec 11 FR-1107..FR-1111; VC-1107..VC-1111, logic only: no real store).
import { describe, expect, it } from 'vitest';
import { runBlobChecks, runCli } from '@/scripts/blob-checks';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { ObjectExistsError, type ObjectStore } from '@/src/storage/object-store';
import { faultyStore } from './helpers/faulty-store';

const RUN_ID = 'run-test';
const base = { runId: RUN_ID } as const;

async function leftover(store: ObjectStore): Promise<string[]> {
  return (await store.list(`checks/${RUN_ID}/`)).keys;
}

describe('VC-1107 exclusivity', () => {
  it('a correct store has no violations over 20 rounds x 10 writers', async () => {
    const store = new MemoryObjectStore();
    const result = await runBlobChecks(store, { ...base, rounds: 20, writers: 10 });
    expect(result.exclusivity).toEqual({ violations: 0, zeroWinnerRounds: 0, passed: true });
    expect(result.passed).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('a store whose create-only put never rejects shows violations and fails', async () => {
    const store = faultyStore(new MemoryObjectStore(), (inner) => ({
      put: (key, body, opts) => inner.put(key, body, { ...opts, mode: 'overwrite' }),
    }));
    const result = await runBlobChecks(store, { ...base, rounds: 5, writers: 4 });
    expect(result.exclusivity.violations).toBeGreaterThan(0);
    expect(result.exclusivity.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('a store that stores a different body than the winner wrote is a violation', async () => {
    const store = faultyStore(new MemoryObjectStore(), (inner) => ({
      get: async (key) => {
        const found = await inner.get(key);
        return key.includes('/excl/') && found
          ? { body: new TextEncoder().encode('other') }
          : found;
      },
    }));
    const result = await runBlobChecks(store, { ...base, rounds: 3, writers: 3 });
    expect(result.exclusivity.violations).toBe(3);
  });

  it('rounds where every writer is rejected count as zero-winner, not violations', async () => {
    const inner = new MemoryObjectStore();
    const store = faultyStore(inner, (i) => ({
      put: async (key, body, opts) => {
        if (key.includes('/excl/')) {
          await i.put(key, body, opts).catch(() => undefined);
          throw new ObjectExistsError(key);
        }
        return i.put(key, body, opts);
      },
    }));
    const result = await runBlobChecks(store, { ...base, rounds: 4, writers: 3 });
    expect(result.exclusivity.zeroWinnerRounds).toBe(4);
    expect(result.exclusivity.violations).toBe(0);
    expect(result.passed).toBe(true);
  });

  it('a losing writer rejecting with another error is an unexpected error', async () => {
    let calls = 0;
    const store = faultyStore(new MemoryObjectStore(), (inner) => ({
      put: async (key, body, opts) => {
        calls += 1;
        if (key.includes('/excl/') && calls === 2) throw new Error('boom');
        return inner.put(key, body, opts);
      },
    }));
    const result = await runBlobChecks(store, { ...base, rounds: 2, writers: 3 });
    expect(result.passed).toBe(false);
    expect(result.error).toEqual({ name: 'Error', message: 'boom' });
  });
});

describe('VC-1108 consistent reads', () => {
  it('a correct store has no false-missing and no stale reads', async () => {
    const result = await runBlobChecks(new MemoryObjectStore(), { ...base, rounds: 7, writers: 2 });
    expect(result.consistency).toEqual({
      createThenGet: { n: 7, falseMissing: 0 },
      overwriteThenGet: { n: 7, stale: 0 },
      passed: true,
    });
  });

  it('a get that returns null right after a create counts as falseMissing', async () => {
    const store = faultyStore(new MemoryObjectStore(), (inner) => ({
      get: async (key) => (key.includes('/create/') ? null : inner.get(key)),
    }));
    const result = await runBlobChecks(store, { ...base, rounds: 5, writers: 2 });
    expect(result.consistency.createThenGet.falseMissing).toBe(5);
    expect(result.consistency.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('an overwrite read back stale counts as stale', async () => {
    const store = faultyStore(new MemoryObjectStore(), (inner) => ({
      put: async (key, body, opts) => {
        if (opts?.mode === 'overwrite' && key.includes('/overwrite/')) return; // dropped write
        return inner.put(key, body, opts);
      },
    }));
    const result = await runBlobChecks(store, { ...base, rounds: 5, writers: 2 });
    expect(result.consistency.overwriteThenGet).toEqual({ n: 5, stale: 5 });
    expect(result.passed).toBe(false);
  });
});

describe('VC-1109 listing and delete', () => {
  it('the memory store lists 25 keys in order and deletes them all', async () => {
    const result = await runBlobChecks(new MemoryObjectStore(), { ...base, rounds: 1, writers: 1 });
    expect(result.listing).toEqual({ keys: 25, pageSize: 10, ordered: true, passed: true });
    expect(result.delete).toEqual({ remaining: 0, passed: true });
  });

  it('a store that lists each page in descending order is not ordered', async () => {
    const store = faultyStore(new MemoryObjectStore(), (inner) => ({
      list: async (prefix, opts) => {
        const page = await inner.list(prefix, opts);
        return { ...page, keys: [...page.keys].reverse() };
      },
    }));
    const result = await runBlobChecks(store, { ...base, rounds: 1, writers: 1 });
    expect(result.listing.ordered).toBe(false);
    expect(result.listing.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('a listing that returns fewer than 25 keys fails listing.passed (stricter reading)', async () => {
    const store = faultyStore(new MemoryObjectStore(), (inner) => ({
      list: async (prefix, opts) =>
        prefix.endsWith('/list/') ? { keys: [] } : inner.list(prefix, opts),
    }));
    const result = await runBlobChecks(store, { ...base, rounds: 1, writers: 1 });
    expect(result.listing).toMatchObject({ keys: 0, ordered: true, passed: false });
  });

  it('a delete that does nothing leaves remaining keys', async () => {
    const store = faultyStore(new MemoryObjectStore(), () => ({ delete: async () => undefined }));
    const result = await runBlobChecks(store, { ...base, rounds: 1, writers: 1 });
    expect(result.delete.remaining).toBe(25);
    expect(result.delete.passed).toBe(false);
    expect(result.passed).toBe(false);
  });
});

describe('VC-1111 cleanup', () => {
  it('leaves no key under checks/<runId>/ after a normal run', async () => {
    const store = new MemoryObjectStore();
    await runBlobChecks(store, { ...base, rounds: 5, writers: 3 });
    expect(await leftover(store)).toEqual([]);
  });

  it('leaves no key after a run aborted by an injected error', async () => {
    const inner = new MemoryObjectStore();
    let puts = 0;
    const store = faultyStore(inner, (i) => ({
      put: async (key, body, opts) => {
        puts += 1;
        if (puts === 30) throw new Error('injected');
        return i.put(key, body, opts);
      },
    }));
    const result = await runBlobChecks(store, { ...base, rounds: 5, writers: 3 });
    expect(result.error?.message).toBe('injected');
    expect(result.passed).toBe(false);
    expect(puts).toBeGreaterThan(5);
    expect(await leftover(inner)).toEqual([]);
  });

  it('leaves no key after an abort signal and reports the interruption', async () => {
    const inner = new MemoryObjectStore();
    const controller = new AbortController();
    let puts = 0;
    const store = faultyStore(inner, (i) => ({
      put: async (key, body, opts) => {
        puts += 1;
        if (puts === 12) controller.abort();
        return i.put(key, body, opts);
      },
    }));
    const result = await runBlobChecks(store, {
      ...base,
      rounds: 5,
      writers: 3,
      signal: controller.signal,
    });
    expect(result.error?.name).toBe('InterruptedError');
    expect(result.passed).toBe(false);
    expect(await leftover(inner)).toEqual([]);
  });

  it('reports a CleanupError when keys cannot be removed', async () => {
    const store = faultyStore(new MemoryObjectStore(), () => ({ delete: async () => undefined }));
    const result = await runBlobChecks(store, { ...base, rounds: 1, writers: 1 });
    expect(result.error?.name).toBe('CleanupError');
    expect(result.passed).toBe(false);
  });
});

describe('VC-1110 command line', () => {
  const TOKEN = 'vercel_blob_rw_FAKE_TOKEN_abc123';

  function harness(env: Record<string, string | undefined>, store?: ObjectStore) {
    const out: string[] = [];
    const err: string[] = [];
    const deps = {
      env,
      io: { stdout: (l: string) => out.push(l), stderr: (l: string) => err.push(l) },
      makeStore: () => store ?? new MemoryObjectStore(),
      runId: RUN_ID,
    };
    return { out, err, deps };
  }

  it('--rounds 0 exits 2 with one stderr line and no stdout', async () => {
    const h = harness({ BLOB_READ_WRITE_TOKEN: TOKEN });
    expect(await runCli(['--rounds', '0'], h.deps)).toBe(2);
    expect(h.err).toHaveLength(1);
    expect(h.err[0]).toContain('--rounds');
    expect(h.out).toEqual([]);
    expect(h.out.join() + h.err.join()).not.toContain(TOKEN);
  });

  it('a missing token exits 2 with one line naming the variable', async () => {
    for (const env of [{}, { BLOB_READ_WRITE_TOKEN: '' }]) {
      const h = harness(env);
      expect(await runCli([], h.deps)).toBe(2);
      expect(h.err).toHaveLength(1);
      expect(h.err[0]).toContain('BLOB_READ_WRITE_TOKEN');
      expect(h.out).toEqual([]);
    }
  });

  it('an unknown option exits 2 and a token is never echoed', async () => {
    const h = harness({ BLOB_READ_WRITE_TOKEN: TOKEN });
    expect(await runCli(['--bogus', TOKEN], h.deps)).toBe(2);
    expect(h.err).toHaveLength(1);
    expect((h.out.join() + h.err.join()).includes(TOKEN)).toBe(false);
  });

  it('a normal run prints the run id to stderr, one JSON line to stdout and exits 0', async () => {
    const h = harness({ BLOB_READ_WRITE_TOKEN: TOKEN });
    expect(await runCli(['--rounds', '3', '--writers', '4'], h.deps)).toBe(0);
    expect(h.err).toEqual([`blob-checks run ${RUN_ID}`]);
    expect(h.out).toHaveLength(1);
    const line = JSON.parse(h.out[0]);
    expect(Object.keys(line)).toEqual([
      'check',
      'runId',
      'startedAt',
      'rounds',
      'writers',
      'exclusivity',
      'consistency',
      'listing',
      'delete',
      'passed',
      'durationMs',
    ]);
    expect(line).toMatchObject({
      check: 'blob-checks',
      runId: RUN_ID,
      rounds: 3,
      writers: 4,
      passed: true,
    });
    expect(h.out.join() + h.err.join()).not.toContain(TOKEN);
  });

  it('a forced store error exits 1 with passed false, an error field and every section', async () => {
    const store = faultyStore(new MemoryObjectStore(), () => ({
      put: async () => {
        throw new Error(`auth failed for ${TOKEN}\nsecond line ${'x'.repeat(400)}`);
      },
      list: async () => {
        throw new Error(`list failed ${TOKEN}`);
      },
    }));
    const h = harness({ BLOB_READ_WRITE_TOKEN: TOKEN }, store);
    expect(await runCli([], h.deps)).toBe(1);
    expect(h.out).toHaveLength(1);
    const line = JSON.parse(h.out[0]);
    expect(line.passed).toBe(false);
    expect(line.error.name).toBe('Error');
    expect(line.error.message.length).toBeLessThanOrEqual(200);
    expect(line.error.message).not.toContain('\n');
    for (const section of ['exclusivity', 'consistency', 'listing', 'delete']) {
      expect(line[section]).toBeDefined();
    }
    expect(line.consistency.createThenGet).toEqual({ n: 0, falseMissing: 0 });
    expect(h.out.join() + h.err.join()).not.toContain(TOKEN);
  });
});
