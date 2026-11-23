// Game id check and key builders (spec 06 FR-600, FR-601; VC-601 key part, VC-602).
import { describe, expect, it } from 'vitest';
import { InvalidGameIdError } from '@/src/state/errors';
import {
  assertValidGameId,
  commitKey,
  commitsPrefix,
  finalScoresKey,
  gameKeyPrefix,
  headKey,
  indexCreatedKey,
  indexCreatedPrefix,
  MAX_COMMIT_VERSION,
  metaKey,
  parseCommitKey,
} from '@/src/state/keys';
import { assertValidKey, assertValidPrefix } from '@/src/storage/object-store';

const g = 'abcdefghijklmnopqrstuvwxyz';

/** Runs `fn()`, expects an `InvalidGameIdError` whose `gameId` is `input`. */
function expectInvalidId(fn: () => unknown, input: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(InvalidGameIdError);
  expect((caught as InvalidGameIdError).gameId).toBe(input);
  expect((caught as InvalidGameIdError).name).toBe('InvalidGameIdError');
}

describe('VC-601 assertValidGameId', () => {
  it.each(['a'.repeat(26), 'abcdefghijklmnopqrstuvwxyz', '234567'.repeat(4) + 'ab'])(
    'accepts %s',
    (id) => {
      expect(() => assertValidGameId(id)).not.toThrow();
    },
  );

  it.each([
    ['empty', ''],
    ['25 chars', 'a'.repeat(25)],
    ['27 chars', 'a'.repeat(27)],
    ['uppercase', 'A' + 'a'.repeat(25)],
    ['digit 0', '0' + 'a'.repeat(25)],
    ['digit 1', '1' + 'a'.repeat(25)],
    ['digit 8', '8' + 'a'.repeat(25)],
    ['slash', 'a'.repeat(12) + '/' + 'a'.repeat(13)],
    ['dot-dot', '..' + 'a'.repeat(24)],
    ['bare dot-dot', '..'],
  ])('rejects %s with InvalidGameIdError naming the input', (_label, id) => {
    expectInvalidId(() => assertValidGameId(id), id);
  });

  it('every builder that takes a gameId checks it first', () => {
    const bad = 'BAD';
    expectInvalidId(() => gameKeyPrefix(bad), bad);
    expectInvalidId(() => metaKey(bad), bad);
    expectInvalidId(() => commitsPrefix(bad), bad);
    expectInvalidId(() => commitKey(bad, -1), bad);
    expectInvalidId(() => headKey(bad), bad);
    expectInvalidId(() => finalScoresKey(bad), bad);
    expectInvalidId(() => indexCreatedKey('not-a-date', bad), bad);
    expectInvalidId(() => parseCommitKey(bad, 'games/BAD/commits/00000000.json'), bad);
  });
});

describe('VC-602 key builders', () => {
  it('build exactly the documented keys', () => {
    expect(gameKeyPrefix(g)).toBe(`games/${g}/`);
    expect(metaKey(g)).toBe(`games/${g}/meta.json`);
    expect(commitsPrefix(g)).toBe(`games/${g}/commits/`);
    expect(commitKey(g, 0)).toBe(`games/${g}/commits/00000000.json`);
    expect(commitKey(g, 41)).toBe(`games/${g}/commits/00000041.json`);
    expect(commitKey(g, 99999999)).toBe(`games/${g}/commits/99999999.json`);
    expect(headKey(g)).toBe(`games/${g}/head.json`);
    expect(finalScoresKey(g)).toBe(`games/${g}/scores/final.json`);
    expect(indexCreatedKey('2026-11-23', g)).toBe(`index/created/2026-11-23/${g}`);
    expect(indexCreatedPrefix).toBe('index/created/');
    expect(MAX_COMMIT_VERSION).toBe(99_999_999);
  });

  it.each([-1, 1.5, 100000000, Number.NaN, Infinity])(
    'commitKey rejects version %s with a RangeError naming version',
    (v) => {
      expect(() => commitKey(g, v)).toThrow(RangeError);
      expect(() => commitKey(g, v)).toThrow(/version/);
    },
  );

  it.each(['2026-02-30', '2026-1-5', '2026-13-01', '2026-11-23T00:00:00Z', ''])(
    'indexCreatedKey rejects date %j with a RangeError naming date',
    (date) => {
      expect(() => indexCreatedKey(date, g)).toThrow(RangeError);
      expect(() => indexCreatedKey(date, g)).toThrow(/date/);
    },
  );

  it('accepts a leap day', () => {
    expect(indexCreatedKey('2028-02-29', g)).toBe(`index/created/2028-02-29/${g}`);
    expect(() => indexCreatedKey('2027-02-29', g)).toThrow(RangeError);
  });

  it('every built key passes assertValidKey and every prefix assertValidPrefix', () => {
    const keys = [
      metaKey(g),
      commitKey(g, 0),
      commitKey(g, 41),
      commitKey(g, MAX_COMMIT_VERSION),
      headKey(g),
      finalScoresKey(g),
      indexCreatedKey('2026-11-23', g),
    ];
    for (const key of keys) expect(() => assertValidKey(key)).not.toThrow();
    for (const prefix of [gameKeyPrefix(g), commitsPrefix(g), indexCreatedPrefix]) {
      expect(() => assertValidPrefix(prefix)).not.toThrow();
    }
  });

  it('no built key is a path prefix of another', () => {
    const keys = [
      metaKey(g),
      commitKey(g, 0),
      commitKey(g, 1),
      headKey(g),
      finalScoresKey(g),
      indexCreatedKey('2026-11-23', g),
    ];
    for (const a of keys) {
      for (const b of keys) {
        if (a !== b) expect(b.startsWith(`${a}/`)).toBe(false);
      }
    }
  });

  it('parseCommitKey inverts commitKey and rejects anything else', () => {
    expect(parseCommitKey(g, commitKey(g, 7))).toBe(7);
    expect(parseCommitKey(g, commitKey(g, 0))).toBe(0);
    expect(parseCommitKey(g, commitKey(g, MAX_COMMIT_VERSION))).toBe(MAX_COMMIT_VERSION);
    expect(parseCommitKey(g, headKey(g))).toBeNull();
    expect(parseCommitKey(g, metaKey(g))).toBeNull();
    expect(parseCommitKey(g, `${commitsPrefix(g)}x`)).toBeNull();
    expect(parseCommitKey(g, `${commitsPrefix(g)}0000007.json`)).toBeNull();
    expect(parseCommitKey(g, `${commitsPrefix(g)}000000007.json`)).toBeNull();
    expect(parseCommitKey(g, `${commitsPrefix(g)}00000007.json/x`)).toBeNull();
    expect(parseCommitKey(g, `${commitsPrefix(g)}00000007.jsonx`)).toBeNull();
    expect(parseCommitKey(g, commitKey('234567'.repeat(4) + 'ab', 7))).toBeNull();
  });

  it('sorting commit keys by code unit gives version order', () => {
    const keys = [100, 9, 10].map((v) => commitKey(g, v));
    const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(sorted.map((k) => parseCommitKey(g, k))).toEqual([9, 10, 100]);
  });
});
