import { describe, expect, it, vi } from 'vitest';
import { newClientRequestId } from '@/app/_client/ids';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newClientRequestId (FR-935, VC-924)', () => {
  it('uses randomUUID when it is a function', () => {
    const randomUUID = vi.fn(() => 'fixed-id');
    expect(
      newClientRequestId({ randomUUID, getRandomValues: crypto.getRandomValues.bind(crypto) }),
    ).toBe('fixed-id');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('uses the real crypto by default', () => {
    expect(newClientRequestId()).toMatch(V4);
  });

  it('falls back to a v4 UUID from getRandomValues without randomUUID', () => {
    const noUuid = { getRandomValues: crypto.getRandomValues.bind(crypto) };
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = newClientRequestId(noUuid);
      expect(id).toMatch(V4);
      ids.add(id);
    }
    expect(ids.size).toBe(1000);
  });

  it('sets the version and variant bits on all-ones and all-zero bytes', () => {
    for (const fill of [0x00, 0xff]) {
      const id = newClientRequestId({
        getRandomValues: <T extends ArrayBufferView | null>(a: T): T => {
          (a as unknown as Uint8Array).fill(fill);
          return a;
        },
      });
      expect(id).toMatch(V4);
    }
  });
});
