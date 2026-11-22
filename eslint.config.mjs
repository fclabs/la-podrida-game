// ESLint flat config. Run via `pnpm lint` (`eslint . --max-warnings 0 && prettier --check .`).
//
// Block order matters: later blocks override earlier ones for the files they match.
//   1. Global ignores
//   2. Base JS rules (all linted files)
//   3. TypeScript rules (**/*.{ts,tsx,mts,cts})
//   4. Next.js rules (app/**)
//   5. Layer boundaries (src/**, app/** except app/api/**) — local rule, see D-008.
//   6. eslint-config-prettier — must stay last so it turns off any stylistic rule above.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettierConfig from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import layerBoundaries from './tools/eslint-rules/layer-boundaries.mjs';

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];
const SOURCE_EXT = '{ts,tsx,mts,cts,js,jsx,mjs,cjs}';

// Third-party modules the core (domain, engine, score, players) may import, subpaths included
// (BR-001). Everything else — incl. every Node built-in — is an error in the core.
const CORE_EXTERNALS = ['zod', '@noble/hashes'];

// Layer import matrix (architecture §4.1, spec FR-011–FR-020). A layer may always import its own
// folder. `layers`: other layers it may import. `config`: may import src/config. `externals`:
// bare-module allowlist (omitted = any, subject to `io`). Nothing lists `service` (FR-015).
const LAYER_BOUNDARIES = {
  srcDir: 'src',
  configModule: 'config',
  layers: {
    domain: { layers: [], config: false, externals: CORE_EXTERNALS },
    engine: { layers: ['domain'], config: false, externals: CORE_EXTERNALS },
    score: { layers: ['domain'], config: false, externals: CORE_EXTERNALS },
    players: { layers: ['domain'], config: false, externals: CORE_EXTERNALS },
    state: { layers: ['storage', 'domain'], config: true },
    storage: { layers: ['domain', 'engine', 'score', 'players', 'state'], config: true },
    service: { layers: ['domain', 'engine', 'score', 'players', 'state', 'storage'], config: true },
  },
  // Filesystem and Blob SDK: only storage (FR-017, BR-003). Subpaths included.
  io: { modules: ['fs', 'node:fs', '@vercel/blob'], allowedIn: ['storage'] },
  // UI (app/** except app/api/**): `import type` only, and only from these layers (FR-018–020).
  ui: { dir: 'app', exclude: ['app/api'], typeOnlyFrom: ['domain'] },
};

export default defineConfig(
  // 1. Global ignores (generated output and dependencies).
  globalIgnores(['.next/', 'node_modules/', 'coverage/', 'out/', 'next-env.d.ts']),

  // 2. Base JS rules.
  js.configs.recommended,

  // 3. TypeScript recommended rules (syntax-only; no type-aware linting).
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: TS_FILES })),

  // 4. Next.js rules for the App Router.
  {
    ...nextPlugin.configs['core-web-vitals'],
    files: ['app/**/*.{ts,tsx}'],
  },

  // 5. Layer-boundary rules. One block; the rule picks the policy from the file's path.
  {
    files: [`src/**/*.${SOURCE_EXT}`, `app/**/*.${SOURCE_EXT}`],
    ignores: ['app/api/**'],
    plugins: { 'layer-boundaries': layerBoundaries },
    rules: { 'layer-boundaries/imports': ['error', LAYER_BOUNDARIES] },
  },

  // 6. Disable stylistic rules that conflict with Prettier. Keep last.
  prettierConfig,
);
