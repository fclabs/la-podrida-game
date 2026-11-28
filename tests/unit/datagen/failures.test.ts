// Failure handling and test hooks through the real worker pool (spec 12 VC-1221..1226, 1229 second
// half, 1247, 1251, 1253; FR-1217). Games are played by real workers; hooks come from
// `fixtures/hooks-configurable.ts`, configured with environment variables (plan I-4).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadHooks } from '../../../scripts/datagen/hooks';
import { cleanupShardFiles } from '../../../scripts/datagen/run';
import { ManifestSchema, type Manifest } from '../../../scripts/datagen/schema';
import { makeTempDir, runCli } from './helpers';

const T = 120_000;
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures');
const CONFIGURABLE = path.join(FIXTURES, 'hooks-configurable.ts');
const EMPTY = path.join(FIXTURES, 'hooks-empty.ts');

function readRunManifest(out: string, runId: string): Manifest {
  return ManifestSchema.parse(
    JSON.parse(readFileSync(path.join(out, runId, 'manifest.json'), 'utf8')),
  );
}

function shardFiles(out: string, runId: string): string[] {
  const dir = path.join(out, runId, 'shards');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function failedError(manifest: Manifest, shard: number): { seed: string | null; message: string } {
  const entry = manifest.shards[shard];
  if (entry.status !== 'failed') throw new Error(`shard ${shard} is ${entry.status}`);
  return entry.error;
}

function lines(file: string): string[] {
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
}

function dataset(out: string, runId: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of shardFiles(out, runId)) {
    result[name] = gunzipSync(readFileSync(path.join(out, runId, 'shards', name))).toString('utf8');
  }
  return result;
}

/** Runs a single-shard run where game `index` (seed `f-0-<index>`) is hit by `HOOK_MODE`. */
async function failingGame(mode: string, index = 2, extra: Record<string, string> = {}) {
  const out = makeTempDir();
  const result = await runCli(
    ['run', '--run-id', 'f', '--games', '6', '--shard-size', '6', '--workers', '1', '--out', out],
    {
      env: {
        GENERATE_DATA_TEST_HOOKS: CONFIGURABLE,
        HOOK_FAIL_SEED: `f-0-${index}`,
        HOOK_MODE: mode,
        ...extra,
      },
    },
  );
  const manifest = readRunManifest(out, 'f');
  return { out, result, manifest, error: failedError(manifest, 0), seed: `f-0-${index}` };
}

function expectCleanFailure(r: Awaited<ReturnType<typeof failingGame>>): void {
  expect(r.result.code).toBe(1);
  expect(r.error.seed).toBe(r.seed);
  expect(shardFiles(r.out, 'f')).toEqual([]);
  expect(r.result.stdout).toContain('shards: 0 complete (0 skipped, 1 failed)');
}

