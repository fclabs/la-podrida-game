// Service errors (spec 07 Data & Interfaces, BR-701; plan P-1).
import { describe, expect, it } from 'vitest';
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

const UPDATE = { version: 7, events: [], view: {}, legalMoves: [] } as unknown as PlayerUpdate;

describe('P-1: each error class', () => {
  it('VersionConflict carries the update', () => {
    const err = new VersionConflict(UPDATE);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(VersionConflict);
    expect(err.name).toBe('VersionConflict');
    expect(err.update).toBe(UPDATE);
    expect(err.message).toBe('Version conflict: the game is at version 7');
  });

  it.each(['game-over', 'unknown-move'] as const)('IllegalMove with reason %s', (reason) => {
    const err = new IllegalMove('bid:99', reason);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('IllegalMove');
    expect(err.moveId).toBe('bid:99');
    expect(err.reason).toBe(reason);
    expect(err.message).toBe(`Illegal move "bid:99": ${reason}`);
  });

  it('NotYourTurn carries the seat', () => {
    const err = new NotYourTurn(0);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('NotYourTurn');
    expect(err.seat).toBe(0);
    expect(err.message).toBe('Not your turn (seat 0)');
  });

  it('Unauthorized has no fields', () => {
    const err = new Unauthorized();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('Unauthorized');
    expect(err.message).toBe('Unauthorized');
    expect(Object.keys(err)).toEqual(['name']);
  });

  it('GameNotFound carries the id', () => {
    const err = new GameNotFound('abcdefghijklmnopqrstuvwxyz');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('GameNotFound');
    expect(err.gameId).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(err.message).toBe('Game not found: abcdefghijklmnopqrstuvwxyz');
  });

  it('GameNotFound clips a long id to its first 64 characters', () => {
    const raw = 'x'.repeat(64) + 'Y'.repeat(10_000);
    const err = new GameNotFound(raw);
    expect(err.gameId).toBe('x'.repeat(64));
    expect(err.message).toBe(`Game not found: ${'x'.repeat(64)}`);
    expect(err.message).not.toContain('Y');
    expect(new GameNotFound('x'.repeat(65)).gameId).toHaveLength(64);
    expect(new GameNotFound('ABC').gameId).toBe('ABC');
  });

  it.each([
    'humanName',
    'aiCount',
    'rulesPreset',
    'sinceVersion',
    'version',
    'moveId',
    'clientRequestId',
  ])('InvalidRequest with reason %s', (reason) => {
    const err = new InvalidRequest(reason);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('InvalidRequest');
    expect(err.reason).toBe(reason);
    expect(err.message).toBe(`Invalid request: ${reason}`);
  });

  it('GameUnsupported carries the id and the engine version', () => {
    const err = new GameUnsupported('abcdefghijklmnopqrstuvwxyz', 2);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('GameUnsupported');
    expect(err.gameId).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(err.engineVersion).toBe(2);
    expect(err.message).toBe(
      'Game abcdefghijklmnopqrstuvwxyz was created with engine version 2, which this server does not support',
    );
  });
});
