/** The part of `Crypto` that request ids need. */
export interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues?: <T extends ArrayBufferView | null>(array: T) => T;
}

/**
 * A new `clientRequestId` (FR-935): `randomUUID()` when it is a function, otherwise a version-4
 * UUID built from 16 `getRandomValues` bytes (works outside secure contexts).
 */
export function newClientRequestId(cryptoLike: CryptoLike = globalThis.crypto): string {
  if (typeof cryptoLike.randomUUID === 'function') return cryptoLike.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoLike.getRandomValues !== 'function') {
    throw new Error('No crypto source available');
  }
  cryptoLike.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
