// Secrets stay on the server (spec 07 BR-701; VC-725 (a) and (b), plan P-12 R-033). Covers the
// returns of a full game played with playToEnd, the VC-716 rejections, the VC-717 conflicts, the
// VC-718 retry and a VC-720 race conflict.
import { beforeAll, describe, expect, it } from 'vitest';
import { cardId } from '@/src/domain/cards';
import { DEFAULT_PRESET_ID, getPreset } from '@/src/domain/presets';
import type { GameEvent, PlayerUpdate, SeatInfo } from '@/src/domain/types';
import { createGame, currentActor } from '@/src/engine/engine';
import { IllegalMove, NotYourTurn, VersionConflict } from '@/src/service/errors';
import type { CreateGameResult, GameService } from '@/src/service/game-service';
import { buildPlayerView } from '@/src/service/player-view';
import type { GameStateManager } from '@/src/state/game-state-manager';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { GAME_ID } from '../state/support/fixtures';
import { GatedStore } from './support/gated-store';
import {
  firstLegalMoveId,
  makeService,
  playToEnd,
  storeHandmadeGame,
} from './support/service-fixtures';

/** A value the service returned, or a service error it threw, with the game and seat it is for. */
interface Observation {
  label: string;
  state: GameStateManager;
  gameId: string;
  seat: number;
  value: unknown;
}

/** The secrets of one game. */
interface GameSecrets {
  seed: string;
  hash: string;
  token: string;
}

const observations: Observation[] = [];
const secrets = new Map<string, GameSecrets>();
/** The JSON of every value except `createGame` results (where the seat token is expected). */
const nonCreateJson: string[] = [];

/** `{ name, message, ...ownFields }` of a service error; the value itself otherwise. */
function serializable(value: unknown): unknown {
  if (value instanceof Error) return { ...value, name: value.name, message: value.message };
  return value;
}

/** The rejection of `promise` (fails when it resolves). */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => expect.unreachable('expected a rejection'),
    (e: unknown) => e as Error,
  );
}

async function remember(state: GameStateManager, gameId: string, seat: number, token: string) {
  const meta = await state.loadMeta(gameId);
  const commit0 = await state.load(gameId, 0);
  secrets.set(gameId, {
    seed: commit0.state.seed,
    hash: meta.seatTokenHashes[seat] as string,
    token,
  });
}

function observe(o: Observation, isCreate = false) {
  observations.push(o);
  if (!isCreate) nonCreateJson.push(JSON.stringify(serializable(o.value)));
}

/** Every update in an observation: the value itself, a create result's update, or a 409's. */
function updatesOf(value: unknown): PlayerUpdate[] {
  if (value instanceof VersionConflict) return [value.update];
  if (value instanceof Error) return [];
  const v = value as Partial<PlayerUpdate & CreateGameResult>;
  if (v.update !== undefined) return [v.update];
  if (v.view !== undefined) return [value as PlayerUpdate];
  return [];
}

