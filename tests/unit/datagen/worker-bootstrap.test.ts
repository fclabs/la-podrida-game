// Spec A-2: a worker started with `execArgv: ['--import', 'tsx']` from a tsx process loads
// scripts/datagen/worker.ts and its `@/` imports, and plays a game.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getPreset } from '@/src/domain/presets';
import type { SeatInfo } from '@/src/domain/types';
import { createGame } from '@/src/engine/engine';
import { createPlayers } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { runAiLoop } from '@/src/service/ai-loop';
import { REPO_ROOT } from './helpers';

function playInProcess(seed: string): number[] {
  const seats: SeatInfo[] = Array.from({ length: 5 }, (_, i) => ({
    seat: i,
    playerId: `ai-${i}`,
    name: `AI ${i}`,
    kind: 'ai' as const,
    strategy: 'random',
  }));
  const start = createGame({ gameId: seed, rules: getPreset('argentina-fidepo'), seats, seed });
  return evaluate(runAiLoop(start.state, createPlayers(seats)).state).totals;
}

function runFixture(
  seed: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        path.join(REPO_ROOT, 'tests/unit/datagen/fixtures/spawn-selftest.ts'),
        seed,
      ],
      { cwd: REPO_ROOT },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('worker bootstrap (A-2)', () => {
  it.each(['selftest', 'boot-2'])(
    'a tsx worker plays the same game as the main thread (seed %s)',
    async (seed) => {
      const result = await runFixture(seed);
      expect(result.stderr).toBe('');
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(playInProcess(seed));
    },
    120_000,
  );
});
