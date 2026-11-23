// Persisted document schemas (spec 06 FR-602, FR-603; VC-603 schema level, VC-604).
import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { getPreset, PRESET_IDS } from '@/src/domain/presets';
import type { GameState, SeatInfo } from '@/src/domain/types';
import { createGame, ENGINE_VERSION } from '@/src/engine/engine';
import { createPlayers } from '@/src/players/registry';
import { evaluate } from '@/src/score/score-engine';
import { runAiLoop } from '@/src/service/ai-loop';
import {
  CommitSchema,
  FinalScoresSchema,
  firstIssuePath,
  GameMetaSchema,
  HeadSchema,
  ScoreBoardSchema,
} from '@/src/state/schemas';
import { MemoryObjectStore } from '@/src/storage/memory-store';
import { CorruptObjectError, getJson, putJson } from '@/src/storage/object-store';

const g = 'abcdefghijklmnopqrstuvwxyz';
const HUMAN_HASH = 'ab'.repeat(32);

const seats: SeatInfo[] = [
  { seat: 0, playerId: 'p0', name: 'Ana', kind: 'human' },
  { seat: 1, playerId: 'ai-1', name: 'AI 1', kind: 'ai' },
  { seat: 2, playerId: 'ai-2', name: 'AI 2', kind: 'ai' },
];
const initial = createGame({
  gameId: g,
  rules: getPreset('argentina-fidepo'),
  seats,
  seed: 'test-seed',
});

type Doc = Record<string, unknown>;

function meta(): Doc {
  return {
    schemaVersion: 1,
    gameId: g,
    presetId: 'argentina-fidepo',
    engineVersion: ENGINE_VERSION,
    createdAt: '2026-11-23T14:05:00.000Z',
    seats: structuredClone(seats),
    seatTokenHashes: [HUMAN_HASH, null, null],
  };
}

function commit0(): Doc {
  const state = structuredClone(initial.state);
  return {
    schemaVersion: 1,
    version: 0,
    at: '2026-11-23T14:05:00.000Z',
    actorSeat: null,
    clientRequestId: null,
    events: structuredClone(initial.events),
    state,
    scoreboard: evaluate(state),
  };
}

function commit1(): Doc {
  const state: GameState = { ...structuredClone(initial.state), version: 1 };
  return {
    schemaVersion: 1,
    version: 1,
    at: '2026-11-23T14:06:00.000Z',
    actorSeat: 0,
    clientRequestId: 'req-1',
    events: [],
    state,
    scoreboard: evaluate(state),
  };
}

function head(): Doc {
  return { schemaVersion: 1, version: 5 };
}

function finalScores(): Doc {
  const board = evaluate(initial.state);
  return {
    schemaVersion: 1,
    gameId: g,
    version: 7,
    ranking: board.ranking,
    totals: board.totals,
    madeCount: board.madeCount,
    missedCount: board.missedCount,
  };
}

const SCHEMAS: [string, z.ZodType, () => Doc, string][] = [
  ['GameMeta', GameMetaSchema, meta, 'presetId'],
  ['Commit', CommitSchema, commit1, 'scoreboard'],
  ['Head', HeadSchema, head, 'version'],
  ['FinalScores', FinalScoresSchema, finalScores, 'ranking'],
];

let store: MemoryObjectStore;
beforeEach(() => {
  store = new MemoryObjectStore();
});

/** Stores `doc` and expects `getJson` with `schema` to reject with a schema `CorruptObjectError`. */
async function expectCorrupt(schema: z.ZodType, doc: unknown, issuePath: string): Promise<void> {
  await putJson(store, 'doc', doc, { mode: 'overwrite' });
  const error = await getJson(store, 'doc', schema).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CorruptObjectError);
  expect((error as CorruptObjectError).reason).toBe('schema');
  expect((error as CorruptObjectError).issuePath).toBe(issuePath);
}

