// Tiny strict command-line parser shared by the Phase 11 scripts. Built on `node:util` `parseArgs`.
// Every failure is a `UsageError` whose message is ONE line and never contains an option value, so
// a secret mistakenly typed as an argument cannot reach stderr.
import { parseArgs } from 'node:util';

/** Invalid command line or missing input. `message` is the single stderr line (no prefix). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** A decimal integer in `[min, max]`; `default` is used when the option is absent. */
export interface IntegerOptionSpec {
  type: 'integer';
  min: number;
  max: number;
  default?: number;
}

/** A free string, optionally restricted to `choices`; `default` is used when absent. */
export interface StringOptionSpec {
  type: 'string';
  choices?: readonly string[];
  default?: string;
}

export type OptionSpec = IntegerOptionSpec | StringOptionSpec;

type ValueOf<O extends OptionSpec> = O extends IntegerOptionSpec ? number : string;

/** A key is `T` when its spec has a `default`, else `T | undefined` (absent option). */
export type ParsedOptions<S extends Record<string, OptionSpec>> = {
  [K in keyof S]: S[K] extends { default: unknown } ? ValueOf<S[K]> : ValueOf<S[K]> | undefined;
};

const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/;

/** Parses `args` (without `node` and the script path) against `spec`. Throws `UsageError`. */
export function parseStrict<const S extends Record<string, OptionSpec>>(
  args: readonly string[],
  spec: S,
): ParsedOptions<S> {
  let raw: Record<string, string | boolean | undefined>;
  try {
    const options: Record<string, { type: 'string' }> = {};
    for (const name of Object.keys(spec)) options[name] = { type: 'string' };
    ({ values: raw } = parseArgs({
      args: [...args],
      strict: true,
      allowPositionals: false,
      options,
    }));
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') {
      throw new UsageError('unexpected positional argument');
    }
    // Messages can span several lines; the first one names the problem (an option, not a value).
    const first = String(error instanceof Error ? error.message : error).split('\n')[0];
    throw new UsageError(first);
  }

  const out: Record<string, number | string | undefined> = {};
  for (const [name, option] of Object.entries(spec)) {
    const value = raw[name];
    if (value === undefined) {
      out[name] = option.default;
      continue;
    }
    const text = String(value);
    if (option.type === 'integer') {
      const n = DECIMAL_INTEGER.test(text) ? Number(text) : NaN;
      if (!(n >= option.min && n <= option.max)) {
        throw new UsageError(
          `--${name} must be a decimal integer from ${option.min} to ${option.max}`,
        );
      }
      out[name] = n;
    } else {
      if (option.choices !== undefined && !option.choices.includes(text)) {
        throw new UsageError(`--${name} must be one of: ${option.choices.join(', ')}`);
      }
      out[name] = text;
    }
  }
  return out as ParsedOptions<S>;
}
