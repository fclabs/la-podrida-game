// Worker entry (spec BR-1206: workers write only the temporary files of their shard).
// Messages: `{ kind: 'shard', ... }` plays one shard (see worker-host.ts for the protocol);
// `{ kind: 'selftest', seed }` plays one 5-seat all-`random` argentina-fidepo game and posts its totals.
import { parentPort } from 'node:worker_threads';
import { getPreset } from '@/src/domain/presets';
import type { SeatInfo } from '@/src/domain/types';
import { createGame } from '@/src/engine/engine';
import { createPlayers } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { runAiLoop } from '@/src/service/ai-loop';
import { processShard } from './shard';
import type { ShardErrorResponse, ShardRequest, ShardResponse } from './worker-host';

export interface SelftestMessage {
  kind: 'selftest';
  seed: string;
}

export interface SelftestResult {
  kind: 'selftest-result';
  totals: number[];
}

function selftest(seed: string): number[] {
  const seats: SeatInfo[] = Array.from({ length: 5 }, (_, i) => ({
    seat: i,
    playerId: `ai-${i}`,
    name: `AI ${i}`,
    kind: 'ai' as const,
    strategy: 'random',
  }));
  const start = createGame({ gameId: seed, rules: getPreset('argentina-fidepo'), seats, seed });
  const { state } = runAiLoop(start.state, createPlayers(seats));
  return evaluate(state).totals;
}

async function handleShard(request: ShardRequest): Promise<void> {
  try {
    const result = await processShard({
      params: request.params,
      shard: request.shard,
      runDir: request.runDir,
      stamp: {
        git_commit: request.git_commit,
        git_dirty: request.git_dirty,
        now: () => new Date().toISOString(),
      },
    });
    const response: ShardResponse = { kind: 'shard-result', shard: request.shard, result };
    parentPort?.postMessage(response);
  } catch (error) {
    const response: ShardErrorResponse = {
      kind: 'shard-error',
      shard: request.shard,
      message: error instanceof Error ? error.message : String(error),
    };
    parentPort?.postMessage(response);
  }
}

parentPort?.on('message', (message: SelftestMessage | ShardRequest) => {
  if (message.kind === 'selftest') {
    const result: SelftestResult = { kind: 'selftest-result', totals: selftest(message.seed) };
    parentPort?.postMessage(result);
  } else if (message.kind === 'shard') {
    void handleShard(message);
  }
});
