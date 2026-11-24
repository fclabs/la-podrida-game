import { describe, expect, it, vi } from 'vitest';
import { captureAction, isAnimated, shouldAdopt } from '@/app/_client/game-state';
import { makeUpdate } from './support/fixtures';

describe('shouldAdopt (VC-920)', () => {
  const current = makeUpdate({ version: 7 });
  it('adopts when nothing is adopted', () => {
    expect(shouldAdopt(null, makeUpdate({ version: 0 }))).toBe(true);
  });
  it('adopts a greater version', () => {
    expect(shouldAdopt(current, makeUpdate({ version: 8 }))).toBe(true);
  });
  it('ignores an equal version', () => {
    expect(shouldAdopt(current, makeUpdate({ version: 7 }))).toBe(false);
  });
  it('ignores a lower version', () => {
    expect(shouldAdopt(current, makeUpdate({ version: 6 }))).toBe(false);
  });
});

describe('captureAction (VC-924)', () => {
  it('captures the adopted version, the move id and one new id', () => {
    const newId = vi.fn(() => 'id-1');
    const body = captureAction(makeUpdate({ version: 7 }), 'bid:2', newId);
    expect(body).toEqual({ version: 7, moveId: 'bid:2', clientRequestId: 'id-1' });
    expect(newId).toHaveBeenCalledTimes(1);
  });
  it('uses a new id per capture', () => {
    let n = 0;
    const newId = (): string => `id-${++n}`;
    const adopted = makeUpdate({ version: 7 });
    expect(captureAction(adopted, 'bid:2', newId).clientRequestId).not.toBe(
      captureAction(adopted, 'play:QH', newId).clientRequestId,
    );
  });
});

describe('isAnimated (FR-911)', () => {
  it('is true only for create and move', () => {
    expect(isAnimated('create')).toBe(true);
    expect(isAnimated('move')).toBe(true);
    expect(isAnimated('load')).toBe(false);
    expect(isAnimated('conflict')).toBe(false);
    expect(isAnimated('recovery')).toBe(false);
  });
});
