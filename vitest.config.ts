import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `pnpm test`: unit, contract and api tests only. Simulation tests
// (`tests/sim`) run separately via `vitest.sim.config.ts` (`pnpm test:sim`).
export default defineConfig({
  resolve: {
    // Mirror tsconfig.json `paths`: `@/*` → project root.
    alias: { '@': path.dirname(fileURLToPath(import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/{unit,contract,api}/**/*.test.ts'],
  },
});
