import { z } from 'zod';
import {
  GameEventSchema,
  GameStateSchema,
  PresetIdSchema,
  SeatInfoSchema,
} from '@/src/domain/schemas';
import { GAME_ID_PATTERN, MAX_COMMIT_VERSION } from './keys';

/*
 * Strict, versioned schemas of every persisted game document (architecture §6.2). Unknown keys are
 * rejected at every level, every document carries `schemaVersion: 1`, and the cross-field rules are
 * schema refinements, so they apply to every read and every write.
 */

const SEAT_TOKEN_HASH = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** True iff `value` is exactly what `Date#toISOString` returns for some date. */
function isIsoTimestamp(value: string): boolean {
  if (!ISO_TIMESTAMP.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

const nonNegativeInt = z.int().min(0);
const commitVersion = z.int().min(0).max(MAX_COMMIT_VERSION);
const gameId = z.string().regex(GAME_ID_PATTERN, { message: 'Invalid game id' });
const isoTimestamp = z.string().refine(isIsoTimestamp, { message: 'Not a toISOString timestamp' });

/** The domain `ScoreBoard`, field for field (`live` optional). Strict at every level. */
export const ScoreBoardSchema = z.strictObject({
  hands: z.array(
    z.strictObject({
      handIndex: nonNegativeInt,
      perSeat: z.array(
        z.strictObject({
          seat: nonNegativeInt,
          bid: nonNegativeInt,
          tricks: nonNegativeInt,
          made: z.boolean(),
          points: z.number(),
        }),
      ),
    }),
  ),
  totals: z.array(z.number()),
  madeCount: z.array(nonNegativeInt),
  missedCount: z.array(nonNegativeInt),
  live: z
    .array(
      z.strictObject({
        seat: nonNegativeInt,
        bid: nonNegativeInt.nullable(),
        tricksWon: nonNegativeInt,
        status: z.enum(['on-track', 'made-so-far', 'busted']),
      }),
    )
    .optional(),
  ranking: z.array(
    z.strictObject({ seat: nonNegativeInt, total: z.number(), place: z.int().min(1) }),
  ),
});

/**
 * `games/{gameId}/meta.json`. Rules: `seats[i].seat === i`; one seat-token hash per seat, a
 * 64-char lowercase hex string for a human seat and `null` for an AI seat.
 */
export const GameMetaSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    gameId,
    presetId: PresetIdSchema,
    engineVersion: z.int().min(1),
    createdAt: isoTimestamp,
    seats: z.array(SeatInfoSchema),
    seatTokenHashes: z.array(z.string().nullable()),
  })
  .superRefine((meta, ctx) => {
    meta.seats.forEach((seat, i) => {
      if (seat.seat !== i) {
        ctx.addIssue({ code: 'custom', message: 'Seat out of order', path: ['seats', i, 'seat'] });
      }
    });
    if (meta.seatTokenHashes.length !== meta.seats.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'One seat-token hash per seat',
        path: ['seatTokenHashes'],
      });
    }
    const count = Math.min(meta.seats.length, meta.seatTokenHashes.length);
    for (let i = 0; i < count; i++) {
      const hash = meta.seatTokenHashes[i];
      const ok =
        meta.seats[i].kind === 'human'
          ? hash !== null && SEAT_TOKEN_HASH.test(hash)
          : hash === null;
      if (!ok) {
        ctx.addIssue({
          code: 'custom',
          message: 'Seat-token hash does not fit the seat kind',
          path: ['seatTokenHashes', i],
        });
      }
    }
  });

/**
 * `games/{gameId}/commits/{version:08d}.json`. Rules: `actorSeat` and `clientRequestId` are both
 * `null` at version 0 and both non-null at every later version.
 */
export const CommitSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    version: commitVersion,
    at: isoTimestamp,
    actorSeat: nonNegativeInt.nullable(),
    clientRequestId: z.string().min(1).max(128).nullable(),
    events: z.array(GameEventSchema),
    state: GameStateSchema,
    scoreboard: ScoreBoardSchema,
  })
  .superRefine((commit, ctx) => {
    const initial = commit.version === 0;
    if ((commit.actorSeat === null) !== initial) {
      ctx.addIssue({
        code: 'custom',
        message: 'actorSeat is null iff version is 0',
        path: ['actorSeat'],
      });
    }
    if ((commit.clientRequestId === null) !== initial) {
      ctx.addIssue({
        code: 'custom',
        message: 'clientRequestId is null iff version is 0',
        path: ['clientRequestId'],
      });
    }
  });

/** `games/{gameId}/head.json` — a hint of the latest version. */
export const HeadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: commitVersion,
});

/** `games/{gameId}/scores/final.json` — the final result, copied from the terminal scoreboard. */
export const FinalScoresSchema = z.strictObject({
  schemaVersion: z.literal(1),
  gameId,
  version: nonNegativeInt,
  ranking: ScoreBoardSchema.shape.ranking,
  totals: ScoreBoardSchema.shape.totals,
  madeCount: ScoreBoardSchema.shape.madeCount,
  missedCount: ScoreBoardSchema.shape.missedCount,
});

export type GameMeta = z.infer<typeof GameMetaSchema>;
export type Commit = z.infer<typeof CommitSchema>;
export type CommitBody = Omit<Commit, 'schemaVersion'>;
export type Head = z.infer<typeof HeadSchema>;
export type FinalScores = z.infer<typeof FinalScoresSchema>;

/**
 * The first issue's path of a Zod error, joined with `.`, or `(root)` when empty. Used to build
 * `InvalidCommitError` reasons; never includes the issue message, which can echo values.
 */
export function firstIssuePath(error: z.ZodError): string {
  const path = error.issues[0]?.path ?? [];
  return path.length === 0 ? '(root)' : path.map(String).join('.');
}
