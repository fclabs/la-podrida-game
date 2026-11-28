// CLI entry of the data generator (`pnpm generate-data`, spec 12). Usage:
//
//   pnpm generate-data run --run-id <id> [--preset <id>] [--players <n>] [--games <n>]
//                          [--shard-size <n>] [--strategies <s0,s1,...>] [--workers <n>]
//                          [--replay-every <n>] [--out <dir>]
//   pnpm generate-data validate --run-id <id> [--out <dir>]
//
// An invalid command line prints one line `generate-data: <problem>` to stderr and exits 1.
import { UsageError, parseRunArgs, parseValidateArgs } from './datagen/args';

function main(argv: string[]): number {
  const [subcommand, ...rest] = argv;
  try {
    switch (subcommand) {
      case 'run':
        parseRunArgs(rest);
        process.stderr.write('generate-data: run is not implemented yet\n');
        return 1;
      case 'validate':
        parseValidateArgs(rest);
        process.stderr.write('generate-data: validate is not implemented yet\n');
        return 1;
      case undefined:
        throw new UsageError('missing subcommand (expected "run" or "validate")');
      default:
        throw new UsageError(`unknown subcommand "${subcommand}" (expected "run" or "validate")`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`generate-data: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = main(process.argv.slice(2));
