// JSON responses (spec FR-800; plan P-2). Every response of the API, success or error, is built here.

/** A JSON response with `Content-Type: application/json` and `Cache-Control: no-store`. */
export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
