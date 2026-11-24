// The config-wired `GameService` (spec FR-812, BR-805 exception; plan P-8). This is the only module
// of the HTTP layer that wires the store and the state manager.
import { getConfig } from '@/src/config';
import { GameService } from '@/src/service/game-service';
import { GameStateManager } from '@/src/state/game-state-manager';
import { createObjectStore } from '@/src/storage';

let cached: GameService | undefined;

/**
 * Returns the process-wide `GameService`, building it on the first successful call. A failure
 * (e.g. `ConfigError`) is thrown and not cached, so the next call tries again.
 */
export function getService(): GameService {
  if (cached !== undefined) return cached;
  const config = getConfig();
  const store = createObjectStore(config);
  const state = new GameStateManager(store);
  cached = new GameService({ state, defaultPresetId: config.defaultRulesPreset });
  return cached;
}
