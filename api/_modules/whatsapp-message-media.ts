import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { findReceivedMediaMessage } from '../_infrastructure/db/repositories/whatsapp-message-media-repository.js';
import { getEvolutionClient, type EvolutionClient } from '../_infrastructure/integrations/evolution/client.js';
import { safeMediaFilename } from './postgres-media.js';
import { detectedWhatsappMediaMime, MAX_OPERATOR_ATTACHMENT_BYTES, whatsappMediaAllowed, whatsappMediaLimit } from './whatsapp-media-validation.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = Math.ceil(MAX_OPERATOR_ATTACHMENT_BYTES * 4 / 3) + 4096;
class MediaTooLargeError extends Error {}

type MediaRow = Awaited<ReturnType<typeof findReceivedMediaMessage>>;
export interface ReceivedMediaDependencies {
  findMessage?: (id: string) => Promise<MediaRow>;
  client?: EvolutionClient;
}

function json(statusCode: number, code: string, error: string): FunctionResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ code, error }) };
}

async function boundedJson(response: Response): Promise<Record<string, unknown> | null> {
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw new MediaTooLargeError();
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_RESPONSE_BYTES) throw new MediaTooLargeError();
      chunks.push(value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch (error) {
    if (error instanceof MediaTooLargeError) throw error;
    return null;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

export function createReceivedMediaHandler(dependencies: ReceivedMediaDependencies = {}) {
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (event.httpMethod !== 'GET') return json(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
    const id = event.queryStringParameters?.id || '';
    if (!UUID.test(id)) return json(400, 'INVALID_MESSAGE', 'Mensagem inválida.');
    try {
      const message = await (dependencies.findMessage || findReceivedMediaMessage)(id.toLowerCase());
      if (!message || message.direction !== 'inbound' || !['image', 'document', 'audio'].includes(message.type)) {
        return json(404, 'MEDIA_NOT_FOUND', 'Mídia não encontrada.');
      }
      if (!message.providerMessageId) return json(410, 'MEDIA_UNAVAILABLE', 'Mídia indisponível na origem.');
      const client = dependencies.client || getEvolutionClient();
      if (client.config().instance !== message.instance) return json(410, 'MEDIA_UNAVAILABLE', 'Mídia indisponível na origem.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await client.request(
          `/chat/getBase64FromMediaMessage/${encodeURIComponent(client.config().instance)}`,
          { message: { key: { id: message.providerMessageId, remoteJid: message.providerConversationId, fromMe: false } }, convertToMp4: false },
          { externalWrite: false, signal: controller.signal },
        );
        if (response.status === 404 || response.status === 410) return json(410, 'MEDIA_EXPIRED', 'Mídia expirada na origem.');
        if (!response.ok) return json(503, 'MEDIA_UNAVAILABLE', 'Mídia indisponível na origem.');
        const result = await boundedJson(response);
        const base64 = typeof result?.base64 === 'string' ? result.base64 : '';
        if (base64.length > MAX_RESPONSE_BYTES) return json(413, 'MEDIA_TOO_LARGE', 'Mídia acima do limite permitido.');
        if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
          return json(422, 'MEDIA_INVALID', 'Mídia inválida na origem.');
        }
        const bytes = Buffer.from(base64, 'base64');
        const mime = detectedWhatsappMediaMime(bytes);
        const limit = Math.min(whatsappMediaLimit(message.type), MAX_OPERATOR_ATTACHMENT_BYTES);
        if (bytes.length > limit) return json(413, 'MEDIA_TOO_LARGE', 'Mídia acima do limite permitido.');
        if (!mime || !whatsappMediaAllowed(message.type, mime)) return json(422, 'MEDIA_INVALID', 'Formato da mídia não suportado.');
        const declared = typeof result?.mimetype === 'string' ? result.mimetype.split(';', 1)[0].trim().toLowerCase() : '';
        if (declared && declared !== mime) return json(422, 'MEDIA_INVALID', 'Formato da mídia não corresponde ao conteúdo.');
        return {
          statusCode: 200,
          headers: {
            'Content-Type': mime,
            'Content-Length': String(bytes.length),
            'Content-Disposition': `${mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="${safeMediaFilename('', mime, 'mensagem')}"`,
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'",
          },
          body: bytes.toString('base64'),
          isBase64Encoded: true,
        };
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    } catch (error) {
      if (error instanceof MediaTooLargeError) return json(413, 'MEDIA_TOO_LARGE', 'Mídia acima do limite permitido.');
      console.error('[whatsapp-message-media]', error instanceof Error ? error.name : typeof error);
      return json(503, 'MEDIA_UNAVAILABLE', 'Mídia indisponível na origem.');
    }
  };
}

export const whatsappMessageMedia = createReceivedMediaHandler();
