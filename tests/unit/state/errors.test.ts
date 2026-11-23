// No secrets in error messages (spec 06 BR-604; VC-624). Every error class is provoked through the
// manager on a game whose state seed is SECRET-SEED-123 and whose meta holds the seat-token hash
// 'ab'.repeat(32); no message (or InvalidCommitError reason) may contain either string.
import { describe, expect, it } from 'vitest';
import {
  CommitConflictError,
  CommitNotFoundError,
  GameExistsError,
  GameNotFoundError,
  InvalidCommitError,
  InvalidGameIdError,
} from '@/src/state/errors';
import { GameStateManager } from '@/src/state/game-state-manager';
import { commitKey } from '@/src/state/keys';
import type { CommitBody, GameMeta } from '@/src/state/schemas';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { GAME_ID, makeCommitBody, makeInitial, makeMeta } from './support/fixtures';

const g = GAME_ID;
const SECRET_SEED = 'SECRET-SEED-123';
const SECRET_HASH = 'ab'.repeat(32);

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a rejection');
}

function secretMeta(overrides: Partial<GameMeta> = {}): GameMeta {
  return makeMeta({ seatTokenHashes: [SECRET_HASH, null, null], ...overrides });
}

function secretInitial(): CommitBody {
  const initial = makeInitial();
  return { ...initial, state: { ...initial.state, seed: SECRET_SEED } };
}

/** A created game with the secret seed and hash, and its manager and store. */
async function secretGame(): Promise<{
  memory: MemoryObjectStore;
  manager: GameStateManager;
  initial: CommitBody;
}> {
  const memory = new MemoryObjectStore();
  const manager = new GameStateManager(memory);
  const initial = secretInitial();
  await manager.create(secretMeta(), initial);
  return { memory, manager, initial };
}

function expectNoSecrets(err: unknown): void {
  expect(err).toBeInstanceOf(Error);
  const { message } = err as Error;
  expect(message).not.toContain(SECRET_SEED);
  expect(message).not.toContain(SECRET_HASH);
  expect(String(err)).not.toContain(SECRET_SEED);
  expect(String(err)).not.toContain(SECRET_HASH);
  if (err instanceof InvalidCommitError) {
    expect(err.reason).not.toContain(SECRET_SEED);
    expect(err.reason).not.toContain(SECRET_HASH);
  }
}

describe('VC-624 — error messages never contain the seed or a seat-token hash', () => {
  it('the secret game really holds both secrets', async () => {
    const { manager } = await secretGame();
    expect((await manager.loadLatest(g)).state.seed).toBe(SECRET_SEED);
    expect((await manager.loadMeta(g)).seatTokenHashes[0]).toBe(SECRET_HASH);
  });

  it('InvalidGameIdError', async () => {
    const { manager } = await secretGame();
    const err = await rejectionOf(manager.commit('BAD', makeCommitBody(secretInitial(), 1)));
    expect(err).toBeInstanceOf(InvalidGameIdError);
    expectNoSecrets(err);
  });

  it('GameNotFoundError (commit 0 deleted)', async () => {
    const { memory, manager } = await secretGame();
    await memory.delete([commitKey(g, 0)]);
    const err = await rejectionOf(manager.loadLatest(g));
    expect(err).toBeInstanceOf(GameNotFoundError);
    expectNoSecrets(err);
  });

  it('GameExistsError (create again with another createdAt)', async () => {
    const { manager } = await secretGame();
    const err = await rejectionOf(
      manager.create(secretMeta({ createdAt: '2026-11-24T00:00:00.000Z' }), secretInitial()),
    );
    expect(err).toBeInstanceOf(GameExistsError);
    expectNoSecrets(err);
  });

  it('CommitNotFoundError', async () => {
    const { manager } = await secretGame();
    const err = await rejectionOf(manager.load(g, 9));
    expect(err).toBeInstanceOf(CommitNotFoundError);
    expectNoSecrets(err);
  });

  it('CommitConflictError', async () => {
    const { manager, initial } = await secretGame();
    const v1 = makeCommitBody(initial, 1);
    await manager.commit(g, v1);
    const err = await rejectionOf(manager.commit(g, { ...v1, clientRequestId: SECRET_HASH }));
    expect(err).toBeInstanceOf(CommitConflictError);
    expectNoSecrets(err);
  });

  it('InvalidCommitError from a commit body holding both secrets', async () => {
    const { manager, initial } = await secretGame();
    const v1 = makeCommitBody(initial, 1);
    // A 64-char clientRequestId is valid; actorSeat null at v1 breaks the schema.
    const err = await rejectionOf(
      manager.commit(g, { ...v1, actorSeat: null, clientRequestId: SECRET_HASH }),
    );
    expect(err).toBeInstanceOf(InvalidCommitError);
    expect((err as InvalidCommitError).reason).toBe('commit-schema:actorSeat');
    expectNoSecrets(err);
  });

  it('InvalidCommitError from a body whose secret value is itself invalid', async () => {
    const { manager, initial } = await secretGame();
    const v1 = makeCommitBody(initial, 1);
    const err = await rejectionOf(
      manager.commit(g, { ...v1, clientRequestId: SECRET_HASH + SECRET_HASH + SECRET_SEED }),
    );
    expect(err).toBeInstanceOf(InvalidCommitError);
    expect((err as InvalidCommitError).reason).toBe('commit-schema:clientRequestId');
    expectNoSecrets(err);
  });

  it('InvalidCommitError from a create whose meta puts the hash on an AI seat', async () => {
    const manager = new GameStateManager(new MemoryObjectStore());
    const err = await rejectionOf(
      manager.create(
        secretMeta({ seatTokenHashes: [SECRET_HASH, SECRET_HASH, null] }),
        secretInitial(),
      ),
    );
    expect(err).toBeInstanceOf(InvalidCommitError);
    expectNoSecrets(err);
  });

  it('InvalidCommitError from writeFinalScores with a board holding the secrets', async () => {
    const manager = new GameStateManager(new MemoryObjectStore());
    const board = { ...secretInitial().scoreboard, totals: SECRET_SEED + SECRET_HASH };
    const err = await rejectionOf(manager.writeFinalScores(g, 1, board as never));
    expect(err).toBeInstanceOf(InvalidCommitError);
    expectNoSecrets(err);
  });
});
