// CLI entry of the data generator (`pnpm generate-data`, spec 12). Usage:
//
//   pnpm generate-data run --run-id <id> [--preset <id>] [--players <n>] [--games <n>]
//                          [--shard-size <n>] [--strategies <s0,s1,...>] [--workers <n>]
//                          [--replay-every <n>] [--out <dir>]
//   pnpm generate-data validate --run-id <id> [--out <dir>]
//
// An invalid command line prints one line `generate-data: <problem>` to stderr and exits 1.
import { execFileSync } from 'node:child_process';
import { UsageError, parseRunArgs, parseValidateArgs } from './datagen/args';
import { type GitInfo, executeRun } from './datagen/run';

/** `git rev-parse HEAD` and `git status --porcelain`, once; `"unknown"` / dirty when git fails. */
function readGitInfo(): GitInfo {
  const git = (args: string[]): string =>
    execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let git_commit = 'unknown';
  let git_dirty = false;
  try {
    git_commit = git(['rev-parse', 'HEAD']).trim() || 'unknown';
  } catch {
    // git unavailable or not a repository
  }
  try {
    git_dirty = git(['status', '--porcelain']).trim() !== '';
  } catch {
    // leave false
  }
  return { git_commit, git_dirty };
}

async function main(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;
  try {
    switch (subcommand) {
      case 'run':
        return (
          await executeRun(parseRunArgs(rest), {
            now: () => new Date().toISOString(),
            gitInfo: readGitInfo(),
          })
        ).exitCode;
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

process.exitCode = await main(process.argv.slice(2));
