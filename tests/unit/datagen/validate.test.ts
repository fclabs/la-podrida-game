// `validate` and the distribution report (spec 12 VC-1233..1237, FR-1221..1223) at CLI level.
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { createReportAccumulator, formatReport, oneDecimal } from '../../../scripts/datagen/report';
import { ManifestSchema, type Manifest } from '../../../scripts/datagen/schema';
import { makeTempDir, runCli } from './helpers';

const T = 120_000;
const CONFIGURABLE = path.resolve(import.meta.dirname, 'fixtures/hooks-configurable.ts');

function readRunManifest(out: string, runId: string): Manifest {
  return ManifestSchema.parse(
    JSON.parse(readFileSync(path.join(out, runId, 'manifest.json'), 'utf8')),
  );
}

type Table = 'games' | 'hands' | 'decisions';

function readRows(out: string, runId: string, table: Table): Record<string, unknown>[] {
  const manifest = readRunManifest(out, runId);
  const rows: Record<string, unknown>[] = [];
  for (const entry of manifest.shards) {
    if (entry.status !== 'complete') continue;
    const text = gunzipSync(
      readFileSync(path.join(out, runId, entry.files[table].path)),
    ).toString();
    for (const line of text.split('\n')) if (line !== '') rows.push(JSON.parse(line));
  }
  return rows;
}

/**
 * Rewrites one table file of a shard through `edit` (it receives the decompressed lines) as a
 * properly gzipped file AND updates the manifest entry's bytes, sha256 and rows, so the checksum
 * check (2) passes and only the targeted later check can fail.
 */
