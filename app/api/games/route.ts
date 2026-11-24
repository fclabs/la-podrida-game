import { defaultDeps } from '@/app/api/_lib/default-deps';
import { createGameHandler } from '@/app/api/_lib/handlers';

export const POST = (req: Request) => createGameHandler(req, defaultDeps);
