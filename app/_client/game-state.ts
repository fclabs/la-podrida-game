import type { PlayerUpdate } from '@/src/domain/types';

/** Where an update came from; only `create` and `move` responses are animated (FR-911). */
export type UpdateSource = 'create' | 'move' | 'load' | 'conflict' | 'recovery';

/** FR-910 version guard: adopt only when nothing is adopted yet or the version is greater. */
export function shouldAdopt(current: PlayerUpdate | null, incoming: PlayerUpdate): boolean {
  return current === null || incoming.version > current.version;
}

/** FR-916: the body of one action, captured once; every retry sends this same object. */
export function captureAction(
  adopted: PlayerUpdate,
  moveId: string,
  newId: () => string,
): { version: number; moveId: string; clientRequestId: string } {
  return { version: adopted.version, moveId, clientRequestId: newId() };
}

/** FR-911: adopting a 201 or a 200 move response animates its events; any other source does not. */
export function isAnimated(source: UpdateSource): boolean {
  return source === 'create' || source === 'move';
}
