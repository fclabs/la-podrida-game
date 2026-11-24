import { defaultDeps } from '@/app/api/_lib/default-deps';
import { submitMoveHandler } from '@/app/api/_lib/handlers';

export const POST = (req: Request, ctx: { params: Promise<{ id: string }> }) =>
  submitMoveHandler(req, ctx, defaultDeps);
