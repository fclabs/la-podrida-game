// Strategy registry and createPlayers (spec 04 FR-404, FR-405; VC-403).
import { describe, expect, it } from 'vitest';
import type { SeatInfo } from '@/src/domain/types';
import {
  STRATEGY_NAMES,
  UnknownStrategyError,
  createPlayers,
  getStrategy,
} from '@/src/players/registry';
import { randomStrategy } from '@/src/players/strategies/random';

describe('VC-403 getStrategy', () => {
  it('returns randomStrategy for random, undefined and the empty string', () => {
    expect(getStrategy('random')).toBe(randomStrategy);
    expect(getStrategy(undefined)).toBe(randomStrategy);
    expect(getStrategy('')).toBe(randomStrategy);
  });

  it('throws UnknownStrategyError naming an unknown strategy', () => {
    expect(() => getStrategy('genius')).toThrow(UnknownStrategyError);
    expect(() => getStrategy('genius')).toThrow(/genius/);
    try {
      getStrategy('genius');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe('UnknownStrategyError');
    }
  });

  it('does not find inherited object names', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(() => getStrategy(name)).toThrow(UnknownStrategyError);
    }
  });

  it('STRATEGY_NAMES lists the registered names', () => {
    expect(STRATEGY_NAMES).toEqual(['random']);
  });
});

describe('VC-403 createPlayers', () => {
  const seat = (n: number, kind: SeatInfo['kind'], name: string, strategy?: string): SeatInfo =>
    strategy === undefined
      ? { seat: n, playerId: `p${n}`, name, kind }
      : { seat: n, playerId: `p${n}`, name, kind, strategy };

  it('builds one player per seat in seat order', () => {
    const players = createPlayers([
      seat(0, 'human', 'Ana'),
      seat(1, 'ai', 'Bot 1'),
      seat(2, 'ai', 'Bot 2', 'random'),
    ]);
    expect(players.map((p) => p.kind)).toEqual(['human', 'ai', 'ai']);
    expect(players.map((p) => p.seat)).toEqual([0, 1, 2]);
    expect(players.map((p) => p.name)).toEqual(['Ana', 'Bot 1', 'Bot 2']);
  });

  it('throws UnknownStrategyError for an unregistered strategy', () => {
    expect(() => createPlayers([seat(0, 'human', 'Ana'), seat(1, 'ai', 'Bot', 'genius')])).toThrow(
      UnknownStrategyError,
    );
  });
});
