import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VercelRequestLike, VercelResponseLike } from './_lib/types.js';
import { wrapFunctionHandler } from './_lib/function-adapter.js';
import { isAuthenticated, getRouteName } from './_lib/auth.js';
import { checkRateLimitAsync } from './_lib/rate-limit.js';
import { routes } from './_app/routes.js';

export default async function handler(
  req: VercelRequestLike,
  res: VercelResponseLike
): Promise<void> {
  // ── Auth guard ──
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'Não autorizado. Faça login em /api/login.' });
    return;
  }

  // ── Rate limit ──
  if (!(await checkRateLimitAsync(req))) {
    res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.' });
    return;
  }

  const routeName = getRouteName(req);
  const routeHandler = routes[routeName];

  if (!routeHandler) {
    res.status(404).json({ error: 'Endpoint não encontrado.' });
    return;
  }

  return wrapFunctionHandler(routeHandler)(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse
  );
}
