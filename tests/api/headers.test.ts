// Headers and error bodies across every status the API answers (spec FR-800, FR-801, BR-802;
// VC-800, VC-801). One real response per status, each built over the handlers.
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES, type ErrorCode } from '@/app/api/_lib/errors';
import {
  createGameHandler,
  getGameHandler,
  presetsHandler,
  submitMoveHandler,
} from '@/app/api/_lib/handlers';
import { ErrorResponseSchema, PlayerUpdateResponseSchema } from '@/app/api/_lib/schemas';
import { ENGINE_VERSION } from '@/src/engine/engine';
import { NotYourTurn } from '@/src/service/errors';
import { metaKey } from '@/src/state/keys';
import { firstLegalMoveId } from '../unit/service/support/service-fixtures';
import {
  bearer,
  createGameVia,
  ctx,
  getReq,
  makeApi,
  postJson,
  readJson,
  wrapService,
  type Api,
  type GameIds,
} from './support/api-fixtures';

const UNKNOWN_ID = 'a'.repeat(26);

function move(api: Api, ids: GameIds, body: unknown): Promise<Response> {
  return submitMoveHandler(
    postJson(`/api/games/${ids.gameId}/moves`, body, { headers: bearer(ids.seatToken) }),
    ctx(ids.gameId),
    api.deps,
  );
}

function firstMove(ids: GameIds, clientRequestId: string) {
  return { version: ids.update.version, moveId: firstLegalMoveId(ids.update), clientRequestId };
}

/** One scenario per status: it returns a fresh response of that status. */
const SCENARIOS: {
  status: number;
  code: ErrorCode | null;
  field?: string;
  make: () => Promise<Response>;
}[] = [
  {
    status: 200,
    code: null,
    make: async () => {
      const api = makeApi();
      const ids = await createGameVia(api);
      return getGameHandler(
        getReq(`/api/games/${ids.gameId}`, bearer(ids.seatToken)),
        ctx(ids.gameId),
        api.deps,
      );
    },
  },
  {
    status: 201,
    code: null,
    make: () =>
      createGameHandler(postJson('/api/games', { humanName: 'Ana', aiCount: 3 }), makeApi().deps),
  },
  {
    status: 400,
    code: 'invalid_request',
    field: 'body',
    make: () =>
      createGameHandler(
        postJson('/api/games', null, { rawBody: new TextEncoder().encode('{') }),
        makeApi().deps,
      ),
  },
  {
    status: 401,
    code: 'unauthorized',
    make: async () => {
      const api = makeApi();
      const ids = await createGameVia(api);
      return getGameHandler(getReq(`/api/games/${ids.gameId}`), ctx(ids.gameId), api.deps);
    },
  },
  {
    status: 403,
    code: 'not_your_turn',
    make: async () => {
      const api = makeApi();
      const ids = await createGameVia(api);
      api.deps.getService = () =>
        wrapService(api.service, { submitMove: () => Promise.reject(new NotYourTurn(0)) });
      return move(api, ids, firstMove(ids, 'h-403'));
    },
  },
  {
    status: 404,
    code: 'game_not_found',
    make: () =>
      getGameHandler(
        getReq(`/api/games/${UNKNOWN_ID}`, bearer('A'.repeat(43))),
        ctx(UNKNOWN_ID),
        makeApi().deps,
      ),
  },
  {
    status: 409,
    code: 'version_conflict',
    make: async () => {
      const api = makeApi();
      const ids = await createGameVia(api);
      expect((await move(api, ids, firstMove(ids, 'h-409a'))).status).toBe(200);
      return move(api, ids, firstMove(ids, 'h-409b'));
    },
  },
  {
    status: 410,
    code: 'game_unsupported',
    make: async () => {
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
      return getGameHandler(
        getReq(`/api/games/${ids.gameId}`, bearer(ids.seatToken)),
        ctx(ids.gameId),
        api.deps,
      );
    },
  },
  {
    status: 413,
    code: 'payload_too_large',
    make: () =>
      createGameHandler(
        postJson('/api/games', null, { rawBody: new Uint8Array(16385).fill(0x20) }),
        makeApi().deps,
      ),
  },
  {
    status: 422,
    code: 'illegal_move',
    make: async () => {
      const api = makeApi();
      const ids = await createGameVia(api);
      return move(api, ids, {
        version: ids.update.version,
        moveId: 'play:ZZ',
        clientRequestId: 'h-422',
      });
    },
  },
  {
    status: 500,
    code: 'internal',
    make: () => {
      const api = makeApi();
      api.deps.getService = () => {
        throw new Error('secret-xyz');
      };
      return createGameHandler(postJson('/api/games', { humanName: 'Ana', aiCount: 3 }), api.deps);
    },
  },
];

describe('VC-800: every status carries application/json and no-store', () => {
  it('covers the 11 statuses of the API', () => {
    expect(SCENARIOS.map((s) => s.status)).toEqual([
      200, 201, 400, 401, 403, 404, 409, 410, 413, 422, 500,
    ]);
  });

  it.each(SCENARIOS)('$status', async ({ status, make }) => {
    const res = await make();
    expect(res.status).toBe(status);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('the presets 200 also carries both headers', async () => {
    const res = await presetsHandler(getReq('/api/presets'), makeApi().deps);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await readJson(res)).toHaveProperty('presets');
  });
});

describe('VC-801: every error body is the fixed { error: { code, message } }', () => {
  it.each(SCENARIOS.filter((s) => s.code !== null))('$status $code', async (scenario) => {
    const res = await scenario.make();
    const raw = await res.text();
    const body = ErrorResponseSchema.parse(JSON.parse(raw));
    expect(body.error.code).toBe(scenario.code);
    const base = ERROR_MESSAGES[body.error.code];
    expect(body.error.message).toBe(
      scenario.field === undefined ? base : `${base}: ${scenario.field}`,
    );
    if (scenario.status === 409) {
      expect(Object.keys(body).sort()).toEqual(['error', 'update']);
      PlayerUpdateResponseSchema.parse(body.update);
    } else {
      expect(Object.keys(body)).toEqual(['error']);
    }
    expect(raw).not.toContain('stack');
    expect(raw).not.toContain('secret-xyz');
  });
});
