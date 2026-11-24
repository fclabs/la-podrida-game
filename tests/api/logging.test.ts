// Request and error logging (spec FR-814–FR-816, BR-803; plan P-7). VC-827, VC-828, D-013.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGameHandler,
  getGameHandler,
  presetsHandler,
  submitMoveHandler,
} from '@/app/api/_lib/handlers';
import { consoleLog, withRequestLog } from '@/app/api/_lib/log';
import {
  CreateGameResponseSchema,
  ErrorResponseSchema,
  PlayerUpdateResponseSchema,
} from '@/app/api/_lib/schemas';
import { ConfigError } from '@/src/config';
import type { PlayerUpdate } from '@/src/domain/types';
import { firstLegalMoveId } from '../unit/service/support/service-fixtures';
import {
  bearer,
  createGameVia,
  ctx,
  getReq,
  makeApi,
  postJson,
  readJson,
  type Api,
  type GameIds,
} from './support/api-fixtures';

const PATH = '/api/games';
const VALID = { humanName: 'Ana', aiCount: 3 };
const REQUEST_KEYS = [
  'route',
  'gameId',
  'seat',
  'fromVersion',
  'toVersion',
  'aiMoves',
  'status',
  'durationMs',
  'errorCode',
].sort();
const ERROR_KEYS = ['route', 'gameId', 'errorName', 'errorMessage', 'stack'].sort();

function linesAt(api: Api, level: 'info' | 'error') {
  return api.logs.filter((l) => l.level === level).map((l) => l.line);
}

