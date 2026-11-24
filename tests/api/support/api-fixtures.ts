// Shared fixtures for the API tests (plan P-11). Handlers are called directly with injected deps:
// a real `GameService` over a `RecordingStore` around a fresh `MemoryObjectStore`.
import { expect } from 'vitest';
import type { HandlerDeps } from '@/app/api/_lib/handlers';
import { createGameHandler, submitMoveHandler } from '@/app/api/_lib/handlers';
import type { LogLevel } from '@/app/api/_lib/log';
import { CreateGameResponseSchema, PlayerUpdateResponseSchema } from '@/app/api/_lib/schemas';
import { type Config, loadConfig } from '@/src/config';
import type { PresetId } from '@/src/domain/rules';
import type { PlayerUpdate } from '@/src/domain/types';
import type { GameService } from '@/src/service/game-service';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { firstLegalMoveId, makeService } from '../../unit/service/support/service-fixtures';
import { RecordingStore } from '../../unit/state/support/store-wrappers';

/** The origin of every test request. */
export const BASE_URL = 'http://localhost';

/** One captured log line. */
export interface CapturedLog {
  level: LogLevel;
  line: Record<string, unknown>;
}

/** Options of `makeApi`. */
export interface MakeApiOptions {
  store?: RecordingStore;
  service?: GameService;
  logLevel?: Config['logLevel'];
  defaultPreset?: PresetId;
}

/** Injected deps plus the store, the service and the captured log lines. */
export interface Api {
  deps: HandlerDeps;
  store: RecordingStore;
  service: GameService;
  logs: CapturedLog[];
}

/**
 * Handler deps for a test: `getService` returns `service` (default: `makeService` over `store`,
 * itself defaulting to a `RecordingStore` around a fresh `MemoryObjectStore`), `getConfig` a
 * memory-driver config, `now` a fake clock advancing 1 ms per call, `log` a capturing sink.
 */
export function makeApi(opts: MakeApiOptions = {}): Api {
  const store = opts.store ?? new RecordingStore(new MemoryObjectStore());
  const service =
    opts.service ??
    makeService(
      store,
      opts.defaultPreset === undefined ? {} : { defaultPresetId: opts.defaultPreset },
    ).service;
  const config = loadConfig({
    STORAGE_DRIVER: 'memory',
    LOG_LEVEL: opts.logLevel ?? 'info',
    DEFAULT_RULES_PRESET: opts.defaultPreset,
  });
  const logs: CapturedLog[] = [];
  let clock = 0;
  const deps: HandlerDeps = {
    getService: () => service,
    getConfig: () => config,
    now: () => clock++,
    log: (level, line) => {
      logs.push({ level, line });
    },
  };
  return { deps, store, service, logs };
}

/** Options of `postJson`. */
export interface PostJsonOptions {
  headers?: Record<string, string>;
  /** Raw body bytes, sent instead of `JSON.stringify(body)`. */
  rawBody?: Uint8Array<ArrayBuffer>;
  /** The `Content-Type` (default `application/json`); `null` sends none. */
  contentType?: string | null;
}

/**
 * A `POST` with a JSON body. The body is always sent as bytes, so `Request` adds no default
 * `text/plain` type: `contentType: null` sends no `Content-Type` at all (ledger R-027).
 */
export function postJson(path: string, body: unknown, opts: PostJsonOptions = {}): Request {
  const headers = new Headers(opts.headers);
  const contentType = opts.contentType === undefined ? 'application/json' : opts.contentType;
  if (contentType !== null) headers.set('content-type', contentType);
  const bytes = opts.rawBody ?? new TextEncoder().encode(JSON.stringify(body));
  return new Request(new URL(path, BASE_URL), { method: 'POST', body: bytes, headers });
}

/** A `GET` with optional headers. */
export function getReq(path: string, headers?: Record<string, string>): Request {
  return new Request(new URL(path, BASE_URL), { method: 'GET', headers });
}

/** The Next.js 16 route context of an `[id]` route. */
export function ctx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

/** The parsed JSON body of a response. */
export async function readJson<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** The default body of `createGameVia`. */
export const DEFAULT_CREATE_BODY = { humanName: 'Ana', aiCount: 3 } as const;

/**
 * Creates a game through `createGameHandler`, asserts a 201 whose body parses with
 * `CreateGameResponseSchema`, and returns its fields.
 */
export async function createGameVia(
  api: Api,
  body: unknown = DEFAULT_CREATE_BODY,
): Promise<{ gameId: string; seatToken: string; update: PlayerUpdate }> {
  const res = await createGameHandler(postJson('/api/games', body), api.deps);
  expect(res.status).toBe(201);
  const parsed = CreateGameResponseSchema.parse(await res.json());
  return { gameId: parsed.gameId, seatToken: parsed.seatToken, update: parsed.update };
}

/** The public methods of `GameService`. */
export type ServiceMethods = Pick<GameService, 'createGame' | 'getUpdate' | 'submitMove'>;

/**
 * An object with the `GameService` method shape that delegates to `service`, except for the
 * methods in `overrides` (typically one that throws). `GameService` has private fields, so the
 * wrapper is cast to the class type for `HandlerDeps.getService`.
 */
export function wrapService(service: GameService, overrides: Partial<ServiceMethods>): GameService {
  const wrapper: ServiceMethods = {
    createGame: (req) => service.createGame(req),
    getUpdate: (gameId, seatToken, since) => service.getUpdate(gameId, seatToken, since),
    submitMove: (gameId, seatToken, req) => service.submitMove(gameId, seatToken, req),
    ...overrides,
  };
  return wrapper as unknown as GameService;
}

/** `{ authorization: 'Bearer <token>' }`. */
export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** The ids `playToEndVia` needs (the `createGameVia` result fits). */
export interface GameIds {
  gameId: string;
  seatToken: string;
  update: PlayerUpdate;
}

/**
 * Plays a game to `game-over` through `submitMoveHandler`: the human always submits its first
 * legal move at the latest version, with a fresh `clientRequestId` per call (`via-<n>`). Asserts
 * each response is a 200 parsing with `PlayerUpdateResponseSchema` and returns them in order (the
 * last one is the game-over update).
 */
export async function playToEndVia(api: Api, ids: GameIds): Promise<PlayerUpdate[]> {
  const responses: PlayerUpdate[] = [];
  let update = ids.update;
  while (update.view.phase !== 'game-over') {
    const res = await submitMoveHandler(
      postJson(
        `/api/games/${ids.gameId}/moves`,
        {
          version: update.version,
          moveId: firstLegalMoveId(update),
          clientRequestId: `via-${responses.length + 1}`,
        },
        { headers: bearer(ids.seatToken) },
      ),
      ctx(ids.gameId),
      api.deps,
    );
    expect(res.status).toBe(200);
    update = PlayerUpdateResponseSchema.parse(await res.json());
    responses.push(update);
  }
  return responses;
}
