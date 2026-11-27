import type { PlayerUpdate } from '@/src/domain/types';
import type { CreateGameBody, PresetsBody } from './api-types';

// Top-level shape checks of FR-936; deeper fields are trusted (plan P-8).

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPlayerUpdate(value: unknown): value is PlayerUpdate {
  if (!isObject(value)) return false;
  const view = value.view;
  return (
    typeof value.version === 'number' &&
    Array.isArray(value.events) &&
    isObject(view) &&
    Array.isArray(view.seats) &&
    Array.isArray(view.handPlan) &&
    Array.isArray(view.yourHand) &&
    isObject(view.scoreboard) &&
    Array.isArray(value.legalMoves)
  );
}

export function isCreateBody(value: unknown): value is CreateGameBody {
  return (
    isObject(value) &&
    typeof value.gameId === 'string' &&
    typeof value.seatToken === 'string' &&
    isPlayerUpdate(value.update)
  );
}

/** Also requires a preset whose `id` equals `defaultPresetId` (P-8, so create fails per FR-903). */
export function isPresetsBody(value: unknown): value is PresetsBody {
  if (!isObject(value) || typeof value.defaultPresetId !== 'string') return false;
  const presets = value.presets;
  if (!Array.isArray(presets)) return false;
  const entries = presets as unknown[];
  const wellFormed = entries.every(
    (p) => isObject(p) && typeof p.id === 'string' && typeof p.deck === 'string',
  );
  return wellFormed && entries.some((p) => (p as { id: string }).id === value.defaultPresetId);
}
