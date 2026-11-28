// Resume and the parameter guard (spec 12 VC-1238..1242, FR-1214, FR-1218..1220, NFR-1205).
// Every test passes `--out <temp dir>`; a killed run is a child process (`spawnCli`).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ManifestSchema, type Manifest } from '../../../scripts/datagen/schema';
import { makeTempDir, runCli, spawnCli, tryReadManifest, waitForManifest } from './helpers';

const T = 120_000;
const CONFIGURABLE = path.resolve(import.meta.dirname, 'fixtures/hooks-configurable.ts');

function readRunManifest(out: string, runId: string): Manifest {
  return ManifestSchema.parse(
    JSON.parse(readFileSync(path.join(out, runId, 'manifest.json'), 'utf8')),
  );
}

/** Every file under `dir` (relative path, forward slashes), sorted. */
function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)))
    .sort();
}

/** Relative path -> contents (hex), for byte-for-byte comparisons of a whole directory. */
function snapshot(dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const file of listFiles(dir))
    result[file] = readFileSync(path.join(dir, file)).toString('hex');
  return result;
}

interface FileStat {
  ino: number;
  size: number;
  mtimeMs: number;
}

function fileStat(file: string): FileStat {
  const { ino, size, mtimeMs } = statSync(file);
  return { ino, size, mtimeMs };
}

function completeShards(manifest: Manifest): number[] {
  return manifest.shards.filter((s) => s.status === 'complete').map((s) => s.shard);
}

function shardPaths(manifest: Manifest, shard: number): string[] {
  const entry = manifest.shards[shard];
  if (entry.status !== 'complete') throw new Error(`shard ${shard} is ${entry.status}`);
  return Object.values(entry.files).map((f) => f.path);
}

async function validateOk(out: string, runId: string): Promise<void> {
  const v = await runCli(['validate', '--run-id', runId, '--out', out]);
  expect(v.stderr).toBe('');
  expect(v.code).toBe(0);
}

function skippedCount(stdout: string): number {
  const match = /^shards: \d+ complete \((\d+) skipped, \d+ failed\)$/m.exec(stdout);
  if (match === null) throw new Error(`no shards line in:\n${stdout}`);
  return Number(match[1]);
}

