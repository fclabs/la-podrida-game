import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `pnpm test:sim`: simulation tests (`tests/sim`) only; exits 0 when there are
// none. Kept standalone (not importing `vitest.config.ts`) so Vite's config
// loader needs no extensionless TS import; keep `resolve` and `environment`
// in sync with `vitest.config.ts`.
export default defineConfig({
  resolve: {
    // Mirror tsconfig.json `paths`: `@/*` → project root.
    alias: { '@': path.dirname(fileURLToPath(import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/sim/**/*.test.ts'],
    passWithNoTests: true,
  },
});
