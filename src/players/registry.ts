import type { SeatInfo } from '@/src/domain/types';
import { createAiPlayer } from './ai-player';
import { createHumanPlayer } from './human-player';
import type { AIStrategy, Player } from './player';
import { randomStrategy } from './strategies/random';

/** Registered strategies by name. A `Map`, so inherited names such as `'constructor'` are never found. */
const STRATEGIES: ReadonlyMap<string, AIStrategy> = new Map([
  [randomStrategy.name, randomStrategy],
]);

/** The registered strategy names (FR-404). Frozen. */
export const STRATEGY_NAMES: readonly string[] = Object.freeze([...STRATEGIES.keys()]);

/** Thrown by `getStrategy` (and `createPlayers`) for a strategy name that is not registered. */
export class UnknownStrategyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownStrategyError';
  }
}

/**
 * Returns the strategy registered as `name` (FR-404). `undefined` or `''` returns `randomStrategy`;
 * any other unregistered name throws `UnknownStrategyError` (message contains the name).
 */
export function getStrategy(name: string | undefined): AIStrategy {
  if (name === undefined || name === '') return randomStrategy;
  const strategy = STRATEGIES.get(name);
  if (strategy === undefined) {
    throw new UnknownStrategyError(
      `Unknown AI strategy "${name}" (known: ${STRATEGY_NAMES.join(', ')})`,
    );
  }
  return strategy;
}

/**
 * Builds one player per seat, in the order of `seats` (a game's seats are in seat order) (FR-405):
 * a human player for `kind: 'human'`, an AI player with `getStrategy(strategy)` for `kind: 'ai'`.
 * Throws `UnknownStrategyError` for an unregistered strategy name.
 */
export function createPlayers(seats: readonly SeatInfo[]): Player[] {
  return seats.map((info) =>
    info.kind === 'human'
      ? createHumanPlayer(info.seat, info.name)
      : createAiPlayer(info.seat, info.name, getStrategy(info.strategy)),
  );
}
