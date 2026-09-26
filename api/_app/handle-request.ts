// Pipeline HTTP único: auth -> rate limit -> dispatch -> normalização de erro.
// Runtimes (Vercel, Node) apenas adaptam transporte para este contrato.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VercelRequestLike, VercelResponseLike } from '../_http/types.js';
import { getRouteName, isAuthenticated } from '../_shared/auth.js';
import { isPublicHttpError } from '../_shared/http-error.js';
import { checkRateLimitAsync } from '../_shared/rate-limit.js';
import { wrapFunctionHandler } from '../_http/function-adapter.js';
import { routes } from './routes.js';
import { requestOrigin, whatsappContextCorsHeaders } from '../_shared/whatsapp-context-cors.js';
import { captureApiException } from '../_infrastructure/integrations/sentry/client.js';
import { safeErrorSummary } from '../_shared/safe-error.js';

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
  if (isPublicHttpError(err)) {
    return {
      statusCode: err.statusCode,
      message: err.statusCode === 500 ? 'Erro interno. Tente novamente.' : err.message,
    };
  }
  const statusCode =
    err !== null &&
    typeof err === 'object' &&
    Number.isInteger((err as { statusCode?: unknown }).statusCode)
      ? (err as { statusCode: number }).statusCode
      : 500;
  return { statusCode, message: 'Erro interno. Tente novamente.' };
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: VercelResponseLike
): Promise<void> {
  const requestLike = req as unknown as VercelRequestLike;
  const routeName = getRouteName(requestLike);
  if (routeName === 'whatsapp-context') {
    const headers = whatsappContextCorsHeaders(
      requestOrigin((requestLike.headers || {}) as Record<string, string | string[] | undefined>)
    );
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  }
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
    console.error(`[api/${routeName}]`, safeErrorSummary(err));
    const { statusCode, message } = normalizeHandlerError(routeName, err);
    if (statusCode >= 500) {
      captureApiException(err, {
        routeName,
        method: String(requestLike.method || '').toUpperCase(),
      });
    }
    res.status(statusCode).json({ error: message });
  }
}
