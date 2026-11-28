// Manifest, shard planning and naming tests (spec 12 VC-1205, VC-1249 naming, FR-1215, I-5).
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  newManifest,
  planShards,
  readManifest,
  shardFileName,
  shardFilePaths,
  writeManifestAtomic,
} from '../../../scripts/datagen/manifest';
import { ManifestSchema } from '../../../scripts/datagen/schema';
import { makeTempDir } from './helpers';

const params = {
  preset: 'argentina-fidepo',
  players: 3,
  games: 25,
  shard_size: 10,
  strategies: ['random', 'random', 'random'],
  replay_every: 100,
};

describe('planShards (VC-1205)', () => {
  it('(20, 20) is one shard of 20', () => {
    expect(planShards(20, 20)).toEqual([{ shard: 0, games: 20 }]);
  });
  it('(21, 20) is two shards, the second with 1 game', () => {
    expect(planShards(21, 20)).toEqual([
      { shard: 0, games: 20 },
      { shard: 1, games: 1 },
    ]);
  });
  it('(1, any) is one shard with 1 game', () => {
    for (const size of [1, 7, 1000]) expect(planShards(1, size)).toEqual([{ shard: 0, games: 1 }]);
  });
  it('(25, 10) is 10, 10, 5', () => {
    expect(planShards(25, 10).map((s) => s.games)).toEqual([10, 10, 5]);
    expect(planShards(25, 10).map((s) => s.shard)).toEqual([0, 1, 2]);
  });
  it('rejects non-positive input', () => {
    expect(() => planShards(0, 10)).toThrow(RangeError);
    expect(() => planShards(10, 0)).toThrow(RangeError);
  });
});

describe('shard file naming (VC-1249)', () => {
  it('zero-pads to 5 digits', () => {
    for (let s = 0; s <= 11; s++) {
      const n = String(s).padStart(5, '0');
      expect(shardFileName(s, 'games')).toBe(`shard-${n}.games.jsonl.gz`);
      expect(shardFileName(s, 'hands')).toBe(`shard-${n}.hands.jsonl.gz`);
      expect(shardFileName(s, 'decisions')).toBe(`shard-${n}.decisions.jsonl.gz`);
    }
  });
  it('puts the files in <runDir>/shards', () => {
    const p = shardFilePaths('/x/run', 11);
    expect(p.games).toBe('/x/run/shards/shard-00011.games.jsonl.gz');
    expect(p.decisions).toBe('/x/run/shards/shard-00011.decisions.jsonl.gz');
  });
});

describe('manifest', () => {
  it('newManifest has pending shards in order and parses', () => {
    const m = newManifest({ run_id: 'r', params, created_at: '2026-01-01T00:00:00.000Z' });
    expect(ManifestSchema.parse(m)).toEqual(m);
    expect(m.shards).toEqual([
      { shard: 0, games: 10, status: 'pending' },
      { shard: 1, games: 10, status: 'pending' },
      { shard: 2, games: 5, status: 'pending' },
    ]);
    expect(m.schema_version).toBe(1);
    expect(m.generator_version).toBe(1);
  });

  it('writeManifestAtomic round-trips and leaves no tmp file', async () => {
    const dir = makeTempDir();
    const m = newManifest({ run_id: 'r', params, created_at: '2026-01-01T00:00:00.000Z' });
    await writeManifestAtomic(dir, m);
    expect(await readManifest(dir)).toEqual(m);
    expect(readdirSync(dir)).toEqual(['manifest.json']);
    expect(existsSync(path.join(dir, 'manifest.json.tmp'))).toBe(false);
  }, 120_000);

  it('a polling reader never sees an unparsable file', async () => {
    const dir = makeTempDir();
    const m = newManifest({ run_id: 'r', params, created_at: '2026-01-01T00:00:00.000Z' });
    await writeManifestAtomic(dir, m);
    let writing = true;
    let reads = 0;
    const bad: string[] = [];
    const poller = (async () => {
      while (writing) {
        try {
          ManifestSchema.parse(JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')));
          reads++;
        } catch (error) {
          bad.push(String(error));
        }
      }
    })();
    for (let i = 0; i < 300; i++) {
      await writeManifestAtomic(dir, {
        ...m,
        shards: m.shards.map((s, k) =>
          k <= i % 3
            ? { ...s, status: 'failed' as const, error: { seed: null, message: `m${i}` } }
            : s,
        ),
      });
    }
    writing = false;
    await poller;
    expect(bad).toEqual([]);
    expect(reads).toBeGreaterThan(0);
    expect(existsSync(path.join(dir, 'manifest.json.tmp'))).toBe(false);
  }, 120_000);

  it('readManifest rejects {} with a schema error', async () => {
    const dir = makeTempDir();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path.join(dir, 'manifest.json'), '{}');
    await expect(readManifest(dir)).rejects.toThrow(/schema_version|expected/i);
    await expect(readManifest(dir)).rejects.toMatchObject({ name: 'ZodError' });
  });
});
