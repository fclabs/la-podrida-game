// Persisted replay (spec 07 FR-723, FR-724; VC-723 on a chain built without the service, VC-724).
import { describe, expect, it } from 'vitest';
import { cardId } from '@/src/domain/cards';
import { ENGINE_VERSION, IllegalMoveError } from '@/src/engine/engine';
import { evaluate } from '@/src/score/score-engine';
import { GameUnsupported } from '@/src/service/errors';
import { replayGame } from '@/src/service/replay';
import type { Commit } from '@/src/state/schemas';
import { buildStoredChain } from './support/replay-fixtures';

describe('VC-723: a stored chain replays exactly', () => {
  it.each(['replay-seed', 'replay-seed-2', 'replay-seed-3'])(
    'seed %s: every state and scoreboard matches',
    (seed) => {
      const { meta, commits } = buildStoredChain({ seed });
      expect(commits.at(-1)?.state.phase).toBe('game-over');
      expect(commits.length).toBeGreaterThan(2);

      const states = replayGame(meta, commits);
      expect(states).toHaveLength(commits.length);
      states.forEach((state, i) => {
        expect(state).toEqual(commits[i].state);
        expect(state.version).toBe(i);
        expect(state.aiDecisionCount).toBe(commits[i].state.aiDecisionCount);
        expect(evaluate(state)).toEqual(commits[i].scoreboard);
      });
      expect(states.at(-1)?.aiDecisionCount).toBeGreaterThan(0);
    },
  );

  it('a partial chain (maxCommits 3) replays to its 3 states', () => {
    const { meta, commits } = buildStoredChain({ maxCommits: 3 });
    expect(commits.map((c) => c.version)).toEqual([0, 1, 2]);
    expect(replayGame(meta, commits)).toEqual(commits.map((c) => c.state));
  });

  it('does not mutate its inputs', () => {
    const { meta, commits } = buildStoredChain({ maxCommits: 4 });
    const before = structuredClone({ meta, commits });
    replayGame(meta, commits);
    expect({ meta, commits }).toEqual(before);
  });
});

describe('VC-724: bad input is refused', () => {
  const { meta, commits } = buildStoredChain({ maxCommits: 3 });

  it('an engineVersion mismatch → GameUnsupported', () => {
    const other = { ...meta, engineVersion: ENGINE_VERSION + 1 };
    let error: unknown;
    try {
      replayGame(other, commits);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(GameUnsupported);
    expect(error).toMatchObject({ gameId: meta.gameId, engineVersion: ENGINE_VERSION + 1 });
  });

  it.each<[string, Commit[]]>([
    ['[]', []],
    ['[0, 2]', [commits[0], commits[2]]],
    ['[1]', [commits[1]]],
    ['[1, 0]', [commits[1], commits[0]]],
  ])('versions %s → RangeError naming commits', (_label, chain) => {
    expect(() => replayGame(meta, chain)).toThrow(RangeError);
    expect(() => replayGame(meta, chain)).toThrow(/commits/);
  });

  it('the commits check runs before the engine version check', () => {
    const other = { ...meta, engineVersion: ENGINE_VERSION + 1 };
    expect(() => replayGame(other, [])).toThrow(RangeError);
  });
});

describe('FR-724: a move the engine rejects propagates', () => {
  it('a tampered card-played event → IllegalMoveError', () => {
    const { meta, commits } = buildStoredChain({ maxCommits: 8 });
    const tampered = structuredClone(commits);
    // Replace a later card-played card with a card already played in an earlier commit.
    const firstIndex = tampered.findIndex((c) => c.events.some((e) => e.type === 'card-played'));
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    const played = tampered[firstIndex].events.find((e) => e.type === 'card-played');
    const laterCommit = tampered
      .slice(firstIndex + 1)
      .find((c) => c.events.some((e) => e.type === 'card-played'));
    const later = laterCommit?.events.find((e) => e.type === 'card-played');
    if (played?.type !== 'card-played' || later?.type !== 'card-played') {
      throw new Error('the chain has no two commits with card-played events');
    }
    expect(cardId(later.card)).not.toBe(cardId(played.card));
    later.card = { ...played.card };

    let error: unknown;
    try {
      replayGame(meta, tampered);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(IllegalMoveError);
    expect(error).toMatchObject({ reason: 'unknown-move', seat: later.seat });
  });
});
