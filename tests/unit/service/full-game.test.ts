// A full game played through submitMove (spec 07 FR-712, FR-718, FR-721, FR-722, FR-723, FR-724;
// VC-714, VC-715, VC-723 on a service-played game).
import { beforeAll, describe, expect, it } from 'vitest';
import type { PlayerUpdate } from '@/src/domain/types';
import { evaluate } from '@/src/score/score-engine';
import { replayGame } from '@/src/service/replay';
import type { CreateGameResult } from '@/src/service/game-service';
import type { GameStateManager } from '@/src/state/game-state-manager';
import { finalScoresKey } from '@/src/state/keys';
import type { Commit } from '@/src/state/schemas';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { RecordingStore } from '../state/support/store-wrappers';
import { makeService, playToEnd } from './support/service-fixtures';

interface PlayedGame {
  state: GameStateManager;
  created: CreateGameResult;
  responses: PlayerUpdate[];
  commits: Commit[];
}

/** An argentina-fidepo game with 3 AIs played to game-over; every stored commit 0…tip. */
async function playedGame(): Promise<PlayedGame> {
  const { service, state } = makeService();
  const created = await service.createGame({
    rulesPreset: 'argentina-fidepo',
    humanName: 'Ana',
    aiCount: 3,
  });
  const responses = await playToEnd(service, created);
  const tip = responses[responses.length - 1].version;
  const commits: Commit[] = [];
  for (let v = 0; v <= tip; v++) commits.push(await state.load(created.gameId, v));
  return { state, created, responses, commits };
}

let game: PlayedGame;

beforeAll(async () => {
  game = await playedGame();
});

describe('VC-714: a full argentina-fidepo game with 3 AIs played through submitMove', () => {
  it('ends at game-over, and the tip is the last response', async () => {
    const last = game.responses[game.responses.length - 1];
    expect(last.view.phase).toBe('game-over');
    expect(game.commits[game.commits.length - 1].state.phase).toBe('game-over');
    expect(game.responses.length).toBe(game.commits.length - 1);
  });

  it('every response has version = previous + 1 and events = that commit’s events', () => {
    let previous = game.created.update.version;
    for (const response of game.responses) {
      expect(response.version).toBe(previous + 1);
      expect(response.events).toEqual(game.commits[response.version].events);
      previous = response.version;
    }
  });

  it('view.finalRanking is absent until the last response, where it equals scoreboard.ranking', () => {
    const last = game.responses[game.responses.length - 1];
    for (const response of [game.created.update, ...game.responses.slice(0, -1)]) {
      expect('finalRanking' in response.view).toBe(false);
    }
    expect(last.view.finalRanking).toEqual(game.commits[last.version].scoreboard.ranking);
    expect(last.view.finalRanking).toEqual(last.view.scoreboard.ranking);
  });

  it('each commit: actorSeat 0, the request’s clientRequestId, state.version, scoreboard = evaluate', () => {
    for (const commit of game.commits.slice(1)) {
      expect(commit.actorSeat).toBe(0);
      expect(commit.clientRequestId).toBe(`play-${commit.version}`);
      expect(commit.state.version).toBe(commit.version);
      expect(commit.scoreboard).toEqual(evaluate(commit.state));
    }
  });
});

describe('VC-715: final scores are written when the game ends', () => {
  it('readFinalScores returns the terminal commit’s version and ranking', async () => {
    const terminal = game.commits[game.commits.length - 1];
    const scores = await game.state.readFinalScores(game.created.gameId);
    expect(scores).not.toBeNull();
    expect(scores?.version).toBe(terminal.version);
    expect(scores?.ranking).toEqual(terminal.scoreboard.ranking);
    expect(scores?.totals).toEqual(terminal.scoreboard.totals);
  });

  it('a store whose final.json put throws still lets the last submitMove resolve normally', async () => {
    const failing = new RecordingStore(new MemoryObjectStore(), {
      put: ({ key, body, opts }, inner) =>
        key.endsWith('/final.json')
          ? Promise.reject(new Error('final.json put failed'))
          : inner.put(key, body, opts),
    });
    const { service, state } = makeService(failing);
    const created = await service.createGame({ humanName: 'Ana', aiCount: 3 });
    const responses = await playToEnd(service, created);
    const last = responses[responses.length - 1];
    expect(last.view.phase).toBe('game-over');
    expect(last.view.finalRanking).toBeDefined();
    const finalPuts = failing
      .callsOf('put')
      .filter((c) => c.key === finalScoresKey(created.gameId));
    expect(finalPuts).toHaveLength(1);
    expect(await state.readFinalScores(created.gameId)).toBeNull();
  });
});

describe('VC-723: the service-played game replays exactly', () => {
  it('replayGame over commits 0…tip gives every stored state; evaluate gives every scoreboard', async () => {
    const meta = await game.state.loadMeta(game.created.gameId);
    const states = replayGame(meta, game.commits);
    expect(states).toHaveLength(game.commits.length);
    states.forEach((state, v) => {
      expect(state).toEqual(game.commits[v].state);
      expect(state.aiDecisionCount).toBe(game.commits[v].state.aiDecisionCount);
      expect(evaluate(state)).toEqual(game.commits[v].scoreboard);
    });
  });
});