/** Every card object (`{ rank, suit }`) inside `value`, with its property path. */
function cardsIn(value: unknown, path = ''): Array<{ path: string; id: string }> {
  if (Array.isArray(value)) return value.flatMap((item, i) => cardsIn(item, `${path}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  const keys = Object.keys(value).sort();
  if (keys.length === 2 && keys[0] === 'rank' && keys[1] === 'suit') {
    return [{ path, id: cardId(value as { rank: string; suit: string }) }];
  }
  return Object.entries(value).flatMap(([k, v]) => cardsIn(v, path === '' ? k : `${path}.${k}`));
}

/** Seats 0 human, 1–3 random AIs. */
function oneHumanSeats(): SeatInfo[] {
  return [
    { seat: 0, playerId: 'human-0', name: 'Ana', kind: 'human' },
    ...[1, 2, 3].map((i): SeatInfo => ({
      seat: i,
      playerId: `ai-${i}`,
      name: `AI ${i}`,
      kind: 'ai',
      strategy: 'random',
    })),
  ];
}

async function playFullGame() {
  const { service, state } = makeService();
  const created = await service.createGame({ humanName: 'Ana', aiCount: 3 });
  await remember(state, created.gameId, 0, created.seatToken);
  observe({ label: 'createGame', state, gameId: created.gameId, seat: 0, value: created }, true);
  const responses = await playToEnd(service, created);
  responses.forEach((r, i) =>
    observe({ label: `submit ${i + 1}`, state, gameId: created.gameId, seat: 0, value: r }),
  );
  const last = responses[responses.length - 1];

  // VC-716 game-over rejection.
  const over = await rejection(
    service.submitMove(created.gameId, created.seatToken, {
      version: last.version,
      moveId: 'bid:0',
      clientRequestId: 'late',
    }),
  );
  expect(over).toBeInstanceOf(IllegalMove);
  observe({ label: 'IllegalMove game-over', state, gameId: created.gameId, seat: 0, value: over });

  // VC-717 conflicts at game over too (the tip holds the final hands).
  const stale = await rejection(
    service.submitMove(created.gameId, created.seatToken, {
      version: 0,
      moveId: 'bid:0',
      clientRequestId: 'stale-at-end',
    }),
  );
  observe({ label: 'stale at end', state, gameId: created.gameId, seat: 0, value: stale });
  observe({
    label: 'getUpdate since 0',
    state,
    gameId: created.gameId,
    seat: 0,
    value: await service.getUpdate(created.gameId, created.seatToken, 0),
  });
}

async function midGameRejections() {
  const { service, state } = makeService();
  const created = await service.createGame({ humanName: 'Bea', aiCount: 4 });
  await remember(state, created.gameId, 0, created.seatToken);
  observe({ label: 'createGame 2', state, gameId: created.gameId, seat: 0, value: created }, true);
  const at = (label: string, value: unknown) =>
    observe({ label, state, gameId: created.gameId, seat: 0, value });

  let update = created.update;
  const firstReq = {
    version: 0,
    moveId: firstLegalMoveId(update),
    clientRequestId: 'mid-1',
  };
  for (let n = 1; n <= 4; n++) {
    update = await service.submitMove(
      created.gameId,
      created.seatToken,
      n === 1
        ? firstReq
        : {
            version: update.version,
            moveId: firstLegalMoveId(update),
            clientRequestId: `mid-${n}`,
          },
    );
    at(`mid submit ${n}`, update);
  }
  // VC-718 retry.
  at('retry', await service.submitMove(created.gameId, created.seatToken, firstReq));
  // VC-716 unknown move.
  at(
    'IllegalMove unknown-move',
    await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        version: update.version,
        moveId: 'bid:99',
        clientRequestId: 'x',
      }),
    ),
  );
  // VC-717 stale and future.
  at(
    'stale',
    await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        version: 1,
        moveId: 'bid:0',
        clientRequestId: 'y',
      }),
    ),
  );
  at(
    'future',
    await rejection(
      service.submitMove(created.gameId, created.seatToken, {
        version: update.version + 5,
        moveId: 'bid:0',
        clientRequestId: 'z',
      }),
    ),
  );
}

async function notYourTurn() {
  const token = 'secrets-human-token';
  let seed = '';
  for (let i = 0; i < 100 && seed === ''; i++) {
    const { state } = createGame({
      gameId: GAME_ID,
      rules: getPreset(DEFAULT_PRESET_ID),
      seats: oneHumanSeats(),
      seed: `ai-first-${i}`,
    });
    if (currentActor(state) !== 0) seed = `ai-first-${i}`;
  }
  const { service, state } = makeService();
  await storeHandmadeGame(state, {
    gameId: GAME_ID,
    seats: oneHumanSeats(),
    tokens: [token, null, null, null],
    seed,
    runLoop: false,
  });
  await remember(state, GAME_ID, 0, token);
  const err = await rejection(
    service.submitMove(GAME_ID, token, { version: 0, moveId: 'bid:0', clientRequestId: 'n' }),
  );
  expect(err).toBeInstanceOf(NotYourTurn);
  observe({ label: 'NotYourTurn', state, gameId: GAME_ID, seat: 0, value: err });
}

async function raceConflict() {
  const memory = new MemoryObjectStore();
  const { service: setup } = makeService(memory);
  const created = await setup.createGame({ humanName: 'Cid', aiCount: 2 });
  let update = created.update;
  while (update.legalMoves.length < 2) {
    update = await setup.submitMove(created.gameId, created.seatToken, {
      version: update.version,
      moveId: firstLegalMoveId(update),
      clientRequestId: `r-${update.version + 1}`,
    });
  }
  const gated = new GatedStore(memory);
  gated.barrierOnCommitPut(2);
  const { service, state }: { service: GameService; state: GameStateManager } = makeService(gated);
  await remember(state, created.gameId, 0, created.seatToken);
  const outcomes = await Promise.allSettled(
    [0, 1].map((i) =>
      service.submitMove(created.gameId, created.seatToken, {
        version: update.version,
        moveId: update.legalMoves[i].id,
        clientRequestId: `race-${i}`,
      }),
    ),
  );
  for (const o of outcomes) {
    const value = o.status === 'fulfilled' ? o.value : (o.reason as unknown);
    observe({ label: `race ${o.status}`, state, gameId: created.gameId, seat: 0, value });
  }
  expect(outcomes.some((o) => o.status === 'rejected')).toBe(true);
}

beforeAll(async () => {
  await playFullGame();
  await midGameRejections();
  await notYourTurn();
  await raceConflict();
});

describe('VC-725 (a): every update shows only what its seat may see', () => {
  it('collected the expected kinds of values', () => {
    const errors = observations.filter((o) => o.value instanceof Error).map((o) => o.value);
    expect(errors.some((e) => e instanceof VersionConflict)).toBe(true);
    expect(errors.some((e) => e instanceof NotYourTurn)).toBe(true);
    expect(errors.filter((e) => e instanceof IllegalMove)).toHaveLength(2);
    expect(observations.length).toBeGreaterThan(50);
  });

  it('view = buildPlayerView(stored state of update.version, seat); no other seat’s card outside events', async () => {
    let checked = 0;
    let cardsSeen = 0;
    for (const o of observations) {
      for (const update of updatesOf(o.value)) {
        const stored = (await o.state.load(o.gameId, update.version)).state;
        expect(update.view, o.label).toEqual(buildPlayerView(stored, o.seat));
        const others = new Set<string>();
        if (stored.hand !== null) {
          const trump = cardId(stored.hand.trumpCard);
          stored.hand.hands.forEach((cards, seat) => {
            if (seat === o.seat) return;
            for (const c of cards) if (cardId(c) !== trump) others.add(cardId(c));
          });
        }
        const withoutEvents: unknown = JSON.parse(JSON.stringify({ ...update, events: undefined }));
        const cards = cardsIn(withoutEvents);
        const leaked = cards.filter((c) => others.has(c.id));
        expect(leaked, o.label).toEqual([]);
        cardsSeen += cards.length;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
    expect(cardsSeen).toBeGreaterThan(100);
  });
});

describe('VC-725 (b): no secret in any returned value or service error', () => {
  it('no seed, no seat-token hash, no aiDecisionCount; R-033: no "hands":[[', () => {
    for (const o of observations) {
      const json = JSON.stringify(serializable(o.value));
      const s = secrets.get(o.gameId) as GameSecrets;
      expect(json.includes(s.seed), `${o.label}: seed`).toBe(false);
      expect(json.includes(s.hash), `${o.label}: hash`).toBe(false);
      expect(json.includes('aiDecisionCount'), `${o.label}: aiDecisionCount`).toBe(false);
      expect(json.includes('"hands":[['), `${o.label}: hands`).toBe(false);
    }
  });

  it('every service error’s JSON (name, message, own fields) has no "hands":[[ (R-033)', () => {
    const errors = observations.filter((o) => o.value instanceof Error);
    expect(errors.length).toBeGreaterThanOrEqual(6);
    for (const o of errors) {
      const json = JSON.stringify(serializable(o.value));
      expect(json).toContain('"message"');
      expect(json).not.toContain('"hands":[[');
    }
  });

  it('events carry cards only in card-played.card and hand-dealt.trumpCard', () => {
    let events = 0;
    for (const o of observations) {
      for (const update of updatesOf(o.value)) {
        for (const event of update.events as GameEvent[]) {
          const paths = cardsIn(event).map((c) => c.path);
          const allowed =
            event.type === 'card-played'
              ? ['card']
              : event.type === 'hand-dealt'
                ? ['trumpCard']
                : [];
          expect(paths, `${o.label}: ${event.type}`).toEqual(allowed);
          events++;
        }
      }
    }
    expect(events).toBeGreaterThan(100);
  });

  it('the seat token appears only in createGame’s result', () => {
    const creates = observations.filter((o) => o.label.startsWith('createGame'));
    for (const o of creates) {
      const token = (secrets.get(o.gameId) as GameSecrets).token;
      expect(JSON.stringify(o.value)).toContain(token);
    }
    const tokens = [...secrets.values()].map((s) => s.token);
    for (const json of nonCreateJson) {
      for (const token of tokens) expect(json.includes(token)).toBe(false);
    }
  });
});
