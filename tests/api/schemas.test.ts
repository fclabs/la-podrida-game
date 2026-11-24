// Request and response schemas, `since` and preset labels (spec FR-803, FR-804, FR-811, Data &
// Interfaces; plan P-4, P-5, P-9, P-10). VC-805, VC-806, VC-808, VC-809 at the parser level.
import { describe, expect, it } from 'vitest';
import { RequestError } from '@/app/api/_lib/errors';
import { PRESET_LABELS } from '@/app/api/_lib/presets';
import {
  CreateGameBodySchema,
  CreateGameResponseSchema,
  ErrorResponseSchema,
  parseBody,
  parseSince,
  PlayerUpdateResponseSchema,
  PresetsResponseSchema,
  SubmitMoveBodySchema,
} from '@/app/api/_lib/schemas';
import { getPreset, PRESET_IDS } from '@/src/domain/presets';
import { MAX_COMMIT_VERSION } from '@/src/state/keys';
import { makeService } from '../unit/service/support/service-fixtures';

function fieldOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(RequestError);
    const e = err as RequestError;
    expect(e.status).toBe(400);
    expect(e.code).toBe('invalid_request');
    return e.field;
  }
  throw new Error('expected a RequestError');
}

const CREATE = { humanName: 'Ana', aiCount: 3 };
const MOVE = { version: 0, moveId: 'bid:1', clientRequestId: 'req-1' };

describe('VC-805: unknown fields are named', () => {
  it.each([
    ['seed', CreateGameBodySchema, { ...CREATE, seed: 'x' }],
    ['foo', CreateGameBodySchema, { ...CREATE, foo: 1 }],
    ['bar', SubmitMoveBodySchema, { ...MOVE, bar: true }],
  ] as const)('%s', (key, schema, body) => {
    expect(fieldOf(() => parseBody(schema, body))).toBe(key);
  });
});

describe('VC-806: create body boundaries', () => {
  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['41 characters', 'a'.repeat(41)],
    ['41 characters after trim', ` ${'a'.repeat(41)} `],
  ])('humanName %s → humanName', (_name, humanName) => {
    expect(fieldOf(() => parseBody(CreateGameBodySchema, { ...CREATE, humanName }))).toBe(
      'humanName',
    );
  });

  it('humanName of 40 characters after trim → ok, passed on untrimmed', () => {
    const humanName = `  ${'a'.repeat(40)}  `;
    expect(parseBody(CreateGameBodySchema, { ...CREATE, humanName })).toEqual({
      ...CREATE,
      humanName,
    });
  });

  it.each([
    ['1', 1],
    ['6', 6],
    ['2.5', 2.5],
    ["'3'", '3'],
    ['missing', undefined],
  ])('aiCount %s → aiCount', (_name, aiCount) => {
    expect(fieldOf(() => parseBody(CreateGameBodySchema, { ...CREATE, aiCount }))).toBe('aiCount');
  });

  it.each([2, 5])('aiCount %d → ok', (aiCount) => {
    expect(parseBody(CreateGameBodySchema, { ...CREATE, aiCount }).aiCount).toBe(aiCount);
  });

  it("rulesPreset 'nope' → rulesPreset", () => {
    expect(fieldOf(() => parseBody(CreateGameBodySchema, { ...CREATE, rulesPreset: 'nope' }))).toBe(
      'rulesPreset',
    );
  });

  it.each(PRESET_IDS)('rulesPreset %s → ok', (rulesPreset) => {
    expect(parseBody(CreateGameBodySchema, { ...CREATE, rulesPreset }).rulesPreset).toBe(
      rulesPreset,
    );
  });

  it('an empty object names the first missing field', () => {
    expect(fieldOf(() => parseBody(CreateGameBodySchema, {}))).toBe('humanName');
  });

  it('a non-object value → no field', () => {
    expect(fieldOf(() => parseBody(CreateGameBodySchema, null))).toBeUndefined();
  });
});

