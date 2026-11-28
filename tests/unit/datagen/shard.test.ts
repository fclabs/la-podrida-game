// Sink and shard processor tests (spec 12 VC-1204/1227/1232/1249 at shard level).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  ManifestSchema,
  ShardEntrySchema,
  GamesRowSchema,
  HandsRowSchema,
  DecisionRowSchema,
} from '../../../scripts/datagen/schema';
import { createJsonlGzipSink } from '../../../scripts/datagen/sinks';
import { type ShardParams, type ShardStamp, processShard } from '../../../scripts/datagen/shard';
import { shardFilePaths } from '../../../scripts/datagen/manifest';
import { runAiLoop } from '../../../src/service/ai-loop';
import { makeTempDir } from './helpers';

const stamp: ShardStamp = {
  git_commit: 'abc123',
  git_dirty: false,
  now: () => '2026-01-01T00:00:00.000Z',
};

function params(over: Partial<ShardParams> = {}): ShardParams {
  return {
    run_id: 'sh',
    preset: 'argentina-fidepo',
    games: 25,
    shard_size: 10,
    strategies: ['random', 'random', 'random'],
    replay_every: 5,
    ...over,
  };
}

function lines(file: string): string[] {
  const text = gunzipSync(readFileSync(file)).toString('utf8');
  return text === '' ? [] : text.replace(/\n$/, '').split('\n');
}

describe('JSONL gzip sink', () => {
  it('writes to .tmp, renames on finish and describes the stored bytes', async () => {
    const final = path.join(makeTempDir(), 'x.jsonl.gz');
    const sink = createJsonlGzipSink(final);
    await sink.append([{ a: 1, b: 'é' }]);
    await sink.append([]);
    await sink.append([{ a: 2, b: 'z' }]);
    await new Promise((r) => setTimeout(r, 20));
    expect(existsSync(final)).toBe(false);
    expect(existsSync(`${final}.tmp`)).toBe(true);
    const r = await sink.finish();
    expect(existsSync(`${final}.tmp`)).toBe(false);
    expect(r.path).toBe(final);
    expect(r.rows).toBe(2);
    expect(r.bytes).toBe(statSync(final).size);
    expect(r.sha256).toBe(createHash('sha256').update(readFileSync(final)).digest('hex'));
    expect(lines(final)).toEqual(['{"a":1,"b":"é"}', '{"a":2,"b":"z"}']);
  });

  it('abort leaves the .tmp file and no final file', async () => {
    const final = path.join(makeTempDir(), 'y.jsonl.gz');
    const sink = createJsonlGzipSink(final);
    await sink.append([{ a: 1 }]);
    await sink.abort();
    expect(existsSync(final)).toBe(false);
    expect(existsSync(`${final}.tmp`)).toBe(true);
  });

  it('handles many rows (backpressure)', async () => {
    const final = path.join(makeTempDir(), 'z.jsonl.gz');
    const sink = createJsonlGzipSink(final);
    for (let i = 0; i < 200; i++) {
      await sink.append(
        Array.from({ length: 500 }, (_, k) => ({ i, k, pad: `${i}-${k}`.repeat(20) })),
      );
    }
    const r = await sink.finish();
    expect(r.rows).toBe(100000);
    expect(lines(final)).toHaveLength(100000);
  });
});

