import type { PlayerUpdate } from '@/src/domain/types';
import type { CreateGameBody, CreateGameRequest, MoveRequest, PresetsBody } from './api-types';
import { isCreateBody, isPlayerUpdate, isPresetsBody } from './shape';

export type ApiResult<T> =
  | { kind: 'ok'; status: number; body: T }
  | { kind: 'conflict'; update: PlayerUpdate } // 409 on a move (FR-918)
  | { kind: 'error'; status: number; code: string } // a 4xx handled for this call by its FR
  | { kind: 'transport' }; // per FR-936

export interface ApiDeps {
  fetch: typeof fetch;
  setTimeout: (handler: () => void, ms: number) => unknown;
  clearTimeout: (id: never) => void;
}

export const API_TIMEOUT_MS = 20_000;

interface CallSpec<T> {
  method: 'GET' | 'POST';
  url: string;
  token?: string;
  body?: unknown;
  okStatus: number;
  errorStatuses: readonly number[];
  conflict?: boolean;
  parse: (json: unknown) => json is T;
}

const TRANSPORT = { kind: 'transport' } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The spec 08 `error.code`; empty when the body is not the expected error body. */
async function errorCode(response: Response): Promise<string> {
  try {
    const json: unknown = await response.json();
    const error = isRecord(json) ? json.error : undefined;
    return isRecord(error) && typeof error.code === 'string' ? error.code : '';
  } catch {
    return '';
  }
}

async function run<T>(deps: ApiDeps, spec: CallSpec<T>, init: RequestInit): Promise<ApiResult<T>> {
  const response = await deps.fetch(spec.url, init);
  const status = response.status;
  if (status === spec.okStatus) {
    const json: unknown = await response.json();
    return spec.parse(json) ? { kind: 'ok', status, body: json } : TRANSPORT;
  }
  if (status === 409 && spec.conflict === true) {
    const json: unknown = await response.json();
    const update = isRecord(json) ? json.update : undefined;
    return isPlayerUpdate(update) ? { kind: 'conflict', update } : TRANSPORT;
  }
  if (spec.errorStatuses.includes(status)) {
    return { kind: 'error', status, code: await errorCode(response) };
  }
  return TRANSPORT;
}

async function call<T>(deps: ApiDeps, spec: CallSpec<T>): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = deps.setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (spec.body !== undefined) headers['Content-Type'] = 'application/json';
    if (spec.token !== undefined) headers.Authorization = `Bearer ${spec.token}`;
    const init: RequestInit = {
      method: spec.method,
      headers,
      cache: 'no-store',
      signal: controller.signal,
    };
    if (spec.body !== undefined) init.body = JSON.stringify(spec.body);
    // Race against the abort so a fetch/json() that ignores the signal still ends at 20 s.
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('timeout')), {
        once: true,
      });
    });
    return await Promise.race([run(deps, spec, init), aborted]);
  } catch {
    return TRANSPORT;
  } finally {
    deps.clearTimeout(timer as never);
  }
}

/** `GET /api/presets`: 200 (FR-903 otherwise). */
export function getPresets(deps: ApiDeps): Promise<ApiResult<PresetsBody>> {
  return call(deps, {
    method: 'GET',
    url: '/api/presets',
    okStatus: 200,
    errorStatuses: [],
    parse: isPresetsBody,
  });
}

/** `POST /api/games`: 201, 400 (FR-903). */
export function createGame(
  deps: ApiDeps,
  body: CreateGameRequest,
): Promise<ApiResult<CreateGameBody>> {
  return call(deps, {
    method: 'POST',
    url: '/api/games',
    body,
    okStatus: 201,
    errorStatuses: [400],
    parse: isCreateBody,
  });
}

/** `GET /api/games/{id}[?since=n]`: 200, 401, 404, 410 (FR-907/908). */
export function getUpdate(
  deps: ApiDeps,
  gameId: string,
  token: string,
  since?: number,
): Promise<ApiResult<PlayerUpdate>> {
  const query = since === undefined ? '' : `?since=${since}`;
  return call(deps, {
    method: 'GET',
    url: `/api/games/${encodeURIComponent(gameId)}${query}`,
    token,
    okStatus: 200,
    errorStatuses: [401, 404, 410],
    parse: isPlayerUpdate,
  });
}

/** `POST /api/games/{id}/moves`: 200, 409 with update, 400/401/403/404/410/413/422 (FR-918). */
export function submitMove(
  deps: ApiDeps,
  gameId: string,
  token: string,
  body: MoveRequest,
): Promise<ApiResult<PlayerUpdate>> {
  return call(deps, {
    method: 'POST',
    url: `/api/games/${encodeURIComponent(gameId)}/moves`,
    token,
    body,
    okStatus: 200,
    errorStatuses: [400, 401, 403, 404, 410, 413, 422],
    conflict: true,
    parse: isPlayerUpdate,
  });
}
