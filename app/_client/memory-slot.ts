import type { GameSlot } from './slot';

// FR-931: when `localStorage` cannot be written at game creation, the slot lives here for the rest
// of the tab session (a module variable, lost on reload). `NewGamePage` sets it; `GamePage` reads it
// when the stored slot does not match its route.
let memorySlot: GameSlot | null = null;

export function getMemorySlot(): GameSlot | null {
  return memorySlot;
}

export function setMemorySlot(slot: GameSlot | null): void {
  memorySlot = slot;
}
