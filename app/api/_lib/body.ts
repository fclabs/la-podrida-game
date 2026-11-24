// JSON body reading with a size cap (spec FR-802; plan P-3). Checks run in order; the first wins.
import { RequestError } from './errors';

/** The largest accepted request body, in raw received bytes. */
export const MAX_BODY_BYTES = 16384;

/**
 * Reads `request`'s body as a JSON object:
 * 1. the media type must be `application/json` (case-insensitive, parameters allowed) → else 400 `body`;
 * 2. the raw body must be at most `MAX_BODY_BYTES` bytes (`Content-Length` is not trusted) → else 413;
 * 3. the bytes must be valid UTF-8 JSON whose value is an object → else 400 `body`.
 */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const mediaType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') throw new RequestError(400, 'invalid_request', 'body');

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw new RequestError(413, 'payload_too_large');

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RequestError(400, 'invalid_request', 'body');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RequestError(400, 'invalid_request', 'body');
  }
  return value as Record<string, unknown>;
}
