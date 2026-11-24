// The deps every `route.ts` binds its handler to (spec FR-813; plan P-8).
import { getConfig } from '@/src/config';
import type { HandlerDeps } from './handlers';
import { consoleLog } from './log';
import { getService } from './service-factory';

/** The real factory, the memoised config, `performance.now` and the console sink. */
export const defaultDeps: HandlerDeps = {
  getService,
  getConfig,
  now: () => performance.now(),
  log: consoleLog,
};
