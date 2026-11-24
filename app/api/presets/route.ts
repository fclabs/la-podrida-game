import { defaultDeps } from '@/app/api/_lib/default-deps';
import { presetsHandler } from '@/app/api/_lib/handlers';

export const GET = (req: Request) => presetsHandler(req, defaultDeps);
