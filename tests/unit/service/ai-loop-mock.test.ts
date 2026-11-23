// Failures inside the AI loop and on create (spec 07 FR-701, FR-717; VC-722, VC-731). One mocked
// module per file (plan P-11): `@/src/service/ai-loop`, with `runAiLoop` delegating to the original.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/src/domain/types';
import * as aiLoop from '@/src/service/ai-loop';
import { AiLoopLimitError } from '@/src/service/ai-loop';
import { GameExistsError } from '@/src/state/errors';
import { commitKey, metaKey } from '@/src/state/keys';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { RecordingStore } from '../state/support/store-wrappers';
import {
  byteRange,
  firstLegalMoveId,
  makeService,
  scriptedBytes,
} from './support/service-fixtures';

vi.mock('@/src/service/ai-loop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/service/ai-loop')>();
  return { ...actual, runAiLoop: vi.fn(actual.runAiLoop) };
});

const runAiLoopMock = vi.mocked(aiLoop.runAiLoop);

/** Makes the next `runAiLoop` call throw an `AiLoopLimitError`; `holder.thrown` is that error. */
function failNextLoop(): { thrown: AiLoopLimitError | null } {
  const holder: { thrown: AiLoopLimitError | null } = { thrown: null };
  runAiLoopMock.mockImplementationOnce((state: GameState) => {
    holder.thrown = new AiLoopLimitError(1000, state);
    throw holder.thrown;
  });
  return holder;
}

afterEach(() => {
  runAiLoopMock.mockClear();
});

const ID_BYTES = byteRange(0, 16);
const GAME_ID = 'aaaqeayeaudaocajbifqydiob4';

describe('VC-722: submitMove with an AI loop that throws AiLoopLimitError', () => {
  it('rejects with that error and adds no commit', async () => {
    const memory = new MemoryObjectStore();
    const store = new RecordingStore(memory);
    const { service } = makeService(store);
    const created = await service.createGame({ humanName: 'Ana', aiCount: 3 });
    store.reset();
    runAiLoopMock.mockClear();

    const loop = failNextLoop();
    const err = await service
      .submitMove(created.gameId, created.seatToken, {
        version: 0,
        moveId: firstLegalMoveId(created.update),
        clientRequestId: 'loop-fails',
      })
      .then(
        () => expect.unreachable('expected a rejection'),
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(AiLoopLimitError);
    expect(err).toBe(loop.thrown);
    expect(runAiLoopMock).toHaveBeenCalledTimes(1);
    expect(store.callsOf('put')).toHaveLength(0);
    expect(await memory.exists(commitKey(created.gameId, 1))).toBe(false);
  });
});

describe('VC-731: createGame propagates loop and create errors', () => {
  it('a loop that throws AiLoopLimitError → createGame rejects with it; no meta.json', async () => {
    const memory = new MemoryObjectStore();
    const store = new RecordingStore(memory);
    const { service } = makeService(store, {
      randomBytes: scriptedBytes([ID_BYTES, byteRange(100, 32), byteRange(200, 32)]),
    });
    const loop = failNextLoop();
    const err = await service.createGame({ humanName: 'Ana', aiCount: 3 }).then(
      () => expect.unreachable('expected a rejection'),
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AiLoopLimitError);
    expect(err).toBe(loop.thrown);
    expect(runAiLoopMock).toHaveBeenCalledTimes(1);
    expect(store.calls).toHaveLength(0);
    expect(await memory.exists(metaKey(GAME_ID))).toBe(false);
  });

  it('an id that collides with a stored game (different seed and token) → GameExistsError', async () => {
    const memory = new MemoryObjectStore();
    const { service: first } = makeService(memory, {
      randomBytes: scriptedBytes([ID_BYTES, byteRange(100, 32), byteRange(200, 32)]),
    });
    const existing = await first.createGame({ humanName: 'Ana', aiCount: 3 });
    expect(existing.gameId).toBe(GAME_ID);
    const storedMeta = await memory.get(metaKey(GAME_ID));

    const { service: second } = makeService(memory, {
      randomBytes: scriptedBytes([ID_BYTES, byteRange(50, 32), byteRange(150, 32)]),
    });
    const err = await second.createGame({ humanName: 'Ana', aiCount: 3 }).then(
      () => expect.unreachable('expected a rejection'),
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GameExistsError);
    expect((await memory.get(metaKey(GAME_ID)))?.body).toEqual(storedMeta?.body);
  });
});
