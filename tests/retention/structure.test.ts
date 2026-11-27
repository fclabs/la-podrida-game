// Static checks (spec 10: VC-1014, VC-1018). No store matrix.
//
// VC-1018 (a): the import specifiers of app/api/_lib/cleanup.ts and every file under app/api/cron/
// are parsed with a regex over `import ... from '...'` (and bare `import '...'`) and must be in
// ALLOWED_IMPORTS or be a Node built-in (`node:`). `git diff main -- src` is run by hand, not here.
//
// VC-1018 (b): the secret check uses `timingSafeEqual` from `node:crypto`. The comparison scan is
// scoped to the identifiers bound to the secret and to the Authorization value: `secret`,
// `cronSecret`, `header` and `authorization` (word match, case-insensitive on `authorization`).
// On every source line (comments stripped) that mentions one of them, none of `===`, `!==`, `==`,
// `!=`, `.startsWith(` or `.includes(` may appear, except a comparison whose other side is
// `null` or `undefined` (that operator form is removed before the scan).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const CLEANUP = join(ROOT, 'app/api/_lib/cleanup.ts');
const CRON_DIR = join(ROOT, 'app/api/cron');

const ALLOWED_IMPORTS = new Set([
  '@/src/storage',
  '@/src/config',
  '@/src/state/keys',
  '@/src/storage/object-store',
  '@/app/api/_lib/cleanup',
  './errors',
  './http',
  './log',
]);
const FORBIDDEN = /game-state-manager|schemas|service|engine|score|players/;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function specifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) out.push(m[1] as string);
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('VC-1014: wiring', () => {
  it('vercel.json has the one daily cron and the nextjs framework', () => {
    const json = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(json.crons).toEqual([{ path: '/api/cron/cleanup', schedule: '0 3 * * *' }]);
    expect(json.framework).toBe('nextjs');
  });

  it('the route module exports exactly GET', async () => {
    const mod = await import('@/app/api/cron/cleanup/route');
    expect(Object.keys(mod)).toEqual(['GET']);
  });
});

describe('VC-1018 (a): layering', () => {
  const files = [CLEANUP, ...filesUnder(CRON_DIR)];

  it('finds the route file and cleanup.ts', () => {
    expect(files.length).toBeGreaterThanOrEqual(2);
  });

  it.each(files.map((f) => [f.slice(ROOT.length + 1), f]))(
    '%s imports only the allowed modules',
    (_name, file) => {
      const found = specifiers(readFileSync(file as string, 'utf8'));
      expect(found.length).toBeGreaterThan(0);
      for (const spec of found) {
        expect(
          spec.startsWith('node:') || ALLOWED_IMPORTS.has(spec),
          `unexpected import ${spec}`,
        ).toBe(true);
        expect(FORBIDDEN.test(spec), `forbidden import ${spec}`).toBe(false);
      }
    },
  );
});

describe('VC-1018 (b): secret handling', () => {
  const source = stripComments(readFileSync(CLEANUP, 'utf8'));

  it('imports timingSafeEqual from node:crypto and calls it', () => {
    expect(source).toMatch(/import\s*\{[^}]*\btimingSafeEqual\b[^}]*\}\s*from\s*'node:crypto'/);
    expect(source).toMatch(/\btimingSafeEqual\(/);
  });

  it('applies no equality, startsWith or includes to the secret or the Authorization value', () => {
    const IDENT = /\b(secret|cronSecret|header|authorization)\b/i;
    const NULLISH = /(?:===|!==|==|!=)\s*(?:null|undefined)\b/g;
    const BAD = /===|!==|==|!=|\.startsWith\(|\.includes\(/;
    const offenders = source
      .split('\n')
      .filter((line) => IDENT.test(line))
      .map((line) => line.replace(NULLISH, ''))
      .filter((line) => BAD.test(line));
    expect(offenders).toEqual([]);
  });
});