describe('game failures mark the shard failed (FR-1217)', () => {
  it(
    'VC-1221: a non-game-over state fails the game',
    async () => {
      const r = await failingGame('not-game-over');
      expectCleanFailure(r);
      expect(r.error.message).toMatch(/check 1/);
    },
    T,
  );

  it(
    'VC-1222: a dropped decisions row fails the row-count check',
    async () => {
      const r = await failingGame('drop-decision');
      expectCleanFailure(r);
      expect(r.error.message).toMatch(/check 3/);
    },
    T,
  );

  it.each([
    ['points', 'check 5'],
    ['tricks', 'check 4'],
    ['drop-hand', 'check 2'],
  ])(
    'VC-1223: transformRows %s fails %s',
    async (mode, check) => {
      const r = await failingGame(mode);
      expectCleanFailure(r);
      expect(r.error.message).toContain(check);
    },
    T,
  );

  it(
    'VC-1224: a differing replay names the first differing step',
    async () => {
      const r = await failingGame('replay-differ', 0, { HOOK_REPLAY_LOG: '/dev/null' });
      expectCleanFailure(r);
      expect(r.error.message).toMatch(/replay: step 1 differs/);
    },
    T,
  );

  it(
    'VC-1224: replays happen for indices 0, 100, 200 by default and for all with --replay-every 1',
    async () => {
      const out = makeTempDir();
      const log = path.join(out, 'replays.log');
      const env = { GENERATE_DATA_TEST_HOOKS: CONFIGURABLE, HOOK_REPLAY_LOG: log };
      const first = await runCli(
        ['run', '--run-id', 'r', '--games', '201', '--shard-size', '201', '--out', out],
        { env },
      );
      expect(first.code).toBe(0);
      expect(lines(log)).toEqual(['r-0-0', 'r-0-100', 'r-0-200']);

      const out2 = makeTempDir();
      const log2 = path.join(out2, 'replays.log');
      const second = await runCli(
        [
          'run',
          '--run-id',
          'r',
          '--games',
          '12',
          '--shard-size',
          '6',
          '--out',
          out2,
          '--replay-every',
          '1',
        ],
        { env: { ...env, HOOK_REPLAY_LOG: log2 } },
      );
      expect(second.code).toBe(0);
      const expected = [0, 1].flatMap((s) => Array.from({ length: 6 }, (_, i) => `r-${s}-${i}`));
      expect(lines(log2).sort()).toEqual(expected.sort());
    },
    T,
  );

  it(
    'VC-1225: only the failing shard of 3 is failed and cleaned up',
    async () => {
      const out = makeTempDir();
      const result = await runCli(
        [
          'run',
          '--run-id',
          'p',
          '--games',
          '6',
          '--shard-size',
          '2',
          '--workers',
          '2',
          '--out',
          out,
        ],
        {
          env: {
            GENERATE_DATA_TEST_HOOKS: CONFIGURABLE,
            HOOK_FAIL_SEED: 'p-1-1',
            HOOK_MODE: 'drop-decision',
          },
        },
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('shards: 2 complete (0 skipped, 1 failed)');
      const manifest = readRunManifest(out, 'p');
      expect(manifest.shards.map((s) => s.status)).toEqual(['complete', 'failed', 'complete']);
      expect(failedError(manifest, 1).seed).toBe('p-1-1');
      expect(shardFiles(out, 'p')).toEqual(
        ['00000', '00002'].flatMap((n) =>
          ['decisions', 'games', 'hands'].map((t) => `shard-${n}.${t}.jsonl.gz`),
        ),
      );
    },
    T,
  );

  it.each([
    ['limit', 'AI loop limit reached'],
    ['illegal', 'Illegal move "bid:99"'],
  ])(
    'VC-1247: a thrown %s error fails the shard at game 3 and stops it',
    async (mode, text) => {
      const out = makeTempDir();
      const calls = path.join(out, 'calls.log');
      const r = await failingGame(mode, 3, { HOOK_CALLS_LOG: calls });
      expectCleanFailure(r);
      expect(r.error.message).toContain(text);
      expect(lines(calls)).toEqual(['f-0-0', 'f-0-1', 'f-0-2', 'f-0-3']);
    },
    T,
  );
});

describe('dying workers', () => {
  it(
    'VC-1226: a worker that exits on shard 1 start fails it with seed null; the others finish',
    async () => {
      const out = makeTempDir();
      const result = await runCli(
        [
          'run',
          '--run-id',
          'x',
          '--games',
          '6',
          '--shard-size',
          '2',
          '--workers',
          '1',
          '--out',
          out,
        ],
        { env: { GENERATE_DATA_TEST_HOOKS: CONFIGURABLE, HOOK_EXIT_SHARD: '1' } },
      );
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('shards: 2 complete (0 skipped, 1 failed)');
      const manifest = readRunManifest(out, 'x');
      expect(manifest.shards.map((s) => s.status)).toEqual(['complete', 'failed', 'complete']);
      expect(failedError(manifest, 1).seed).toBeNull();
      expect(failedError(manifest, 1).message).toMatch(/worker exited unexpectedly \(code 1\)/);
      expect(shardFiles(out, 'x').filter((n) => n.startsWith('shard-00001'))).toEqual([]);
    },
    T,
  );
});

describe('hooks and the manifest', () => {
  it(
    'VC-1229 (second half): --workers 2 never overlaps more than 2 shards, each shard once',
    async () => {
      const out = makeTempDir();
      const log = path.join(out, 'times.log');
      const result = await runCli(
        [
          'run',
          '--run-id',
          'w',
          '--games',
          '12',
          '--shard-size',
          '2',
          '--workers',
          '2',
          '--out',
          out,
        ],
        { env: { GENERATE_DATA_TEST_HOOKS: CONFIGURABLE, HOOK_TIMES_LOG: log } },
      );
      expect(result.code).toBe(0);
      const events = lines(log).map((l) => {
        const [shard, phase, time] = l.split(' ');
        return { shard: Number(shard), phase, time: Number(time) };
      });
      for (let s = 0; s < 6; s++) {
        expect(events.filter((e) => e.shard === s).map((e) => e.phase)).toEqual(['start', 'end']);
      }
      // Sweep the events in time order (an end before a start at equal times: a worker logs its end before it gets its next shard) counting open shards.
      const ordered = [...events].sort(
        (a, b) => a.time - b.time || Number(a.phase === 'start') - Number(b.phase === 'start'),
      );
      let open = 0;
      let max = 0;
      for (const e of ordered) {
        open += e.phase === 'start' ? 1 : -1;
        max = Math.max(max, open);
      }
      expect(max).toBeLessThanOrEqual(2);
    },
    T,
  );

  it(
    'VC-1251: a manifest deleted during a shard is recreated by the main thread',
    async () => {
      const out = makeTempDir();
      const manifestPath = path.join(out, 'm', 'manifest.json');
      const result = await runCli(
        [
          'run',
          '--run-id',
          'm',
          '--games',
          '4',
          '--shard-size',
          '2',
          '--workers',
          '1',
          '--out',
          out,
        ],
        { env: { GENERATE_DATA_TEST_HOOKS: CONFIGURABLE, HOOK_MANIFEST_PATH: manifestPath } },
      );
      expect(result.code).toBe(0);
      expect(readRunManifest(out, 'm').shards.map((s) => s.status)).toEqual([
        'complete',
        'complete',
      ]);
    },
    T,
  );

  it('VC-1251: worker.ts never mentions the manifest', () => {
    const source = readFileSync(
      path.resolve(FIXTURES, '../../../../scripts/datagen/worker.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/manifest/);
  });

  it(
    'VC-1253: an unset hook variable and a hook module without hooks give the same dataset',
    async () => {
      const args = (out: string) => [
        'run',
        '--run-id',
        'e',
        '--games',
        '20',
        '--shard-size',
        '10',
        '--out',
        out,
      ];
      const a = makeTempDir();
      const b = makeTempDir();
      expect((await runCli(args(a))).code).toBe(0);
      expect((await runCli(args(b), { env: { GENERATE_DATA_TEST_HOOKS: EMPTY } })).code).toBe(0);
      expect(dataset(b, 'e')).toEqual(dataset(a, 'e'));
      expect(Object.keys(dataset(a, 'e'))).toHaveLength(6);
    },
    T,
  );
});

describe('loadHooks', () => {
  it('returns no hooks when the variable is unset or empty', async () => {
    expect(await loadHooks({})).toEqual({ hooks: {} });
    expect(await loadHooks({ GENERATE_DATA_TEST_HOOKS: '' })).toEqual({ hooks: {} });
  });

  it('wraps the factories into plain functions and ignores missing ones', async () => {
    const loaded = await loadHooks({ GENERATE_DATA_TEST_HOOKS: CONFIGURABLE });
    expect(typeof loaded.hooks.runAiLoop).toBe('function');
    expect(typeof loaded.hooks.replayRunAiLoop).toBe('function');
    expect(typeof loaded.hooks.transformRows).toBe('function');
    expect(typeof loaded.onShard).toBe('function');
    const none = await loadHooks({ GENERATE_DATA_TEST_HOOKS: EMPTY });
    expect(none.hooks).toEqual({});
    expect(none.onShard).toBeUndefined();
  });
});

describe('cleanupShardFiles', () => {
  it('deletes final and .tmp files of the shard only, ignoring missing ones', async () => {
    const dir = makeTempDir();
    const shards = path.join(dir, 'shards');
    mkdirSync(shards);
    const names = [
      'shard-00001.games.jsonl.gz',
      'shard-00001.hands.jsonl.gz.tmp',
      'shard-00001.decisions.jsonl.gz',
      'shard-00002.games.jsonl.gz',
    ];
    for (const n of names) writeFileSync(path.join(shards, n), 'x');
    expect(await cleanupShardFiles(dir, 1)).toBeNull();
    expect(readdirSync(shards)).toEqual(['shard-00002.games.jsonl.gz']);
  });

  it('reports a file it cannot delete and still deletes the others', async () => {
    const dir = makeTempDir();
    const shards = path.join(dir, 'shards');
    mkdirSync(path.join(shards, 'shard-00001.games.jsonl.gz'), { recursive: true }); // a directory
    writeFileSync(path.join(shards, 'shard-00001.hands.jsonl.gz'), 'x');
    const problem = await cleanupShardFiles(dir, 1);
    expect(problem).not.toBeNull();
    expect(readdirSync(shards)).toEqual(['shard-00001.games.jsonl.gz']);
  });
});
