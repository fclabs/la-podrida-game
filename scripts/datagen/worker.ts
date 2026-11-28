// Worker entry (spec BR-1206: workers never write the manifest). For now it only answers the
// `selftest` message: play one 5-seat all-`random` argentina-fidepo game and post its totals.
import { parentPort } from 'node:worker_threads';
import { getPreset } from '@/src/domain/presets';
import type { SeatInfo } from '@/src/domain/types';
import { createGame } from '@/src/engine/engine';
import { createPlayers } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { runAiLoop } from '@/src/service/ai-loop';

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

parentPort?.on('message', (message: SelftestMessage) => {
  if (message.kind === 'selftest') {
    const result: SelftestResult = { kind: 'selftest-result', totals: selftest(message.seed) };
    parentPort?.postMessage(result);
  }
});
