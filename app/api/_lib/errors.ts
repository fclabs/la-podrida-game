// The single error → HTTP response mapping (spec FR-801, FR-807, BR-802, BR-804; plan P-1). This is
// the only module of the HTTP layer that holds error statuses: everything else throws.
import type { PlayerUpdate } from '@/src/domain/types';
import {
  GameNotFound,
  GameUnsupported,
  IllegalMove,
  InvalidRequest,
  NotYourTurn,
  Unauthorized,
  VersionConflict,
} from '@/src/service/errors';
import { CommitNotFoundError, GameNotFoundError } from '@/src/state/errors';

/** Every error `code` the API answers with, in status order. */
export const ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'not_your_turn',
  'game_not_found',
  'version_conflict',
  'game_unsupported',
  'payload_too_large',
  'illegal_move',
  'internal',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** The fixed English message of each code (FR-807). `invalid_request` may add `: <field>`. */
export const ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = Object.freeze({
  invalid_request: 'Invalid request',
  unauthorized: 'Missing or invalid seat token',
  not_your_turn: 'It is not your turn',
  game_not_found: 'Game not found',
  version_conflict: 'The game has moved on; see update',
  game_unsupported: 'This game was created by an older version and can no longer be played',
  payload_too_large: 'Request body too large',
  illegal_move: 'That move is not legal now',
  internal: 'Internal error',
});

/** The codes a request-parse failure can carry, each with its status. */
type RequestErrorStatus = 400 | 401 | 404 | 413;
type RequestErrorCode = 'invalid_request' | 'unauthorized' | 'game_not_found' | 'payload_too_large';

/**
 * A request that failed the HTTP layer's own checks (FR-802–FR-806), before the service is called.
 * `field` names the offending field of an `invalid_request` (`body`, `since`, a body key).
 */
export class RequestError extends Error {
  readonly status: RequestErrorStatus;
  readonly code: RequestErrorCode;
  readonly field?: string;

  constructor(status: RequestErrorStatus, code: RequestErrorCode, field?: string) {
    super(messageFor(code, field));
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
    if (field !== undefined && field !== '') this.field = field;
  }
}

/** The body of every error response; `update` only on 409 (FR-801). */
export interface ErrorBody {
  error: { code: ErrorCode; message: string };
  update?: PlayerUpdate;
}

function messageFor(code: ErrorCode, field?: string): string {
  const base = ERROR_MESSAGES[code];
  return code === 'invalid_request' && field !== undefined && field !== ''
    ? `${base}: ${field}`
    : base;
}

function errorBody(code: ErrorCode, field?: string): ErrorBody {
  return { error: { code, message: messageFor(code, field) } };
}

/**
 * Maps any thrown value to a status and an error body (FR-807). Only the service errors, the two
 * state "not found" errors and `RequestError` are recognised; anything else is a 500 whose body
 * carries nothing from the thrown value (BR-802).
 */
export function toErrorResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof RequestError) {
    return { status: err.status, body: errorBody(err.code, err.field) };
  }
  if (err instanceof InvalidRequest) {
    return { status: 400, body: errorBody('invalid_request', err.reason) };
  }
  if (err instanceof Unauthorized) return { status: 401, body: errorBody('unauthorized') };
  if (err instanceof NotYourTurn) return { status: 403, body: errorBody('not_your_turn') };
  if (
    err instanceof GameNotFound ||
    err instanceof GameNotFoundError ||
    err instanceof CommitNotFoundError
  ) {
    return { status: 404, body: errorBody('game_not_found') };
  }
  if (err instanceof VersionConflict) {
    return { status: 409, body: { ...errorBody('version_conflict'), update: err.update } };
  }
  if (err instanceof GameUnsupported) return { status: 410, body: errorBody('game_unsupported') };
  if (err instanceof IllegalMove) return { status: 422, body: errorBody('illegal_move') };
  return { status: 500, body: errorBody('internal') };
}
