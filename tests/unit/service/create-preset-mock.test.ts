// createGame with a mocked preset registry (spec 07 FR-701; VC-703 first half). One mocked module
// per file (plan P-11): `@/src/domain/presets`, partial mock delegating to the original.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as presets from '@/src/domain/presets';
import { InvalidRequest } from '@/src/service/errors';
import { makeService } from './support/service-fixtures';

vi.mock('@/src/domain/presets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/domain/presets')>();
  return { ...actual, getPreset: vi.fn(actual.getPreset) };
});

const getPresetMock = vi.mocked(presets.getPreset);

/** A real preset whose player range is narrowed to 3–4. */
async function narrowPreset(): Promise<void> {
  const actual =
    await vi.importActual<typeof import('@/src/domain/presets')>('@/src/domain/presets');
  getPresetMock.mockImplementation((id: string) => ({
    ...actual.getPreset(id),
    players: { min: 3, max: 4 },
  }));
}

afterEach(() => {
  getPresetMock.mockReset();
});

describe('VC-703 (mocked half): the preset player range bounds aiCount', () => {
  it('players { min: 3, max: 4 }: aiCount 4 → InvalidRequest aiCount, 0 store calls', async () => {
    await narrowPreset();
    const { service, store } = makeService();
    const err = await service.createGame({ humanName: 'Ana', aiCount: 4 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InvalidRequest);
    expect((err as InvalidRequest).reason).toBe('aiCount');
    expect(store.calls).toHaveLength(0);
    expect(getPresetMock).toHaveBeenCalledWith('argentina-fidepo');
  });

  it('players { min: 3, max: 4 }: aiCount 3 succeeds with the mocked rules stored', async () => {
    await narrowPreset();
    const { service, state } = makeService();
    const { gameId } = await service.createGame({ humanName: 'Ana', aiCount: 3 });
    const commit0 = await state.load(gameId, 0);
    expect(commit0.state.seats).toHaveLength(4);
    expect(commit0.state.rules.players).toEqual({ min: 3, max: 4 });
  });
});
