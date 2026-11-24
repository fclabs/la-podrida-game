import { describe, expect, it } from 'vitest';
import { clearSlot, type GameSlot, readSlot, SLOT_KEY, writeSlot } from '@/app/_client/slot';

const SLOT: GameSlot = {
  gameId: 'g'.repeat(26),
  seatToken: 't'.repeat(43),
  deck: 'french-52',
  finished: false,
};

function memoryStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(SLOT_KEY, initial);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
  removeItem: () => {
    throw new Error('denied');
  },
};

describe('slot (VC-904, FR-930)', () => {
  it('uses the documented key', () => {
    expect(SLOT_KEY).toBe('la-podrida:game');
  });

  it('survives a storage whose methods throw', () => {
    expect(readSlot(throwing)).toBeNull();
    expect(writeSlot(throwing, SLOT)).toBe(false);
    expect(() => clearSlot(throwing)).not.toThrow();
  });

  it('treats a null storage as empty or failing', () => {
    expect(readSlot(null)).toBeNull();
    expect(writeSlot(null, SLOT)).toBe(false);
    expect(() => clearSlot(null)).not.toThrow();
  });

  it('reads null for a missing key, bad JSON, wrong types and missing fields', () => {
    expect(readSlot(memoryStorage())).toBeNull();
    expect(readSlot(memoryStorage('{'))).toBeNull();
    expect(readSlot(memoryStorage('null'))).toBeNull();
    expect(readSlot(memoryStorage('"x"'))).toBeNull();
    expect(readSlot(memoryStorage(JSON.stringify({ ...SLOT, gameId: 1 })))).toBeNull();
    expect(readSlot(memoryStorage(JSON.stringify({ ...SLOT, seatToken: null })))).toBeNull();
    expect(readSlot(memoryStorage(JSON.stringify({ ...SLOT, deck: 3 })))).toBeNull();
    expect(readSlot(memoryStorage(JSON.stringify({ ...SLOT, finished: 'no' })))).toBeNull();
    expect(
      readSlot(memoryStorage(JSON.stringify({ gameId: 'a', seatToken: 'b', finished: false }))),
    ).toBeNull();
  });

  it('round-trips a valid slot and clears it', () => {
    const storage = memoryStorage();
    expect(writeSlot(storage, SLOT)).toBe(true);
    expect(readSlot(storage)).toEqual(SLOT);
    clearSlot(storage);
    expect(storage.data.has(SLOT_KEY)).toBe(false);
    expect(readSlot(storage)).toBeNull();
  });

  it('works with the jsdom localStorage', () => {
    expect(writeSlot(localStorage, SLOT)).toBe(true);
    expect(readSlot(localStorage)).toEqual(SLOT);
  });
});
