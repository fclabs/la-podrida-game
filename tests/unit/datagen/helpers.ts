// Helpers for the data-generator tests: run the CLI as a child process, make temp directories.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs `scripts/generate-data.ts` in a child process (`node --import tsx`, from the repository
 * root unless `cwd` is given) and collects its exit code and output.
 */
export function runCli(
  args: string[],
  options: { env?: Record<string, string>; cwd?: string } = {},
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', path.join(REPO_ROOT, 'scripts/generate-data.ts'), ...args],
      { cwd: options.cwd ?? REPO_ROOT, env: { ...process.env, ...options.env } },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Creates a new empty directory under the OS temp directory. */
export function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'datagen-'));
}
