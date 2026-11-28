// HTTP helper for the Phase 11 scripts (spec 11 NFR-4, FR-1106). Every request is aborted after
// 30 s (an abort is a failure, not a hang) and the Vercel protection-bypass header is added only
// when a bypass value is passed in. The helper returns data and never prints anything.

export const REQUEST_TIMEOUT_MS = 30_000;
export const BYPASS_HEADER = 'x-vercel-protection-bypass';

export type FetchFn = typeof fetch;

export interface RequestOptions {
  /** Value of `VERCEL_PROTECTION_BYPASS`; the header is sent iff this is a non-empty string. */
  bypass?: string;
  /** Overrides the 30 s abort (tests only). */
  timeoutMs?: number;
}

export interface HttpResponse {
  status: number;
  /** The whole response body, read inside the timeout. */
  body: string;
}

/** The request (including reading its body) did not finish in time. */
export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`request timed out after ${timeoutMs} ms`);
    this.name = 'RequestTimeoutError';
  }
}

/** Sends the request, reads the full body, and aborts everything after the timeout. */
export async function request(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<HttpResponse> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const headers = new Headers(init.headers);
  if (options.bypass !== undefined && options.bypass !== '') {
    headers.set(BYPASS_HEADER, options.bypass);
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Rejects at the deadline even if `fetchFn` ignores the abort signal, so nothing can hang.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new RequestTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  const exchange = (async (): Promise<HttpResponse> => {
    const response = await fetchFn(url, { ...init, headers, signal: controller.signal });
    return { status: response.status, body: await response.text() };
  })();
  exchange.catch(() => undefined); // an exchange that loses the race must not be an unhandled rejection
  try {
    return await Promise.race([exchange, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