function rewriteTable(
  out: string,
  runId: string,
  shard: number,
  table: Table,
  edit: (lines: string[]) => string[],
): void {
  const runDir = path.join(out, runId);
  const manifest = readRunManifest(out, runId);
  const entry = manifest.shards[shard];
  if (entry.status !== 'complete') throw new Error('shard is not complete');
  const file = path.join(runDir, entry.files[table].path);
  const lines = gunzipSync(readFileSync(file)).toString().split('\n').filter(Boolean);
  const edited = edit(lines);
  const bytes = gzipSync(edited.map((l) => `${l}\n`).join(''));
  writeFileSync(file, bytes);
  entry.files[table] = {
    path: entry.files[table].path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    rows: edited.length,
  };
  writeFileSync(path.join(runDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

describe('report formatting', () => {
  it('prints the fixed labels, one decimal and no -0.0', () => {
    expect(oneDecimal(-0.04)).toBe('0.0');
    const acc = createReportAccumulator();
    acc.addGame(
      {
        game_id: 'g-0-0',
        run_id: 'g',
        shard: 0,
        seed: 'g-0-0',
        preset: 'argentina-fidepo',
        n_players: 2,
        n_hands: 1,
        strategy_by_seat: ['random', 'random'],
        final_total_by_seat: [-1, 1],
        final_place_by_seat: [1, 0],
        generator_version: 1,
      },
      7,
    );
    acc.addHand({
      game_id: 'g-0-0',
      hand_index: 0,
      cards_dealt: 2,
      dealer: 0,
      trump_card: 'x',
      trump_in_dealer_hand: false,
      bid_by_seat: [0, 2],
      tricks_won_by_seat: [0, 1],
      made_by_seat: [true, false],
      points_by_seat: [0, 0],
    });
    expect(formatReport('g', 'OK', acc.stats())).toBe(
      [
        'validate: g  status: OK',
        'games: 1  hands: 1  decisions: 7',
        'decisions per game: mean 7.0  min 7  max 7',
        'made-bid rate: 50.0%',
        'average final total by seat: 0: -1.0  1: 1.0',
        'average final total by strategy: random: 0.0',
        'bid histogram, 2: 0:1 1:0 2:1',
        '',
      ].join('\n'),
    );
  });
});

describe('validate a good run (VC-1233)', () => {
  it(
    'exits 0 with status OK and a consistent report',
    async () => {
      const out = makeTempDir();
      const run = await runCli([
        ...['run', '--run-id', 'v', '--games', '60', '--shard-size', '20', '--workers', '2'],
        ...['--replay-every', '1', '--out', out],
      ]);
      expect(run.code).toBe(0);
      const v = await runCli(['validate', '--run-id', 'v', '--out', out]);
      expect(v.code).toBe(0);
      expect(v.stderr).toBe('');
      const lines = v.stdout.trimEnd().split('\n');
      expect(lines[0]).toBe('validate: v  status: OK');
      expect(lines[1]).toMatch(/^games: 60 {2}hands: \d+ {2}decisions: \d+$/);
      const decisions = Number(/decisions: (\d+)/.exec(lines[1])![1]);
      const mean = Number(/mean ([\d.]+)/.exec(lines[2])![1]);
      expect(Math.round(mean * 60)).toBe(decisions);
      expect(decisions).toBe(readRows(out, 'v', 'decisions').length);
      const distinct = new Set(readRows(out, 'v', 'hands').map((h) => h.cards_dealt));
      const histograms = lines.filter((l) => l.startsWith('bid histogram, '));
      expect(histograms).toHaveLength(distinct.size);
      const dealt = histograms.map((l) => Number(/^bid histogram, (\d+):/.exec(l)![1]));
      expect(dealt).toEqual([...distinct].map(Number).sort((a, b) => a - b));
      for (const l of histograms) {
        const n = Number(/^bid histogram, (\d+):/.exec(l)![1]);
        expect(l.split(': ')[1].split(' ')).toHaveLength(n + 1);
      }
      expect(lines.slice(3, 6).map((l) => l.split(':')[0])).toEqual([
        'made-bid rate',
        'average final total by seat',
        'average final total by strategy',
      ]);
    },
    T,
  );
});

describe('validate corrupted runs (VC-1234)', () => {
  let base = '';
  beforeAll(async () => {
    base = makeTempDir();
    const run = await runCli([
      ...['run', '--run-id', 'c', '--games', '12', '--shard-size', '6', '--workers', '2'],
      ...['--replay-every', '1', '--out', base],
    ]);
    expect(run.code).toBe(0);
  }, T);

  async function corrupted(edit: (out: string) => void) {
    const out = makeTempDir();
    cpSync(path.join(base, 'c'), path.join(out, 'c'), { recursive: true });
    edit(out);
    const r = await runCli(['validate', '--run-id', 'c', '--out', out]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    return r.stderr;
  }

  it(
    'the untouched copy validates',
    async () => {
      const r = await runCli(['validate', '--run-id', 'c', '--out', base]);
      expect(r.code).toBe(0);
    },
    T,
  );

  it(
    'a shard file deleted -> check 2',
    async () => {
      const err = await corrupted((out) =>
        rmSync(path.join(out, 'c/shards/shard-00001.hands.jsonl.gz')),
      );
      expect(err).toMatch(/^generate-data: validate: check 2 \(files\): shard 1 hands: .*missing/);
    },
    T,
  );

  it(
    'one byte changed -> check 2',
    async () => {
      const err = await corrupted((out) => {
        const file = path.join(out, 'c/shards/shard-00000.games.jsonl.gz');
        const bytes = readFileSync(file);
        bytes[bytes.length - 12] ^= 0xff;
        writeFileSync(file, bytes);
      });
      expect(err).toMatch(/^generate-data: validate: check 2 \(files\): shard 0 games: /);
    },
    T,
  );

  it(
    'a games line removed -> check 4 (join)',
    async () => {
      const err = await corrupted((out) =>
        rewriteTable(out, 'c', 0, 'games', (lines) => lines.slice(1)),
      );
      expect(err).toMatch(/^generate-data: validate: check 4 \(join\): shard 0: /);
    },
    T,
  );

  it(
    'a decisions line removed -> check 5 (decisions per game)',
    async () => {
      const err = await corrupted((out) =>
        rewriteTable(out, 'c', 1, 'decisions', (lines) => lines.filter((_, i) => i !== 10)),
      );
      expect(err).toMatch(
        /^generate-data: validate: check 5 \(decisions per game\): shard 1 game /,
      );
    },
    T,
  );

  it(
    'a hands.points_by_seat value changed -> check 6 (labels)',
    async () => {
      const err = await corrupted((out) =>
        rewriteTable(out, 'c', 0, 'hands', (lines) => {
          const row = JSON.parse(lines[0]) as { points_by_seat: number[] };
          row.points_by_seat[0] += 1;
          return [JSON.stringify(row), ...lines.slice(1)];
        }),
      );
      expect(err).toMatch(/^generate-data: validate: check 6 \(labels\): shard 0 /);
    },
    T,
  );

  it(
    'a self-consistent points change (totals adjusted too) -> check 6 (labels)',
    async () => {
      const err = await corrupted((out) => {
        rewriteTable(out, 'c', 0, 'hands', (lines) => {
          const row = JSON.parse(lines[0]) as { points_by_seat: number[] };
          row.points_by_seat[0] += 5;
          return [JSON.stringify(row), ...lines.slice(1)];
        });
        rewriteTable(out, 'c', 0, 'games', (lines) => {
          const row = JSON.parse(lines[0]) as { final_total_by_seat: number[] };
          row.final_total_by_seat[0] += 5;
          return [JSON.stringify(row), ...lines.slice(1)];
        });
        rewriteTable(out, 'c', 0, 'decisions', (lines) =>
          lines.map((l) => {
            const row = JSON.parse(l) as {
              game_id: string;
              hand_index: number;
              seat: number;
              hand_points: number;
              final_total: number;
            };
            if (row.game_id !== 'c-0-0' || row.seat !== 0) return l;
            if (row.hand_index === 0) row.hand_points += 5;
            row.final_total += 5;
            return JSON.stringify(row);
          }),
        );
      });
      expect(err).toMatch(
        /^generate-data: validate: check 6 \(labels\): shard 0 game c-0-0 hand 0 seat 0: differs from the score engine/,
      );
    },
    T,
  );

  it(
    'a decisions.chosen_move_id changed on a sampled game -> check 7 (replay)',
    async () => {
      const err = await corrupted((out) =>
        rewriteTable(out, 'c', 0, 'decisions', (lines) => {
          const row = JSON.parse(lines[3]) as { chosen_move_id: string };
          row.chosen_move_id = row.chosen_move_id.startsWith('bid:') ? 'bid:9' : 'play:XX';
          return [...lines.slice(0, 3), JSON.stringify(row), ...lines.slice(4)];
        }),
      );
      expect(err).toMatch(
        /^generate-data: validate: check 7 \(replay\): shard 0 game .*step 3 differs/,
      );
    },
    T,
  );

  it(
    'a row that does not parse -> check 3 (rows)',
    async () => {
      const err = await corrupted((out) =>
        rewriteTable(out, 'c', 0, 'hands', (lines) => [...lines.slice(0, 1), '{"game_id":1}']),
      );
      expect(err).toMatch(/^generate-data: validate: check 3 \(rows\): shard 0 hands line 2: /);
    },
    T,
  );

  it(
    'manifest.json replaced by {} -> check 1',
    async () => {
      const err = await corrupted((out) => writeFileSync(path.join(out, 'c/manifest.json'), '{}'));
      expect(err).toMatch(/^generate-data: validate: check 1 \(manifest\): manifest.json: /);
    },
    T,
  );
});

describe('validate an incomplete run (VC-1235)', () => {
  it(
    'reports the complete shards with status INCOMPLETE and exits 1',
    async () => {
      const out = makeTempDir();
      const run = await runCli(
        [
          'run',
          '--run-id',
          'i',
          '--games',
          '9',
          '--shard-size',
          '3',
          '--workers',
          '1',
          '--out',
          out,
        ],
        {
          env: {
            GENERATE_DATA_TEST_HOOKS: CONFIGURABLE,
            HOOK_FAIL_SEED: 'i-1-0',
            HOOK_MODE: 'not-game-over',
          },
        },
      );
      expect(run.code).toBe(1);
      expect(readRunManifest(out, 'i').shards.map((s) => s.status)).toEqual([
        'complete',
        'failed',
        'complete',
      ]);
      const v = await runCli(['validate', '--run-id', 'i', '--out', out]);
      expect(v.code).toBe(1);
      expect(v.stderr).toBe('');
      expect(v.stdout.split('\n')[0]).toBe('validate: i  status: INCOMPLETE');
      expect(v.stdout.split('\n')[1]).toMatch(/^games: 6 {2}hands: \d+ {2}decisions: \d+$/);
    },
    T,
  );
});

describe('validate usage and missing runs (VC-1236)', () => {
  it(
    'no run directory, or a directory without manifest.json',
    async () => {
      const out = makeTempDir();
      const missing = await runCli(['validate', '--run-id', 'nope', '--out', out]);
      expect(missing.code).toBe(1);
      expect(missing.stdout).toBe('');
      expect(missing.stderr).toBe(`generate-data: no run "nope" in ${out}\n`);

      const empty = path.join(out, 'bare');
      cpSync(makeTempDir(), empty, { recursive: true });
      const bare = await runCli(['validate', '--run-id', 'bare', '--out', out]);
      expect(bare.code).toBe(1);
      expect(bare.stdout).toBe('');
      expect(bare.stderr).toBe(`generate-data: no run "bare" in ${out}\n`);
    },
    T,
  );

  it(
    'a missing --run-id is one usage line',
    async () => {
      const r = await runCli(['validate']);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toMatch(/^generate-data: .*\n$/);
      expect(r.stderr.trimEnd().split('\n')).toHaveLength(1);
    },
    T,
  );
});

describe('report numbers (VC-1237)', () => {
  it(
    'made-bid rate and seat averages match the tables',
    async () => {
      const out = makeTempDir();
      const run = await runCli([
        ...['run', '--run-id', 'n', '--games', '30', '--shard-size', '10', '--players', '3'],
        ...['--workers', '2', '--out', out],
      ]);
      expect(run.code).toBe(0);
      const v = await runCli(['validate', '--run-id', 'n', '--out', out]);
      expect(v.code).toBe(0);
      const games = readRows(out, 'n', 'games') as unknown as {
        n_hands: number;
        final_total_by_seat: number[];
      }[];
      const hands = readRows(out, 'n', 'hands') as unknown as { made_by_seat: boolean[] }[];
      const made = hands.reduce((a, h) => a + h.made_by_seat.filter(Boolean).length, 0);
      const bids = games.reduce((a, g) => a + g.n_hands * 3, 0);
      expect(bids).toBe(hands.length * 3);
      expect(v.stdout).toContain(`made-bid rate: ${oneDecimal((100 * made) / bids)}%\n`);
      const seats = [0, 1, 2].map(
        (k) =>
          `${k}: ${oneDecimal(games.reduce((a, g) => a + g.final_total_by_seat[k], 0) / games.length)}`,
      );
      expect(v.stdout).toContain(`average final total by seat: ${seats.join('  ')}\n`);
    },
    T,
  );
});
