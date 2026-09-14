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

const MAX_EVOLUTION_WEBHOOK_BODY_BYTES = 64 * 1024;

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
    err !== null && typeof err === 'object' && Number.isInteger((err as { statusCode?: unknown }).statusCode)
      ? (err as { statusCode: number }).statusCode
      : 500;
  return { statusCode, message: 'Erro interno. Tente novamente.' };
}

function requestHeader(request: VercelRequestLike, name: string): string | undefined {
  const canonicalName = name
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('-');
  const value = request.headers?.[name] ?? request.headers?.[canonicalName];
  if (Array.isArray(value)) return value[0];
  return value;
}

function requestBodyByteLength(body: unknown): number {
  if (body === undefined || body === null) return 0;
  if (typeof body === 'string') return Buffer.byteLength(body, 'utf8');
  if (body instanceof Uint8Array) return body.byteLength;
  if (body && typeof (body as { on?: unknown }).on === 'function') return Number.POSITIVE_INFINITY;
  try {
    const serialized = JSON.stringify(body);
    return typeof serialized === 'string' ? Buffer.byteLength(serialized, 'utf8') : 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function isOversizedEvolutionWebhookRequest(request: VercelRequestLike): boolean {
  const rawContentLength = requestHeader(request, 'content-length');
  if (rawContentLength !== undefined) {
    const contentLength = Number(rawContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_EVOLUTION_WEBHOOK_BODY_BYTES) {
      request.resume?.();
      return true;
    }
  }
  if (request.rawBody !== undefined && requestBodyByteLength(request.rawBody) > MAX_EVOLUTION_WEBHOOK_BODY_BYTES) {
    request.resume?.();
    return true;
  }
  if (rawContentLength === undefined && request.readable === true && request.readableEnded !== true) {
    request.resume?.();
    return true;
  }
  return requestBodyByteLength(request.body) > MAX_EVOLUTION_WEBHOOK_BODY_BYTES;
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: VercelResponseLike
): Promise<void> {
  const requestLike = req as unknown as VercelRequestLike;
  const routeName = getRouteName(requestLike);
  if (routeName === 'whatsapp-context') {
    const headers = whatsappContextCorsHeaders(
      requestOrigin((requestLike.headers || {}) as Record<string, string | string[] | undefined>),
    );
    for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  }
  try {
    if (routeName === 'evolution-webhook' && isOversizedEvolutionWebhookRequest(requestLike)) {
      res.status(413).json({ error: 'Corpo da requisição excede o limite permitido.' });
      return;
    }
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