describe('valid documents round-trip through getJson', () => {
  it.each([
    ['GameMeta', GameMetaSchema, meta],
    ['Commit v0', CommitSchema, commit0],
    ['Commit v1', CommitSchema, commit1],
    ['Head', HeadSchema, head],
    ['FinalScores', FinalScoresSchema, finalScores],
  ] as const)('%s', async (_name, schema, make) => {
    const doc = make();
    await putJson(store, 'doc', doc);
    expect(await getJson(store, 'doc', schema)).toEqual(doc);
  });

  it('accepts boundary values', () => {
    expect(
      GameMetaSchema.safeParse({ ...meta(), createdAt: '2026-11-23T23:59:59.999Z' }).success,
    ).toBe(true);
    expect(HeadSchema.safeParse({ schemaVersion: 1, version: 99999999 }).success).toBe(true);
    expect(CommitSchema.safeParse({ ...commit1(), clientRequestId: 'x'.repeat(128) }).success).toBe(
      true,
    );
    const allAi = { ...meta(), seats: seats.map((s) => ({ ...s, kind: 'ai' })) };
    expect(
      GameMetaSchema.safeParse({ ...allAi, seatTokenHashes: [null, null, null] }).success,
    ).toBe(true);
  });
});

describe('VC-603 every schema rejects schemaVersion 2, an extra key and a missing field', () => {
  describe.each(SCHEMAS)('%s', (_name, schema, make, requiredField) => {
    it('schemaVersion 2 → issuePath schemaVersion', async () => {
      await expectCorrupt(schema, { ...make(), schemaVersion: 2 }, 'schemaVersion');
    });

    it('an extra key → schema error at the root', async () => {
      await expectCorrupt(schema, { ...make(), extra: true }, '');
    });

    it(`missing ${requiredField} → issuePath ${requiredField}`, async () => {
      const doc = make();
      delete doc[requiredField];
      await expectCorrupt(schema, doc, requiredField);
    });
  });

  it('a strict nested object rejects an extra key (scoreboard.ranking[0])', async () => {
    const doc = commit1();
    const board = doc.scoreboard as { ranking: Doc[] };
    board.ranking[0].extra = 1;
    await expectCorrupt(CommitSchema, doc, 'scoreboard.ranking.0');
  });
});

describe('VC-603 GameMeta cross-field rules', () => {
  it('seats[1].seat = 2', async () => {
    const doc = meta();
    (doc.seats as SeatInfo[])[1].seat = 2;
    await expectCorrupt(GameMetaSchema, doc, 'seats.1.seat');
  });

  it('a hash on an AI seat', async () => {
    await expectCorrupt(
      GameMetaSchema,
      { ...meta(), seatTokenHashes: [HUMAN_HASH, HUMAN_HASH, null] },
      'seatTokenHashes.1',
    );
  });

  it('null on a human seat', async () => {
    await expectCorrupt(
      GameMetaSchema,
      { ...meta(), seatTokenHashes: [null, null, null] },
      'seatTokenHashes.0',
    );
  });

  it('an uppercase hash', async () => {
    await expectCorrupt(
      GameMetaSchema,
      { ...meta(), seatTokenHashes: ['AB'.repeat(32), null, null] },
      'seatTokenHashes.0',
    );
  });

  it('one hash too few', async () => {
    await expectCorrupt(
      GameMetaSchema,
      { ...meta(), seatTokenHashes: [HUMAN_HASH, null] },
      'seatTokenHashes',
    );
  });

  it("createdAt '2026-11-23T14:05:00Z' (no milliseconds)", async () => {
    await expectCorrupt(
      GameMetaSchema,
      { ...meta(), createdAt: '2026-11-23T14:05:00Z' },
      'createdAt',
    );
  });

  it("createdAt '2026-02-30T00:00:00.000Z' (not a calendar date)", async () => {
    await expectCorrupt(
      GameMetaSchema,
      { ...meta(), createdAt: '2026-02-30T00:00:00.000Z' },
      'createdAt',
    );
  });

  it('an invalid gameId', async () => {
    await expectCorrupt(GameMetaSchema, { ...meta(), gameId: 'BAD' }, 'gameId');
  });

  it('engineVersion 0', async () => {
    await expectCorrupt(GameMetaSchema, { ...meta(), engineVersion: 0 }, 'engineVersion');
  });
});

