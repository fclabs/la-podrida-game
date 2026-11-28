// `validate` (spec 12 FR-1221..1223): checks a dataset and prints the distribution report.
//
// Shard files are streamed (`createReadStream` -> `createGunzip` -> `readline`), one line at a time;
// only one shard's `games` and `hands` rows and the move ids of replay-sampled games are held in
// memory. Checks 1 and 2 run over the whole manifest first; checks 3-7 then run shard by shard,
// and inside a shard the failure of the lowest check number is the one reported.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import type { z } from 'zod';
import { getPreset } from '@/src/domain/presets';
import type { RuleSet } from '@/src/domain/rules';
import { expandHandSequence } from '@/src/engine/sequence';
import { scoreHand } from '@/src/score/score-engine';
import { GameFailure, replayAgainst } from './game';
import { MANIFEST_FILE, SHARD_TABLES, type ShardTable, readManifest } from './manifest';
import { createReportAccumulator, formatReport } from './report';
import {
  DecisionRowSchema,
  type GamesRow,
  GamesRowSchema,
  type HandsRow,
  HandsRowSchema,
  type CompleteShardEntry,
} from './schema';
import type { ValidateOptions } from './args';

export const CHECK_NAMES = [
  'manifest',
  'files',
  'rows',
  'join',
  'decisions per game',
  'labels',
  'replay',
] as const;

/** A failed check of FR-1221: `check` is 1-7; `message` is the line without `generate-data: `. */
export class ValidationError extends Error {
  readonly check: number;

  constructor(check: number, detail: string) {
    super(`validate: check ${check} (${CHECK_NAMES[check - 1]}): ${detail}`);
    this.name = 'ValidationError';
    this.check = check;
  }
}

export interface ValidateResult {
  exitCode: 0 | 1;
}

/** The decompressed lines of a gzip file, streamed. Rejects on a missing or corrupt file. */
async function* readLines(file: string): AsyncGenerator<string> {
  const source = createReadStream(file);
  const gunzip = createGunzip();
  source.on('error', (error) => gunzip.destroy(error));
  source.pipe(gunzip);
  const lines = createInterface({ input: gunzip, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield line;
  } finally {
    lines.close();
    source.destroy();
  }
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const issues = (error as { issues?: z.core.$ZodIssue[] }).issues;
    if (issues !== undefined && issues.length > 0) {
      const first = issues[0];
      const where = first.path.length > 0 ? `${first.path.join('.')}: ` : '';
      return `${where}${first.message}`.split('\n')[0];
    }
    return error.message.split('\n')[0];
  }
  return String(error);
}

/** Check 2 for one shard: the three files exist with the manifest's bytes, SHA-256 and rows. */
async function checkFiles(runDir: string, entry: CompleteShardEntry): Promise<void> {
  for (const table of SHARD_TABLES) {
    const expected = entry.files[table];
    const label = `shard ${entry.shard} ${table}`;
    const file = path.join(runDir, expected.path);
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      throw new ValidationError(2, `${label}: file ${expected.path} is missing`);
    }
    if (size !== expected.bytes) {
      throw new ValidationError(2, `${label}: ${size} bytes, manifest says ${expected.bytes}`);
    }
    const sha = await sha256Of(file);
    if (sha !== expected.sha256) {
      throw new ValidationError(2, `${label}: SHA-256 ${sha} differs from the manifest`);
    }
    let rows = 0;
    try {
      for await (const line of readLines(file)) {
        void line;
        rows += 1;
      }
    } catch (error) {
      throw new ValidationError(2, `${label}: cannot be read (${describeError(error)})`);
    }
    if (rows !== expected.rows) {
      throw new ValidationError(2, `${label}: ${rows} rows, manifest says ${expected.rows}`);
    }
  }
}

/** Streams a shard table, parsing each line with `schema` (check 3). */
async function* parsedRows<T>(
  runDir: string,
  entry: CompleteShardEntry,
  table: ShardTable,
  schema: z.ZodType<T>,
): AsyncGenerator<T> {
  const label = `shard ${entry.shard} ${table}`;
  let lineNo = 0;
  try {
    for await (const line of readLines(path.join(runDir, entry.files[table].path))) {
      lineNo += 1;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch (error) {
        throw new ValidationError(3, `${label} line ${lineNo}: ${describeError(error)}`);
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new ValidationError(3, `${label} line ${lineNo}: ${describeError(parsed.error)}`);
      }
      yield parsed.data;
    }
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError(3, `${label}: cannot be read (${describeError(error)})`);
  }
}

