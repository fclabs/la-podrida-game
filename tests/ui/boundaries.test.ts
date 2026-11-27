// VC-947 / BR-902: static check over `app/**` outside `app/api/**`. No import specifier may resolve
// into `app/api/`; an import from `src/` must be `import type` (or `export type`) from `src/domain`.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const APP = path.join(ROOT, 'app');
const API = path.join(APP, 'api');

interface Specifier {
  spec: string;
  typeOnly: boolean;
}

/** Every import/export/dynamic-import/require specifier of `source`. */
export function findSpecifiers(source: string): Specifier[] {
  const found: Specifier[] = [];
  const staticRe = /\b(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s*)?(['"])([^'"]+)\3/g;
  for (const m of source.matchAll(staticRe)) {
    const clause = m[0];
    // `export const x = 'a'` has no `from`; only keep `export ... from` and bare/`import ... from`.
    if (m[1] === 'export' && !/\sfrom\s*['"]/.test(clause)) continue;
    found.push({ spec: m[4] as string, typeOnly: m[2] !== undefined });
  }
  const dynamicRe = /\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const m of source.matchAll(dynamicRe)) found.push({ spec: m[2] as string, typeOnly: false });
  return found;
}

/** Resolves a relative or `@/` specifier to an absolute path; `null` for bare modules. */
function resolveSpec(file: string, spec: string): string | null {
  if (spec.startsWith('@/')) return path.join(ROOT, spec.slice(2));
  if (spec.startsWith('.')) return path.resolve(path.dirname(file), spec);
  return null;
}

function within(target: string, dir: string): boolean {
  const rel = path.relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Violations of the boundary in `source` (a file at `file`). */
export function violations(file: string, source: string): string[] {
  const out: string[] = [];
  for (const { spec, typeOnly } of findSpecifiers(source)) {
    const target = resolveSpec(file, spec);
    if (target === null) continue;
    if (within(target, API)) out.push(`${spec}: imports from app/api`);
    if (within(target, path.join(ROOT, 'src'))) {
      if (!within(target, path.join(ROOT, 'src/domain')))
        out.push(`${spec}: src outside src/domain`);
      else if (!typeOnly) out.push(`${spec}: value import from src`);
    }
  }
  return out;
}

function listSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (within(full, API)) continue;
    if (entry.isDirectory()) files.push(...listSources(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

describe('UI layer boundary (VC-947, BR-902)', () => {
  it('no app file outside app/api imports app/api, or a value from src', () => {
    const files = listSources(APP);
    expect(files.length).toBeGreaterThan(0);
    const bad = files.flatMap((f) =>
      violations(f, fs.readFileSync(f, 'utf8')).map((v) => `${path.relative(ROOT, f)}: ${v}`),
    );
    expect(bad).toEqual([]);
  });

  describe('scanner positive controls', () => {
    const file = path.join(APP, '_client/x.ts');
    it('flags app/api imports in every syntax', () => {
      for (const src of [
        "import '@/app/api/_lib/http';",
        "import { a } from '@/app/api/_lib/http';",
        "import type { A } from '../api/_lib/http';",
        "export { a } from './../api/x';",
        "const m = await import('@/app/api/x');",
      ]) {
        expect(violations(file, src), src).not.toEqual([]);
      }
    });
    it('flags src value imports and non-domain src imports', () => {
      expect(violations(file, "import { x } from '@/src/domain/types';")).not.toEqual([]);
      expect(violations(file, "import type { X } from '@/src/state/keys';")).not.toEqual([]);
      expect(violations(file, "import { z } from '@/src/service/game-service';")).not.toEqual([]);
    });
    it('allows type imports from src/domain and unrelated imports', () => {
      expect(violations(file, "import type { X } from '@/src/domain/types';")).toEqual([]);
      expect(violations(file, "import { a } from './slot';\nimport 'react';")).toEqual([]);
      expect(violations(file, "export const s = 'a';")).toEqual([]);
    });
  });
});
