// The service with a mocked preset registry (spec 07 FR-701, FR-717, BR-703; VC-703 first half,
// VC-721). One mocked module per file (plan P-11): `@/src/domain/presets`, partial mock delegating
// to the original.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as presets from '@/src/domain/presets';
import { InvalidRequest } from '@/src/service/errors';
import { firstLegalMoveId, makeService } from './support/service-fixtures';

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

describe('VC-721: stored rules are frozen; submitMove never reads the preset registry', () => {
  it('after switching getPreset to other scoring and hand plan, the next commit keeps the stored ones', async () => {
    const { service, state } = makeService();
    const created = await service.createGame({ humanName: 'Ana', aiCount: 3 });
    const commit0 = await state.load(created.gameId, 0);
    expect(commit0.state.rules.scoring.kind).toBe('bonus-plus-tricks');

    const actual =
      await vi.importActual<typeof import('@/src/domain/presets')>('@/src/domain/presets');
    getPresetMock.mockImplementation((id: string) => ({
      ...actual.getPreset(id),
      scoring: { kind: 'bonus-plus-bid', bonus: 10 },
      handSequence: [{ kind: 'repeat', cards: 1, times: 2 }],
    }));
    getPresetMock.mockClear();

    const update = await service.submitMove(created.gameId, created.seatToken, {
      version: 0,
      moveId: firstLegalMoveId(created.update),
      clientRequestId: 'after-switch',
    });
    expect(update.version).toBe(1);
    expect(getPresetMock).not.toHaveBeenCalled();

    const commit1 = await state.load(created.gameId, 1);
    expect(commit1.state.rules).toEqual(commit0.state.rules);
    expect(commit1.state.handPlan).toEqual(commit0.state.handPlan);
    expect(update.view.handPlan).toEqual(commit0.state.handPlan);
  });
});
