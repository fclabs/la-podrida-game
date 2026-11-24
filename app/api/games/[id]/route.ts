import { defaultDeps } from '@/app/api/_lib/default-deps';
import { getGameHandler } from '@/app/api/_lib/handlers';

export const GET = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  getGameHandler(req, ctx, defaultDeps);
