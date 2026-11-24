// POST /api/games through `createGameHandler` (spec FR-800–FR-808, FR-812; VC-800, VC-801,
// VC-802–VC-807, VC-815, VC-824 handler part, VC-826 route part).
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES } from '@/app/api/_lib/errors';
import { createGameHandler } from '@/app/api/_lib/handlers';
import { CreateGameResponseSchema, ErrorResponseSchema } from '@/app/api/_lib/schemas';
import { ConfigError } from '@/src/config';
import { PRESET_IDS } from '@/src/domain/presets';
import { InvalidRequest } from '@/src/service/errors';
import { makeApi, postJson, readJson, wrapService, type Api } from './support/api-fixtures';

const PATH = '/api/games';
const VALID = { humanName: 'Ana', aiCount: 3 };

async function create(api: Api, req: Request): Promise<{ res: Response; body: unknown }> {
  const res = await createGameHandler(req, api.deps);
  return { res, body: await readJson(res) };
}

/** Asserts an error response: status, schema, code and the exact FR-807 message. */
async function expectError(
  req: Request,
  status: number,
  code: keyof typeof ERROR_MESSAGES,
  field?: string,
  api: Api = makeApi(),
): Promise<void> {
  const { res, body } = await create(api, req);
  expect(res.status).toBe(status);
  const parsed = ErrorResponseSchema.parse(body);
  expect(parsed.error.code).toBe(code);
  const base = ERROR_MESSAGES[code];
  expect(parsed.error.message).toBe(field === undefined ? base : `${base}: ${field}`);
}

function expectJsonHeaders(res: Response): void {
  expect(res.headers.get('content-type')).toBe('application/json');
  expect(res.headers.get('cache-control')).toBe('no-store');
}

describe('VC-815: valid create → 201', () => {
  it('answers 201 with seat 0, a 43-char base64url token and an update at version 0', async () => {
    const api = makeApi();
    const { res, body } = await create(api, postJson(PATH, VALID));
    expect(res.status).toBe(201);
    const parsed = CreateGameResponseSchema.parse(body);
    expect(parsed.seat).toBe(0);
    expect(parsed.seatToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(parsed.update.version).toBe(0);
    expect(parsed.update.view.you).toBe(0);
  });

  it('stores the game (the service was really called)', async () => {
    const api = makeApi();
    const { body } = await create(api, postJson(PATH, VALID));
    const { gameId } = CreateGameResponseSchema.parse(body);
    expect(api.store.callsOf().some((c) => JSON.stringify(c).includes(gameId))).toBe(true);
  });
});

describe('VC-802: body size cap', () => {
  it('16,385 bytes → 413 payload_too_large', async () => {
    const core = JSON.stringify(VALID);
    const raw = new TextEncoder().encode(core + ' '.repeat(16385 - core.length));
    await expectError(postJson(PATH, null, { rawBody: raw }), 413, 'payload_too_large');
  });

  it('16,384 bytes (padded) → 201', async () => {
    const core = JSON.stringify(VALID);
    const raw = new TextEncoder().encode(core + ' '.repeat(16384 - core.length));
    const { res } = await create(makeApi(), postJson(PATH, null, { rawBody: raw }));
    expect(res.status).toBe(201);
  });
});

describe('VC-803: Content-Type', () => {
  it('text/plain → 400 body', async () => {
    await expectError(
      postJson(PATH, VALID, { contentType: 'text/plain' }),
      400,
      'invalid_request',
      'body',
    );
  });

  it('no Content-Type → 400 body', async () => {
    await expectError(postJson(PATH, VALID, { contentType: null }), 400, 'invalid_request', 'body');
  });

  it('Application/JSON; charset=utf-8 → 201', async () => {
    const req = postJson(PATH, VALID, { contentType: 'Application/JSON; charset=utf-8' });
    const { res } = await create(makeApi(), req);
    expect(res.status).toBe(201);
  });
});

describe('VC-804: malformed JSON', () => {
  for (const raw of ['{', 'null', '[]', '"x"', '42']) {
    it(`${raw} → 400 body`, async () => {
      const req = postJson(PATH, null, { rawBody: new TextEncoder().encode(raw) });
      await expectError(req, 400, 'invalid_request', 'body');
    });
  }

  it('invalid UTF-8 → 400 body', async () => {
    const req = postJson(PATH, null, { rawBody: Uint8Array.from([0x22, 0xff, 0x22]) });
    await expectError(req, 400, 'invalid_request', 'body');
  });
});

describe('VC-805: strict body', () => {
  for (const key of ['seed', 'foo']) {
    it(`unknown key ${key} → 400 ${key}`, async () => {
      await expectError(postJson(PATH, { ...VALID, [key]: 'x' }), 400, 'invalid_request', key);
    });
  }
});

describe('VC-806: create boundaries', () => {
  for (const humanName of ['', '   ', 'a'.repeat(41)]) {
    it(`humanName ${JSON.stringify(humanName.length > 5 ? `${humanName.length} chars` : humanName)} → 400 humanName`, async () => {
      await expectError(
        postJson(PATH, { ...VALID, humanName }),
        400,
        'invalid_request',
        'humanName',
      );
    });
  }

  it('40 chars after trim → 201', async () => {
    const { res } = await create(
      makeApi(),
      postJson(PATH, { ...VALID, humanName: `  ${'a'.repeat(40)}  ` }),
    );
    expect(res.status).toBe(201);
  });

  for (const aiCount of [1, 6, 2.5, '3']) {
    it(`aiCount ${JSON.stringify(aiCount)} → 400 aiCount`, async () => {
      await expectError(postJson(PATH, { ...VALID, aiCount }), 400, 'invalid_request', 'aiCount');
    });
  }

  for (const aiCount of [2, 5]) {
    it(`aiCount ${aiCount} → 201`, async () => {
      const { res } = await create(makeApi(), postJson(PATH, { ...VALID, aiCount }));
      expect(res.status).toBe(201);
    });
  }

  it("rulesPreset 'nope' → 400 rulesPreset", async () => {
    await expectError(
      postJson(PATH, { ...VALID, rulesPreset: 'nope' }),
      400,
      'invalid_request',
      'rulesPreset',
    );
  });

  for (const rulesPreset of PRESET_IDS) {
    it(`rulesPreset ${rulesPreset} with aiCount 2 → 201`, async () => {
      const { res, body } = await create(
        makeApi(),
        postJson(PATH, { ...VALID, aiCount: 2, rulesPreset }),
      );
      expect(res.status).toBe(201);
      CreateGameResponseSchema.parse(body);
    });
  }
});

describe('VC-807: service cross-field check', () => {
  it("createGame throwing InvalidRequest('aiCount') → 400 Invalid request: aiCount", async () => {
    const base = makeApi();
    const service = wrapService(base.service, {
      createGame: async () => {
        throw new InvalidRequest('aiCount');
      },
    });
    const api = makeApi({ service });
    await expectError(postJson(PATH, VALID), 400, 'invalid_request', 'aiCount', api);
  });
});

describe('VC-824 (handler part): getService throws', () => {
  it('ConfigError → 500 internal and one error line named ConfigError', async () => {
    const api = makeApi();
    api.deps.getService = () => {
      throw new ConfigError('Invalid configuration:\n  - STORAGE_DRIVER must be one of x');
    };
    const { res, body } = await create(api, postJson(PATH, VALID));
    expect(res.status).toBe(500);
    expect(ErrorResponseSchema.parse(body)).toEqual({
      error: { code: 'internal', message: 'Internal error' },
    });
    const errors = api.logs.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].line.errorName).toBe('ConfigError');
  });
});

