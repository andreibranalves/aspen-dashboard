// Adapter de transporte para funções serverless da Vercel.
// A plataforma já entrega body/query parseados; só há casts para o contrato Node.
import type { IncomingMessage } from 'node:http';
import type { VercelRequestLike, VercelResponseLike } from '../_lib/types.js';

export function createVercelHandler(
  handle: (req: IncomingMessage, res: VercelResponseLike) => Promise<void>
) {
  return async function vercelApiHandler(
    req: VercelRequestLike,
    res: VercelResponseLike
  ): Promise<void> {
    return handle(req as unknown as IncomingMessage, res);
  };
}
