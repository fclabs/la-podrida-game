// Request and response schemas of the HTTP API (spec FR-803, FR-804, Data & Interfaces; plan P-4,
// P-5, P-10). Request schemas are strict and run in handlers; response schemas are strict at every
// object level and are used by tests only (handlers never parse responses).
import { z } from 'zod';
import { CardSchema, GameEventSchema, PresetIdSchema, TrickPlaySchema } from '@/src/domain/schemas';
import type { PlayerUpdate } from '@/src/domain/types';
import { GAME_ID_PATTERN, MAX_COMMIT_VERSION } from '@/src/state/keys';
import { ScoreBoardSchema } from '@/src/state/schemas';
import { ERROR_CODES, RequestError } from './errors';

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

const MAX_HUMAN_NAME = 40;
const MAX_MOVE_ID = 32;
const MAX_CLIENT_REQUEST_ID = 128;

/** `POST /api/games`. `humanName` is passed on untrimmed; the service trims it. */
export const CreateGameBodySchema = z.strictObject({
  humanName: z.string().refine((s) => {
    const t = s.trim();
    return t.length >= 1 && t.length <= MAX_HUMAN_NAME;
  }),
  aiCount: z.int().min(2).max(5),
  rulesPreset: PresetIdSchema.optional(),
});

/** `POST /api/games/{id}/moves`. */
export const SubmitMoveBodySchema = z.strictObject({
  version: z
    .int()
    .min(0)
    .max(MAX_COMMIT_VERSION - 1),
  moveId: z.string().min(1).max(MAX_MOVE_ID),
  clientRequestId: z.string().min(1).max(MAX_CLIENT_REQUEST_ID),
});

/**
 * Parses `value` with `schema`, or throws a 400 `RequestError` naming the field of the first Zod
 * issue: the first unknown key of an `unrecognized_keys` issue, else the issue's top-level path
 * segment (none when the path is empty).
 */
export function parseBody<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const field =
    issue === undefined
      ? ''
      : issue.code === 'unrecognized_keys'
        ? (issue.keys[0] ?? '')
        : String(issue.path[0] ?? '');
  throw new RequestError(400, 'invalid_request', field === '' ? undefined : field);
}

const SINCE = /^(0|[1-9][0-9]{0,7})$/;

/**
 * The `since` query parameter: `undefined` when absent; else it must appear once, be a canonical
 * decimal and be at most `MAX_COMMIT_VERSION` → otherwise a 400 `RequestError` naming `since`.
 */
export function parseSince(url: URL): number | undefined {
  const values = url.searchParams.getAll('since');
  if (values.length === 0) return undefined;
  const [value] = values;
  if (values.length > 1 || !SINCE.test(value)) {
    throw new RequestError(400, 'invalid_request', 'since');
  }
  const since = Number(value);
  if (since > MAX_COMMIT_VERSION) throw new RequestError(400, 'invalid_request', 'since');
  return since;
}

// ---------------------------------------------------------------------------------------------
// Responses (test-time contract)
// ---------------------------------------------------------------------------------------------

const nonNegativeInt = z.int().min(0);
const rankingSchema = z.array(
  z.strictObject({ seat: nonNegativeInt, total: z.number(), place: z.int().min(1) }),
);

const MoveSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bid'), seat: nonNegativeInt, tricks: nonNegativeInt }),
  z.strictObject({ type: z.literal('play'), seat: nonNegativeInt, card: CardSchema }),
]);

const LegalMoveSchema = z.strictObject({ id: z.string(), move: MoveSchema });

/** The domain `PlayerView` (= `TableView` + scoreboard + optional final ranking), field for field. */
const PlayerViewSchema = z.strictObject({
  gameId: z.string(),
  version: nonNegativeInt,
  phase: z.enum(['bidding', 'playing', 'game-over']),
  you: nonNegativeInt.nullable(),
  seats: z.array(
    z.strictObject({
      seat: nonNegativeInt,
      name: z.string(),
      kind: z.enum(['human', 'ai']),
      cardCount: nonNegativeInt,
      bid: nonNegativeInt.nullable(),
      tricksWon: nonNegativeInt,
    }),
  ),
  handIndex: nonNegativeInt,
  handPlan: z.array(z.int().min(1)),
  dealer: nonNegativeInt,
  toAct: nonNegativeInt.nullable(),
  trumpCard: CardSchema.nullable(),
  trumpCardInDealerHand: z.boolean(),
  yourHand: z.array(CardSchema),
  currentTrick: z.array(TrickPlaySchema),
  lastTrick: z.strictObject({ winner: nonNegativeInt, plays: z.array(TrickPlaySchema) }).nullable(),
  scoreboard: ScoreBoardSchema,
  finalRanking: rankingSchema.optional(),
});

/** A `PlayerUpdate`, strict at every object level. */
export const PlayerUpdateResponseSchema = z.strictObject({
  version: nonNegativeInt,
  events: z.array(GameEventSchema),
  view: PlayerViewSchema,
  legalMoves: z.array(LegalMoveSchema),
});

// Compile-time check: the schema's inferred type is exactly the domain `PlayerUpdate`.
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Check = Expect<Equal<z.infer<typeof PlayerUpdateResponseSchema>, PlayerUpdate>>;

/** The 201 body of `POST /api/games`. */
export const CreateGameResponseSchema = z.strictObject({
  gameId: z.string().regex(GAME_ID_PATTERN),
  seat: nonNegativeInt,
  seatToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  update: PlayerUpdateResponseSchema,
});

/** Every error body; `update` only on a 409. */
export const ErrorResponseSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(ERROR_CODES), message: z.string().min(1) }),
  update: PlayerUpdateResponseSchema.optional(),
});

/** The 200 body of `GET /api/presets`. */
export const PresetsResponseSchema = z.strictObject({
  defaultPresetId: PresetIdSchema,
  presets: z.array(
    z.strictObject({
      id: PresetIdSchema,
      name: z.string().min(1),
      description: z.string().min(1).max(200),
      players: z.strictObject({ min: z.int().min(2), max: z.int().min(2) }),
      deck: z.enum(['french-52', 'spanish-40']),
    }),
  ),
});