describe('VC-808: move body boundaries', () => {
  it.each([
    ['-1', -1],
    ['1.5', 1.5],
    ['MAX_COMMIT_VERSION', MAX_COMMIT_VERSION],
    ["'0'", '0'],
  ])('version %s → version', (_name, version) => {
    expect(fieldOf(() => parseBody(SubmitMoveBodySchema, { ...MOVE, version }))).toBe('version');
  });

  it('version MAX_COMMIT_VERSION − 1 → ok', () => {
    const version = MAX_COMMIT_VERSION - 1;
    expect(parseBody(SubmitMoveBodySchema, { ...MOVE, version }).version).toBe(version);
  });

  it.each([
    ['moveId', ''],
    ['moveId', 'm'.repeat(33)],
    ['clientRequestId', ''],
    ['clientRequestId', 'c'.repeat(129)],
  ])('%s of length %#', (field, value) => {
    expect(fieldOf(() => parseBody(SubmitMoveBodySchema, { ...MOVE, [field]: value }))).toBe(field);
  });

  it('moveId of 32 and clientRequestId of 128 characters → ok', () => {
    const body = { version: 3, moveId: 'm'.repeat(32), clientRequestId: 'c'.repeat(128) };
    expect(parseBody(SubmitMoveBodySchema, body)).toEqual(body);
  });
});

describe('VC-809: parseSince', () => {
  const url = (query: string) => new URL(`http://localhost/api/games/x${query}`);

  it.each([
    ['empty', '?since='],
    ['-1', '?since=-1'],
    ['1.5', '?since=1.5'],
    ['abc', '?since=abc'],
    ['leading zero', '?since=01'],
    ['100000000', '?since=100000000'],
    ['repeated', '?since=0&since=0'],
    ['plus sign', '?since=%2B1'],
    ['spaces', '?since=%201'],
  ])('%s → since', (_name, query) => {
    expect(fieldOf(() => parseSince(url(query)))).toBe('since');
  });

  it('0 and 99999999 → numbers', () => {
    expect(parseSince(url('?since=0'))).toBe(0);
    expect(parseSince(url('?since=99999999'))).toBe(99_999_999);
    expect(MAX_COMMIT_VERSION).toBe(99_999_999);
  });

  it('absent → undefined; other parameters are ignored', () => {
    expect(parseSince(url(''))).toBeUndefined();
    expect(parseSince(url('?foo=bar'))).toBeUndefined();
    expect(parseSince(url('?foo=bar&since=7'))).toBe(7);
  });
});

