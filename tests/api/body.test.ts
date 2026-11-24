// JSON body reading (spec FR-802; plan P-3). VC-802, VC-803 and VC-804 at the unit level.
import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, readJsonBody } from '@/app/api/_lib/body';
import { RequestError } from '@/app/api/_lib/errors';

const URL = 'http://localhost/api/games';

function req(body: Uint8Array<ArrayBuffer> | string, contentType?: string): Request {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const headers = new Headers();
  if (contentType !== undefined) headers.set('content-type', contentType);
  return new Request(URL, { method: 'POST', body: bytes, headers });
}

async function rejection(promise: Promise<unknown>): Promise<RequestError> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RequestError);
  return err as RequestError;
}

/** A valid JSON object of exactly `n` bytes (whitespace-padded). */
function paddedJson(n: number): string {
  const core = '{"humanName":"Ana","aiCount":3}';
  return core + ' '.repeat(n - core.length);
}

describe('VC-802: body size cap', () => {
  it('MAX_BODY_BYTES is 16384', () => {
    expect(MAX_BODY_BYTES).toBe(16384);
  });

  it('16,385 bytes → 413 payload_too_large', async () => {
    const body = paddedJson(16385);
    expect(new TextEncoder().encode(body).byteLength).toBe(16385);
    const err = await rejection(readJsonBody(req(body, 'application/json')));
    expect(err.status).toBe(413);
    expect(err.code).toBe('payload_too_large');
  });

  it('exactly 16,384 bytes of padded valid JSON → parsed', async () => {
    const body = paddedJson(16384);
    expect(new TextEncoder().encode(body).byteLength).toBe(16384);
    await expect(readJsonBody(req(body, 'application/json'))).resolves.toEqual({
      humanName: 'Ana',
      aiCount: 3,
    });
  });

  it('8,193 two-byte characters in a JSON string (16,386+ bytes, < 16,384 code units) → 413', async () => {
    const body = `{"humanName":"${'é'.repeat(8193)}"}`;
    expect(body.length).toBeLessThan(MAX_BODY_BYTES);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(MAX_BODY_BYTES);
    const err = await rejection(readJsonBody(req(body, 'application/json')));
    expect(err.status).toBe(413);
  });

  it('a lying Content-Length does not bypass the cap', async () => {
    const r = req(paddedJson(20000), 'application/json');
    const lying = new Request(r, {
      headers: { 'content-type': 'application/json', 'content-length': '10' },
    });
    const err = await rejection(readJsonBody(lying));
    expect(err.status).toBe(413);
  });
});

describe('VC-803: Content-Type', () => {
  it('text/plain → 400 body', async () => {
    const err = await rejection(readJsonBody(req('{"a":1}', 'text/plain')));
    expect(err.status).toBe(400);
    expect(err.code).toBe('invalid_request');
    expect(err.field).toBe('body');
    expect(err.message).toBe('Invalid request: body');
  });

  it('no Content-Type at all (Uint8Array body) → 400 body', async () => {
    const r = req(new TextEncoder().encode('{"a":1}'));
    expect(r.headers.get('content-type')).toBeNull();
    const err = await rejection(readJsonBody(r));
    expect(err.status).toBe(400);
    expect(err.field).toBe('body');
  });

  it('text/plain with a 20,000-byte body → 400 (type wins over size)', async () => {
    const err = await rejection(readJsonBody(req(paddedJson(20000), 'text/plain')));
    expect(err.status).toBe(400);
    expect(err.field).toBe('body');
  });

  it('Application/JSON; charset=utf-8 → parsed', async () => {
    await expect(
      readJsonBody(req('{"humanName":"Ana","aiCount":3}', 'Application/JSON; charset=utf-8')),
    ).resolves.toEqual({ humanName: 'Ana', aiCount: 3 });
  });

  it('application/jsonx and application/json-patch+json → 400 body', async () => {
    for (const type of ['application/jsonx', 'application/json-patch+json']) {
      const err = await rejection(readJsonBody(req('{}', type)));
      expect(err.field).toBe('body');
    }
  });
});

describe('VC-804: the body must be a UTF-8 JSON object', () => {
  const cases: [string, Uint8Array<ArrayBuffer> | string][] = [
    ['{', '{'],
    ['null', 'null'],
    ['[]', '[]'],
    ['"x"', '"x"'],
    ['42', '42'],
    ['empty', ''],
    ['invalid UTF-8 [0x22, 0xff, 0x22]', Uint8Array.from([0x22, 0xff, 0x22])],
    ['invalid UTF-8 inside an object', Uint8Array.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])],
  ];

  it.each(cases)('%s → 400 body', async (_name, body) => {
    const err = await rejection(readJsonBody(req(body, 'application/json')));
    expect(err.status).toBe(400);
    expect(err.code).toBe('invalid_request');
    expect(err.field).toBe('body');
  });

  it('{} → parsed as an empty object', async () => {
    await expect(readJsonBody(req('{}', 'application/json'))).resolves.toEqual({});
  });
});
