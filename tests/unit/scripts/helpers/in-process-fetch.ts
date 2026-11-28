// Test helper (shared by the bench-moves and smoke tests): a `fetch` that routes requests to the
// REAL route handlers over a store, with no network. The URL origin is ignored; only the path
// matters. Unknown routes answer 404.
//
//   const api = inProcessApi();                  // fresh MemoryObjectStore
//   const api = inProcessApi({ store });         // share a store with the script under test
//   runBench({ fetch: api.fetch, ... })
import {
  createGameHandler,
  getGameHandler,
  presetsHandler,
  submitMoveHandler,
  type HandlerDeps,
} from '@/app/api/_lib/handlers';
import { loadConfig } from '@/src/config';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import type { ObjectStore } from '@/src/storage/object-store';
import { makeService } from '../../service/support/service-fixtures';

export interface InProcessApi {
  /** Same shape as the global `fetch`. */
  fetch: typeof fetch;
  store: ObjectStore;
  deps: HandlerDeps;
  /** Every request seen, in order. */
  requests: Array<{ method: string; path: string; headers: Headers }>;
}

export interface InProcessOptions {
  store?: ObjectStore;
}

export function inProcessApi(options: InProcessOptions = {}): InProcessApi {
  const store = options.store ?? new MemoryObjectStore();
  const { service } = makeService(store);
  const config = loadConfig({ STORAGE_DRIVER: 'memory', LOG_LEVEL: 'error' });
  const deps: HandlerDeps = {
    getService: () => service,
    getConfig: () => config,
    now: () => 0,
    log: () => undefined,
  };
  const requests: InProcessApi['requests'] = [];

  const route = async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    requests.push({ method: req.method, path, headers: req.headers });
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    if (req.method === 'POST' && path === '/api/games') return createGameHandler(req, deps);
    if (req.method === 'GET' && path === '/api/presets') return presetsHandler(req, deps);
    const move = /^\/api\/games\/([^/]+)\/moves$/.exec(path);
    if (req.method === 'POST' && move) return submitMoveHandler(req, ctx(move[1]), deps);
    const game = /^\/api\/games\/([^/]+)$/.exec(path);
    if (req.method === 'GET' && game) return getGameHandler(req, ctx(game[1]), deps);
    return new Response('not found', { status: 404 });
  };

  const fetchFn = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    route(new Request(input, init));
  return { fetch: fetchFn as typeof fetch, store, deps, requests };
}
