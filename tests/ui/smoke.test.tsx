import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeInProcessApi } from './support/in-process-api';

function Hello({ name }: { name: string }) {
  return <p>Hola {name}</p>;
}

describe('ui test infrastructure', () => {
  it('compiles JSX in jsdom', () => {
    render(<Hello name="Ana" />);
    expect(screen.getByText('Hola Ana')).toBeTruthy();
    expect(typeof document).toBe('object');
  });

  it('runs the Phase 8 handlers in process under jsdom', async () => {
    const { fetch, calls } = makeInProcessApi();

    const presets = await fetch('/api/presets');
    expect(presets.status).toBe(200);
    const presetsBody = (await presets.json()) as { defaultPresetId: string; presets: unknown[] };
    expect(typeof presetsBody.defaultPresetId).toBe('string');

    const created = await fetch('/api/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ humanName: 'Ana', aiCount: 2 }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { gameId: string; seatToken: string };
    expect(body.gameId).toHaveLength(26);
    expect(body.seatToken).toHaveLength(43);

    expect(calls.map((c) => [c.method, c.path, c.status])).toEqual([
      ['GET', '/api/presets', 200],
      ['POST', '/api/games', 201],
    ]);
  });

  it('injects failures and honours abort', async () => {
    const { fetch, calls, failNext } = makeInProcessApi();
    failNext('reject-before');
    await expect(fetch('/api/presets')).rejects.toThrow(TypeError);
    failNext({ status: 503, body: { error: 'x' } });
    expect((await fetch('/api/presets')).status).toBe(503);
    failNext('hang');
    const ac = new AbortController();
    const hung = fetch('/api/presets', { signal: ac.signal });
    ac.abort();
    await expect(hung).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(3);
  });
});
