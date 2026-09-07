// Adapter de transporte para funções serverless da Vercel.
// A plataforma já entrega body/query parseados; só há casts para o contrato Node.
import type { IncomingMessage } from 'node:http';
import type { VercelRequestLike, VercelResponseLike } from './types.js';
import { getRouteName } from '../_shared/auth.js';
import {
  MAX_SITE_QUOTE_BODY_BYTES,
  readRawBody,
  RequestBodyTooLargeError,
  sendBodyTooLarge,
} from './raw-body.js';

export function createVercelHandler(
  handle: (req: IncomingMessage, res: VercelResponseLike) => Promise<void>
) {
  return async function vercelApiHandler(
    req: VercelRequestLike,
    res: VercelResponseLike
  ): Promise<void> {
    if (
      getRouteName(req) === 'site-quote-leads' &&
      typeof (req as unknown as { on?: unknown }).on === 'function'
    ) {
      try {
        const rawBody = await readRawBody(
          req as unknown as IncomingMessage,
          MAX_SITE_QUOTE_BODY_BYTES
        );
        req.rawBody = rawBody;
        req.body = rawBody.toString('utf8');
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          sendBodyTooLarge(res);
          return;
        }
        throw error;
      }
    }
    return handle(req as unknown as IncomingMessage, res);
  };
}
