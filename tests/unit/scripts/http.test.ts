import { describe, expect, it } from 'vitest';
import { BYPASS_HEADER, RequestTimeoutError, request, type FetchFn } from '@/scripts/lib/http';

function recordingFetch(): { fetchFn: FetchFn; seen: Headers[] } {
  const seen: Headers[] = [];
  const fetchFn: FetchFn = async (_url, init) => {
    seen.push(new Headers(init?.headers));
    return new Response('hello', { status: 201 });
  };
  return { fetchFn, seen };
}

describe('request', () => {
  it('returns status and the whole body', async () => {
    const { fetchFn } = recordingFetch();
    expect(await request(fetchFn, 'https://x.test/a')).toEqual({ status: 201, body: 'hello' });
  });

  it('adds the bypass header only when a value is passed', async () => {
    const { fetchFn, seen } = recordingFetch();
    await request(fetchFn, 'https://x.test/a', { headers: { 'x-keep': '1' } });
    await request(fetchFn, 'https://x.test/a', {}, { bypass: '' });
    await request(fetchFn, 'https://x.test/a', { headers: { 'x-keep': '1' } }, { bypass: 'val' });
    expect(seen[0].has(BYPASS_HEADER)).toBe(false);
    expect(seen[1].has(BYPASS_HEADER)).toBe(false);
    expect(seen[2].get(BYPASS_HEADER)).toBe('val');
    expect(seen[2].get('x-keep')).toBe('1');
  });

  it('aborts a request that honours the signal and reports a timeout', async () => {
    let aborted = false;
    const fetchFn: FetchFn = (_url, init) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    await expect(request(fetchFn, 'https://x.test', {}, { timeoutMs: 20 })).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
    expect(aborted).toBe(true);
  });

  it('does not hang when fetch ignores the signal or the body never ends', async () => {
    const never: FetchFn = () => new Promise(() => undefined);
    await expect(request(never, 'https://x.test', {}, { timeoutMs: 20 })).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
    const slowBody: FetchFn = async () =>
      ({ status: 200, text: () => new Promise<string>(() => undefined) }) as unknown as Response;
    await expect(request(slowBody, 'https://x.test', {}, { timeoutMs: 20 })).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
  });

  it('passes network errors through', async () => {
    const fetchFn: FetchFn = async () => {
      throw new TypeError('network down');
    };
    await expect(request(fetchFn, 'https://x.test')).rejects.toThrow('network down');
  });
});
