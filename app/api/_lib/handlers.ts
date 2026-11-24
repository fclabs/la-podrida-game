// Route logic of the HTTP API (spec FR-808–FR-813, BR-804, BR-805). Handlers parse, call one
// service method (none for presets), and serialize. They never build an error status: they throw,
// and `withRequestLog` maps the throw with `toErrorResponse`. No import from `src/state`,
// `src/storage` or `src/engine` (VC-832).
import type { Config } from '@/src/config';
import { getPreset, PRESET_IDS } from '@/src/domain/presets';
import type { GameService } from '@/src/service/game-service';
import { readJsonBody } from './body';
import { type LogSink, withRequestLog } from './log';
import { PRESET_LABELS } from './presets';
import { CreateGameBodySchema, parseBody } from './schemas';

/** The injectable collaborators of every handler (FR-813). */
export interface HandlerDeps {
  getService: () => GameService;
  getConfig: () => Config;
  /** Milliseconds, for durations. */
  now: () => number;
  log: LogSink;
}

/** `POST /api/games` (FR-808): 201 `{ gameId, seat, seatToken, update }`. */
export function createGameHandler(req: Request, deps: HandlerDeps): Promise<Response> {
  return withRequestLog('POST /api/games', deps, async () => {
    const data = parseBody(CreateGameBodySchema, await readJsonBody(req));
    const result = await deps.getService().createGame(data);
    return { status: 201, body: result, gameId: result.gameId, update: result.update };
  });
}

/** `GET /api/presets` (FR-811): 200 `{ defaultPresetId, presets }`. No service, no storage. */
export function presetsHandler(req: Request, deps: HandlerDeps): Promise<Response> {
  return withRequestLog('GET /api/presets', deps, async () => {
    const body = {
      defaultPresetId: deps.getConfig().defaultRulesPreset,
      presets: PRESET_IDS.map((id) => {
        const preset = getPreset(id);
        return {
          id,
          ...PRESET_LABELS[id],
          players: { ...preset.players },
          deck: preset.deck.id,
        };
      }),
    };
    return { status: 200, body };
  });
}
