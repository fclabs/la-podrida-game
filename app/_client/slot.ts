/** The one remembered game of this browser (FR-930). */
export interface GameSlot {
  gameId: string;
  seatToken: string;
  deck: string;
  finished: boolean;
}

/** The `localStorage` key of the slot. */
export const SLOT_KEY = 'la-podrida:game';

/** The stored slot, or `null` when the key is missing, unparsable, mistyped or storage fails. */
export function readSlot(storage: Pick<Storage, 'getItem'> | null): GameSlot | null {
  try {
    if (storage === null) return null;
    const raw = storage.getItem(SLOT_KEY);
    if (raw === null || raw === undefined) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Record<string, unknown>;
    if (
      typeof v.gameId !== 'string' ||
      typeof v.seatToken !== 'string' ||
      typeof v.deck !== 'string' ||
      typeof v.finished !== 'boolean'
    ) {
      return null;
    }
    return { gameId: v.gameId, seatToken: v.seatToken, deck: v.deck, finished: v.finished };
  } catch {
    return null;
  }
}

/** Stores `slot`; `false` when storage is missing or throws. */
export function writeSlot(storage: Pick<Storage, 'setItem'> | null, slot: GameSlot): boolean {
  try {
    if (storage === null) return false;
    storage.setItem(SLOT_KEY, JSON.stringify(slot));
    return true;
  } catch {
    return false;
  }
}

/** Removes the slot; never throws. */
export function clearSlot(storage: Pick<Storage, 'removeItem'> | null): void {
  try {
    storage?.removeItem(SLOT_KEY);
  } catch {
    // Ignored (FR-930).
  }
}
