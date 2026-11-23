// Shared fixtures for the GameService tests (plan P-10). Tests may import any layer.
import type { PlayerUpdate } from '@/src/domain/types';
import { GameService, type GameServiceDeps } from '@/src/service/game-service';
import { GameStateManager } from '@/src/state/game-state-manager';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import type { ObjectStore } from '@/src/storage/object-store';
import { RecordingStore } from '../../state/support/store-wrappers';

/** The fixed clock of every service test. */
export const FIXED_NOW = new Date('2026-11-23T14:05:00.000Z');

/** The deps a test may override (everything except `state`). */
export type ServiceOverrides = Partial<Omit<GameServiceDeps, 'state'>>;

/**
 * A `GameService` over `store` (default: a `RecordingStore` around a fresh `MemoryObjectStore`),
 * with `now` fixed at `FIXED_NOW` and real randomness unless `overrides` say otherwise. Returns
 * the service, its `GameStateManager` and the store.
 */
export function makeService<S extends ObjectStore = RecordingStore>(
  store?: S,
  overrides: ServiceOverrides = {},
): { service: GameService; state: GameStateManager; store: S } {
  const actual = (store ?? new RecordingStore(new MemoryObjectStore())) as S;
  const state = new GameStateManager(actual);
  const service = new GameService({ state, now: () => FIXED_NOW, ...overrides });
  return { service, state, store: actual };
}

/**
 * A scripted `randomBytes`: the k-th call returns a copy of `seq[k]`. Throws when the script is
 * exhausted or when the requested length differs from the scripted entry's length.
 */
export function scriptedBytes(
  seq: ReadonlyArray<Uint8Array | readonly number[]>,
): (n: number) => Uint8Array {
  let call = 0;
  return (n: number) => {
    if (call >= seq.length) throw new Error(`scriptedBytes: no entry for call ${call}`);
    const bytes = Uint8Array.from(seq[call]);
    if (bytes.length !== n) {
      throw new Error(
        `scriptedBytes: call ${call} asked for ${n} bytes, script has ${bytes.length}`,
      );
    }
    call++;
    return bytes;
  };
}

/** `n` bytes with values `start, start + 1, …` (mod 256). */
export function byteRange(start: number, n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_, i) => (start + i) & 0xff);
}

/** The id of the first legal move in `update`. Throws when there is none. */
export function firstLegalMoveId(update: PlayerUpdate): string {
  const [first] = update.legalMoves;
  if (first === undefined) throw new Error(`no legal move at version ${update.version}`);
  return first.id;
}
