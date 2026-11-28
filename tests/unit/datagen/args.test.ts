import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';
import { UsageError, parseRunArgs, parseValidateArgs } from '../../../scripts/datagen/args';
import { makeTempDir, runCli } from './helpers';

const OK = ['--run-id', 'r1'];

/** Every invalid case of FR-1202 (the subcommand cases are CLI-only, below). */
const INVALID_RUN: [string, string[]][] = [
  ['unknown option', [...OK, '--bogus', 'x']],
  ['positional', [...OK, 'extra']],
  ['missing run id', []],
  ['run id with uppercase and underscore', ['--run-id', 'Bad_Id']],
  ['run id with double hyphen', ['--run-id', 'a--b']],
  ['run id of 65 characters', ['--run-id', 'a'.repeat(65)]],
  ['run id starting with eval', ['--run-id', 'eval-1']],
  ['unknown preset', [...OK, '--preset', 'nope']],
  ['players below min', [...OK, '--players', '2']],
  ['players above max', [...OK, '--players', '7']],
  ['players not a number', [...OK, '--players', 'x']],
  ...['games', 'shard-size', 'workers', 'replay-every'].flatMap((name): [string, string[]][] => [
    [`${name} 0`, [...OK, `--${name}`, '0']],
    [`${name} 1.5`, [...OK, `--${name}`, '1.5']],
    [`${name} abc`, [...OK, `--${name}`, 'abc']],
    [`${name} negative`, [...OK, `--${name}`, '-3']],
  ]),
  ['strategies of wrong length', [...OK, '--strategies', 'random,random']],
  ['strategies with an empty item', [...OK, '--strategies', 'random,,random']],
  ['strategies naming an unknown one', [...OK, '--strategies', 'nope,random,random']],
];

describe('parseRunArgs defaults (FR-1203)', () => {
  it('returns every default for --run-id only', () => {
    expect(parseRunArgs(['--run-id', 't3'])).toEqual({
      run_id: 't3',
      preset: 'argentina-fidepo',
      players: 3,
      games: 1000,
      shard_size: 1000,
      strategies: ['random', 'random', 'random'],
      workers: availableParallelism(),
      replay_every: 100,
      out: '.data/datasets',
    });
  });

  it('derives the strategies default from the player count', () => {
    expect(parseRunArgs([...OK, '--players', '5']).strategies).toEqual(Array(5).fill('random'));
  });

  it('accepts explicit values', () => {
    const options = parseRunArgs([
      ...OK,
      '--preset',
      'gamerules',
      '--players',
      '7',
      '--games',
      '25',
      '--shard-size',
      '10',
      '--workers',
      '2',
      '--replay-every',
      '1',
      '--out',
      '/tmp/x',
    ]);
    expect(options).toMatchObject({
      preset: 'gamerules',
      players: 7,
      games: 25,
      shard_size: 10,
      workers: 2,
      replay_every: 1,
      out: '/tmp/x',
    });
  });

  it('reports the first problem in the order of the Command line block', () => {
    expect(() => parseRunArgs(['--preset', 'nope'])).toThrow(/--run-id is required/);
    expect(() => parseRunArgs([...OK, '--preset', 'nope', '--games', '0'])).toThrow(/preset/);
  });
});

describe('parseRunArgs invalid cases (FR-1202)', () => {
  it.each(INVALID_RUN)('rejects %s with a single-line UsageError', (_label, argv) => {
    let error: unknown;
    try {
      parseRunArgs(argv);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(UsageError);
    expect((error as UsageError).message).not.toContain('\n');
    expect((error as UsageError).message).not.toMatch(/^generate-data: /);
  });
});

describe('parseValidateArgs', () => {
  it('defaults out to .data/datasets', () => {
    expect(parseValidateArgs(['--run-id', 'v1'])).toEqual({ run_id: 'v1', out: '.data/datasets' });
  });

  it('accepts --out', () => {
    expect(parseValidateArgs(['--run-id', 'v1', '--out', '/tmp/y'])).toEqual({
      run_id: 'v1',
      out: '/tmp/y',
    });
  });

  it.each([
    ['missing run id', []],
    ['eval run id', ['--run-id', 'eval-x']],
    ['run-only option', ['--run-id', 'v1', '--games', '3']],
    ['positional', ['--run-id', 'v1', 'x']],
  ])('rejects %s', (_label, argv) => {
    expect(() => parseValidateArgs(argv)).toThrow(UsageError);
  });
});

describe('generate-data CLI usage errors (VC-1202)', () => {
  const cases: [string, string[]][] = [
    ['no subcommand', []],
    ['unknown subcommand', ['frobnicate']],
    ...INVALID_RUN.map(([label, argv]): [string, string[]] => [`run: ${label}`, ['run', ...argv]]),
    ['validate: missing run id', ['validate']],
    ['validate: unknown option', ['validate', '--run-id', 'v1', '--games', '3']],
  ];

  it.each(cases)(
    '%s exits 1 with one stderr line, empty stdout and no files',
    async (_label, argv) => {
      const tmp = makeTempDir();
      const result = await runCli([...argv, ...(argv[0] === 'run' ? ['--out', tmp] : [])]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/^generate-data: [^\n]+\n$/);
      expect(readdirSync(tmp)).toEqual([]);
    },
    120_000,
  );

  it('a valid validate command line reaches validate (no run in the output directory)', async () => {
    const tmp = makeTempDir();
    const result = await runCli(['validate', '--run-id', 'r1', '--out', tmp]);
    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: `generate-data: no run "r1" in ${tmp}\n`,
    });
  }, 120_000);
});
