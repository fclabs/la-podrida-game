import { cleanupHandler, defaultCleanupDeps } from '@/app/api/_lib/cleanup';

export const GET = (req: Request) => cleanupHandler(req, defaultCleanupDeps);
