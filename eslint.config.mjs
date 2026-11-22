// ESLint flat config. Run via `pnpm lint` (`eslint . --max-warnings 0 && prettier --check .`).
//
// Block order matters: later blocks override earlier ones for the files they match.
//   1. Global ignores
//   2. Base JS rules (all linted files)
//   3. TypeScript rules (**/*.{ts,tsx,mts,cts})
//   4. Next.js rules (app/**)
//   5. Per-folder import-boundary blocks go here (src/**, app/**), before Prettier.
//   6. eslint-config-prettier — must stay last so it turns off any stylistic rule above.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import prettierConfig from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];

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

  // 5. Layer-boundary rules: insert per-folder `files` blocks here.

  // 6. Disable stylistic rules that conflict with Prettier. Keep last.
  prettierConfig,
);
