// Pipeline HTTP único: auth -> rate limit -> dispatch -> normalização de erro.
// Runtimes (Vercel, Node) apenas adaptam transporte para este contrato.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VercelRequestLike, VercelResponseLike } from '../_http/types.js';
import { getRouteName, isAuthenticated } from '../_shared/auth.js';
import { checkRateLimitAsync } from '../_shared/rate-limit.js';
import { wrapFunctionHandler } from '../_http/function-adapter.js';
import { routes } from './routes.js';

export function normalizeHandlerError(
  routeName: string,
  err: unknown
): { statusCode: number; message: string } {
  if (routeName === 'public-quotation') {
    return {
      statusCode: 503,
      message: 'Não foi possível consultar o orçamento. Tente novamente.',
    };
  }
  const statusCode =
    err !== null && typeof err === 'object' && Number.isInteger((err as { statusCode?: unknown }).statusCode)
      ? (err as { statusCode: number }).statusCode
      : 500;
  // Mensagem pública apenas com opt-in explícito (expose === true) ou marcador logMessage
  // (HttpError e erros de integração seguros). expose === false ou ausência de marcador cai no genérico.
  const errLike = err as { expose?: unknown; logMessage?: unknown } | null;
  const isPublic =
    errLike !== null &&
    errLike.expose !== false &&
    (errLike.expose === true || typeof errLike.logMessage === 'string');
  const message =
    statusCode !== 500 && err instanceof Error && isPublic
      ? err.message
      : 'Erro interno. Tente novamente.';
  return { statusCode, message };
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: VercelResponseLike
): Promise<void> {
  const requestLike = req as unknown as VercelRequestLike;
  const routeName = getRouteName(requestLike);
  try {
    if (!isAuthenticated(requestLike)) {
      res.status(401).json({ error: 'Não autorizado. Faça login em /api/login.' });
      return;
    }
    if (!(await checkRateLimitAsync(requestLike))) {
      res.status(429).json({ error: 'Muitas requisições. Aguarde um minuto.' });
      return;
    }
    const routeHandler = routes[routeName];
    if (!routeHandler) {
      res.status(404).json({ error: 'Endpoint não encontrado.' });
      return;
    }
    await wrapFunctionHandler(routeHandler)(req, res as unknown as ServerResponse);
  } catch (err) {
    console.error(`[api/${routeName}]`, err instanceof Error ? err.name : typeof err);
    const { statusCode, message } = normalizeHandlerError(routeName, err);
    res.status(statusCode).json({ error: message });
  }
}
