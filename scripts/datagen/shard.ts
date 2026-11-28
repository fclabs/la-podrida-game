// Plays one shard in-process and writes its three gzip JSONL files (spec 12 FR-1204, FR-1214).
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { type PlayRecordedGameOptions, gameSeed, playRecordedGame } from './game';
import { planShards, shardFilePaths, shardsDir } from './manifest';
import type { CompleteShardEntry } from './schema';
import { type JsonlGzipSink, createJsonlGzipSink } from './sinks';
import type { RunOptions } from './args';

/** The run parameters a shard needs; a `RunOptions` fits. */
export type ShardParams = Pick<
  RunOptions,
  'run_id' | 'preset' | 'games' | 'shard_size' | 'strategies' | 'replay_every'
>;

/** Hook functions passed through to `playRecordedGame` (plain functions, D-007). */
export type ShardHooks = Pick<
  PlayRecordedGameOptions,
  'runAiLoop' | 'replayRunAiLoop' | 'transformRows'
>;

/** What the caller knows about the process: git state and a clock for `completed_at`. */
export interface ShardStamp {
  git_commit: string;
  git_dirty: boolean;
  /** ISO-8601 UTC time; called once, after the three files are renamed. */
  now: () => string;
}

export interface ProcessShardOptions {
  params: ShardParams;
  shard: number;
  runDir: string;
  hooks?: ShardHooks;
  stamp: ShardStamp;
}

/** The first failing game of a shard; its `.tmp` files are left in place for the main thread to delete. */
export interface ShardFailure {
  status: 'failed';
  seed: string;
  message: string;
}

/** A complete manifest entry, or the failure of the shard. */
export type ShardResult = CompleteShardEntry | ShardFailure;

/**
 * Plays the games of `shard` one at a time, streaming each game's rows to the three sinks, then
 * renames the files and returns the `complete` manifest entry. Anything thrown while a game is
 * played (a failed check, `AiLoopLimitError`, `IllegalMoveError`, a hook) stops the shard at that
 * game and returns `{ status: 'failed', seed: gameSeed(...), message }`; the sinks are closed and
 * their `.tmp` files stay. Errors outside a game (disk, sinks) propagate unchanged.
 */
export async function processShard(options: ProcessShardOptions): Promise<ShardResult> {
  const { params, shard, runDir, hooks, stamp } = options;
  const planned = planShards(params.games, params.shard_size)[shard];
  if (planned === undefined) throw new RangeError(`shard ${shard} is not in the plan`);

  await mkdir(shardsDir(runDir), { recursive: true });
  const paths = shardFilePaths(runDir, shard);
  const sinks: Record<'games' | 'hands' | 'decisions', JsonlGzipSink> = {
    games: createJsonlGzipSink(paths.games),
    hands: createJsonlGzipSink(paths.hands),
    decisions: createJsonlGzipSink(paths.decisions),
  };

  let index = 0;
  try {
    for (; index < planned.games; index++) {
      let tables: ReturnType<typeof playRecordedGame>;
      try {
        tables = playRecordedGame({
          run_id: params.run_id,
          shard,
          index,
          preset: params.preset,
          strategies: params.strategies,
          replay_every: params.replay_every,
          ...hooks,
        });
      } catch (error) {
        await Promise.all([sinks.games.abort(), sinks.hands.abort(), sinks.decisions.abort()]);
        return {
          status: 'failed',
          seed: gameSeed(params.run_id, shard, index),
          message: error instanceof Error ? error.message : String(error),
        };
      }
      await sinks.games.append([tables.games]);
      await sinks.hands.append(tables.hands);
      await sinks.decisions.append(tables.decisions);
    }
  } catch (error) {
    await Promise.all([sinks.games.abort(), sinks.hands.abort(), sinks.decisions.abort()]);
    throw error;
  }

  const games = await sinks.games.finish();
  const hands = await sinks.hands.finish();
  const decisions = await sinks.decisions.finish();
  const relative = (r: typeof games) => ({ ...r, path: path.relative(runDir, r.path) });
  return {
    shard,
    games: planned.games,
    status: 'complete',
    git_commit: stamp.git_commit,
    git_dirty: stamp.git_dirty,
    completed_at: stamp.now(),
    files: { games: relative(games), hands: relative(hands), decisions: relative(decisions) },
  };
}
