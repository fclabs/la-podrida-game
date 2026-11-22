// Layer-boundary fixtures (spec 00 FR-021, VC-011–VC-020). Each row lints an inline source
// string at a virtual file path with the project ESLint config and asserts whether the
// `layer-boundaries/imports` rule reports an error. Other rules (unused vars, Next) are ignored.
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const RULE_ID = 'layer-boundaries/imports';
const eslint = new ESLint({ cwd: fileURLToPath(new URL('../..', import.meta.url)) });

async function boundaryErrors(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  // A fixture that fails to parse would report no boundary error; treat that as a test bug.
  expect(result.messages.filter((m) => m.fatal)).toEqual([]);
  return result.messages
    .filter((m) => m.ruleId === RULE_ID && m.severity === 2)
    .map((m) => m.message);
}

type Row = [vc: string, filePath: string, code: string, expectError: boolean];

const imp = (spec: string) => `import { y } from '${spec}';\nexport const x = y;\n`;

const rows: Row[] = [
  // VC-011 (FR-011)
  ['VC-011', 'src/domain/x.ts', imp('../engine/y'), true],
  ['VC-011', 'src/domain/x.ts', imp('@/src/config'), true],
  ['VC-011', 'src/domain/x.ts', imp('./cards'), false],
  // VC-012 (FR-012)
  ['VC-012', 'src/engine/x.ts', imp('../domain/y'), false],
  ['VC-012', 'src/engine/x.ts', imp('../storage/y'), true],
  ['VC-012', 'src/engine/x.ts', imp('../score/y'), true],
  ['VC-012', 'src/score/x.ts', imp('../engine/y'), true],
  ['VC-012', 'src/players/x.ts', imp('../state/y'), true],
  ['VC-012', 'src/engine/x.ts', imp('@/src/config'), true],
  // VC-013 (FR-013, BR-001)
  ['VC-013', 'src/engine/x.ts', imp('@noble/hashes/sha2'), false],
  ['VC-013', 'src/engine/x.ts', imp('zod'), false],
  ['VC-013', 'src/engine/x.ts', imp('node:crypto'), true],
  ['VC-013', 'src/engine/x.ts', imp('crypto'), true],
  ['VC-013', 'src/engine/x.ts', imp('next/server'), true],
  ['VC-013', 'src/engine/x.ts', imp('react'), true],
  ['VC-013', 'src/engine/x.ts', imp('@vercel/blob'), true],
  ['VC-013', 'src/engine/x.ts', imp('lodash'), true],
  ['VC-013', 'src/domain/x.ts', "import type { X } from 'next';\nexport type Y = X;\n", true],
  // VC-014 (FR-014)
  ['VC-014', 'src/state/x.ts', imp('../storage/y'), false],
  ['VC-014', 'src/state/x.ts', imp('../domain/y'), false],
  ['VC-014', 'src/state/x.ts', imp('../engine/y'), true],
  ['VC-014', 'src/state/x.ts', imp('../service/y'), true],
  // VC-015 (FR-015)
  ['VC-015', 'src/storage/x.ts', imp('../service/y'), true],
  ['VC-015', 'src/players/x.ts', imp('@/src/service/y'), true],
  // VC-016 (FR-016)
  ['VC-016', 'src/service/x.ts', imp('../domain/y'), false],
  ['VC-016', 'src/service/x.ts', imp('../engine/y'), false],
  ['VC-016', 'src/service/x.ts', imp('../score/y'), false],
  ['VC-016', 'src/service/x.ts', imp('../players/y'), false],
  ['VC-016', 'src/service/x.ts', imp('../state/y'), false],
  // VC-017 (FR-017, BR-003)
  ['VC-017', 'src/storage/x.ts', imp('node:fs'), false],
  ['VC-017', 'src/storage/x.ts', imp('@vercel/blob'), false],
  ['VC-017', 'src/state/x.ts', imp('node:fs/promises'), true],
  ['VC-017', 'src/service/x.ts', imp('@vercel/blob'), true],
  ['VC-017', 'src/service/x.ts', imp('fs'), true],
  // VC-018 (FR-018, BR-004)
  [
    'VC-018',
    'app/page.tsx',
    "import { createGame } from '@/src/engine/engine';\nexport { createGame };\n",
    true,
  ],
  ['VC-018', 'app/page.tsx', "import { X } from '@/src/domain/types';\nexport { X };\n", true],
  // VC-019 (FR-019, BR-004)
  [
    'VC-019',
    'app/game/[id]/page.tsx',
    "import type { X } from '@/src/engine/engine';\nexport type Y = X;\n",
    true,
  ],
  // VC-020 (FR-020)
  [
    'VC-020',
    'app/page.tsx',
    "import type { X } from '@/src/domain/types';\nexport type Y = X;\n",
    false,
  ],
  [
    'VC-020',
    'app/api/games/route.ts',
    "import { GameService } from '@/src/service/game-service';\nexport { GameService };\n",
    false,
  ],
  // Extra cases (plan Iteration 4, delta review)
  ['extra', 'src/engine/a/b.ts', imp('../../storage/x'), true],
  ['extra', 'src/engine/a/b.ts', imp('../c'), false],
  ['extra', 'src/domain/x.ts', "export { x } from '../engine/y';\n", true],
  [
    'extra',
    'app/page.tsx',
    "import { type X } from '@/src/domain/types';\nexport type Y = X;\n",
    false,
  ],
  [
    'extra',
    'app/page.tsx',
    "import { type X, Y } from '@/src/domain/types';\nexport type Z = X;\nexport { Y };\n",
    true,
  ],
  [
    'extra',
    'app/page.tsx',
    "import type { Config } from '@/src/config';\nexport type C = Config;\n",
    true,
  ],
  ['extra', 'src/state/x.ts', imp('@/src/config'), false],
  ['extra', 'src/engine/x.ts', imp('zod/v4'), false],
];

describe('layer boundaries (ESLint fixtures)', () => {
  it.each(rows)('%s: %s with %j → error %s', async (_vc, filePath, code, expectError) => {
    const errors = await boundaryErrors(filePath, code);
    if (expectError) {
      expect(errors).not.toHaveLength(0);
    } else {
      expect(errors).toEqual([]);
    }
  });
});
