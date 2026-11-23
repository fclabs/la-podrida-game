// Seeded random streams (spec 02 FR-200 to FR-205; VC-201 to VC-205).
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { createXoshiro128ss, deriveRng, rngFromSource } from '@/src/engine/rng';
import type { Rng } from '@/src/domain/types';

const MAX_U32 = 2 ** 32 - 1;

/** The first `n` raw outputs, observed through `int(0, 2**32 - 1)` (always accepted). */
function rawOutputs(rng: Rng, n: number): number[] {
  return Array.from({ length: n }, () => rng.int(0, MAX_U32));
}

/** A `next` that returns `values` in order and fails if drawn past the end. */
function stubSource(values: number[]): { next: () => number; calls: () => number } {
  let i = 0;
  return {
    next: () => {
      if (i >= values.length) throw new Error('stub exhausted');
      return values[i++];
    },
    calls: () => i,
  };
}

/**
 * Independent reference xoshiro128** written with BigInt (deliberately different from rng.ts,
 * which uses Math.imul on plain numbers). Returns the first `n` outputs from state `words`.
 */
function referenceXoshiro(words: number[], n: number): number[] {
  const M = 0xffffffffn;
  const rot = (x: bigint, k: bigint) => ((x << k) | (x >> (32n - k))) & M;
  let [a, b, c, d] = words.map((w) => BigInt(w) & M);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(Number((rot((b * 5n) & M, 7n) * 9n) & M));
    const t = (b << 9n) & M;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rot(d, 11n);
  }
  return out;
}

describe('VC-201 createXoshiro128ss reference outputs', () => {
  it('state (1, 2, 3, 4) gives the pinned first six raw outputs', () => {
    expect(rawOutputs(createXoshiro128ss([1, 2, 3, 4]), 6)).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492,
    ]);
  });

  it('the in-test BigInt reference agrees on state (1, 2, 3, 4)', () => {
    expect(referenceXoshiro([1, 2, 3, 4], 6)).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492,
    ]);
  });

  it('an all-zero state behaves as the replacement state', () => {
    const replacement = createXoshiro128ss([0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x6a09e667]);
    expect(rawOutputs(createXoshiro128ss([0, 0, 0, 0]), 20)).toEqual(rawOutputs(replacement, 20));
  });

  it('does not mutate the words argument', () => {
    const words: [number, number, number, number] = [1, 2, 3, 4];
    rawOutputs(createXoshiro128ss(words), 10);
    expect(words).toEqual([1, 2, 3, 4]);
  });
});

describe('VC-202 int', () => {
  it('10,000 draws of int(1, 6) stay in [1, 6] with each face 1,500–1,850 times', () => {
    const rng = createXoshiro128ss([1, 2, 3, 4]);
    const counts = new Map<number, number>();
    for (let i = 0; i < 10_000; i++) {
      const v = rng.int(1, 6);
      expect(Number.isInteger(v) && v >= 1 && v <= 6).toBe(true);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    for (let face = 1; face <= 6; face++) {
      const c = counts.get(face) ?? 0;
      expect(c).toBeGreaterThanOrEqual(1500);
      expect(c).toBeLessThanOrEqual(1850);
    }
  });

  it('int(5, 5) is 5', () => {
    const rng = deriveRng('s', 'x');
    for (let i = 0; i < 10; i++) expect(rng.int(5, 5)).toBe(5);
  });

  it('int(-3, -1) stays in [-3, -1]', () => {
    const rng = deriveRng('s', 'neg');
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(-3, -1);
      expect(v >= -3 && v <= -1).toBe(true);
    }
  });

  it('rngFromSource over 2**32 - 1 then 0: int(0, 2) rejects the first draw and returns 0', () => {
    const stub = stubSource([MAX_U32, 0]);
    expect(rngFromSource(stub.next).int(0, 2)).toBe(0);
    expect(stub.calls()).toBe(2);
  });
});

describe('VC-203 int argument errors', () => {
  it.each<[string, number, number]>([
    ['int(1.5, 3)', 1.5, 3],
    ['int(3, 1)', 3, 1],
    ['int(0, 2**32)', 0, 2 ** 32],
  ])('%s throws RangeError', (_label, min, max) => {
    const rng = createXoshiro128ss([1, 2, 3, 4]);
    expect(() => rng.int(min, max)).toThrow(RangeError);
  });
});

describe('VC-204 shuffle', () => {
  it('shuffling [0..51] returns a permutation and leaves the input unchanged', () => {
    const input = Array.from({ length: 52 }, (_, i) => i);
    const before = input.slice();
    const out = deriveRng('s', 'deal', 0).shuffle(input);
    expect(out).not.toBe(input);
    expect(input).toEqual(before);
    expect(out.slice().sort((x, y) => x - y)).toEqual(before);
  });

  it('with a stub returning 0 forever, [a, b, c, d] shuffles to [b, c, d, a]', () => {
    const rng = rngFromSource(() => 0);
    expect(rng.shuffle(['a', 'b', 'c', 'd'])).toEqual(['b', 'c', 'd', 'a']);
  });

  it('shuffling [] and [x] returns [] and [x]', () => {
    const rng = rngFromSource(() => 0);
    const empty: string[] = [];
    const one = ['x'];
    expect(rng.shuffle(empty)).toEqual([]);
    expect(rng.shuffle(empty)).not.toBe(empty);
    expect(rng.shuffle(one)).toEqual(['x']);
    expect(rng.shuffle(one)).not.toBe(one);
  });
});

describe('VC-205 deriveRng', () => {
  it('equal inputs give identical first 100 outputs', () => {
    expect(rawOutputs(deriveRng('s', 'deal', 0), 100)).toEqual(
      rawOutputs(deriveRng('s', 'deal', 0), 100),
    );
  });

  it('four different inputs give pairwise different first outputs', () => {
    const firsts = [
      deriveRng('s', 'deal', 0),
      deriveRng('s', 'deal', 1),
      deriveRng('t', 'deal', 0),
      deriveRng('s', 'ai', 0, 0),
    ].map((rng) => rng.int(0, MAX_U32));
    expect(new Set(firsts).size).toBe(4);
  });

  it("golden: deriveRng('golden-seed', 'deal', 0) matches an independent FR-205 computation", () => {
    const digest = sha256(utf8ToBytes(JSON.stringify(['golden-seed', 'deal', 0])));
    // Little-endian uint32 words from bytes 0–15, assembled by hand (rng.ts uses a DataView).
    const words = [0, 4, 8, 12].map(
      (o) =>
        (digest[o] + digest[o + 1] * 2 ** 8 + digest[o + 2] * 2 ** 16 + digest[o + 3] * 2 ** 24) >>>
        0,
    );
    const expected = referenceXoshiro(words, 8);
    expect(rawOutputs(deriveRng('golden-seed', 'deal', 0), 8)).toEqual(expected);
  });
});
