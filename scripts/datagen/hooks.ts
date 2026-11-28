// Test-hook seam (spec 12 BR-1211, "Test hooks"). Only a worker calls `loadHooks`; the main
// thread never reads `GENERATE_DATA_TEST_HOOKS`. With the variable unset nothing is imported and
// no hook code runs.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAiLoop as realRunAiLoop } from '@/src/service/ai-loop';
import type { GameTables } from './labels';
import type { RunAiLoopFn } from './game';
import type { ShardHooks } from './shard';

export const HOOKS_ENV = 'GENERATE_DATA_TEST_HOOKS';

/** The default export of a hook module; every function is optional (a missing one is no hook). */
export interface HookModule {
  runAiLoop?: (real: RunAiLoopFn) => RunAiLoopFn;
  replayRunAiLoop?: (real: RunAiLoopFn) => RunAiLoopFn;
  transformRows?: (rows: GameTables) => GameTables;
  onShard?: (info: { shard: number; phase: 'start' | 'end' }) => void;
}

export interface LoadedHooks {
  /** Plain functions for `processShard` / `playRecordedGame` (the factories already applied). */
  hooks: ShardHooks;
  onShard?: HookModule['onShard'];
}

/**
 * Imports the module named by `GENERATE_DATA_TEST_HOOKS` (empty or unset: none) and adapts its
 * default export: `runAiLoop(real)` and `replayRunAiLoop(real)` are called once with the real
 * `runAiLoop` to get the functions used for play and replay.
 */
export async function loadHooks(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<LoadedHooks> {
  const file = env[HOOKS_ENV];
  if (file === undefined || file === '') return { hooks: {} };
  const imported = (await import(pathToFileURL(path.resolve(file)).href)) as {
    default?: HookModule;
  };
  const mod = imported.default ?? {};
  const hooks: ShardHooks = {};
  if (mod.runAiLoop) hooks.runAiLoop = mod.runAiLoop(realRunAiLoop);
  if (mod.replayRunAiLoop) hooks.replayRunAiLoop = mod.replayRunAiLoop(realRunAiLoop);
  if (mod.transformRows) hooks.transformRows = mod.transformRows;
  return { hooks, onShard: mod.onShard };
}