describe('VC-801: a 500 body carries nothing from the thrown value', () => {
  it("new Error('secret-xyz') → Internal error, no secret, no stack", async () => {
    const api = makeApi();
    api.deps.getService = () => {
      throw new Error('secret-xyz');
    };
    const res = await createGameHandler(postJson(PATH, VALID), api.deps);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(ErrorResponseSchema.parse(JSON.parse(text)).error.message).toBe('Internal error');
    expect(text).not.toContain('secret-xyz');
    expect(text).not.toContain('stack');
  });
});

describe('VC-800 (partial): JSON headers on every status', () => {
  it('201', async () => {
    const res = await createGameHandler(postJson(PATH, VALID), makeApi().deps);
    expect(res.status).toBe(201);
    expectJsonHeaders(res);
  });

  it('400', async () => {
    const res = await createGameHandler(postJson(PATH, { ...VALID, aiCount: 1 }), makeApi().deps);
    expect(res.status).toBe(400);
    expectJsonHeaders(res);
  });

  it('413', async () => {
    const raw = new TextEncoder().encode(' '.repeat(16385));
    const res = await createGameHandler(postJson(PATH, null, { rawBody: raw }), makeApi().deps);
    expect(res.status).toBe(413);
    expectJsonHeaders(res);
  });

  it('500', async () => {
    const api = makeApi();
    api.deps.getService = () => {
      throw new Error('boom');
    };
    const res = await createGameHandler(postJson(PATH, VALID), api.deps);
    expect(res.status).toBe(500);
    expectJsonHeaders(res);
  });
});

describe('VC-826 (partial): app/api/games/route.ts', () => {
  it('exports only POST', async () => {
    const mod = await import('@/app/api/games/route');
    expect(Object.keys(mod)).toEqual(['POST']);
  });
});
