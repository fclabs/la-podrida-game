// Static structure checks over the handlers and route files (spec BR-804, BR-805; VC-832).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The files that must hold no error status and no lower-layer import. */
const SCANNED = [
  'app/api/_lib/handlers.ts',
  'app/api/games/route.ts',
  'app/api/games/[id]/route.ts',
  'app/api/games/[id]/moves/route.ts',
  'app/api/presets/route.ts',
];

/** Layers only `service-factory.ts` (not scanned) may reach. */
const FORBIDDEN_LAYERS = ['src/state', 'src/storage', 'src/engine'];

/** Any 4xx/5xx number token, anywhere (comments included, D-014). */
const ANY_ERROR_NUMBER = /\b[45]\d\d\b/g;
/** `status: 4xx` / `status = 5xx` style literals. */
const STATUS_LITERAL = /\bstatus\s*[:=]\s*[45]\d\d\b/g;
/** `jsonResponse(4xx` / `new Response(…, { status: 5xx` style calls. */
const STATUS_CALL = /\b(jsonResponse|Response)\s*\(\s*[45]\d\d\b/g;

/** Every module specifier of `source`: static imports/exports, `import()` and `require()`. */
function importSpecifiers(source: string): string[] {
  const patterns = [
    /\b(?:import|export)\s[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((re) => [...source.matchAll(re)].map((m) => m[1]));
}

/** The repository-relative target of `specifier` imported from `file`, or the bare specifier. */
function resolveSpecifier(file: string, specifier: string): string {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) {
    return path.relative(ROOT, path.resolve(ROOT, path.dirname(file), specifier));
  }
  return specifier;
}

/** The forbidden-layer imports of `source` as imported from `file`. */
function forbiddenImports(file: string, source: string): string[] {
  return importSpecifiers(source).filter((spec) => {
    const target = resolveSpecifier(file, spec).split(path.sep).join('/');
    return FORBIDDEN_LAYERS.some((layer) => target === layer || target.startsWith(`${layer}/`));
  });
}

/** The error-status findings of `source`. */
function statusFindings(source: string): string[] {
  return [STATUS_LITERAL, STATUS_CALL, ANY_ERROR_NUMBER].flatMap((re) =>
    [...source.matchAll(re)].map((m) => m[0]),
  );
}

const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');

describe('VC-832: handlers and routes build no error status (BR-804)', () => {
  it.each(SCANNED)('%s has no 4xx/5xx status literal or number', (file) => {
    expect(statusFindings(read(file))).toEqual([]);
  });

  it('errors.ts is where the error statuses live', () => {
    const source = read('app/api/_lib/errors.ts');
    for (const status of [400, 401, 403, 404, 409, 410, 413, 422, 500]) {
      expect(source).toMatch(new RegExp(`\\b${status}\\b`));
    }
  });

  it('the scan catches status literals, calls and bare numbers', () => {
    expect(statusFindings('return { status: 418, body };')).toContain('status: 418');
    expect(statusFindings('x.status = 500;')).toContain('status = 500');
    expect(statusFindings('return jsonResponse(404, body);')).toContain('jsonResponse(404');
    expect(statusFindings("new Response('', { status: 503 })")).toContain('status: 503');
    expect(statusFindings('// answers 409 on conflict')).toEqual(['409']);
    expect(statusFindings('return { status: 200, body }; // 201 too')).toEqual([]);
  });
});

describe('VC-832: handlers and routes import no lower layer (BR-805)', () => {
  it.each(SCANNED)('%s imports nothing from src/state, src/storage or src/engine', (file) => {
    const source = read(file);
    expect(importSpecifiers(source).length).toBeGreaterThan(0);
    expect(forbiddenImports(file, source)).toEqual([]);
  });

  it('service-factory.ts, the one exception, does wire the store and the state manager', () => {
    const file = 'app/api/_lib/service-factory.ts';
    const found = forbiddenImports(file, read(file)).map((s) => resolveSpecifier(file, s));
    expect(found.some((t) => t.startsWith('src/state/'))).toBe(true);
    expect(found.some((t) => t.startsWith('src/storage'))).toBe(true);
  });

  it('the scan catches aliased, relative, dynamic and re-exported imports', () => {
    const file = 'app/api/_lib/handlers.ts';
    const cases = [
      "import { GameStateManager } from '@/src/state/game-state-manager';",
      "import type { ObjectStore } from '@/src/storage/object-store';",
      "import { applyMove } from '../../../src/engine/engine';",
      "const m = await import('@/src/state/keys');",
      "export { metaKey } from '../../../src/state/keys';",
      "import '../../../src/storage';",
      "const s = require('@/src/storage/memory-store');",
    ];
    for (const source of cases) expect(forbiddenImports(file, source), source).toHaveLength(1);
    const allowed = [
      "import { z } from 'zod';",
      "import type { GameService } from '@/src/service/game-service';",
      "import { readJsonBody } from './body';",
      "import { getPreset } from '@/src/domain/presets';",
      "import { x } from '@/src/statex/y';",
    ];
    for (const source of allowed) expect(forbiddenImports(file, source), source).toEqual([]);
  });
});