describe('P-10: response schemas', () => {
  async function created() {
    const { service } = makeService();
    return service.createGame({ humanName: 'Ana', aiCount: 3 });
  }

  it('a real create result parses with CreateGameResponseSchema and its update with PlayerUpdateResponseSchema', async () => {
    const result = await created();
    expect(CreateGameResponseSchema.safeParse(result).success).toBe(true);
    expect(PlayerUpdateResponseSchema.safeParse(result.update).success).toBe(true);
  });

  it('a real game-over update parses (finalRanking present)', async () => {
    const { service } = makeService();
    const result = await service.createGame({
      humanName: 'Ana',
      aiCount: 2,
      rulesPreset: 'gamerules',
    });
    let update = result.update;
    let n = 0;
    while (update.view.phase !== 'game-over') {
      update = await service.submitMove(result.gameId, result.seatToken, {
        version: update.version,
        moveId: update.legalMoves[0].id,
        clientRequestId: `r${n++}`,
      });
      expect(PlayerUpdateResponseSchema.safeParse(update).success).toBe(true);
    }
    expect(update.view.finalRanking).toBeDefined();
  });

  it.each([
    ['the top level', (u: Record<string, unknown>) => ({ ...u, seed: 'x' })],
    [
      'view',
      (u: Record<string, unknown>) => ({ ...u, view: { ...(u.view as object), seed: 'x' } }),
    ],
    [
      'view.seats[0]',
      (u: Record<string, unknown>) => {
        const view = u.view as { seats: object[] };
        return {
          ...u,
          view: { ...view, seats: [{ ...view.seats[0], seed: 'x' }, ...view.seats.slice(1)] },
        };
      },
    ],
  ])('an extra seed key at %s is rejected', async (_name, inject) => {
    const { update } = await created();
    const tampered = inject(update as unknown as Record<string, unknown>);
    expect(PlayerUpdateResponseSchema.safeParse(tampered).success).toBe(false);
    expect(
      ErrorResponseSchema.safeParse({
        error: { code: 'version_conflict', message: 'm' },
        update: tampered,
      }).success,
    ).toBe(false);
  });

  it.each(['hands', 'stock', 'aiDecisionCount', 'seatTokenHashes'])(
    'an extra %s key in view is rejected',
    async (key) => {
      const { update } = await created();
      expect(
        PlayerUpdateResponseSchema.safeParse({ ...update, view: { ...update.view, [key]: [] } })
          .success,
      ).toBe(false);
    },
  );

  it('CreateGameResponseSchema rejects an extra key and a malformed token', async () => {
    const result = await created();
    expect(CreateGameResponseSchema.safeParse({ ...result, seed: 'x' }).success).toBe(false);
    expect(CreateGameResponseSchema.safeParse({ ...result, seatToken: 'short' }).success).toBe(
      false,
    );
  });

  it('ErrorResponseSchema: strict, known codes only', () => {
    expect(
      ErrorResponseSchema.safeParse({ error: { code: 'internal', message: 'Internal error' } })
        .success,
    ).toBe(true);
    expect(ErrorResponseSchema.safeParse({ error: { code: 'nope', message: 'x' } }).success).toBe(
      false,
    );
    expect(
      ErrorResponseSchema.safeParse({ error: { code: 'internal', message: 'x', stack: 's' } })
        .success,
    ).toBe(false);
    expect(
      ErrorResponseSchema.safeParse({ error: { code: 'internal', message: 'x' }, detail: 1 })
        .success,
    ).toBe(false);
  });

  it('PresetsResponseSchema accepts the P-9 body built from PRESET_LABELS', () => {
    const body = {
      defaultPresetId: 'argentina-fidepo',
      presets: PRESET_IDS.map((id) => ({
        id,
        ...PRESET_LABELS[id],
        players: { ...getPreset(id).players },
        deck: getPreset(id).deck.id,
      })),
    };
    expect(PresetsResponseSchema.safeParse(body).success).toBe(true);
    expect(PresetsResponseSchema.safeParse({ ...body, extra: 1 }).success).toBe(false);
    const withRules = { ...body, presets: [{ ...body.presets[0], rules: {} }] };
    expect(PresetsResponseSchema.safeParse(withRules).success).toBe(false);
  });
});

describe('P-9: PRESET_LABELS', () => {
  const NAMES = {
    'argentina-fidepo': 'Argentina (F.I.DE.PO.)',
    'spain-ludoteka': 'Spain (Ludoteka)',
    gamerules: 'GameRules',
    'mexico-bazas': 'Mexico (Bazas)',
  };

  it('has exactly the PRESET_IDS keys', () => {
    expect(Object.keys(PRESET_LABELS).sort()).toEqual([...PRESET_IDS].sort());
  });

  it.each(PRESET_IDS)('%s: FR-811 name, 1–200 char one-sentence description', (id) => {
    const { name, description } = PRESET_LABELS[id];
    expect(name).toBe(NAMES[id]);
    expect(description.length).toBeGreaterThanOrEqual(1);
    expect(description.length).toBeLessThanOrEqual(200);
    expect(description.endsWith('.')).toBe(true);
    expect(Object.keys(PRESET_LABELS[id]).sort()).toEqual(['description', 'name']);
  });
});
