// A `fetch` for UI tests that routes the four Phase 8 routes to the real handlers in process
// (plan P-2): real `GameService` over a `RecordingStore` around `MemoryObjectStore`, via `makeApi`.
import {
  createGameHandler,
  getGameHandler,
  presetsHandler,
  submitMoveHandler,
} from '@/app/api/_lib/handlers';
import {
  type Api,
  BASE_URL,
  ctx,
  type MakeApiOptions,
  makeApi,
} from '../../api/support/api-fixtures';

/** One call seen by the in-process `fetch`. `body` is parsed JSON when it parses, else the raw text. */
export interface RecordedCall {
  method: string;
  /** Path plus query, e.g. `/api/games/<id>?since=3`. */
  path: string;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  body: unknown;
  /** The status the caller received; `null` when the call rejected, hung or was aborted. */
  status: number | null;
}

/**
 * One injected failure:
 * - `'reject-before'`: `fetch` rejects with a `TypeError`; no handler runs.
 * - `'reject-after'`: the handler runs (the server state advances), then `fetch` rejects.
 * - `'hang'`: never settles unless `init.signal` aborts (then it rejects with `AbortError`).
 * - `{ status, body }`: a fixed JSON response; no handler runs.
 */
export type FailMode =
  'reject-before' | 'reject-after' | 'hang' | { status: number; body: unknown };

/** Restricts which call a `failNext` applies to. Omitted fields match anything. */
export interface FailMatch {
  method?: string;
  /** A string must be contained in the path-plus-query; a RegExp must match it. */
  path?: string | RegExp;
}

export interface InProcessApi {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  api: Api;
  calls: RecordedCall[];
  /** Arms one failure for the next call matching `match` (default: the next call). */
  failNext: (mode: FailMode, match?: FailMatch) => void;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/** Settles with `promise`, or rejects with `AbortError` when `signal` aborts first. */
function withSignal<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

function matches(match: FailMatch | undefined, method: string, path: string): boolean {
  if (!match) return true;
  if (match.method !== undefined && match.method.toUpperCase() !== method) return false;
  if (typeof match.path === 'string') return path.includes(match.path);
  if (match.path) return match.path.test(path);
  return true;
}

function parseBody(text: string | undefined): unknown {
  if (text === undefined || text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Copies a handler response into a plain `Response` (status, headers, text body). */
async function plainResponse(res: Response): Promise<Response> {
  const text = await res.text();
  const headers = new Headers();
  res.headers.forEach((value, key) => headers.set(key, value));
  return new Response(text, { status: res.status, headers });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Builds the in-process API. `opts` go to `makeApi` (store, service, default preset, log level). */
export function makeInProcessApi(opts: MakeApiOptions = {}): InProcessApi {
  const api = makeApi(opts);
  const calls: RecordedCall[] = [];
  const armed: { mode: FailMode; match: FailMatch | undefined }[] = [];

  async function dispatch(
    method: string,
    path: string,
    headers: Headers,
    text: string | undefined,
  ) {
    const url = new URL(path, BASE_URL);
    const init: RequestInit = { method, headers };
    if (text !== undefined) init.body = new TextEncoder().encode(text);
    const req = new Request(url, init);
    const segments = url.pathname.split('/').filter(Boolean); // ['api', 'games', id, 'moves']
    if (segments[0] === 'api' && segments[1] === 'presets' && segments.length === 2) {
      if (method === 'GET') return presetsHandler(req, api.deps);
    } else if (segments[0] === 'api' && segments[1] === 'games') {
      if (segments.length === 2 && method === 'POST') return createGameHandler(req, api.deps);
      const id = segments[2];
      if (id !== undefined && segments.length === 3 && method === 'GET') {
        return getGameHandler(req, ctx(id), api.deps);
      }
      if (
        id !== undefined &&
        segments.length === 4 &&
        segments[3] === 'moves' &&
        method === 'POST'
      ) {
        return submitMoveHandler(req, ctx(id), api.deps);
      }
    }
    return jsonResponse(404, { error: 'not_found' });
  }

  const fetchFn: InProcessApi['fetch'] = async (input, init) => {
    const source = input instanceof Request ? input : undefined;
    const rawUrl =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(rawUrl, BASE_URL);
    const path = url.pathname + url.search;
    const method = (init?.method ?? source?.method ?? 'GET').toUpperCase();
    const headers = new Headers(source?.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    const bodyInit = init?.body ?? undefined;
    const text = typeof bodyInit === 'string' ? bodyInit : undefined;
    const signal = init?.signal ?? source?.signal;

    const headerRecord: Record<string, string> = {};
    headers.forEach((value, key) => {
      headerRecord[key] = value;
    });
    const call: RecordedCall = {
      method,
      path,
      headers: headerRecord,
      body: parseBody(text),
      status: null,
    };
    calls.push(call);

    if (signal?.aborted) throw abortError();

    const idx = armed.findIndex((a) => matches(a.match, method, path));
    const mode = idx >= 0 ? armed.splice(idx, 1)[0]?.mode : undefined;

    if (mode === 'reject-before') throw new TypeError('Failed to fetch');
    if (mode === 'hang') {
      return withSignal(new Promise<Response>(() => undefined), signal);
    }
    if (mode !== undefined && mode !== 'reject-after') {
      call.status = mode.status;
      return jsonResponse(mode.status, mode.body);
    }
    const res = await withSignal(dispatch(method, path, headers, text).then(plainResponse), signal);
    if (mode === 'reject-after') throw new TypeError('Failed to fetch');
    call.status = res.status;
    return res;
  };

  return {
    fetch: fetchFn,
    api,
    calls,
    failNext: (mode, match) => {
      armed.push({ mode, match });
    },
  };
}
