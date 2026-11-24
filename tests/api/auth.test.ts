// Seat auth and game id format (spec FR-805, FR-806; plan P-6). VC-811 at the parser level.
import { describe, expect, it } from 'vitest';
import { assertGameIdFormat, parseBearer } from '@/app/api/_lib/auth';
import { RequestError } from '@/app/api/_lib/errors';
import { GAME_ID_PATTERN } from '@/src/state/keys';

const TOKEN_43 = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';

function headers(authorization?: string): Headers {
  const h = new Headers();
  if (authorization !== undefined) h.set('authorization', authorization);
  return h;
}

function thrown(fn: () => unknown): RequestError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RequestError);
    return err as RequestError;
  }
  throw new Error('expected a RequestError');
}

describe('VC-811: parseBearer', () => {
  const bad: [string, string | undefined][] = [
    ['missing header', undefined],
    ['empty header', ''],
    ['Bearer (no token)', 'Bearer'],
    ['Bearer + space (trimmed by Headers)', 'Bearer '],
    ['Basic abc', 'Basic abc'],
    ['Bearer  two-spaces', 'Bearer  two-spaces'],
    ['Bearer a b', 'Bearer a b'],
    ['Bearer + 257 characters', `Bearer ${'a'.repeat(257)}`],
    ['a token with "="', 'Bearer abc='],
    ['a token with "+"', 'Bearer a+b'],
    ['no space', 'Bearerabc'],
  ];

  it.each(bad)('%s → 401 RequestError', (_name, value) => {
    const err = thrown(() => parseBearer(headers(value)));
    expect(err.status).toBe(401);
    expect(err.code).toBe('unauthorized');
    expect(err.message).toBe('Missing or invalid seat token');
  });

  it('TOKEN_43 is a 43-char base64url token', () => {
    expect(TOKEN_43).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR'])('%s <43-char token> → the token', (scheme) => {
    expect(parseBearer(headers(`${scheme} ${TOKEN_43}`))).toBe(TOKEN_43);
  });

  it('Bearer + 256 characters → the token', () => {
    const token = 'a'.repeat(256);
    expect(parseBearer(headers(`Bearer ${token}`))).toBe(token);
  });

  it('the message never echoes the header', () => {
    const err = thrown(() => parseBearer(headers('Basic secret-credential')));
    expect(JSON.stringify({ ...err, message: err.message })).not.toContain('secret-credential');
  });
});

describe('FR-806 step 1: assertGameIdFormat', () => {
  it('accepts a 26-char lowercase base32 id', () => {
    expect(() => assertGameIdFormat('abcdefghijklmnopqrstuvwxyz')).not.toThrow();
    expect(() => assertGameIdFormat('a234567abcdefghijklmnopqrs')).not.toThrow();
  });

  it.each([
    ['BAD', 'BAD'],
    ['empty', ''],
    ['25 chars', 'a'.repeat(25)],
    ['27 chars', 'a'.repeat(27)],
    ['upper case', 'A'.repeat(26)],
    ['digit 1', `1${'a'.repeat(25)}`],
    ['digit 8', `8${'a'.repeat(25)}`],
    ['path traversal', `../${'a'.repeat(23)}`],
    ['trailing newline', `${'a'.repeat(26)}\n`],
  ])('%s → 404 game_not_found', (_name, id) => {
    const err = thrown(() => assertGameIdFormat(id));
    expect(err.status).toBe(404);
    expect(err.code).toBe('game_not_found');
  });

  it('matches the state layer id format', () => {
    expect(GAME_ID_PATTERN.source).toBe('^[a-z2-7]{26}$');
  });
});
