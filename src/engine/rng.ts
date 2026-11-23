// Seeded random streams (spec 02 FR-200 to FR-205).
//
// Every random choice the engine makes comes from an `Rng` built here. `deriveRng` turns a game
// seed plus labels into an independent xoshiro128** stream, so the same inputs always give the
// same numbers on every runtime. Pure: no ambient randomness, clock or I/O.
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import type { Rng } from '@/src/domain/types';

const TWO_POW_32 = 2 ** 32;

/** Replacement for the forbidden all-zero xoshiro state (FR-201). */
const ZERO_STATE_REPLACEMENT = [0x9e3779b9, 0x243f6a88, 0xb7e15162, 0x6a09e667] as const;

/**
 * Builds an `Rng` whose `int` and `shuffle` draw raw uint32 outputs only by calling `next`
 * (FR-200). Useful for stub-driven tests.
 */
export function rngFromSource(next: () => number): Rng {
  function int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new RangeError(`int(${min}, ${max}): bounds must be integers`);
    }
    if (min > max) {
      throw new RangeError(`int(${min}, ${max}): min must not exceed max`);
    }
    const range = max - min + 1;
    if (range > TWO_POW_32) {
      throw new RangeError(`int(${min}, ${max}): range must not exceed 2^32`);
    }
    // Rejection sampling (FR-202): accept only draws below the largest multiple of `range`.
    const limit = Math.floor(TWO_POW_32 / range) * range;
    let u = next() >>> 0;
    while (u >= limit) {
      u = next() >>> 0;
    }
    return min + (u % range);
  }

  function shuffle<T>(items: readonly T[]): T[] {
    // Fisher–Yates from the end on a copy (FR-204); the input is never touched.
    const out = items.slice();
    for (let i = out.length - 1; i >= 1; i--) {
      const j = int(0, i);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  return { int, shuffle };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * Reference xoshiro128** over four uint32 words (FR-201). The words are copied; an all-zero
 * state is replaced by `ZERO_STATE_REPLACEMENT`.
 */
export function createXoshiro128ss(words: readonly [number, number, number, number]): Rng {
  const s = Uint32Array.from(words);
  if (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) {
    s.set(ZERO_STATE_REPLACEMENT);
  }
  // Uint32Array stores every assignment modulo 2^32.
  function next(): number {
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 11);
    return result;
  }
  return rngFromSource(next);
}

/**
 * Derives an independent stream from a seed and labels (FR-205): the first 16 bytes of
 * `SHA-256(UTF-8(JSON.stringify([seed, ...labels])))`, read as four little-endian uint32 words,
 * seed `createXoshiro128ss`. `JSON.stringify` frames the labels unambiguously; do not replace it
 * with string joining.
 */
export function deriveRng(seed: string, ...labels: (string | number)[]): Rng {
  const digest = sha256(utf8ToBytes(JSON.stringify([seed, ...labels])));
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  return createXoshiro128ss([
    view.getUint32(0, true),
    view.getUint32(4, true),
    view.getUint32(8, true),
    view.getUint32(12, true),
  ]);
}