function failingService(api: Api, err: unknown): void {
  api.deps.getService = () => {
    throw err;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('VC-827 (create part): one info line per request', () => {
  it('a 201 logs seat 0, fromVersion null, toVersion 0 and the AI move count', async () => {
    const api = makeApi();
    const res = await createGameHandler(postJson(PATH, VALID), api.deps);
    expect(res.status).toBe(201);
    const body = CreateGameResponseSchema.parse(await readJson(res));
    const aiMoves = body.update.events.filter(
      (e) => (e.type === 'bid-made' || e.type === 'card-played') && e.seat !== 0,
    ).length;

    expect(api.logs).toHaveLength(1);
    const [line] = linesAt(api, 'info');
    expect(Object.keys(line).sort()).toEqual(REQUEST_KEYS);
    expect(line).toEqual({
      route: 'POST /api/games',
      gameId: body.gameId,
      seat: 0,
      fromVersion: null,
      toVersion: 0,
      aiMoves,
      status: 201,
      durationMs: 1,
      errorCode: null,
    });
  });

  it('counts only other seats’ bids and plays', async () => {
    // Random deals: AIs bid before the human in some of them; the count must always match.
    for (let i = 0; i < 5; i++) {
      const api = makeApi();
      const res = await createGameHandler(
        postJson(PATH, { humanName: 'Ana', aiCount: 5 }),
        api.deps,
      );
      const body = CreateGameResponseSchema.parse(await readJson(res));
      const expected = body.update.events.filter(
        (e) => (e.type === 'bid-made' || e.type === 'card-played') && e.seat !== 0,
      ).length;
      expect(linesAt(api, 'info')[0].aiMoves).toBe(expected);
    }
  });

  it('a 400 logs seat null, no update fields and errorCode invalid_request', async () => {
    const api = makeApi();
    const res = await createGameHandler(postJson(PATH, { ...VALID, aiCount: 1 }), api.deps);
    expect(res.status).toBe(400);
    expect(api.logs).toHaveLength(1);
    const [line] = linesAt(api, 'info');
    expect(Object.keys(line).sort()).toEqual(REQUEST_KEYS);
    expect(line).toMatchObject({
      route: 'POST /api/games',
      gameId: null,
      seat: null,
      fromVersion: null,
      toVersion: null,
      aiMoves: null,
      status: 400,
      errorCode: 'invalid_request',
    });
    expect(Number.isInteger(line.durationMs)).toBe(true);
  });

  it('a presets 200 logs route GET /api/presets with no update fields', async () => {
    const api = makeApi();
    await presetsHandler(getReq('/api/presets'), api.deps);
    expect(linesAt(api, 'info')).toEqual([
      {
        route: 'GET /api/presets',
        gameId: null,
        seat: null,
        fromVersion: null,
        toVersion: null,
        aiMoves: null,
        status: 200,
        durationMs: 1,
        errorCode: null,
      },
    ]);
  });

  it('durationMs is Math.round of the clock difference', async () => {
    const api = makeApi();
    const ticks = [10.2, 13.9];
    api.deps.now = () => ticks.shift() ?? 0;
    await presetsHandler(getReq('/api/presets'), api.deps);
    expect(linesAt(api, 'info')[0].durationMs).toBe(4);
  });
});

describe('VC-828: level gating', () => {
  it('warn: a 201 emits no line', async () => {
    const api = makeApi({ logLevel: 'warn' });
    const res = await createGameHandler(postJson(PATH, VALID), api.deps);
    expect(res.status).toBe(201);
    expect(api.logs).toEqual([]);
  });

  it('warn: a 500 emits exactly one error line', async () => {
    const api = makeApi({ logLevel: 'warn' });
    failingService(api, new Error('boom'));
    const res = await createGameHandler(postJson(PATH, VALID), api.deps);
    expect(res.status).toBe(500);
    expect(api.logs).toHaveLength(1);
    expect(api.logs[0].level).toBe('error');
  });

  it('error: a 500 emits exactly one error line', async () => {
    const api = makeApi({ logLevel: 'error' });
    failingService(api, new Error('boom'));
    await createGameHandler(postJson(PATH, VALID), api.deps);
    expect(api.logs.map((l) => l.level)).toEqual(['error']);
  });

  it('debug: a 201 emits one info line', async () => {
    const api = makeApi({ logLevel: 'debug' });
    await createGameHandler(postJson(PATH, VALID), api.deps);
    expect(api.logs.map((l) => l.level)).toEqual(['info']);
  });

  it('info: a 500 emits one info line and one error line', async () => {
    const api = makeApi();
    failingService(api, new Error('boom'));
    await createGameHandler(postJson(PATH, VALID), api.deps);
    expect(api.logs.map((l) => l.level).sort()).toEqual(['error', 'info']);
    expect(linesAt(api, 'info')[0]).toMatchObject({ status: 500, errorCode: 'internal' });
  });

  it('getConfig throwing: a 500 emits both lines (defaulting to info)', async () => {
    const api = makeApi({ logLevel: 'warn' });
    api.deps.getConfig = () => {
      throw new ConfigError('Invalid configuration:\n  - LOG_LEVEL must be one of x');
    };
    const res = await presetsHandler(getReq('/api/presets'), api.deps);
    expect(res.status).toBe(500);
    expect(api.logs.map((l) => l.level).sort()).toEqual(['error', 'info']);
    expect(linesAt(api, 'error')[0].errorName).toBe('ConfigError');
  });

  it('non-500 errors emit no error line', async () => {
    const api = makeApi({ logLevel: 'warn' });
    await createGameHandler(postJson(PATH, { ...VALID, aiCount: 1 }), api.deps);
    expect(api.logs).toEqual([]);
  });
});

describe('FR-815: the error line', () => {
  it('has exactly route, gameId, errorName, errorMessage and stack', async () => {
    const api = makeApi();
    failingService(api, new TypeError('kaput'));
    await createGameHandler(postJson(PATH, VALID), api.deps);
    const [line] = linesAt(api, 'error');
    expect(Object.keys(line).sort()).toEqual(ERROR_KEYS);
    expect(line).toMatchObject({
      route: 'POST /api/games',
      gameId: null,
      errorName: 'TypeError',
      errorMessage: 'kaput',
    });
    expect(typeof line.stack).toBe('string');
  });

  it('clips errorMessage to 500 characters', async () => {
    const api = makeApi();
    failingService(api, new Error('x'.repeat(600)));
    await createGameHandler(postJson(PATH, VALID), api.deps);
    expect(linesAt(api, 'error')[0].errorMessage).toBe('x'.repeat(500));
  });

  it('a non-Error value: errorName is its typeof, stack null', async () => {
    const api = makeApi();
    failingService(api, 'just a string');
    await createGameHandler(postJson(PATH, VALID), api.deps);
    expect(linesAt(api, 'error')[0]).toMatchObject({
      errorName: 'string',
      errorMessage: 'just a string',
      stack: null,
    });
  });

  it('never logs error properties (BR-803)', async () => {
    const api = makeApi();
    const err = Object.assign(new Error('boom'), { state: { seed: 'seed-secret-123' } });
    failingService(api, err);
    await createGameHandler(postJson(PATH, VALID), api.deps);
    expect(JSON.stringify(api.logs)).not.toContain('seed-secret-123');
  });
});

describe('BR-803: create logs carry no secrets', () => {
  it('no seat token, no name, no body in any line', async () => {
    const api = makeApi();
    const res = await createGameHandler(
      postJson(PATH, { humanName: 'Zelda-Unique', aiCount: 3 }),
      api.deps,
    );
    const body = CreateGameResponseSchema.parse(await readJson(res));
    const logged = JSON.stringify(api.logs);
    expect(logged).not.toContain(body.seatToken);
    expect(logged).not.toContain('Zelda-Unique');
    expect(logged).not.toContain('hands');
  });
});

describe('withRequestLog: meta filled before a throw', () => {
  it('logs the gameId and fromVersion the body recorded before throwing', async () => {
    const api = makeApi();
    await withRequestLog('GET /api/games/[id]', api.deps, async (meta) => {
      meta.gameId = 'abc';
      meta.fromVersion = 3;
      throw new Error('boom');
    });
    expect(linesAt(api, 'info')[0]).toMatchObject({ gameId: 'abc', fromVersion: 3, status: 500 });
    expect(linesAt(api, 'error')[0]).toMatchObject({ gameId: 'abc' });
  });
});

describe('consoleLog', () => {
  it('info → console.log, error → console.error, one JSON line each', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLog('info', { a: 1 });
    consoleLog('error', { b: 2 });
    expect(log).toHaveBeenCalledExactlyOnceWith('{"a":1}');
    expect(error).toHaveBeenCalledExactlyOnceWith('{"b":2}');
  });
});

const MOVE_ROUTE = 'POST /api/games/[id]/moves';
const GET_ROUTE = 'GET /api/games/[id]';

function aiMovesIn(update: PlayerUpdate): number {
  return update.events.filter(
    (e) => (e.type === 'bid-made' || e.type === 'card-played') && e.seat !== update.view.you,
  ).length;
}

async function moveVia(
  api: Api,
  ids: GameIds,
  body: unknown,
  headers: Record<string, string> | undefined = bearer(ids.seatToken),
): Promise<{ res: Response; body: unknown }> {
  const res = await submitMoveHandler(
    postJson(`/api/games/${ids.gameId}/moves`, body, { headers }),
    ctx(ids.gameId),
    api.deps,
  );
  return { res, body: await readJson(res) };
}

/** The single info line of the last request (asserts exactly one was added). */
function onlyNewLine(api: Api, before: number): Record<string, unknown> {
  const added = api.logs.slice(before);
  expect(added).toHaveLength(1);
  expect(added[0].level).toBe('info');
  expect(Object.keys(added[0].line).sort()).toEqual(REQUEST_KEYS);
  expect(Number.isInteger(added[0].line.durationMs)).toBe(true);
  return added[0].line;
}

describe('VC-827 (rest): GET and move lines', () => {
  it('a 200 move logs fromVersion, toVersion and the AI bid/play count', async () => {
    const api = makeApi();
    let ids = await createGameVia(api);
    let sawAiMoves = false;
    // Several moves, so at least one response carries AI bids/plays.
    for (let i = 0; i < 6; i++) {
      const before = api.logs.length;
      const body = {
        version: ids.update.version,
        moveId: firstLegalMoveId(ids.update),
        clientRequestId: `log-${i}`,
      };
      const { res, body: resBody } = await moveVia(api, ids, body);
      expect(res.status).toBe(200);
      const update = PlayerUpdateResponseSchema.parse(resBody);
      const k = aiMovesIn(update);
      if (k > 0) sawAiMoves = true;
      expect(onlyNewLine(api, before)).toEqual({
        route: MOVE_ROUTE,
        gameId: ids.gameId,
        seat: 0,
        fromVersion: body.version,
        toVersion: body.version + 1,
        aiMoves: k,
        status: 200,
        durationMs: 1,
        errorCode: null,
      });
      ids = { ...ids, update };
    }
    expect(sawAiMoves).toBe(true);
  });

  it('a 200 GET logs fromVersion = since (or null) and aiMoves over the missed events', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const body = { version: 0, moveId: firstLegalMoveId(ids.update), clientRequestId: 'g-1' };
    await moveVia(api, ids, body);

    let before = api.logs.length;
    const plain = await getGameHandler(
      getReq(`/api/games/${ids.gameId}`, bearer(ids.seatToken)),
      ctx(ids.gameId),
      api.deps,
    );
    expect(plain.status).toBe(200);
    expect(onlyNewLine(api, before)).toMatchObject({
      route: GET_ROUTE,
      gameId: ids.gameId,
      seat: 0,
      fromVersion: null,
      toVersion: 1,
      aiMoves: 0,
      status: 200,
      errorCode: null,
    });

    before = api.logs.length;
    const since = await getGameHandler(
      getReq(`/api/games/${ids.gameId}?since=0`, bearer(ids.seatToken)),
      ctx(ids.gameId),
      api.deps,
    );
    const update = PlayerUpdateResponseSchema.parse(await readJson(since));
    expect(onlyNewLine(api, before)).toMatchObject({
      fromVersion: 0,
      toVersion: 1,
      aiMoves: aiMovesIn(update),
      seat: 0,
    });
  });

  it('a 401 logs seat null, toVersion null, errorCode unauthorized', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const before = api.logs.length;
    const body = { version: 0, moveId: firstLegalMoveId(ids.update), clientRequestId: 'u-1' };
    const { res } = await moveVia(api, ids, body, {});
    expect(res.status).toBe(401);
    expect(onlyNewLine(api, before)).toEqual({
      route: MOVE_ROUTE,
      gameId: ids.gameId,
      seat: null,
      fromVersion: null,
      toVersion: null,
      aiMoves: null,
      status: 401,
      durationMs: 1,
      errorCode: 'unauthorized',
    });
  });

  it('a 422 logs seat null, errorCode illegal_move, the request version', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const before = api.logs.length;
    const { res } = await moveVia(api, ids, {
      version: 0,
      moveId: 'play:ZZ',
      clientRequestId: 'i-1',
    });
    expect(res.status).toBe(422);
    expect(onlyNewLine(api, before)).toMatchObject({
      route: MOVE_ROUTE,
      gameId: ids.gameId,
      seat: null,
      fromVersion: 0,
      toVersion: null,
      aiMoves: null,
      status: 422,
      errorCode: 'illegal_move',
    });
  });

  it('a 409 logs the update seat and version', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const moveId = firstLegalMoveId(ids.update);
    await moveVia(api, ids, { version: 0, moveId, clientRequestId: 'v-1' });
    const before = api.logs.length;
    const { res, body } = await moveVia(api, ids, { version: 0, moveId, clientRequestId: 'v-2' });
    expect(res.status).toBe(409);
    const update = ErrorResponseSchema.parse(body).update;
    if (update === undefined) throw new Error('409 without update');
    expect(onlyNewLine(api, before)).toEqual({
      route: MOVE_ROUTE,
      gameId: ids.gameId,
      seat: update.view.you,
      fromVersion: 0,
      toVersion: update.version,
      aiMoves: aiMovesIn(update),
      status: 409,
      durationMs: 1,
      errorCode: 'version_conflict',
    });
    expect(update.version).toBe(1);
  });

  it('a 400 since past the tip logs fromVersion = since and no update', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const before = api.logs.length;
    const res = await getGameHandler(
      getReq(`/api/games/${ids.gameId}?since=5`, bearer(ids.seatToken)),
      ctx(ids.gameId),
      api.deps,
    );
    expect(res.status).toBe(400);
    expect(onlyNewLine(api, before)).toMatchObject({
      route: GET_ROUTE,
      gameId: ids.gameId,
      seat: null,
      fromVersion: 5,
      toVersion: null,
      aiMoves: null,
      errorCode: 'invalid_request',
    });
  });
});

