import { describe, expect, it } from 'vitest';
import { keepUpdate, takeKeptUpdate } from '@/app/_client/kept-update';
import type { PlayerUpdate } from '@/src/domain/types';

const update = { version: 1 } as unknown as PlayerUpdate;

describe('kept update (FR-902, P-4)', () => {
  it('returns the update for a matching gameId, once', () => {
    keepUpdate('A', update);
    expect(takeKeptUpdate('A')).toBe(update);
    expect(takeKeptUpdate('A')).toBeNull();
  });

  it('returns null and clears it for another gameId', () => {
    keepUpdate('A', update);
    expect(takeKeptUpdate('B')).toBeNull();
    expect(takeKeptUpdate('A')).toBeNull();
  });
});
