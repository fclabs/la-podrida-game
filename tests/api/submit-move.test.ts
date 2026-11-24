// POST /api/games/{id}/moves through `submitMoveHandler` (spec FR-803, FR-805, FR-807, FR-810,
// FR-813; VC-805 (move part), VC-808, VC-811/VC-812 for POST, VC-817–VC-821, VC-800 for
// 403/409/422, VC-826 for the route).
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '@/app/api/_lib/errors';
import { submitMoveHandler } from '@/app/api/_lib/handlers';
import { ErrorResponseSchema, PlayerUpdateResponseSchema } from '@/app/api/_lib/schemas';
import { NotYourTurn } from '@/src/service/errors';
import { MAX_COMMIT_VERSION } from '@/src/state/keys';
import { firstLegalMoveId } from '../unit/service/support/service-fixtures';
import {
  bearer,
  createGameVia,
  ctx,
  makeApi,
  playToEndVia,
  postJson,
  readJson,
  wrapService,
  type Api,
  type GameIds,
} from './support/api-fixtures';

async function move(
  api: Api,
  id: string,
  body: unknown,
  headers: Record<string, string> | undefined,
): Promise<{ res: Response; body: unknown }> {
  const res = await submitMoveHandler(
    postJson(`/api/games/${id}/moves`, body, { headers }),
    ctx(id),
    api.deps,
  );
  return { res, body: await readJson(res) };
}

function firstMove(ids: GameIds, clientRequestId = 'c-1') {
  return {
    version: ids.update.version,
    moveId: firstLegalMoveId(ids.update),
    clientRequestId,
  };
}

function expectErrorBody(body: unknown, code: keyof typeof ERROR_MESSAGES, field?: string): void {
  const parsed = ErrorResponseSchema.parse(body);
  expect(parsed.error.code).toBe(code);
  const base = ERROR_MESSAGES[code];
  expect(parsed.error.message).toBe(field === undefined ? base : `${base}: ${field}`);
}

function expectJsonHeaders(res: Response): void {
  expect(res.headers.get('content-type')).toBe('application/json');
  expect(res.headers.get('cache-control')).toBe('no-store');
}

/** The tip version, read through the service with the creator token. */
async function tipOf(api: Api, ids: GameIds): Promise<number> {
  return (await api.service.getUpdate(ids.gameId, ids.seatToken)).version;
}

describe('VC-817: first legal move → 200, version + 1', () => {
  it('answers a PlayerUpdate at version + 1', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const { res, body } = await move(api, ids.gameId, firstMove(ids), bearer(ids.seatToken));
    expect(res.status).toBe(200);
    expectJsonHeaders(res);
    const update = PlayerUpdateResponseSchema.parse(body);
    expect(update.version).toBe(ids.update.version + 1);
    expect(update.view.you).toBe(0);
    expect(await tipOf(api, ids)).toBe(1);
  });

  it('playToEndVia reaches game-over through the handler', async () => {
    const api = makeApi();
    const ids = await createGameVia(api, { humanName: 'Ana', aiCount: 2 });
    const responses = await playToEndVia(api, ids);
    expect(responses.at(-1)?.view.phase).toBe('game-over');
    expect(responses.at(-1)?.legalMoves).toEqual([]);
  });
});

describe('VC-818: an illegal moveId → 422', () => {
  it('play:ZZ → 422 illegal_move, tip unchanged', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const body = { ...firstMove(ids), moveId: 'play:ZZ' };
    const { res, body: resBody } = await move(api, ids.gameId, body, bearer(ids.seatToken));
    expect(res.status).toBe(422);
    expectJsonHeaders(res);
    expectErrorBody(resBody, 'illegal_move');
    expect(await tipOf(api, ids)).toBe(0);
  });
});

describe('VC-819: NotYourTurn → 403', () => {
  it('a wrapped submitMove throwing NotYourTurn(0) → 403 not_your_turn', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    api.deps.getService = () =>
      wrapService(api.service, {
        submitMove: () => Promise.reject(new NotYourTurn(0)),
      });
    const { res, body } = await move(api, ids.gameId, firstMove(ids), bearer(ids.seatToken));
    expect(res.status).toBe(403);
    expectJsonHeaders(res);
    expectErrorBody(body, 'not_your_turn');
  });
});

describe('VC-820: stale version, new clientRequestId → 409', () => {
  it('answers 409 with the tip update', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const first = await move(api, ids.gameId, firstMove(ids), bearer(ids.seatToken));
    expect(first.res.status).toBe(200);

    const stale = { ...firstMove(ids), clientRequestId: 'c-other' };
    const { res, body } = await move(api, ids.gameId, stale, bearer(ids.seatToken));
    expect(res.status).toBe(409);
    expectJsonHeaders(res);
    const parsed = ErrorResponseSchema.parse(body);
    expect(parsed.error).toEqual({
      code: 'version_conflict',
      message: ERROR_MESSAGES.version_conflict,
    });
    expect(parsed.update).toBeDefined();
    expect(PlayerUpdateResponseSchema.parse(parsed.update).version).toBe(await tipOf(api, ids));
    expect(parsed.update?.version).toBe(1);
  });
});

