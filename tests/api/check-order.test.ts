// FR-806 check order on the `[id]` routes (VC-813): id format → Authorization → body / `since`,
// first failure wins, and nothing touches storage (or the service) before all three pass.
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '@/app/api/_lib/errors';
import { getGameHandler, submitMoveHandler } from '@/app/api/_lib/handlers';
import { ErrorResponseSchema } from '@/app/api/_lib/schemas';
import {
  bearer,
  createGameVia,
  ctx,
  getReq,
  makeApi,
  postJson,
  readJson,
  type Api,
} from './support/api-fixtures';

/** A valid-format id no game has. */
const UNKNOWN_ID = 'a'.repeat(26);
const BAD_BODY = new TextEncoder().encode('{');

async function expectCode(res: Response, status: number, code: keyof typeof ERROR_MESSAGES) {
  expect(res.status).toBe(status);
  expect(ErrorResponseSchema.parse(await readJson(res)).error.code).toBe(code);
}

/** Resets the store's call log and counts `getService` calls from here on. */
function watch(api: Api): { serviceCalls: () => number } {
  api.store.reset();
  let calls = 0;
  const inner = api.deps.getService;
  api.deps.getService = () => {
    calls++;
    return inner();
  };
  return { serviceCalls: () => calls };
}

function moveReq(id: string, headers?: Record<string, string>): Request {
  return postJson(`/api/games/${id}/moves`, null, { headers, rawBody: BAD_BODY });
}

describe('VC-813: check order on POST /api/games/{id}/moves', () => {
  it('id BAD, no auth, bad body → 404', async () => {
    const api = makeApi();
    const w = watch(api);
    await expectCode(
      await submitMoveHandler(moveReq('BAD'), ctx('BAD'), api.deps),
      404,
      'game_not_found',
    );
    expect(api.store.callsOf().length).toBe(0);
    expect(w.serviceCalls()).toBe(0);
  });

  it('a valid-format unknown id, no header → 401', async () => {
    const api = makeApi();
    const w = watch(api);
    await expectCode(
      await submitMoveHandler(moveReq(UNKNOWN_ID), ctx(UNKNOWN_ID), api.deps),
      401,
      'unauthorized',
    );
    expect(api.store.callsOf().length).toBe(0);
    expect(w.serviceCalls()).toBe(0);
  });

  it('a valid id, a valid header, the body `{` → 400', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const w = watch(api);
    const res = await submitMoveHandler(
      moveReq(ids.gameId, bearer(ids.seatToken)),
      ctx(ids.gameId),
      api.deps,
    );
    await expectCode(res, 400, 'invalid_request');
    expect(api.store.callsOf().length).toBe(0);
    expect(w.serviceCalls()).toBe(0);
  });
});

describe('VC-813: check order on GET /api/games/{id}', () => {
  it('id BAD, no auth, bad since → 404', async () => {
    const api = makeApi();
    const w = watch(api);
    const res = await getGameHandler(getReq('/api/games/BAD?since=x'), ctx('BAD'), api.deps);
    await expectCode(res, 404, 'game_not_found');
    expect(api.store.callsOf().length).toBe(0);
    expect(w.serviceCalls()).toBe(0);
  });

  it('a valid-format unknown id, no header, bad since → 401', async () => {
    const api = makeApi();
    const w = watch(api);
    const res = await getGameHandler(
      getReq(`/api/games/${UNKNOWN_ID}?since=x`),
      ctx(UNKNOWN_ID),
      api.deps,
    );
    await expectCode(res, 401, 'unauthorized');
    expect(api.store.callsOf().length).toBe(0);
    expect(w.serviceCalls()).toBe(0);
  });

  it('a valid id, a valid header, a bad since → 400', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const w = watch(api);
    const res = await getGameHandler(
      getReq(`/api/games/${ids.gameId}?since=01`, bearer(ids.seatToken)),
      ctx(ids.gameId),
      api.deps,
    );
    await expectCode(res, 400, 'invalid_request');
    expect(api.store.callsOf().length).toBe(0);
    expect(w.serviceCalls()).toBe(0);
  });

  it('a valid-format unknown id with a valid-format token → 404 from the service', async () => {
    const api = makeApi();
    const res = await getGameHandler(
      getReq(`/api/games/${UNKNOWN_ID}`, bearer('A'.repeat(43))),
      ctx(UNKNOWN_ID),
      api.deps,
    );
    await expectCode(res, 404, 'game_not_found');
  });
});

describe('FR-806 step 1: malformed ids → 404', () => {
  const ids = ['BAD', '', 'A'.repeat(26), 'a'.repeat(25), 'a'.repeat(27), `${'a'.repeat(25)}1`];
  it.each(ids)('id %j → 404 on both routes', async (id) => {
    const api = makeApi();
    await expectCode(
      await getGameHandler(getReq('/api/games/x'), ctx(id), api.deps),
      404,
      'game_not_found',
    );
    await expectCode(
      await submitMoveHandler(moveReq('x'), ctx(id), api.deps),
      404,
      'game_not_found',
    );
    expect(api.store.callsOf().length).toBe(0);
  });
});
