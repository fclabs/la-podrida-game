// The run manifest (spec 12 FR-1205, FR-1215, I-5) and the shard file naming.
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GENERATOR_VERSION, SCHEMA_VERSION } from './constants';
import { type Manifest, type ManifestParams, ManifestSchema } from './schema';

export const MANIFEST_FILE = 'manifest.json';
export const SHARD_TABLES = ['games', 'hands', 'decisions'] as const;
export type ShardTable = (typeof SHARD_TABLES)[number];

export interface PlannedShard {
  shard: number;
  games: number;
}

/** FR-1205: `ceil(games / shardSize)` shards; all hold `shardSize` games but the last. */
export function planShards(games: number, shardSize: number): PlannedShard[] {
  if (!Number.isInteger(games) || games < 1) throw new RangeError(`invalid games: ${games}`);
  if (!Number.isInteger(shardSize) || shardSize < 1) {
    throw new RangeError(`invalid shard size: ${shardSize}`);
  }
  const count = Math.ceil(games / shardSize);
  return Array.from({ length: count }, (_, shard) => ({
    shard,
    games: Math.min(shardSize, games - shard * shardSize),
  }));
}

/** A new manifest with every shard `pending`. `createdAt` is an ISO-8601 UTC string. */
export function newManifest(options: {
  run_id: string;
  params: ManifestParams;
  created_at: string;
}): Manifest {
  return {
    schema_version: SCHEMA_VERSION,
    generator_version: GENERATOR_VERSION,
    run_id: options.run_id,
    params: options.params,
    created_at: options.created_at,
    shards: planShards(options.params.games, options.params.shard_size).map((s) => ({
      shard: s.shard,
      games: s.games,
      status: 'pending' as const,
    })),
  };
}

/** Writes `manifest.json.tmp` in `runDir` and renames it to `manifest.json` (never half-written). */
export async function writeManifestAtomic(runDir: string, manifest: Manifest): Promise<void> {
  const final = path.join(runDir, MANIFEST_FILE);
  const tmp = `${final}.tmp`;
  await writeFile(tmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(tmp, final);
}

/** Reads and validates `<runDir>/manifest.json`; throws (ZodError / SyntaxError / ENOENT) if bad. */
export async function readManifest(runDir: string): Promise<Manifest> {
  const text = await readFile(path.join(runDir, MANIFEST_FILE), 'utf8');
  return ManifestSchema.parse(JSON.parse(text));
}

/** `<runDir>/shards` */
export function shardsDir(runDir: string): string {
  return path.join(runDir, 'shards');
}

/** `shard-<NNNNN>.<table>.jsonl.gz`, the shard number zero-padded to 5 digits. */
export function shardFileName(shard: number, table: ShardTable): string {
  return `shard-${String(shard).padStart(5, '0')}.${table}.jsonl.gz`;
}

/** Absolute (or `runDir`-relative, as `runDir` is) paths of a shard's three final files. */
export function shardFilePaths(runDir: string, shard: number): Record<ShardTable, string> {
  const dir = shardsDir(runDir);
  return {
    games: path.join(dir, shardFileName(shard, 'games')),
    hands: path.join(dir, shardFileName(shard, 'hands')),
    decisions: path.join(dir, shardFileName(shard, 'decisions')),
  };
}
