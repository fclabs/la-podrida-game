import type { z } from 'zod';
import type {
  BoundSchema,
  HandSequenceSpecSchema,
  PresetIdSchema,
  RuleSetSchema,
  ScoringSpecSchema,
  SegmentSchema,
} from './schemas';

/**
 * A card-count bound: a fixed count, `'max'`, `{ min: [n, 'max'] }` (= min(n, max)) or
 * `{ offset: ['max', n] }` (= max + n, n ≤ 0).
 */
export type Bound = z.infer<typeof BoundSchema>;

/** A hand-sequence segment: an inclusive `range` (steps ±1) or a `repeat`. */
export type Segment = z.infer<typeof SegmentSchema>;

/** The ordered list of segments that a game's hand plan is expanded from (Phase 2). */
export type HandSequenceSpec = z.infer<typeof HandSequenceSpecSchema>;

/** The scoring scheme of a rule set. */
export type ScoringSpec = z.infer<typeof ScoringSpecSchema>;

/** One of the four preset ids. */
export type PresetId = z.infer<typeof PresetIdSchema>;

/** A complete, explicit rule set; plain JSON data. */
export type RuleSet = z.infer<typeof RuleSetSchema>;
