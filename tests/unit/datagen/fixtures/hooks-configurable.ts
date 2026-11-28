// Configurable hook module for the failure tests (spec 12 "Test hooks", plan I-4). Every
// behaviour is switched on by an environment variable the test sets; with none set it is inert.
//
//   HOOK_FAIL_SEED   the game (`state.seed`) the failing hooks act on
//   HOOK_MODE        runAiLoop:  'not-game-over' | 'limit' | 'illegal'
//                    transformRows: 'drop-decision' | 'points' | 'tricks' | 'drop-hand'
//                    replayRunAiLoop: 'replay-differ'
//   HOOK_CALLS_LOG   file: one line per call of the runAiLoop hook (the game's seed)
//   HOOK_REPLAY_LOG  file: one line per call of the replayRunAiLoop hook (the replayed seed)
//   HOOK_TIMES_LOG   file: `<shard> <phase> <Date.now()>` per onShard call
//   HOOK_EXIT_SHARD  shard number: onShard calls process.exit(1) at its `start`
//   HOOK_MANIFEST_PATH  file the onShard hook deletes at `start` of shard 0
import { appendFileSync, rmSync } from 'node:fs';
import type { GameState } from '../../../../src/domain/types';
import { IllegalMoveError } from '../../../../src/engine/engine';
import { AiLoopLimitError, type runAiLoop } from '../../../../src/service/ai-loop';
import type { GameTables } from '../../../../scripts/datagen/labels';

type RunAiLoop = typeof runAiLoop;
const env = process.env;

function log(file: string | undefined, line: string): void {
  if (file) appendFileSync(file, `${line}\n`);
}

export default {
  runAiLoop(real: RunAiLoop): RunAiLoop {
    return (state, players, options) => {
      log(env.HOOK_CALLS_LOG, state.seed);
      if (state.seed !== env.HOOK_FAIL_SEED) return real(state, players, options);
      if (env.HOOK_MODE === 'limit') throw new AiLoopLimitError(1000, state);
      if (env.HOOK_MODE === 'illegal') throw new IllegalMoveError('unknown-move', 0, 'bid:99');
      const result = real(state, players, options);
      if (env.HOOK_MODE === 'not-game-over') {
        return { ...result, state: { ...result.state, phase: 'playing' } as GameState };
      }
      return result;
    };
  },

  replayRunAiLoop(real: RunAiLoop): RunAiLoop {
    return (state, players, options) => {
      log(env.HOOK_REPLAY_LOG, state.seed);
      const result = real(state, players, options);
      if (env.HOOK_MODE !== 'replay-differ' || state.seed !== env.HOOK_FAIL_SEED) return result;
      // Change the second applied move (step 1: the second bid of hand 0).
      let bids = 0;
      const events = result.events.map((e) =>
        e.type === 'bid-made' && bids++ === 1 ? { ...e, tricks: e.tricks + 1 } : e,
      );
      return { ...result, events };
    };
  },

  transformRows(rows: GameTables): GameTables {
    if (rows.games.seed !== env.HOOK_FAIL_SEED) return rows;
    switch (env.HOOK_MODE) {
      case 'drop-decision':
        rows.decisions.pop();
        break;
      case 'points':
        rows.hands[0].points_by_seat[0] += 1;
        break;
      case 'tricks':
        rows.hands[0].tricks_won_by_seat[0] += 1;
        break;
      case 'drop-hand':
        rows.hands.pop();
        break;
    }
    return rows;
  },

  onShard({ shard, phase }: { shard: number; phase: 'start' | 'end' }): void {
    log(env.HOOK_TIMES_LOG, `${shard} ${phase} ${Date.now()}`);
    if (phase !== 'start') return;
    if (env.HOOK_EXIT_SHARD !== undefined && shard === Number(env.HOOK_EXIT_SHARD)) {
      process.exit(1);
    }
    if (env.HOOK_MANIFEST_PATH && shard === 0) rmSync(env.HOOK_MANIFEST_PATH, { force: true });
  },
};
