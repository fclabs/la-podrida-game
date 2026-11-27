import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `pnpm test`: two projects. `node` runs unit, contract, api and retention tests (`tests/retention`); `ui` runs `tests/ui` in
// jsdom. Simulation tests (`tests/sim`) run separately via `vitest.sim.config.ts`
// (`pnpm test:sim`). Run one project with `pnpm vitest run --project ui`.
// Mirror tsconfig.json `paths`: `@/*` → project root.
const alias = { '@': path.dirname(fileURLToPath(import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/{unit,contract,api,retention}/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/ui/setup.ts'],
        },
      },
    ],
  },
});