/** Index of a game within its shard: the last segment of the seed `<run_id>-<shard>-<index>`. */
function gameIndexOf(seed: string): number | null {
  const match = /-\d+-(\d+)$/.exec(seed);
  return match === null ? null : Number(match[1]);
}

/** The first failure per check number, so the lowest-numbered one can be reported at shard end. */
class Failures {
  private readonly byCheck = new Map<number, ValidationError>();

  add(check: number, detail: string): void {
    if (!this.byCheck.has(check)) this.byCheck.set(check, new ValidationError(check, detail));
  }

  first(): ValidationError | undefined {
    const check = Math.min(...this.byCheck.keys());
    return this.byCheck.get(check);
  }
}

interface GameState {
  game: GamesRow;
  hands: HandsRow[];
  decisions: number;
  moveIds: string[] | null;
}

/** Checks 3-7 for one complete shard; feeds the report accumulator. */
async function checkShard(
  runDir: string,
  entry: CompleteShardEntry,
  replayEvery: number,
  report: ReturnType<typeof createReportAccumulator>,
): Promise<void> {
  const failures = new Failures();
  const games = new Map<string, GameState>();
  const where = `shard ${entry.shard}`;

  for await (const game of parsedRows(runDir, entry, 'games', GamesRowSchema)) {
    if (games.has(game.game_id)) failures.add(4, `${where}: duplicate game ${game.game_id}`);
    const index = gameIndexOf(game.seed);
    const sampled = index !== null && index % replayEvery === 0;
    games.set(game.game_id, { game, hands: [], decisions: 0, moveIds: sampled ? [] : null });
  }

  for await (const hand of parsedRows(runDir, entry, 'hands', HandsRowSchema)) {
    const state = games.get(hand.game_id);
    if (state === undefined) {
      failures.add(4, `${where}: hands row for unknown game ${hand.game_id}`);
      continue;
    }
    state.hands.push(hand);
  }

  for await (const row of parsedRows(runDir, entry, 'decisions', DecisionRowSchema)) {
    const state = games.get(row.game_id);
    if (state === undefined) {
      failures.add(4, `${where}: decisions row for unknown game ${row.game_id}`);
      continue;
    }
    state.decisions += 1;
    state.moveIds?.push(row.chosen_move_id);
    const hand = state.hands.find((h) => h.hand_index === row.hand_index);
    const tag = `${where} game ${row.game_id} step ${row.step}`;
    if (hand === undefined) {
      failures.add(6, `${tag}: no hands row for hand ${row.hand_index}`);
      continue;
    }
    const s = row.seat;
    if (
      row.hand_bid !== hand.bid_by_seat[s] ||
      row.hand_tricks_won !== hand.tricks_won_by_seat[s] ||
      row.hand_made !== hand.made_by_seat[s] ||
      row.hand_points !== hand.points_by_seat[s]
    ) {
      failures.add(6, `${tag}: hand_* labels differ from the hands row (hand ${row.hand_index})`);
    }
    if (
      row.final_total !== state.game.final_total_by_seat[s] ||
      row.final_place !== state.game.final_place_by_seat[s]
    ) {
      failures.add(6, `${tag}: final_total/final_place differ from the games row`);
    }
  }

  for (const state of games.values()) {
    const { game } = state;
    const id = `${where} game ${game.game_id}`;
    if (state.hands.length !== game.n_hands) {
      failures.add(4, `${id}: ${state.hands.length} hands rows, n_hands is ${game.n_hands}`);
    }
    let handPlan: number[] = [];
    let rules: RuleSet | null = null;
    try {
      rules = getPreset(game.preset);
      handPlan = expandHandSequence(rules, game.n_players);
    } catch (error) {
      failures.add(5, `${id}: no hand plan for ${game.preset} (${describeError(error)})`);
    }
    if (handPlan.length > 0) {
      if (handPlan.length !== game.n_hands) {
        failures.add(5, `${id}: n_hands is ${game.n_hands}, the hand plan has ${handPlan.length}`);
      }
      const expected = game.n_players * (game.n_hands + handPlan.reduce((a, b) => a + b, 0));
      if (state.decisions !== expected) {
        failures.add(5, `${id}: ${state.decisions} decisions rows, expected ${expected}`);
      }
    }
    for (const hand of state.hands) {
      const tag = `${id} hand ${hand.hand_index}`;
      const tricks = hand.tricks_won_by_seat.reduce((a, b) => a + b, 0);
      if (tricks !== hand.cards_dealt) {
        failures.add(6, `${tag}: ${tricks} tricks won, ${hand.cards_dealt} cards dealt`);
      }
      if (rules !== null) {
        try {
          const scored = scoreHand(rules, {
            handIndex: hand.hand_index,
            cardsPerPlayer: hand.cards_dealt,
            dealer: hand.dealer,
            trumpSuit: hand.trump_card.slice(-1),
            bids: hand.bid_by_seat,
            tricks: hand.tricks_won_by_seat,
          });
          for (const p of scored.perSeat) {
            const k = p.seat;
            if (
              hand.bid_by_seat[k] !== p.bid ||
              hand.tricks_won_by_seat[k] !== p.tricks ||
              hand.made_by_seat[k] !== p.made ||
              hand.points_by_seat[k] !== p.points
            ) {
              failures.add(6, `${tag} seat ${k}: differs from the score engine`);
            }
          }
        } catch (error) {
          failures.add(6, `${tag}: cannot be scored (${describeError(error)})`);
        }
      }
    }
    for (let k = 0; k < game.n_players; k++) {
      const sum = state.hands.reduce((a, h) => a + (h.points_by_seat[k] ?? 0), 0);
      if (sum !== game.final_total_by_seat[k]) {
        failures.add(
          6,
          `${id} seat ${k}: hands points sum to ${sum}, final total is ${game.final_total_by_seat[k]}`,
        );
      }
    }
  }

  const failure = failures.first();
  if (failure !== undefined) throw failure;

  for (const state of games.values()) {
    if (state.moveIds === null) continue;
    try {
      replayAgainst({
        preset: state.game.preset,
        strategies: state.game.strategy_by_seat,
        seed: state.game.seed,
        recordedMoveIds: state.moveIds,
        recordedTotals: state.game.final_total_by_seat,
        fail: (message) => {
          throw new GameFailure(state.game.seed, message);
        },
      });
    } catch (error) {
      throw new ValidationError(7, `${where} game ${state.game.game_id}: ${describeError(error)}`);
    }
  }

  for (const state of games.values()) {
    report.addGame(state.game, state.decisions);
    for (const hand of state.hands) report.addHand(hand);
  }
}

