// Helpers for the data-generator tests: run the CLI as a child process, make temp directories.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManifestSchema, type Manifest } from '../../../scripts/datagen/schema';

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

export interface RunningCli {
  /** The node process itself: `child.kill('SIGKILL')` ends it (and its workers) at once. */
  child: ChildProcess;
  /** Resolves when the process has closed. */
  closed: Promise<CliResult>;
}

/** Like `runCli`, but returns the child immediately so a test can observe it and kill it. */
export function spawnCli(
  args: string[],
  options: { env?: Record<string, string>; cwd?: string } = {},
): RunningCli {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', path.join(REPO_ROOT, 'scripts/generate-data.ts'), ...args],
    { cwd: options.cwd ?? REPO_ROOT, env: { ...process.env, ...options.env } },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const closed = new Promise<CliResult>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
  return { child, closed };
}

/** Reads `<out>/<runId>/manifest.json`; `null` while it is missing or cannot be parsed yet. */
export function tryReadManifest(out: string, runId: string): Manifest | null {
  try {
    const text = readFileSync(path.join(out, runId, 'manifest.json'), 'utf8');
    return ManifestSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

/**
 * Polls the manifest every 20 ms until `predicate` holds (never flaky on timing: no fixed
 * sleeps); rejects after `timeoutMs` (default 90 s) or when `running` closes first.
 */
export async function waitForManifest(
  out: string,
  runId: string,
  predicate: (manifest: Manifest) => boolean,
  options: { timeoutMs?: number; running?: RunningCli } = {},
): Promise<Manifest> {
  const deadline = Date.now() + (options.timeoutMs ?? 90_000);
  let exited = false;
  void options.running?.closed.then(() => (exited = true));
  for (;;) {
    const manifest = tryReadManifest(out, runId);
    if (manifest !== null && predicate(manifest)) return manifest;
    if (exited) throw new Error('the run ended before the manifest matched');
    if (Date.now() > deadline) throw new Error('timed out waiting for the manifest');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
