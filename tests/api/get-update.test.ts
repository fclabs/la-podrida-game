// GET /api/games/{id} through `getGameHandler` (spec FR-804, FR-805, FR-807, FR-809, FR-813;
// VC-800 (200), VC-809–VC-812 for GET, VC-816, VC-822, VC-823, VC-826 for the route).
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '@/app/api/_lib/errors';
import { getGameHandler, submitMoveHandler } from '@/app/api/_lib/handlers';
import { ErrorResponseSchema, PlayerUpdateResponseSchema } from '@/app/api/_lib/schemas';
import type { PlayerUpdate } from '@/src/domain/types';
import { ENGINE_VERSION } from '@/src/engine/engine';
import { GameStateManager } from '@/src/state/game-state-manager';
import { commitKey, metaKey } from '@/src/state/keys';
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

async function get(
  api: Api,
  id: string,
  headers: Record<string, string> | undefined,
  query = '',
): Promise<{ res: Response; body: unknown }> {
  const res = await getGameHandler(getReq(`/api/games/${id}${query}`, headers), ctx(id), api.deps);
  return { res, body: await readJson(res) };
}

function expectErrorBody(body: unknown, code: keyof typeof ERROR_MESSAGES, field?: string): void {
  const parsed = ErrorResponseSchema.parse(body);
  expect(parsed.error.code).toBe(code);
  const base = ERROR_MESSAGES[code];
  expect(parsed.error.message).toBe(field === undefined ? base : `${base}: ${field}`);
}

/** Plays `n` human moves through the handler; returns the game ids with the latest update. */
async function advance(api: Api, ids: GameIds, n: number): Promise<GameIds> {
  let update: PlayerUpdate = ids.update;
  for (let i = 0; i < n; i++) {
    const res = await submitMoveHandler(
      postJson(
        `/api/games/${ids.gameId}/moves`,
        { version: update.version, moveId: firstLegalMoveId(update), clientRequestId: `adv-${i}` },
        { headers: bearer(ids.seatToken) },
      ),
      ctx(ids.gameId),
      api.deps,
    );
    expect(res.status).toBe(200);
    update = PlayerUpdateResponseSchema.parse(await readJson(res));
  }
  return { ...ids, update };
}

