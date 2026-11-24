import type { PlayerUpdate } from '@/src/domain/types';

// Spec 08 response shapes, typed locally: the UI may not import `app/api/_lib` (BR-902).

export interface PresetEntry {
  id: string;
  name: string;
  description: string;
  players: { min: number; max: number };
  deck: string;
}

/** `GET /api/presets` 200 body. */
export interface PresetsBody {
  defaultPresetId: string;
  presets: PresetEntry[];
}

/** `POST /api/games` request body. */
export interface CreateGameRequest {
  humanName: string;
  aiCount: number;
  rulesPreset?: string;
}

/** `POST /api/games` 201 body. */
export interface CreateGameBody {
  gameId: string;
  seat: number;
  seatToken: string;
  update: PlayerUpdate;
}

/** `POST /api/games/{id}/moves` request body (FR-935). */
export interface MoveRequest {
  version: number;
  moveId: string;
  clientRequestId: string;
}

/** Error body of every non-2xx response; a 409 also carries `update`. */
export interface ErrorBody {
  error: { code: string; message: string };
  update?: PlayerUpdate;
}
