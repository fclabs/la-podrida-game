// Structured request logging (spec FR-814–FR-816, BR-802, BR-803; plan P-7). One request line per
// request (level `info`, gated by `config.logLevel`) and, on a 500, one error line (level `error`,
// never gated). Lines carry only the fields below: never a token, header, body, hand or seed.
import type { Config } from '@/src/config';
import type { PlayerUpdate } from '@/src/domain/types';
import { jsonResponse } from './http';
import { toErrorResponse } from './errors';

/** The two levels the API writes at. */
export type LogLevel = 'info' | 'error';

/** A log sink: one JSON-serialisable line at a level. */
export type LogSink = (level: LogLevel, line: Record<string, unknown>) => void;

/** The console sink: `info` → `console.log`, `error` → `console.error`, one JSON line each. */
export function consoleLog(level: LogLevel, line: Record<string, unknown>): void {
  if (level === 'error') console.error(JSON.stringify(line));
  else console.log(JSON.stringify(line));
}

/** What a route body returns on success. */
export interface RouteResult {
  status: number;
  body: unknown;
  gameId?: string | null;
  fromVersion?: number | null;
  /** The `PlayerUpdate` the response carries (the 201's `update`, a 200 body). */
  update?: PlayerUpdate;
}

/**
 * Log fields a route body learns before it may throw (the path id, the request `version` or
 * `since`). The wrapper reads them for both the success and the error line.
 */
export interface RequestLogMeta {
  gameId?: string | null;
  fromVersion?: number | null;
}

/** The deps the wrapper needs (a subset of `HandlerDeps`). */
export interface RequestLogDeps {
  getConfig: () => Config;
  now: () => number;
  log: LogSink;
}

/** The longest logged `errorMessage` (P-7). */
const MAX_ERROR_MESSAGE = 500;

function countAiMoves(update: PlayerUpdate, seat: number | null): number {
  return update.events.filter(
    (e) => (e.type === 'bid-made' || e.type === 'card-played') && e.seat !== seat,
  ).length;
}

function requestLevel(deps: RequestLogDeps): Config['logLevel'] {
  try {
    return deps.getConfig().logLevel;
  } catch {
    return 'info';
  }
}

/**
 * Runs a route body, turns a throw into an error response (`toErrorResponse`), and logs the
 * request (FR-814) and, on a 500, the error (FR-815) subject to FR-816. `fn` may fill `meta` as
 * it learns the game id and the request version; fields it returns take precedence.
 */
export async function withRequestLog(
  route: string,
  deps: RequestLogDeps,
  fn: (meta: RequestLogMeta) => Promise<RouteResult>,
): Promise<Response> {
  const start = deps.now();
  const meta: RequestLogMeta = {};
  let status: number;
  let body: unknown;
  let update: PlayerUpdate | undefined;
  let errorCode: string | null = null;
  let thrown: { err: unknown } | undefined;

  try {
    const result = await fn(meta);
    status = result.status;
    body = result.body;
    update = result.update;
    if (result.gameId !== undefined) meta.gameId = result.gameId;
    if (result.fromVersion !== undefined) meta.fromVersion = result.fromVersion;
  } catch (err) {
    const mapped = toErrorResponse(err);
    status = mapped.status;
    body = mapped.body;
    update = mapped.body.update;
    errorCode = mapped.body.error.code;
    thrown = { err };
  }
  const end = deps.now();

  const seat = update?.view.you ?? null;
  const gameId = meta.gameId ?? null;
  const level = requestLevel(deps);
  if (level === 'debug' || level === 'info') {
    deps.log('info', {
      route,
      gameId,
      seat,
      fromVersion: meta.fromVersion ?? null,
      toVersion: update?.version ?? null,
      aiMoves: update === undefined ? null : countAiMoves(update, seat),
      status,
      durationMs: Math.round(end - start),
      errorCode,
    });
  }
  if (thrown !== undefined && errorCode === 'internal') {
    const { err } = thrown;
    deps.log('error', {
      route,
      gameId,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_MESSAGE),
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
  }
  return jsonResponse(status, body);
}
