// GET /api/presets through `presetsHandler` (spec FR-811; VC-825, VC-800 and VC-826 partial).
import { describe, expect, it, vi } from 'vitest';
import { presetsHandler } from '@/app/api/_lib/handlers';
import { PresetsResponseSchema } from '@/app/api/_lib/schemas';
import { getPreset, PRESET_IDS } from '@/src/domain/presets';
import { getReq, makeApi, readJson } from './support/api-fixtures';

const FR_811_NAMES: Record<string, string> = {
  'argentina-fidepo': 'Argentina (F.I.DE.PO.)',
  'spain-ludoteka': 'Spain (Ludoteka)',
  gamerules: 'GameRules',
  'mexico-bazas': 'Mexico (Bazas)',
};

describe('VC-825: GET presets', () => {
  it('answers 200 with every preset in PRESET_IDS order, without calling getService', async () => {
    const api = makeApi({ defaultPreset: 'gamerules' });
    const getService = vi.fn(api.deps.getService);
    api.deps.getService = getService;

    const res = await presetsHandler(getReq('/api/presets'), api.deps);
    expect(res.status).toBe(200);
    const body = PresetsResponseSchema.parse(await readJson(res));

    expect(body.defaultPresetId).toBe('gamerules');
    expect(body.defaultPresetId).toBe(api.deps.getConfig().defaultRulesPreset);
    expect(body.presets.map((p) => p.id)).toEqual([...PRESET_IDS]);
    for (const p of body.presets) {
      const preset = getPreset(p.id);
      expect(p.players).toEqual(preset.players);
      expect(p.deck).toBe(preset.deck.id);
      expect(p.name).toBe(FR_811_NAMES[p.id]);
      expect(p.description.length).toBeGreaterThanOrEqual(1);
      expect(p.description.length).toBeLessThanOrEqual(200);
    }
    expect(getService).not.toHaveBeenCalled();
    expect(api.store.callsOf()).toHaveLength(0);
  });

  it('defaults to argentina-fidepo when DEFAULT_RULES_PRESET is unset', async () => {
    const res = await presetsHandler(getReq('/api/presets'), makeApi().deps);
    expect(PresetsResponseSchema.parse(await readJson(res)).defaultPresetId).toBe(
      'argentina-fidepo',
    );
  });

  it('has JSON headers (VC-800 partial)', async () => {
    const res = await presetsHandler(getReq('/api/presets'), makeApi().deps);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('VC-826 (partial): app/api/presets/route.ts', () => {
  it('exports only GET', async () => {
    const mod = await import('@/app/api/presets/route');
    expect(Object.keys(mod)).toEqual(['GET']);
  });
});