describe('VC-603 Commit cross-field rules', () => {
  it('v1 with actorSeat null', async () => {
    await expectCorrupt(CommitSchema, { ...commit1(), actorSeat: null }, 'actorSeat');
  });

  it('v1 with clientRequestId null', async () => {
    await expectCorrupt(CommitSchema, { ...commit1(), clientRequestId: null }, 'clientRequestId');
  });

  it('v0 with a clientRequestId', async () => {
    await expectCorrupt(
      CommitSchema,
      { ...commit0(), clientRequestId: 'req-0' },
      'clientRequestId',
    );
  });

  it('v0 with an actorSeat', async () => {
    await expectCorrupt(CommitSchema, { ...commit0(), actorSeat: 0 }, 'actorSeat');
  });

  it('a clientRequestId of 129 chars', async () => {
    await expectCorrupt(
      CommitSchema,
      { ...commit1(), clientRequestId: 'x'.repeat(129) },
      'clientRequestId',
    );
  });

  it("an empty clientRequestId ''", async () => {
    await expectCorrupt(CommitSchema, { ...commit1(), clientRequestId: '' }, 'clientRequestId');
  });

  it('version 100000000', async () => {
    await expectCorrupt(CommitSchema, { ...commit1(), version: 100000000 }, 'version');
  });

  it("at '2026-11-23T14:05:00.000+00:00'", async () => {
    await expectCorrupt(CommitSchema, { ...commit1(), at: '2026-11-23T14:05:00.000+00:00' }, 'at');
  });
});

describe('VC-603 Head and FinalScores rules', () => {
  it('head version 100000000', async () => {
    await expectCorrupt(HeadSchema, { schemaVersion: 1, version: 100000000 }, 'version');
  });

  it('head version 1.5', async () => {
    await expectCorrupt(HeadSchema, { schemaVersion: 1, version: 1.5 }, 'version');
  });

  it("final totals 'x'", async () => {
    await expectCorrupt(FinalScoresSchema, { ...finalScores(), totals: 'x' }, 'totals');
  });

  it('final version -1', async () => {
    await expectCorrupt(FinalScoresSchema, { ...finalScores(), version: -1 }, 'version');
  });
});

describe('firstIssuePath', () => {
  it('joins the first issue path with dots, or gives (root)', () => {
    const nested = CommitSchema.safeParse({ ...commit1(), clientRequestId: '' });
    expect(nested.success).toBe(false);
    expect(firstIssuePath(nested.error!)).toBe('clientRequestId');
    const root = HeadSchema.safeParse('not an object');
    expect(firstIssuePath(root.error!)).toBe('(root)');
    const indexed = GameMetaSchema.safeParse({ ...meta(), seatTokenHashes: [null, null, null] });
    expect(firstIssuePath(indexed.error!)).toBe('seatTokenHashes.0');
  });
});

describe('VC-604 ScoreBoardSchema parses evaluate(state) over a full all-AI game per preset', () => {
  it.each(PRESET_IDS)('%s', (id) => {
    const aiSeats: SeatInfo[] = [0, 1, 2].map((i) => ({
      seat: i,
      playerId: `ai-${i}`,
      name: `AI ${i}`,
      kind: 'ai',
    }));
    const start = createGame({
      gameId: g,
      rules: getPreset(id),
      seats: aiSeats,
      seed: `vc604-${id}`,
    });
    const states: GameState[] = [start.state];
    const result = runAiLoop(start.state, createPlayers(aiSeats), {
      maxMoves: 100_000,
      onTransition: (_prev, transition) => states.push(transition.state),
    });
    expect(result.state.phase).toBe('game-over');
    expect(states.length).toBe(result.moves + 1);
    for (const state of states) {
      const board = evaluate(state);
      expect(ScoreBoardSchema.parse(board)).toEqual(board);
    }
  });
});
