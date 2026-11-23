// Compile-time check (spec 06 FR-603; VC-604): ScoreBoardSchema's output type and the domain
// ScoreBoard type are mutually assignable. Checked by `pnpm typecheck`; vitest does not run it.
import type { z } from 'zod';
import type { ScoreBoard } from '@/src/domain/types';
import type { ScoreBoardSchema } from '@/src/state/schemas';

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

export type _ScoreBoardMatches = Assert<Equals<z.infer<typeof ScoreBoardSchema>, ScoreBoard>>;
