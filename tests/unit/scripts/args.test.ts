import { describe, expect, it } from 'vitest';
import { UsageError, parseStrict } from '@/scripts/lib/args';

const spec = {
  rounds: { type: 'integer', min: 1, max: 1000, default: 100 },
  mode: { type: 'string', choices: ['a', 'b'] },
} as const;

describe('parseStrict', () => {
  it('applies defaults and parses decimal integers and choices', () => {
    expect(parseStrict([], spec)).toEqual({ rounds: 100, mode: undefined });
    expect(parseStrict(['--rounds', '7', '--mode', 'b'], spec)).toEqual({ rounds: 7, mode: 'b' });
  });

  it.each(['0', '1001', '-1', '1.5', 'abc', '0x10', '1e2', ' 5', '007'])(
    'rejects --rounds %s without echoing the value',
    (value) => {
      let error: unknown;
      try {
        parseStrict(['--rounds', value], spec);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(UsageError);
      const message = (error as UsageError).message;
      expect(message).toContain('--rounds');
      expect(message).not.toContain('\n');
      if (value.trim() !== '' && !/^[0-9]+$/.test(value)) expect(message).not.toContain(value);
    },
  );

  it('rejects unknown options, positionals and bad choices with one line', () => {
    for (const args of [['--nope', '1'], ['stray'], ['--mode', 'zzz-secret']]) {
      let error: unknown;
      try {
        parseStrict(args, spec);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(UsageError);
      expect((error as UsageError).message).not.toContain('\n');
      expect((error as UsageError).message).not.toContain('zzz-secret');
      expect((error as UsageError).message).not.toContain('stray');
    }
  });
});