describe('resume after a kill (VC-1238, VC-1239, NFR-1205)', () => {
  it(
    'a SIGKILLed run resumes to a complete, valid dataset and leaves finished shards untouched',
    async () => {
      const out = makeTempDir();
      const runId = 'kill';
      const runDir = path.join(out, runId);
      const args = ['run', '--run-id', runId, '--games', '200', '--shard-size', '10', '--out', out];

      const running = spawnCli([...args, '--workers', '2']);
      await waitForManifest(out, runId, (m) => completeShards(m).length >= 3, { running });
      running.child.kill('SIGKILL');
      await running.closed;

      // The killed process is gone, so this manifest is final. It must be unfinished.
      const before = readRunManifest(out, runId);
      const done = completeShards(before);
      expect(done.length).toBeGreaterThanOrEqual(3);
      expect(done.length).toBeLessThan(20);
      const stats = new Map<string, FileStat>();
      for (const shard of done) {
        for (const file of shardPaths(before, shard)) {
          stats.set(file, fileStat(path.join(runDir, file)));
        }
      }

      const resumed = await runCli([...args, '--workers', '3']);
      expect(resumed.stderr).toBe('');
      expect(resumed.code).toBe(0);
      const after = readRunManifest(out, runId);
      expect(after.shards.map((s) => s.status)).toEqual(Array(20).fill('complete'));
      expect(after.created_at).toBe(before.created_at);
      expect(listFiles(runDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);

      // VC-1239: same inode, size and mtime; counted as skipped.
      for (const [file, was] of stats) expect(fileStat(path.join(runDir, file))).toEqual(was);
      expect(skippedCount(resumed.stdout)).toBe(done.length);
      expect(resumed.stdout).toContain('rows: games 200 ');
      await validateOk(out, runId);
    },
    T,
  );
});

describe('resume re-runs shards that are not complete or not intact (VC-1240, FR-1218)', () => {
  it(
    'a deleted, truncated or edited file is re-run; an untouched shard is skipped',
    async () => {
      const out = makeTempDir();
      const runDir = path.join(out, 'chk');
      const args = ['run', '--run-id', 'chk', '--games', '8', '--shard-size', '2', '--out', out];
      expect((await runCli(args)).code).toBe(0);
      const manifest = readRunManifest(out, 'chk');

      const [deleted, truncated, edited, untouched] = [0, 1, 2, 3].map((s) =>
        shardPaths(manifest, s),
      );
      unlinkSync(path.join(runDir, deleted[1]));
      const cut = path.join(runDir, truncated[2]);
      truncateSync(cut, Math.floor(statSync(cut).size / 2));
      const flip = path.join(runDir, edited[0]);
      const bytes = readFileSync(flip);
      bytes[Math.floor(bytes.length / 2)] ^= 0xff; // same size, different content
      writeFileSync(flip, bytes);
      const untouchedStats = untouched.map((f) => fileStat(path.join(runDir, f)));

      const resumed = await runCli(args);
      expect(resumed.code).toBe(0);
      expect(skippedCount(resumed.stdout)).toBe(1);
      expect(untouched.map((f) => fileStat(path.join(runDir, f)))).toEqual(untouchedStats);
      const after = readRunManifest(out, 'chk');
      expect(after.shards.map((s) => s.status)).toEqual(Array(4).fill('complete'));
      // Re-running is deterministic: every shard's files match the original manifest again.
      expect(after.shards.map((s) => (s.status === 'complete' ? s.files : null))).toEqual(
        manifest.shards.map((s) => (s.status === 'complete' ? s.files : null)),
      );
      await validateOk(out, 'chk');
    },
    T,
  );

  it(
    'a failed run resumed without the hook, and with another --workers, completes',
    async () => {
      const out = makeTempDir();
      const args = ['run', '--run-id', 'fr', '--games', '6', '--shard-size', '2', '--out', out];
      const failed = await runCli([...args, '--workers', '1'], {
        env: {
          GENERATE_DATA_TEST_HOOKS: CONFIGURABLE,
          HOOK_FAIL_SEED: 'fr-1-0',
          HOOK_MODE: 'not-game-over',
        },
      });
      expect(failed.code).toBe(1);
      expect(readRunManifest(out, 'fr').shards.map((s) => s.status)).toEqual([
        'complete',
        'failed',
        'complete',
      ]);

      const resumed = await runCli([...args, '--workers', '3']);
      expect(resumed.code).toBe(0);
      expect(skippedCount(resumed.stdout)).toBe(2);
      expect(readRunManifest(out, 'fr').shards.map((s) => s.status)).toEqual(
        Array(3).fill('complete'),
      );
      await validateOk(out, 'fr');
    },
    T,
  );

  it(
    'start-up deletes every *.tmp file under the run directory and nothing else',
    async () => {
      const out = makeTempDir();
      const runDir = path.join(out, 'tmp');
      const args = ['run', '--run-id', 'tmp', '--games', '4', '--shard-size', '2', '--out', out];
      expect((await runCli(args)).code).toBe(0);
      mkdirSync(path.join(runDir, 'deep/er'), { recursive: true });
      const planted = [
        'manifest.json.tmp',
        'shards/shard-00001.games.jsonl.gz.tmp',
        'deep/er/x.tmp',
      ];
      for (const file of planted) writeFileSync(path.join(runDir, file), 'partial');
      writeFileSync(path.join(runDir, 'deep/keep.txt'), 'keep');

      const resumed = await runCli(args);
      expect(resumed.code).toBe(0);
      expect(skippedCount(resumed.stdout)).toBe(2);
      for (const file of planted) expect(existsSync(path.join(runDir, file))).toBe(false);
      expect(readFileSync(path.join(runDir, 'deep/keep.txt'), 'utf8')).toBe('keep');
    },
    T,
  );
});

describe('the parameter guard (VC-1241, FR-1219)', () => {
  const base = [
    '--preset',
    'gamerules',
    '--players',
    '4',
    '--games',
    '4',
    '--shard-size',
    '2',
    '--replay-every',
    '7',
  ];

  function withOption(name: string, value: string | null): string[] {
    const args = [...base];
    const at = args.indexOf(`--${name}`);
    if (value === null) args.splice(at, 2);
    else args[at + 1] = value;
    return args;
  }

  async function guarded(out: string, args: string[], name: string): Promise<void> {
    const runDir = path.join(out, 'g');
    const before = snapshot(runDir);
    const r = await runCli(['run', '--run-id', 'g', '--out', out, ...args]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(`generate-data: run "g" has a different ${name}\n`);
    expect(snapshot(runDir)).toEqual(before);
  }

  it(
    'a differing option (or an omitted one that has a non-default value) is refused, nothing changes',
    async () => {
      const out = makeTempDir();
      const created = await runCli(['run', '--run-id', 'g', '--out', out, ...base]);
      expect(created.code).toBe(0);

      // Changed options (--players 5 also changes the default strategies; preset is checked first).
      await guarded(out, withOption('preset', 'spain-ludoteka'), 'preset');
      await guarded(out, withOption('players', '5'), 'players');
      await guarded(out, withOption('games', '6'), 'games');
      await guarded(out, withOption('shard-size', '1'), 'shard-size');
      await guarded(out, withOption('replay-every', '8'), 'replay-every');
      // Omitted options count as their defaults (argentina-fidepo, 3 players, 1000, 1000, 100).
      await guarded(out, withOption('preset', null), 'preset');
      await guarded(out, withOption('players', null), 'players');
      await guarded(out, withOption('games', null), 'games');
      await guarded(out, withOption('shard-size', null), 'shard-size');
      await guarded(out, withOption('replay-every', null), 'replay-every');
      // Several differences: the first in the fixed order is reported.
      await guarded(
        out,
        withOption('replay-every', '8').map((a) => (a === '2' ? '1' : a)),
        'shard-size',
      );
      await guarded(
        out,
        withOption('games', '6').map((a) => (a === '4' ? '5' : a)),
        'players',
      );
    },
    T,
  );

  it(
    'a differing strategies list, schema_version or generator_version in the manifest is refused',
    async () => {
      const out = makeTempDir();
      const runDir = path.join(out, 'g');
      expect((await runCli(['run', '--run-id', 'g', '--out', out, ...base])).code).toBe(0);
      const file = path.join(runDir, 'manifest.json');
      const original = readFileSync(file, 'utf8');
      const edit = (change: (m: Record<string, unknown>) => void): void => {
        const m = JSON.parse(original) as Record<string, unknown>;
        change(m);
        writeFileSync(file, JSON.stringify(m, null, 2));
      };

      edit((m) => ((m.params as { strategies: string[] }).strategies[3] = 'other'));
      await guarded(out, base, 'strategies');
      // Strategies are compared before the two versions; the versions come last.
      edit((m) => (m.schema_version = 99));
      await guarded(out, base, 'schema_version');
      edit((m) => {
        m.schema_version = 99;
        m.generator_version = 99;
      });
      await guarded(out, base, 'schema_version');
      edit((m) => (m.generator_version = 99));
      await guarded(out, base, 'generator_version');
    },
    T,
  );

  it(
    'a different --workers value is fine',
    async () => {
      const out = makeTempDir();
      const args = ['run', '--run-id', 'g', '--out', out, ...base];
      expect((await runCli([...args, '--workers', '1'])).code).toBe(0);
      const resumed = await runCli([...args, '--workers', '4']);
      expect(resumed.code).toBe(0);
      expect(skippedCount(resumed.stdout)).toBe(2);
    },
    T,
  );
});

describe('an existing run directory (VC-1242, FR-1220)', () => {
  it(
    'a stray file and no manifest: exit 1, one line, nothing changed',
    async () => {
      const out = makeTempDir();
      const runDir = path.join(out, 'stray');
      mkdirSync(runDir);
      writeFileSync(path.join(runDir, 'notes.txt'), 'hello');
      const before = snapshot(runDir);
      const r = await runCli(['run', '--run-id', 'stray', '--games', '2', '--out', out]);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe(`generate-data: run directory "${runDir}" exists without a manifest\n`);
      expect(snapshot(runDir)).toEqual(before);
      expect(readdirSync(runDir)).toEqual(['notes.txt']);
    },
    T,
  );

  it(
    'an empty run directory proceeds as a new run',
    async () => {
      const out = makeTempDir();
      mkdirSync(path.join(out, 'empty'));
      const r = await runCli(['run', '--run-id', 'empty', '--games', '2', '--out', out]);
      expect(r.code).toBe(0);
      expect(skippedCount(r.stdout)).toBe(0);
      expect(tryReadManifest(out, 'empty')?.shards.map((s) => s.status)).toEqual(['complete']);
    },
    T,
  );

  it(
    'resuming a finished run skips every shard and rewrites no shard file',
    async () => {
      const out = makeTempDir();
      const args = ['run', '--run-id', 'all', '--games', '4', '--shard-size', '2', '--out', out];
      expect((await runCli(args)).code).toBe(0);
      const runDir = path.join(out, 'all');
      const shards = listFiles(path.join(runDir, 'shards'));
      const before = shards.map((f) => fileStat(path.join(runDir, 'shards', f)));
      const copy = path.join(out, 'copy.json');
      copyFileSync(path.join(runDir, 'manifest.json'), copy);
      const resumed = await runCli(args);
      expect(resumed.code).toBe(0);
      expect(skippedCount(resumed.stdout)).toBe(2);
      expect(shards.map((f) => fileStat(path.join(runDir, 'shards', f)))).toEqual(before);
      expect(readFileSync(path.join(runDir, 'manifest.json'), 'utf8')).toBe(
        readFileSync(copy, 'utf8'),
      );
    },
    T,
  );
});
