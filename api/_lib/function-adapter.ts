import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FunctionEvent, FunctionResult, LegacyHandler, VercelResponseLike } from './types.js';

function normalizeBody(req: IncomingMessage): string {
  const body = (req as unknown as Record<string, unknown>).body;
  if (body === undefined || body === null) return '';
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  return JSON.stringify(body);
}

function normalizeQuery(query: Record<string, unknown> = {}): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(query).map(([key, value]) => {
      const lastValue = Array.isArray(value) ? value[value.length - 1] : value;
      return [key, typeof lastValue === 'string' ? lastValue.replace(/\+/g, ' ') : lastValue];
    })
  );
}

function setHeaders(res: ServerResponse, headers: Record<string, string> = {}): void {
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) {
      res.setHeader(key, value);
    }
  }
}

export function toFunctionEvent(req: IncomingMessage): FunctionEvent {
  return {
    httpMethod: req.method || 'GET',
    headers: (req.headers || {}) as Record<string, string | string[] | undefined>,
    queryStringParameters: normalizeQuery(
      (req as unknown as Record<string, unknown>).query as Record<string, unknown>
    ),
    body: normalizeBody(req),
    url: req.url || '',
  };
}

export function sendFunctionResult(res: ServerResponse, result: FunctionResult): void {
  const statusCode = result?.statusCode || 200;
  setHeaders(res, (result?.headers || {}) as Record<string, string>);
  (res as unknown as VercelResponseLike).status(statusCode).send(result?.body ?? '');
}

export function wrapFunctionHandler(functionHandler: LegacyHandler) {
  return async function vercelHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const result = await functionHandler(toFunctionEvent(req));
    sendFunctionResult(res, result);
  };
}
