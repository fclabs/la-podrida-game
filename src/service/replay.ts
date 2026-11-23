// Persisted-game replay (spec 07 FR-723, FR-724, BR-705; plan P-9). Pure and synchronous: it
// rebuilds every stored state from the game's seed and move events with `applyMove` only.
import { cardId } from '@/src/domain/cards';
import type { GameState } from '@/src/domain/types';
import { applyMove, createGame, ENGINE_VERSION } from '@/src/engine/engine';
import type { Commit, GameMeta } from '@/src/state/schemas';
import { GameUnsupported } from './errors';

/**
 * Rebuilds a stored game (FR-723, FR-724). Guards, in order: `RangeError` (message names
 * `commits`) unless `commits` is non-empty and `commits[i].version === i`; `GameUnsupported` when
 * `meta.engineVersion !== ENGINE_VERSION`. Then starts from engine `createGame` with the stored
 * seats, rules and seed (its own events are discarded) and, commit by commit, applies every
 * `bid-made` as `bid:<tricks>` and every `card-played` as `play:<cardId>` by its seat. Returns one
 * state per commit, with `version` set to the commit's version. An `IllegalMoveError` from the
 * engine propagates unchanged.
 */
export function replayGame(meta: GameMeta, commits: readonly Commit[]): GameState[] {
  if (commits.length === 0) {
    throw new RangeError('Invalid commits: at least commit 0 is required');
  }
  commits.forEach((commit, i) => {
    if (commit.version !== i) {
      throw new RangeError(
        `Invalid commits: commit at index ${i} has version ${commit.version}, expected ${i}`,
      );
    }
  });
  if (meta.engineVersion !== ENGINE_VERSION) {
    throw new GameUnsupported(meta.gameId, meta.engineVersion);
  }

  const first = commits[0].state;
  let state = createGame({
    gameId: meta.gameId,
    rules: first.rules,
    seats: meta.seats,
    seed: first.seed,
  }).state;
  const states: GameState[] = [];
  for (const commit of commits) {
    for (const event of commit.events) {
      if (event.type === 'bid-made') {
        state = applyMove(state, event.seat, `bid:${event.tricks}`).state;
      } else if (event.type === 'card-played') {
        state = applyMove(state, event.seat, `play:${cardId(event.card)}`).state;
      }
    }
    states.push({ ...state, version: commit.version });
  }
  return states;
}
