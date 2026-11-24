// Request and error logging (spec FR-814–FR-816, BR-803; plan P-7). VC-827 (create part), VC-828.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGameHandler, presetsHandler } from '@/app/api/_lib/handlers';
import { consoleLog, withRequestLog } from '@/app/api/_lib/log';
import { CreateGameResponseSchema } from '@/app/api/_lib/schemas';
import { ConfigError } from '@/src/config';
import { getReq, makeApi, postJson, readJson, type Api } from './support/api-fixtures';

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
