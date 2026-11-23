// Key and prefix validation (spec 05 FR-500, FR-501, BR-504; VC-501, VC-502 tables).
import { describe, expect, it } from 'vitest';
import {
  assertValidKey,
  assertValidPrefix,
  InvalidKeyError,
  MAX_KEY_LENGTH,
} from '@/src/storage/object-store';

/** Runs `fn(input)`, expects an `InvalidKeyError` naming `input`, and returns it. */
function invalid(fn: (input: string) => void, input: string): InvalidKeyError {
  try {
    fn(input);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidKeyError);
    return error as InvalidKeyError;
  }
  throw new Error(`expected "${input}" to be rejected`);
}

describe('VC-501 assertValidKey', () => {
  it('MAX_KEY_LENGTH is 512', () => {
    expect(MAX_KEY_LENGTH).toBe(512);
  });

  it.each(['a', 'games/abc/meta.json', 'index/created/2026-11-23/x_y-z', 'a'.repeat(512), '-_x'])(
    'accepts %j',
    (key) => {
      expect(() => assertValidKey(key)).not.toThrow();
    },
  );

  it.each([
    '',
    '/a',
    'a/',
    'a//b',
    '.',
    'a/..',
    'a/.tmp-1',
    'a b',
    'a\\b',
    'é',
    'a'.repeat(513),
    '../x',
  ])('rejects %j with InvalidKeyError naming it', (key) => {
    const error = invalid(assertValidKey, key);
    expect(error.key).toBe(key);
    expect(error.name).toBe('InvalidKeyError');
    expect(error.message).toBe(`Invalid key: "${key}"`);
  });
});

describe('VC-502 assertValidPrefix', () => {
  it.each(['', 'games/', 'games/ab', 'index/created/2026-', 'a'.repeat(511)])(
    'accepts %j',
    (prefix) => {
      expect(() => assertValidPrefix(prefix)).not.toThrow();
    },
  );

  it.each(['/games', 'games//x', '../', 'games/.t', '.', 'a b', 'a'.repeat(512)])(
    'rejects %j with InvalidKeyError naming it',
    (prefix) => {
      const error = invalid(assertValidPrefix, prefix);
      expect(error.key).toBe(prefix);
      expect(error.message).toBe(`Invalid prefix: "${prefix}"`);
    },
  );
});