describe('VC-816: GET with the creator token → 200', () => {
  it('answers the tip with no events, parsing with PlayerUpdateResponseSchema', async () => {
    const api = makeApi();
    const ids = await advance(api, await createGameVia(api), 2);
    const { res, body } = await get(api, ids.gameId, bearer(ids.seatToken));
    expect(res.status).toBe(200);
    const update = PlayerUpdateResponseSchema.parse(body);
    expect(update.version).toBe(2);
    expect(update.events).toEqual([]);
    expect(update.view.you).toBe(0);
    expect(update.view).toEqual(ids.update.view);
  });

  it('VC-800: the 200 has the JSON and no-store headers', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const { res } = await get(api, ids.gameId, bearer(ids.seatToken));
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('VC-809: since syntax', () => {
  const bad = ['', '-1', '1.5', 'abc', '01', '100000000'];
  it.each(bad)('since=%j → 400 Invalid request: since', async (value) => {
    const api = makeApi();
    const ids = await createGameVia(api);
    api.store.reset();
    const { res, body } = await get(
      api,
      ids.gameId,
      bearer(ids.seatToken),
      `?since=${encodeURIComponent(value)}`,
    );
    expect(res.status).toBe(400);
    expectErrorBody(body, 'invalid_request', 'since');
    expect(api.store.callsOf()).toHaveLength(0);
  });

  it('a repeated since → 400 since', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const { res, body } = await get(api, ids.gameId, bearer(ids.seatToken), '?since=0&since=0');
    expect(res.status).toBe(400);
    expectErrorBody(body, 'invalid_request', 'since');
  });

  it('since=0 → 200 with the events of commits 1…tip', async () => {
    const api = makeApi();
    const ids = await advance(api, await createGameVia(api), 3);
    const { res, body } = await get(api, ids.gameId, bearer(ids.seatToken), '?since=0');
    expect(res.status).toBe(200);
    const update = PlayerUpdateResponseSchema.parse(body);
    expect(update.version).toBe(3);

    const state = new GameStateManager(api.store);
    const expected = [];
    for (let v = 1; v <= 3; v++) expected.push(...(await state.load(ids.gameId, v)).events);
    expect(expected.length).toBeGreaterThan(0);
    expect(update.events).toEqual(expected);
  });

  it('other query parameters are ignored', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const { res } = await get(api, ids.gameId, bearer(ids.seatToken), '?foo=bar&x=');
    expect(res.status).toBe(200);
  });
});

describe('VC-810: since against the tip', () => {
  it('since = tip → 200 with events []', async () => {
    const api = makeApi();
    const ids = await advance(api, await createGameVia(api), 2);
    const { res, body } = await get(api, ids.gameId, bearer(ids.seatToken), '?since=2');
    expect(res.status).toBe(200);
    const update = PlayerUpdateResponseSchema.parse(body);
    expect(update.version).toBe(2);
    expect(update.events).toEqual([]);
  });

  it('since = tip + 1 → 400 Invalid request: since', async () => {
    const api = makeApi();
    const ids = await advance(api, await createGameVia(api), 2);
    const { res, body } = await get(api, ids.gameId, bearer(ids.seatToken), '?since=3');
    expect(res.status).toBe(400);
    expectErrorBody(body, 'invalid_request', 'since');
  });

  it('since = MAX_COMMIT_VERSION on a fresh game → 400 since', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const { res, body } = await get(api, ids.gameId, bearer(ids.seatToken), '?since=99999999');
    expect(res.status).toBe(400);
    expectErrorBody(body, 'invalid_request', 'since');
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

describe('VC-811: malformed Authorization on GET', () => {
  it.each(MALFORMED_AUTH)('%s → 401 with no store call', async (_name, headers) => {
    const api = makeApi();
    const ids = await createGameVia(api);
    api.store.reset();
    const { res, body } = await get(api, ids.gameId, headers);
    expect(res.status).toBe(401);
    expectErrorBody(body, 'unauthorized');
    expect(api.store.callsOf().length).toBe(0);
  });

  it('a lower-case bearer scheme → 200', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const { res } = await get(api, ids.gameId, { authorization: `bearer ${ids.seatToken}` });
    expect(res.status).toBe(200);
  });
});

describe('VC-812: wrong tokens on GET', () => {
  it('a well-formed foreign token → 401', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const { res, body } = await get(api, ids.gameId, bearer('A'.repeat(43)));
    expect(res.status).toBe(401);
    expectErrorBody(body, 'unauthorized');
  });

  it('the token of a second game → 401', async () => {
    const api = makeApi();
    const first = await createGameVia(api);
    const second = await createGameVia(api);
    const { res, body } = await get(api, first.gameId, bearer(second.seatToken));
    expect(res.status).toBe(401);
    expectErrorBody(body, 'unauthorized');
  });
});

describe('VC-822: unsupported engine version → 410', () => {
  it('a meta rewritten with engineVersion + 1 → 410 game_unsupported', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    const stored = await api.store.get(metaKey(ids.gameId));
    if (stored === null) throw new Error('meta missing');
    const meta = JSON.parse(new TextDecoder().decode(stored.body)) as Record<string, unknown>;
    await api.store.put(
      metaKey(ids.gameId),
      JSON.stringify({ ...meta, engineVersion: ENGINE_VERSION + 1 }),
      { mode: 'overwrite' },
    );
    const { res, body } = await get(api, ids.gameId, bearer(ids.seatToken));
    expect(res.status).toBe(410);
    expectErrorBody(body, 'game_unsupported');
  });
});

describe('VC-823: partial delete → 404', () => {
  it('meta deleted → 404', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    await api.store.delete([metaKey(ids.gameId)]);
    const { res, body } = await get(api, ids.gameId, bearer(ids.seatToken));
    expect(res.status).toBe(404);
    expectErrorBody(body, 'game_not_found');
  });

  it('commit 0 deleted in a fresh game → 404', async () => {
    const api = makeApi();
    const ids = await createGameVia(api);
    await api.store.delete([commitKey(ids.gameId, 0)]);
    const { res, body } = await get(api, ids.gameId, bearer(ids.seatToken));
    expect(res.status).toBe(404);
    expectErrorBody(body, 'game_not_found');
  });

  it('commit 1 deleted at tip ≥ 3, GET ?since=0 → 404', async () => {
    const api = makeApi();
    const ids = await advance(api, await createGameVia(api), 3);
    await api.store.delete([commitKey(ids.gameId, 1)]);
    const { res, body } = await get(api, ids.gameId, bearer(ids.seatToken), '?since=0');
    expect(res.status).toBe(404);
    expectErrorBody(body, 'game_not_found');
  });
});

describe('VC-826 (rest): app/api/games/[id]/route.ts', () => {
  it('exports only GET', async () => {
    const mod = await import('@/app/api/games/[id]/route');
    expect(Object.keys(mod)).toEqual(['GET']);
  });
});