describe('processShard', () => {
  it('shard 2 of 25 games has 5 games, seeds R-2-0..4 and no duplicate game_id (VC-1204)', async () => {
    const dir = makeTempDir();
    const res = await processShard({ params: params(), shard: 2, runDir: dir, stamp });
    expect(res.status).toBe('complete');
    if (res.status !== 'complete') return;
    expect(res.games).toBe(5);
    const rows = lines(shardFilePaths(dir, 2).games).map((l) =>
      GamesRowSchema.parse(JSON.parse(l)),
    );
    expect(rows.map((r) => r.seed)).toEqual([0, 1, 2, 3, 4].map((i) => `sh-2-${i}`));
    expect(rows.map((r) => r.game_id)).toEqual(rows.map((r) => r.seed));
    expect(new Set(rows.map((r) => r.game_id)).size).toBe(5);
    expect(rows.every((r) => r.shard === 2)).toBe(true);
  });

  it('files, sizes, hashes, row counts, manifest entry, no tmp (VC-1227, VC-1249)', async () => {
    const dir = makeTempDir();
    const res = await processShard({
      params: params({ games: 120 }),
      shard: 11,
      runDir: dir,
      stamp,
    });
    if (res.status !== 'complete') throw new Error('expected complete');
    expect(ShardEntrySchema.parse(res)).toEqual(res);
    expect(res.git_commit).toBe('abc123');
    expect(res.git_dirty).toBe(false);
    expect(res.completed_at).toBe('2026-01-01T00:00:00.000Z');
    expect(readdirSync(path.join(dir, 'shards')).sort()).toEqual([
      'shard-00011.decisions.jsonl.gz',
      'shard-00011.games.jsonl.gz',
      'shard-00011.hands.jsonl.gz',
    ]);
    for (const table of ['games', 'hands', 'decisions'] as const) {
      const f = res.files[table];
      expect(f.path).toBe(`shards/shard-00011.${table}.jsonl.gz`);
      const abs = path.join(dir, f.path);
      expect(f.bytes).toBe(statSync(abs).size);
      expect(f.sha256).toBe(createHash('sha256').update(readFileSync(abs)).digest('hex'));
      expect(f.rows).toBe(lines(abs).length);
    }
    expect(res.files.games.rows).toBe(res.games);
    const schemas = { games: GamesRowSchema, hands: HandsRowSchema, decisions: DecisionRowSchema };
    for (const table of ['games', 'hands', 'decisions'] as const) {
      for (const l of lines(path.join(dir, res.files[table].path)).slice(0, 50)) {
        const obj = JSON.parse(l) as object;
        expect(Object.keys(obj)).toEqual(Object.keys(schemas[table].shape));
        schemas[table].parse(obj);
      }
    }
    expect(l_noTrailingSpaces(path.join(dir, res.files.decisions.path))).toBe(true);
    // the entry fits a manifest
    ManifestSchema.shape.shards.parse([res]);
  });

  it('the same shard twice gives identical decompressed contents (VC-1232)', async () => {
    const a = makeTempDir();
    const b = makeTempDir();
    await processShard({ params: params(), shard: 1, runDir: a, stamp });
    await processShard({ params: params(), shard: 1, runDir: b, stamp });
    for (const table of ['games', 'hands', 'decisions'] as const) {
      const fa = shardFilePaths(a, 1)[table];
      const fb = shardFilePaths(b, 1)[table];
      expect(gunzipSync(readFileSync(fa)).equals(gunzipSync(readFileSync(fb)))).toBe(true);
    }
  });

  it('stops at the first GameFailure, leaves .tmp files and renames nothing', async () => {
    const dir = makeTempDir();
    let calls = 0;
    const res = await processShard({
      params: params(),
      shard: 0,
      runDir: dir,
      stamp,
      hooks: {
        transformRows: (t) => {
          calls++;
          if (calls === 3) t.decisions.pop();
          return t;
        },
      },
    });
    expect(res).toMatchObject({ status: 'failed', seed: 'sh-0-2' });
    expect(res.status === 'failed' && res.message).toMatch(/check 3/);
    expect(calls).toBe(3);
    const files = readdirSync(path.join(dir, 'shards')).sort();
    expect(files).toEqual([
      'shard-00000.decisions.jsonl.gz.tmp',
      'shard-00000.games.jsonl.gz.tmp',
      'shard-00000.hands.jsonl.gz.tmp',
    ]);
  });

  it('any error thrown by a game fails the shard with that game seed', async () => {
    const dir = makeTempDir();
    const res = await processShard({
      params: params(),
      shard: 1,
      runDir: dir,
      stamp,
      hooks: {
        runAiLoop: (state, players, options) => {
          if (state.seed === 'sh-1-2') throw new Error('boom');
          return runAiLoop(state, players, options);
        },
      },
    });
    expect(res).toMatchObject({ status: 'failed', seed: 'sh-1-2', message: 'boom' });
  });

  it('rejects a shard outside the plan', async () => {
    await expect(
      processShard({ params: params(), shard: 3, runDir: makeTempDir(), stamp }),
    ).rejects.toThrow(RangeError);
  });
});

function l_noTrailingSpaces(file: string): boolean {
  return lines(file).every((l) => l === l.trimEnd());
}
