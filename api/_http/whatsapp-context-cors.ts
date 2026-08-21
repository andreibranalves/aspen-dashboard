import type { FunctionHeaders, VercelResponseLike } from './types.js';

export const WHATSAPP_CONTEXT_ROUTE = 'whatsapp-context';

function headerValue(headers: FunctionHeaders | Record<string, string | string[] | undefined>, name: string): string {
  const canonicalName = name
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join('-');
  const value = headers[name] ?? headers[canonicalName];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

export function whatsappContextCorsHeaders(
  origin: unknown,
  allowedOrigin: unknown = process.env.WHATSAPP_CONTEXT_EXTENSION_ORIGIN
): Record<string, string> {
  const requested = typeof origin === 'string' ? origin.trim() : '';
  const allowed = typeof allowedOrigin === 'string' ? allowedOrigin.trim() : '';
  if (!requested || !allowed || requested !== allowed) return {};
  return {
    'Access-Control-Allow-Origin': requested,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

export function applyWhatsappContextCors(
  routeName: string,
  headers: FunctionHeaders | Record<string, string | string[] | undefined>,
  response: VercelResponseLike
): void {
  if (routeName !== WHATSAPP_CONTEXT_ROUTE) return;
  const corsHeaders = whatsappContextCorsHeaders(headerValue(headers, 'origin'));
  for (const [key, value] of Object.entries(corsHeaders)) response.setHeader(key, value);
}
