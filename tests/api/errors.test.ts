// The error mapper (spec FR-801, FR-807, BR-802; plan P-1). VC-814 and the mapper part of VC-801.
import { describe, expect, it } from 'vitest';
import { ERROR_MESSAGES, RequestError, toErrorResponse } from '@/app/api/_lib/errors';
import { ErrorResponseSchema } from '@/app/api/_lib/schemas';
import { createGame } from '@/src/engine/engine';
import { ConfigError } from '@/src/config';
import { getPreset } from '@/src/domain/presets';
import type { PlayerUpdate } from '@/src/domain/types';
import { AiLoopLimitError } from '@/src/service/ai-loop';
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
import { makeService } from '../unit/service/support/service-fixtures';

const GAME_ID = 'abcdefghijklmnopqrstuvwxyz';

async function realUpdate(): Promise<PlayerUpdate> {
  const { service } = makeService();
  return (await service.createGame({ humanName: 'Ana', aiCount: 3 })).update;
}

describe('VC-814: toErrorResponse maps every FR-807 row', () => {
  const cases: [string, unknown, number, string, string?][] = [
    ['InvalidRequest', new InvalidRequest('aiCount'), 400, 'invalid_request', ': aiCount'],
    ['Unauthorized', new Unauthorized(), 401, 'unauthorized'],
    ['NotYourTurn', new NotYourTurn(0), 403, 'not_your_turn'],
    ['GameNotFound', new GameNotFound(GAME_ID), 404, 'game_not_found'],
    ['state GameNotFoundError', new GameNotFoundError(GAME_ID), 404, 'game_not_found'],
    ['state CommitNotFoundError', new CommitNotFoundError(GAME_ID, 3), 404, 'game_not_found'],
    ['GameUnsupported', new GameUnsupported(GAME_ID, 2), 410, 'game_unsupported'],
    ['IllegalMove', new IllegalMove('bid:9', 'unknown-move'), 422, 'illegal_move'],
    [
      'RequestError 400',
      new RequestError(400, 'invalid_request', 'body'),
      400,
      'invalid_request',
      ': body',
    ],
    [
      'RequestError 400 (no field)',
      new RequestError(400, 'invalid_request'),
      400,
      'invalid_request',
    ],
    ['RequestError 401', new RequestError(401, 'unauthorized'), 401, 'unauthorized'],
    ['RequestError 404', new RequestError(404, 'game_not_found'), 404, 'game_not_found'],
    ['RequestError 413', new RequestError(413, 'payload_too_large'), 413, 'payload_too_large'],
    ['ConfigError', new ConfigError('Invalid configuration: STORAGE_DRIVER'), 500, 'internal'],
    ['plain Error', new Error('secret-xyz'), 500, 'internal'],
    ['RangeError', new RangeError('bad'), 500, 'internal'],
    ['a string', 'str', 500, 'internal'],
    ['undefined', undefined, 500, 'internal'],
    ['null', null, 500, 'internal'],
  ];

  it.each(cases)('%s', (_name, thrown, status, code, suffix) => {
    const res = toErrorResponse(thrown);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({
      error: {
        code,
        message: `${ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]}${suffix ?? ''}`,
      },
    });
    expect(ErrorResponseSchema.safeParse(res.body).success).toBe(true);
  });

  it('VersionConflict → 409 with the error update in the body', async () => {
    const update = await realUpdate();
    const res = toErrorResponse(new VersionConflict(update));
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'version_conflict', message: ERROR_MESSAGES.version_conflict },
      update,
    });
    expect(res.body.update).toBe(update);
    expect(ErrorResponseSchema.safeParse(res.body).success).toBe(true);
  });

  it('AiLoopLimitError → 500, and the body carries nothing of its state', () => {
    const state = createGame({
      gameId: GAME_ID,
      rules: getPreset('argentina-fidepo'),
      seats: [0, 1, 2, 3].map((seat) => ({
        seat,
        playerId: `p${seat}`,
        name: `P${seat}`,
        kind: 'ai' as const,
        strategy: 'random',
      })),
      seed: 'seed-that-must-not-leak',
    }).state;
    const res = toErrorResponse(new AiLoopLimitError(1000, state));
    expect(res).toEqual({
      status: 500,
      body: { error: { code: 'internal', message: 'Internal error' } },
    });
    expect(JSON.stringify(res.body)).not.toContain('seed-that-must-not-leak');
  });
});

describe('VC-801 (mapper part): a 500 never serialises the thrown error', () => {
  it('new Error("secret-xyz") → "Internal error", no message, no stack', () => {
    const res = toErrorResponse(new Error('secret-xyz'));
    const text = JSON.stringify(res.body);
    expect(res.body.error.message).toBe('Internal error');
    expect(text).not.toContain('secret-xyz');
    expect(text).not.toContain('stack');
    expect(Object.keys(res.body)).toEqual(['error']);
  });

  it('a service error body carries only code and message, never the error fields', () => {
    const res = toErrorResponse(new GameNotFound(GAME_ID));
    expect(JSON.stringify(res.body)).not.toContain(GAME_ID);
  });
});

describe('P-1: RequestError', () => {
  it('keeps status, code and field, with a name and the FR-807 message', () => {
    const err = new RequestError(400, 'invalid_request', 'since');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('RequestError');
    expect(err.status).toBe(400);
    expect(err.code).toBe('invalid_request');
    expect(err.field).toBe('since');
    expect(err.message).toBe('Invalid request: since');
  });

  it('an empty field counts as no field', () => {
    const err = new RequestError(400, 'invalid_request', '');
    expect(err.field).toBeUndefined();
    expect(toErrorResponse(err).body.error.message).toBe('Invalid request');
  });
});
