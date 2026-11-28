// `run` command tests (spec 12 VC-1201, 1203, 1204, 1205, 1227, 1228, 1229, 1232, 1249 at CLI level).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { newManifest } from '../../../scripts/datagen/manifest';
import { formatSummary, oneDecimal } from '../../../scripts/datagen/run';
import { ManifestSchema, type Manifest } from '../../../scripts/datagen/schema';
import { SHARD_TABLES } from '../../../scripts/datagen/manifest';
import { makeTempDir, runCli } from './helpers';

const T = 120_000;

function readRunManifest(out: string, runId: string): Manifest {
  return ManifestSchema.parse(
    JSON.parse(readFileSync(path.join(out, runId, 'manifest.json'), 'utf8')),
  );
}

function gunzipLines(file: string): string[] {
  const text = gunzipSync(readFileSync(file)).toString('utf8');
  return text === '' ? [] : text.replace(/\n$/, '').split('\n');
}

function allFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name));
}

/** Every shard file of a run: relative name -> decompressed text. */
function dataset(out: string, runId: string): Record<string, string> {
  const dir = path.join(out, runId, 'shards');
  const result: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    result[name] = gunzipSync(readFileSync(path.join(dir, name))).toString('utf8');
  }
  return result;
}

describe('summary formatting', () => {
  it('formats the four lines with plain integers and one decimal', () => {
    const manifest = newManifest({
      run_id: 'sm',
      params: {
        preset: 'argentina-fidepo',
        players: 3,
        games: 20,
        shard_size: 10,
        strategies: ['random', 'random', 'random'],
        replay_every: 100,
      },
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const file = (rows: number, bytes: number) => ({ path: 'x', rows, bytes, sha256: 'a' });
    manifest.shards[0] = {
      shard: 0,
      games: 10,
      status: 'complete',
      git_commit: 'c',
      git_dirty: false,
      completed_at: '2026-01-01T00:00:00.000Z',
      files: {
        games: file(10, 500_000),
        hands: file(290, 600_000),
        decisions: file(9810, 900_000),
      },
    };
    manifest.shards[1] = {
      shard: 1,
      games: 10,
      status: 'failed',
      error: { seed: 'sm-1-3', message: 'x' },
    };
    expect(formatSummary(manifest, 0, 1.25)).toBe(
      [
        'run: sm  preset: argentina-fidepo  players: 3  games: 20  shards: 2',
        'shards: 1 complete (0 skipped, 1 failed)',
        'rows: games 10  hands 290  decisions 9810',
        'size: 2.0 MB  duration: 1.3 s',
        '',
      ].join('\n'),
    );
    expect(oneDecimal(-0.04)).toBe('0.0');
  });
});

describe('run command (CLI)', () => {
  it(
    'VC-1201 / VC-1203 / VC-1227: summary, files, defaults, hashes',
    async () => {
      const out = makeTempDir();
      const r = await runCli([
        'run',
        '--run-id',
        't1',
        '--games',
        '20',
        '--shard-size',
        '10',
        '--out',
        out,
      ]);
      expect(r.stderr).toBe('');
      expect(r.code).toBe(0);
      const lines = r.stdout.trimEnd().split('\n');
      expect(lines).toHaveLength(4);
      expect(lines[0]).toBe('run: t1  preset: argentina-fidepo  players: 3  games: 20  shards: 2');
      expect(lines[1]).toBe('shards: 2 complete (0 skipped, 0 failed)');
      expect(lines[2]).toMatch(/^rows: games 20 {2}hands \d+ {2}decisions \d+$/);
      expect(lines[3]).toMatch(/^size: \d+\.\d MB {2}duration: \d+\.\d s$/);

      const manifest = readRunManifest(out, 't1');
      const files = allFiles(path.join(out, 't1'));
      expect(files.filter((f) => f.includes('.jsonl.gz'))).toHaveLength(6);
      expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
      for (const entry of manifest.shards) {
        if (entry.status !== 'complete') throw new Error('expected complete');
        expect(entry.git_commit).toMatch(/^([0-9a-f]{40}|unknown)$/);
        for (const table of SHARD_TABLES) {
          const f = entry.files[table];
          const file = path.join(out, 't1', f.path);
          expect(f.bytes).toBe(statSync(file).size);
          expect(f.sha256).toBe(createHash('sha256').update(readFileSync(file)).digest('hex'));
          expect(f.rows).toBe(gunzipLines(file).length);
        }
      }
      const rowsLine = lines[2];
      const sum = (t: 'games' | 'hands' | 'decisions') =>
        manifest.shards.reduce((n, s) => n + (s.status === 'complete' ? s.files[t].rows : 0), 0);
      expect(rowsLine).toBe(
        `rows: games ${sum('games')}  hands ${sum('hands')}  decisions ${sum('decisions')}`,
      );
    },
    T,
  );

  it(
    'VC-1203 second half: defaults for everything not passed',
    async () => {
      const out = makeTempDir();
      const r = await runCli(['run', '--run-id', 't3', '--games', '20', '--out', out]);
      expect(r.code).toBe(0);
      const manifest = readRunManifest(out, 't3');
      expect(manifest.params).toEqual({
        preset: 'argentina-fidepo',
        players: 3,
        games: 20,
        shard_size: 1000,
        strategies: ['random', 'random', 'random'],
        replay_every: 100,
      });
      expect(manifest.shards).toHaveLength(1);
    },
    T,
  );

  it(
    'VC-1204 / VC-1205: shard sizes, seeds, no duplicate game_id',
    async () => {
      const out = makeTempDir();
      const r = await runCli([
        'run',
        '--run-id',
        'sd',
        '--games',
        '25',
        '--shard-size',
        '10',
        '--out',
        out,
      ]);
      expect(r.code).toBe(0);
      const manifest = readRunManifest(out, 'sd');
      expect(manifest.shards.map((s) => s.games)).toEqual([10, 10, 5]);
      const ids: string[] = [];
      for (const entry of manifest.shards) {
        if (entry.status !== 'complete') throw new Error('expected complete');
        const rows = gunzipLines(path.join(out, 'sd', entry.files.games.path)).map(
          (l) => JSON.parse(l) as { game_id: string; seed: string },
        );
        expect(rows.map((x) => x.seed)).toEqual(
          Array.from({ length: entry.games }, (_, i) => `sd-${entry.shard}-${i}`),
        );
        for (const row of rows) expect(row.game_id).toBe(row.seed);
        ids.push(...rows.map((x) => x.game_id));
      }
      expect(new Set(ids).size).toBe(25);

      const out2 = makeTempDir();
      const r2 = await runCli([
        'run',
        '--run-id',
        'sd2',
        '--games',
        '21',
        '--shard-size',
        '20',
        '--out',
        out2,
      ]);
      expect(r2.code).toBe(0);
      expect(readRunManifest(out2, 'sd2').shards.map((s) => s.games)).toEqual([20, 1]);
    },
    T,
  );

  it(
    'VC-1249: a 12-shard run has exactly the 36 correctly named files',
    async () => {
      const out = makeTempDir();
      const r = await runCli([
        'run',
        '--run-id',
        'tw',
        '--games',
        '12',
        '--shard-size',
        '1',
        '--workers',
        '3',
        '--out',
        out,
        '--replay-every',
        '5',
      ]);
      expect(r.code).toBe(0);
      const expected = Array.from({ length: 12 }, (_, s) =>
        SHARD_TABLES.map((t) => `shard-${String(s).padStart(5, '0')}.${t}.jsonl.gz`),
      )
        .flat()
        .sort();
      expect(readdirSync(path.join(out, 'tw', 'shards')).sort()).toEqual(expected);
      expect(expected).toHaveLength(36);
    },
    T,
  );

  it(
    'VC-1229 (no hooks) / VC-1232: workers 1 vs 2 and two directories give identical datasets',
    async () => {
      const a = makeTempDir();
      const b = makeTempDir();
      const c = makeTempDir();
      const args = ['--games', '12', '--shard-size', '3', '--replay-every', '2'];
      const ra = await runCli(['run', '--run-id', 'dt', ...args, '--workers', '1', '--out', a]);
      const rb = await runCli(['run', '--run-id', 'dt', ...args, '--workers', '2', '--out', b]);
      const rc = await runCli(['run', '--run-id', 'dt', ...args, '--workers', '2', '--out', c]);
      expect([ra.code, rb.code, rc.code]).toEqual([0, 0, 0]);
      const da = dataset(a, 'dt');
      expect(Object.keys(da)).toHaveLength(12);
      expect(dataset(b, 'dt')).toEqual(da);
      expect(dataset(c, 'dt')).toEqual(da);
    },
    T,
  );

  it(
    'VC-1228: the manifest is always parsable and shards only move pending -> complete',
    async () => {
      const out = makeTempDir();
      const manifestPath = path.join(out, 'pl', 'manifest.json');
      const child = runCli([
        'run',
        '--run-id',
        'pl',
        '--games',
        '10',
        '--shard-size',
        '1',
        '--workers',
        '2',
        '--out',
        out,
      ]);
      let done = false;
      void child.then(() => (done = true));
      const rank = { pending: 0, complete: 1, failed: 1 } as const;
      const last: number[] = Array.from({ length: 10 }, () => 0);
      let reads = 0;
      while (!done) {
        if (existsSync(manifestPath)) {
          const manifest = ManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
          reads++;
          manifest.shards.forEach((s, i) => {
            expect(rank[s.status]).toBeGreaterThanOrEqual(last[i]);
            last[i] = rank[s.status];
          });
        }
        await new Promise((r) => setTimeout(r, 2));
      }
      expect((await child).code).toBe(0);
      expect(reads).toBeGreaterThan(1);
      expect(readRunManifest(out, 'pl').shards.every((s) => s.status === 'complete')).toBe(true);
    },
    T,
  );
});