describe('D-013: the path id is logged only once it has the game id format', () => {
  it('a malformed id → 404 line with gameId null on both routes', async () => {
    const api = makeApi();
    const raw = `BAD-${'x'.repeat(5000)}`;
    await getGameHandler(getReq('/api/games/x'), ctx(raw), api.deps);
    await submitMoveHandler(
      postJson('/api/games/x/moves', { version: 0, moveId: 'm', clientRequestId: 'c' }),
      ctx(raw),
      api.deps,
    );
    const lines = linesAt(api, 'info');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toMatchObject({ gameId: null, status: 404, errorCode: 'game_not_found' });
    }
    expect(JSON.stringify(api.logs)).not.toContain('BAD-');
  });

  it('a valid-format unknown id → its 401 line carries the id', async () => {
    const api = makeApi();
    const id = 'a'.repeat(26);
    await getGameHandler(getReq(`/api/games/${id}`), ctx(id), api.deps);
    expect(linesAt(api, 'info')[0]).toMatchObject({ gameId: id, status: 401 });
  });
});

describe('BR-803: GET and move logs carry no token', () => {
  it('no seat token and no Bearer in any line', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    await moveVia(api, ids, {
      version: 0,
      moveId: firstLegalMoveId(ids.update),
      clientRequestId: 's-1',
    });
    await getGameHandler(
      getReq(`/api/games/${ids.gameId}?since=0`, bearer(ids.seatToken)),
      ctx(ids.gameId),
      api.deps,
    );
    const logged = JSON.stringify(api.logs);
    expect(logged).not.toContain(ids.seatToken);
    expect(logged).not.toContain('Bearer');
    expect(logged).not.toContain('hands');
  });
});
