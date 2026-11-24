// Seat auth and game id format (spec FR-805, FR-806; plan P-6). Both run before any storage I/O.
import { RequestError } from './errors';

/** `Bearer <token>`: scheme case-insensitive, exactly one space, a 1–256 char base64url token. */
const BEARER = /^bearer ([A-Za-z0-9_-]{1,256})$/i;

/** A game id: 26 lowercase base32 characters. */
const GAME_ID = /^[a-z2-7]{26}$/;

/** The seat token of the `Authorization` header. Missing or malformed → 401 `RequestError`. */
export function parseBearer(headers: Headers): string {
  const match = BEARER.exec(headers.get('authorization') ?? '');
  if (match === null) throw new RequestError(401, 'unauthorized');
  return match[1];
}

/** Throws a 404 `RequestError` unless `id` has the game id format. */
export function assertGameIdFormat(id: string): void {
  if (!GAME_ID.test(id)) throw new RequestError(404, 'game_not_found');
}
