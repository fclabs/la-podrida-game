// Secrets never reach logs or 500 bodies (spec BR-802, BR-803; VC-829, VC-830).
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '@/app/api/_lib/errors';
import { getGameHandler, submitMoveHandler } from '@/app/api/_lib/handlers';
import { ErrorResponseSchema } from '@/app/api/_lib/schemas';
import type { PlayerUpdate } from '@/src/domain/types';
import { AiLoopLimitError } from '@/src/service/ai-loop';
import { GameStateManager } from '@/src/state/game-state-manager';
import { firstLegalMoveId } from '../unit/service/support/service-fixtures';
import {
  bearer,
  createGameVia,
  ctx,
  getReq,
  makeApi,
  playToEndVia,
  postJson,
  readJson,
  wrapService,
  type Api,
  type GameIds,
} from './support/api-fixtures';

/** The seed and the seat-token hashes of a stored game. */
async function storedSecrets(api: Api, gameId: string): Promise<string[]> {
  const manager = new GameStateManager(api.store);
  const meta = await manager.loadMeta(gameId);
  const { state } = await manager.loadLatest(gameId);
  const hashes = meta.seatTokenHashes.filter((h): h is string => h !== null);
  expect(hashes.length).toBeGreaterThan(0);
  return [state.seed, ...hashes];
}

function move(api: Api, ids: GameIds, body: unknown, headers = bearer(ids.seatToken)) {
  return submitMoveHandler(
    postJson(`/api/games/${ids.gameId}/moves`, body, { headers }),
    ctx(ids.gameId),
    api.deps,
  );
}

function get(api: Api, ids: GameIds, query = '', headers = bearer(ids.seatToken)) {
  return getGameHandler(
    getReq(`/api/games/${ids.gameId}${query}`, headers),
    ctx(ids.gameId),
    api.deps,
  );
}

describe('VC-829: no log line carries a token, a hash, a seed or a hand', () => {
  it('a full scripted game plus every error kind logs no secret', async () => {
    const api = makeApi({ logLevel: 'debug' });
    const ids = await createGameVia(api, { humanName: 'Ana', aiCount: 3 });
    const other = await createGameVia(api, { humanName: 'Bea', aiCount: 2 });

    // Errors before any move: foreign token, the other game's token, malformed headers.
    const foreign = 'F'.repeat(43);
    expect((await get(api, ids, '', bearer(foreign))).status).toBe(401);
    expect((await get(api, ids, '', bearer(other.seatToken))).status).toBe(401);
    expect((await get(api, ids, '', { authorization: `Basic ${ids.seatToken}` })).status).toBe(401);
    expect((await get(api, ids, '', { authorization: `bearer ${ids.seatToken}` })).status).toBe(
      200,
    );

    // One move, then a 409, a 422, a stale-since 400 and a 500.
    const first = await move(api, ids, {
      version: ids.update.version,
      moveId: firstLegalMoveId(ids.update),
      clientRequestId: 'secret-1',
    });
    expect(first.status).toBe(200);
    const stale = { version: ids.update.version, moveId: 'bid:0', clientRequestId: 'secret-2' };
    expect((await move(api, ids, stale)).status).toBe(409);
    const tip = ids.update.version + 1;
    const illegal = { version: tip, moveId: 'play:ZZ', clientRequestId: 'secret-3' };
    expect((await move(api, ids, illegal)).status).toBe(422);
    expect((await get(api, ids, `?since=${tip + 1}`)).status).toBe(400);
    const getService = api.deps.getService;
    api.deps.getService = () => {
      throw new Error('storage exploded');
    };
    expect((await get(api, ids)).status).toBe(500);
    api.deps.getService = getService;

    // The rest of the game, with a GET (with and without since) after every move.
    const updates = await playToEndVia(api, {
      ...ids,
      update: await readJson<PlayerUpdate>(first),
    });
    for (const update of updates.slice(0, 20)) {
      expect((await get(api, ids, `?since=${update.version - 1}`)).status).toBe(200);
    }
    expect((await get(api, ids, '?since=0')).status).toBe(200);
    expect(updates.at(-1)?.view.phase).toBe('game-over');

    const logged = JSON.stringify(api.logs);
    expect(api.logs.length).toBeGreaterThan(updates.length);
    expect(api.logs.some((l) => l.level === 'error')).toBe(true);
    const secrets = [
      ids.seatToken,
      other.seatToken,
      foreign,
      ...(await storedSecrets(api, ids.gameId)),
      ...(await storedSecrets(api, other.gameId)),
    ];
    for (const secret of secrets) expect(logged).not.toContain(secret);
    expect(logged).not.toContain('Bearer');
    expect(logged.toLowerCase()).not.toContain('bearer ');
    expect(logged).not.toContain('"hands"');
    expect(logged).not.toContain('"seed"');
    expect(logged).not.toContain('"suit"');
  });
});

describe('VC-830: AiLoopLimitError with a real state → fixed 500, nothing of the state', () => {
  it('the body has no card of any hand and no seed; the error line has no seed', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const { state } = await new GameStateManager(api.store).loadLatest(ids.gameId);
    if (state.hand === null) throw new Error('expected a hand in progress');
    const cards = state.hand.hands.flat();
    expect(cards.length).toBeGreaterThan(0);
    api.deps.getService = () =>
      wrapService(api.service, {
        submitMove: () => Promise.reject(new AiLoopLimitError(1000, state)),
      });

    const res = await move(api, ids, {
      version: ids.update.version,
      moveId: firstLegalMoveId(ids.update),
      clientRequestId: 'loop-1',
    });
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(ErrorResponseSchema.parse(body)).toEqual({
      error: { code: 'internal', message: ERROR_MESSAGES.internal },
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(state.seed);
    for (const card of cards) expect(serialized).not.toContain(JSON.stringify(card));

    const errorLines = api.logs.filter((l) => l.level === 'error');
    expect(errorLines).toHaveLength(1);
    expect(errorLines[0].line.errorName).toBe('AiLoopLimitError');
    const logged = JSON.stringify(api.logs);
    expect(logged).not.toContain(state.seed);
    expect(logged).not.toContain('"hands"');
    for (const card of cards) expect(logged).not.toContain(JSON.stringify(card));
  });
});
