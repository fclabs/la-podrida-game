// Route logic of the HTTP API (spec FR-808–FR-813, BR-804, BR-805). Handlers parse, call one
// service method (none for presets), and serialize. They never build an error status: they throw,
// and `withRequestLog` maps the throw with `toErrorResponse`. No import from `src/state`,
// `src/storage` or `src/engine` (VC-832).
import { z } from 'zod';
import type { Config } from '@/src/config';
import { getPreset, PRESET_IDS } from '@/src/domain/presets';
import type { GameService } from '@/src/service/game-service';
import { assertGameIdFormat, parseBearer } from './auth';
import { readJsonBody } from './body';
import { type LogSink, withRequestLog } from './log';
import { PRESET_LABELS } from './presets';
import { CreateGameBodySchema, parseBody, parseSince, SubmitMoveBodySchema } from './schemas';

/** The injectable collaborators of every handler (FR-813). */
export interface HandlerDeps {
  getService: () => GameService;
  getConfig: () => Config;
  /** Milliseconds, for durations. */
  now: () => number;
  log: LogSink;
}

/** The Next.js 16 context of an `[id]` route: `params` is a promise. */
export interface GameRouteContext {
  params: Promise<{ id: string }>;
}

/** `{ since }` with `since` no greater than `version` (FR-804, after the service call). */
function sinceAtMost(version: number) {
  return z.strictObject({ since: z.int().max(version) });
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

/**
 * `GET /api/games/{id}` (FR-804, FR-806, FR-809): id format → bearer → `since` syntax, all before
 * the service; then `getUpdate`, and a `since` past the returned version is `invalid_request`.
 * 200 with the `PlayerUpdate`. The path id is logged only once it has the game id format (D-013).
 */
export function getGameHandler(
  req: Request,
  ctx: GameRouteContext,
  deps: HandlerDeps,
): Promise<Response> {
  return withRequestLog('GET /api/games/[id]', deps, async (meta) => {
    const { id } = await ctx.params;
    assertGameIdFormat(id);
    meta.gameId = id;
    const token = parseBearer(req.headers);
    const since = parseSince(new URL(req.url));
    meta.fromVersion = since ?? null;
    const update = await deps.getService().getUpdate(id, token, since);
    // FR-804 post-call check: a `since` past the tip is `invalid_request` field `since`. Through
    // `parseBody`, so no status literal lives here (VC-832, D-014).
    if (since !== undefined) parseBody(sinceAtMost(update.version), { since });
    return { status: 200, body: update, update };
  });
}

/**
 * `POST /api/games/{id}/moves` (FR-806, FR-810): id format → bearer → body, all before the
 * service; then `submitMove`. 200 with the `PlayerUpdate` (an idempotent retry answers the
 * original). The path id is logged only once it has the game id format (D-013).
 */
export function submitMoveHandler(
  req: Request,
  ctx: GameRouteContext,
  deps: HandlerDeps,
): Promise<Response> {
  return withRequestLog('POST /api/games/[id]/moves', deps, async (meta) => {
    const { id } = await ctx.params;
    assertGameIdFormat(id);
    meta.gameId = id;
    const token = parseBearer(req.headers);
    const body = parseBody(SubmitMoveBodySchema, await readJsonBody(req));
    meta.fromVersion = body.version;
    const update = await deps.getService().submitMove(id, token, body);
    return { status: 200, body: update, update };
  });
}