describe('VC-821: idempotent retry', () => {
  it('the same body twice → both 200, deep-equal, tip + 1', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const body = firstMove(ids, 'retry-1');
    const a = await move(api, ids.gameId, body, bearer(ids.seatToken));
    const b = await move(api, ids.gameId, body, bearer(ids.seatToken));
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(await tipOf(api, ids)).toBe(1);
  });

  it('after another move landed, the original body → 200, equal to the first response', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const body = firstMove(ids, 'retry-1');
    const a = await move(api, ids.gameId, body, bearer(ids.seatToken));
    const after = PlayerUpdateResponseSchema.parse(a.body);
    const next = await move(
      api,
      ids.gameId,
      { version: after.version, moveId: firstLegalMoveId(after), clientRequestId: 'retry-2' },
      bearer(ids.seatToken),
    );
    expect(next.res.status).toBe(200);
    expect(await tipOf(api, ids)).toBe(2);

    const again = await move(api, ids.gameId, body, bearer(ids.seatToken));
    expect(again.res.status).toBe(200);
    expect(again.body).toEqual(a.body);
    expect(await tipOf(api, ids)).toBe(2);
  });
});

describe('VC-805 (move part) and VC-808: move body limits', () => {
  const cases: [string, (b: Record<string, unknown>) => unknown, string][] = [
    ['an extra bar field', (b) => ({ ...b, bar: 1 }), 'bar'],
    ['version -1', (b) => ({ ...b, version: -1 }), 'version'],
    ['version 1.5', (b) => ({ ...b, version: 1.5 }), 'version'],
    ['version MAX_COMMIT_VERSION', (b) => ({ ...b, version: MAX_COMMIT_VERSION }), 'version'],
    ["moveId ''", (b) => ({ ...b, moveId: '' }), 'moveId'],
    ['moveId 33 chars', (b) => ({ ...b, moveId: 'm'.repeat(33) }), 'moveId'],
    ["clientRequestId ''", (b) => ({ ...b, clientRequestId: '' }), 'clientRequestId'],
    [
      'clientRequestId 129 chars',
      (b) => ({ ...b, clientRequestId: 'c'.repeat(129) }),
      'clientRequestId',
    ],
  ];
  it.each(cases)('%s → 400 with the field, no store call', async (_name, edit, field) => {
    const api = makeApi();
    const ids = await createGameVia(api);
    api.store.reset();
    const { res, body } = await move(api, ids.gameId, edit(firstMove(ids)), bearer(ids.seatToken));
    expect(res.status).toBe(400);
    expectErrorBody(body, 'invalid_request', field);
    expect(api.store.callsOf()).toHaveLength(0);
  });

  it('moveId 32 chars and clientRequestId 128 chars → not 400 (422: not a legal move)', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const body = { ...firstMove(ids), moveId: 'm'.repeat(32), clientRequestId: 'c'.repeat(128) };
    const { res } = await move(api, ids.gameId, body, bearer(ids.seatToken));
    expect(res.status).toBe(422);
  });

  it('a body over 16 KB → 413; text/plain → 400 body', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const big = await submitMoveHandler(
      postJson(`/api/games/${ids.gameId}/moves`, null, {
        headers: bearer(ids.seatToken),
        rawBody: new TextEncoder().encode(`{"x":"${'a'.repeat(16384)}"}`),
      }),
      ctx(ids.gameId),
      api.deps,
    );
    expect(big.status).toBe(413);
    expectErrorBody(await readJson(big), 'payload_too_large');

    const plain = await submitMoveHandler(
      postJson(`/api/games/${ids.gameId}/moves`, firstMove(ids), {
        headers: bearer(ids.seatToken),
        contentType: 'text/plain',
      }),
      ctx(ids.gameId),
      api.deps,
    );
    expect(plain.status).toBe(400);
    expectErrorBody(await readJson(plain), 'invalid_request', 'body');
  });
});

const MALFORMED_AUTH: readonly [string, Record<string, string> | undefined][] = [
  ['no header', undefined],
  ['Bearer (no token)', { authorization: 'Bearer' }],
  ['Basic abc', { authorization: 'Basic abc' }],
  ['Bearer  two-spaces', { authorization: 'Bearer  two-spaces' }],
  ['Bearer a b', { authorization: 'Bearer a b' }],
  ['Bearer + 257 chars', { authorization: `Bearer ${'a'.repeat(257)}` }],
];

describe('VC-811: malformed Authorization on POST move', () => {
  it.each(MALFORMED_AUTH)('%s → 401 with no store call', async (_name, headers) => {
    const api = makeApi();
    const ids = await createGameVia(api);
    api.store.reset();
    const { res, body } = await move(api, ids.gameId, firstMove(ids), headers);
    expect(res.status).toBe(401);
    expectJsonHeaders(res);
    expectErrorBody(body, 'unauthorized');
    expect(api.store.callsOf().length).toBe(0);
  });

  it('a lower-case bearer scheme → 200', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const { res } = await move(api, ids.gameId, firstMove(ids), {
      authorization: `bearer ${ids.seatToken}`,
    });
    expect(res.status).toBe(200);
  });
});

describe('VC-812: wrong tokens on POST move', () => {
  it('a well-formed foreign token → 401, nothing written', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const { res, body } = await move(api, ids.gameId, firstMove(ids), bearer('A'.repeat(43)));
    expect(res.status).toBe(401);
    expectErrorBody(body, 'unauthorized');
    expect(await tipOf(api, ids)).toBe(0);
  });

  it('the token of a second game → 401', async () => {
    const api = makeApi();
    const first = await createGameVia(api);
    const second = await createGameVia(api);
    const { res, body } = await move(api, first.gameId, firstMove(first), bearer(second.seatToken));
    expect(res.status).toBe(401);
    expectErrorBody(body, 'unauthorized');
  });
});

describe('VC-826 (rest): app/api/games/[id]/moves/route.ts', () => {
  it('exports only POST', async () => {
    const mod = await import('@/app/api/games/[id]/moves/route');
    expect(Object.keys(mod)).toEqual(['POST']);
  });
});
