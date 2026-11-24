import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, getPresets, getUpdate, submitMove, type ApiDeps } from '@/app/_client/api';

const update = () => ({
  version: 4,
  events: [],
  view: { seats: [], handPlan: [], yourHand: [], scoreboard: {} },
  legalMoves: [],
});
const presets = () => ({ defaultPresetId: 'a', presets: [{ id: 'a', deck: 'spanish' }] });
const created = () => ({ gameId: 'g1', seat: 0, seatToken: 'tok', update: update() });
const errBody = (code: string) => ({ error: { code, message: 'm' } });
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const TOKEN = 'secret-token-123';
const MOVE = { version: 4, moveId: 'm', clientRequestId: 'c' };

type Handler = (url: string, init: RequestInit) => Promise<Response>;

function makeDeps(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const stub = vi.fn((input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  });
  const deps: ApiDeps = {
    fetch: stub as unknown as typeof fetch,
    setTimeout: (h, ms) => setTimeout(h, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  return { deps, calls };
}
const respond = (status: number, body: unknown) =>
  makeDeps(() => Promise.resolve(json(status, body)));
const move = (d: ApiDeps) => submitMove(d, 'g1', TOKEN, MOVE);
const load = (d: ApiDeps) => getUpdate(d, 'g1', TOKEN);

afterEach(() => vi.useRealTimers());

describe('submitMove (VC-926, FR-918, FR-936)', () => {
  it('maps a rejected fetch to transport', async () => {
    const { deps } = makeDeps(() => Promise.reject(new TypeError('network')));
    expect(await move(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a synchronous throw from fetch to transport', async () => {
    const { deps } = makeDeps(() => {
      throw new Error('boom');
    });
    expect(await move(deps)).toEqual({ kind: 'transport' });
  });

  it.each([500, 502, 503, 302, 301, 204, 418])('maps status %i to transport', async (status) => {
    const { deps } = respond(status, errBody('internal'));
    expect(await move(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a 200 with a non-JSON body to transport', async () => {
    const { deps } = makeDeps(() => Promise.resolve(new Response('<html>', { status: 200 })));
    expect(await move(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a 200 {"version": 9} to transport', async () => {
    const { deps } = respond(200, { version: 9 });
    expect(await move(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a 409 without update to transport', async () => {
    const { deps } = respond(409, errBody('version_conflict'));
    expect(await move(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a 409 with update: {} to transport (P-8)', async () => {
    const { deps } = respond(409, { ...errBody('version_conflict'), update: {} });
    expect(await move(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a 409 with non-JSON body to transport', async () => {
    const { deps } = makeDeps(() => Promise.resolve(new Response('x', { status: 409 })));
    expect(await move(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a valid 200 to ok', async () => {
    const { deps } = respond(200, update());
    expect(await move(deps)).toEqual({ kind: 'ok', status: 200, body: update() });
  });

  it('maps a 409 with a valid update to conflict', async () => {
    const { deps } = respond(409, { ...errBody('version_conflict'), update: update() });
    expect(await move(deps)).toEqual({ kind: 'conflict', update: update() });
  });

  it.each([
    [400, 'invalid_request'],
    [401, 'unauthorized'],
    [403, 'not_your_turn'],
    [404, 'game_not_found'],
    [410, 'game_unsupported'],
    [413, 'payload_too_large'],
    [422, 'illegal_move'],
  ])('maps %i to error with its code', async (status, code) => {
    const { deps } = respond(status, errBody(code));
    expect(await move(deps)).toEqual({ kind: 'error', status, code });
  });

  it('gives an empty code when a handled 4xx has no error body', async () => {
    const { deps } = makeDeps(() => Promise.resolve(new Response('nope', { status: 422 })));
    expect(await move(deps)).toEqual({ kind: 'error', status: 422, code: '' });
  });

  it('POSTs the JSON body with Content-Type, bearer token and no-store', async () => {
    const { deps, calls } = respond(200, update());
    await move(deps);
    const { url, init } = calls[0]!;
    expect(url).toBe('/api/games/g1/moves');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBe(JSON.stringify(MOVE));
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    });
    expect(url).not.toContain(TOKEN);
  });
});

describe('timeout (NFR-904, FR-936)', () => {
  function hanging(honourSignal: boolean) {
    let signal: AbortSignal | undefined;
    const { deps } = makeDeps((_url, init) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        if (honourSignal) {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }
      });
    });
    return { deps, aborted: () => signal?.aborted };
  }

  it.each([true, false])(
    'aborts at 20,000 ms and yields transport (honours signal: %s)',
    async (honour) => {
      vi.useFakeTimers();
      const { deps, aborted } = hanging(honour);
      let result: unknown;
      void move(deps).then((r) => (result = r));
      await vi.advanceTimersByTimeAsync(19_999);
      expect(result).toBeUndefined();
      expect(aborted()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(aborted()).toBe(true);
      expect(result).toEqual({ kind: 'transport' });
    },
  );

  it('clears the timer after a response', async () => {
    vi.useFakeTimers();
    const { deps } = respond(200, update());
    await move(deps);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('applies to every call', async () => {
    vi.useFakeTimers();
    for (const run of [
      (d: ApiDeps) => getPresets(d),
      (d: ApiDeps) => createGame(d, { humanName: 'x', aiCount: 2 }),
      load,
    ]) {
      const { deps } = hanging(true);
      let result: unknown;
      void run(deps).then((r) => (result = r));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(result).toEqual({ kind: 'transport' });
    }
  });
});

describe('getUpdate (FR-907/908, FR-936)', () => {
  it('maps a valid 200 to ok', async () => {
    const { deps } = respond(200, update());
    expect(await load(deps)).toEqual({ kind: 'ok', status: 200, body: update() });
  });

  it.each([
    [401, 'unauthorized'],
    [404, 'game_not_found'],
    [410, 'game_unsupported'],
  ])('maps %i to error', async (status, code) => {
    const { deps } = respond(status, errBody(code));
    expect(await load(deps)).toEqual({ kind: 'error', status, code });
  });

  it.each([400, 403, 409, 413, 422, 500, 503])('maps %i to transport', async (status) => {
    const { deps } = respond(status, { ...errBody('x'), update: update() });
    expect(await load(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a 200 with a malformed body to transport', async () => {
    const { deps } = respond(200, { version: 1 });
    expect(await load(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a rejected fetch to transport', async () => {
    const { deps } = makeDeps(() => Promise.reject(new Error('x')));
    expect(await load(deps)).toEqual({ kind: 'transport' });
  });

  it('sends bearer token and no-store, token not in the URL', async () => {
    const { deps, calls } = respond(200, update());
    await load(deps);
    const { url, init } = calls[0]!;
    expect(url).toBe('/api/games/g1');
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect(init.body).toBeUndefined();
    expect(url).not.toContain(TOKEN);
  });

  it('sends ?since=<n> when given (including 0)', async () => {
    const { deps, calls } = respond(200, update());
    await getUpdate(deps, 'g1', TOKEN, 7);
    await getUpdate(deps, 'g1', TOKEN, 0);
    expect(calls[0]!.url).toBe('/api/games/g1?since=7');
    expect(calls[1]!.url).toBe('/api/games/g1?since=0');
    expect(calls[0]!.url).not.toContain(TOKEN);
  });
});

describe('createGame (FR-903, FR-936)', () => {
  const req = { humanName: 'Ana', aiCount: 3, rulesPreset: 'a' };

  it('maps a valid 201 to ok and POSTs JSON without Authorization', async () => {
    const { deps, calls } = respond(201, created());
    expect(await createGame(deps, req)).toEqual({ kind: 'ok', status: 201, body: created() });
    const { url, init } = calls[0]!;
    expect(url).toBe('/api/games');
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(init.body).toBe(JSON.stringify(req));
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('maps 400 to error', async () => {
    const { deps } = respond(400, errBody('invalid_request'));
    expect(await createGame(deps, req)).toEqual({
      kind: 'error',
      status: 400,
      code: 'invalid_request',
    });
  });

  it.each([200, 401, 403, 404, 409, 422, 500])('maps %i to transport', async (status) => {
    const { deps } = respond(status, errBody('x'));
    expect(await createGame(deps, req)).toEqual({ kind: 'transport' });
  });

  it('maps a 201 with a malformed body to transport', async () => {
    const { deps } = respond(201, { gameId: 'g', seatToken: 't' });
    expect(await createGame(deps, req)).toEqual({ kind: 'transport' });
  });

  it('maps a rejected fetch to transport', async () => {
    const { deps } = makeDeps(() => Promise.reject(new Error('x')));
    expect(await createGame(deps, req)).toEqual({ kind: 'transport' });
  });
});

describe('getPresets (FR-903, FR-936)', () => {
  it('maps a valid 200 to ok and GETs with no-store, no Authorization', async () => {
    const { deps, calls } = respond(200, presets());
    expect(await getPresets(deps)).toEqual({ kind: 'ok', status: 200, body: presets() });
    const { url, init } = calls[0]!;
    expect(url).toBe('/api/presets');
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it.each([400, 401, 404, 500, 503])('maps %i to transport', async (status) => {
    const { deps } = respond(status, errBody('x'));
    expect(await getPresets(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a body without a defaultPresetId entry to transport (P-8)', async () => {
    const { deps } = respond(200, { defaultPresetId: 'zzz', presets: [{ id: 'a', deck: 'x' }] });
    expect(await getPresets(deps)).toEqual({ kind: 'transport' });
  });

  it('maps a rejected fetch to transport', async () => {
    const { deps } = makeDeps(() => Promise.reject(new Error('x')));
    expect(await getPresets(deps)).toEqual({ kind: 'transport' });
  });
});