/**
 * Validates `<out>/<run_id>`. Failures print one `generate-data: …` line on stderr, the report goes
 * to stdout only when the checks pass (status `OK`, or `INCOMPLETE` for a run with `pending` or
 * `failed` shards, whose complete shards pass); exit code 1 unless the status is `OK`.
 */
export async function executeValidate(
  options: ValidateOptions,
  io: { out?: (text: string) => void; err?: (text: string) => void } = {},
): Promise<ValidateResult> {
  const out = io.out ?? ((text) => void process.stdout.write(text));
  const err = io.err ?? ((text) => void process.stderr.write(text));
  const runDir = path.join(options.out, options.run_id);

  try {
    await stat(path.join(runDir, MANIFEST_FILE));
  } catch {
    err(`generate-data: no run "${options.run_id}" in ${options.out}\n`);
    return { exitCode: 1 };
  }

  try {
    let manifest;
    try {
      manifest = await readManifest(runDir);
    } catch (error) {
      throw new ValidationError(1, `${MANIFEST_FILE}: ${describeError(error)}`);
    }
    const complete = manifest.shards.filter(
      (s): s is CompleteShardEntry => s.status === 'complete',
    );
    for (const entry of complete) await checkFiles(runDir, entry);
    const report = createReportAccumulator();
    for (const entry of complete) {
      await checkShard(runDir, entry, manifest.params.replay_every, report);
    }
    const status = complete.length === manifest.shards.length ? 'OK' : 'INCOMPLETE';
    out(formatReport(options.run_id, status, report.stats()));
    return { exitCode: status === 'OK' ? 0 : 1 };
  } catch (error) {
    if (error instanceof ValidationError) {
      err(`generate-data: ${error.message}\n`);
      return { exitCode: 1 };
    }
    throw error;
  }
}
