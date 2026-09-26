import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { findContactPhotoConversation } from '../_infrastructure/db/repositories/whatsapp-message-media-repository.js';
import { getEvolutionClient, type EvolutionClient } from '../_infrastructure/integrations/evolution/client.js';
import { detectedWhatsappMediaMime } from './whatsapp-media-validation.js';
import { safeErrorSummary } from '../_shared/safe-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 512 * 1024;
// WhatsApp photo URLs expire in about ten days, so the URL is never stored;
// the browser keeps the proxied photo (or its absence) for one day.
const PHOTO_CACHE = 'private, max-age=86400';
class PhotoTooLargeError extends Error {}

type Conversation = Awaited<ReturnType<typeof findContactPhotoConversation>>;
export interface ContactPhotoDependencies {
  findConversation?: (id: string) => Promise<Conversation>;
  client?: EvolutionClient;
  fetchImpl?: typeof fetch;
}

function json(statusCode: number, code: string, error: string, cache = 'no-store'): FunctionResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache }, body: JSON.stringify({ code, error }) };
}

async function boundedBytes(response: Response): Promise<Buffer> {
  if (Number(response.headers.get('content-length') || 0) > MAX_PHOTO_BYTES) throw new PhotoTooLargeError();
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_PHOTO_BYTES) throw new PhotoTooLargeError();
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

// The URL comes from Evolution; only WhatsApp's photo CDN is ever fetched.
function photoUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'pps.whatsapp.net' && !url.port && !url.username ? url : null;
  } catch {
    return null;
  }
}

export function createContactPhotoHandler(dependencies: ContactPhotoDependencies = {}) {
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (event.httpMethod !== 'GET') return json(405, 'METHOD_NOT_ALLOWED', 'Método não permitido.');
    const id = event.queryStringParameters?.id || '';
    if (!UUID.test(id)) return json(400, 'INVALID_CONVERSATION', 'Conversa inválida.');
    const noPhoto = json(404, 'PHOTO_NOT_FOUND', 'Foto indisponível.', PHOTO_CACHE);
    try {
      const conversation = await (dependencies.findConversation || findContactPhotoConversation)(id.toLowerCase());
      if (!conversation) return json(404, 'CONVERSATION_NOT_FOUND', 'Conversa não encontrada.');
      const client = dependencies.client || getEvolutionClient();
      if (client.config().instance !== conversation.instance) return noPhoto;
      const signal = AbortSignal.timeout(8_000);
      const lookup = await client.request(
        `/chat/fetchProfilePictureUrl/${encodeURIComponent(conversation.instance)}`,
        { number: conversation.providerConversationId },
        { externalWrite: false, signal },
      );
      if (!lookup.ok) return json(503, 'PHOTO_UNAVAILABLE', 'Foto indisponível na origem.');
      const result = await lookup.json().catch(() => null) as { profilePictureUrl?: unknown } | null;
      const url = photoUrl(result?.profilePictureUrl);
      if (!url) return noPhoto;
      const image = await (dependencies.fetchImpl || fetch)(url, { redirect: 'error', signal });
      if (!image.ok) return json(503, 'PHOTO_UNAVAILABLE', 'Foto indisponível na origem.');
      const bytes = await boundedBytes(image);
      const mime = detectedWhatsappMediaMime(bytes);
      if (!mime?.startsWith('image/')) return json(422, 'PHOTO_INVALID', 'Formato da foto não suportado.');
      return {
        statusCode: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(bytes.length),
          'Cache-Control': PHOTO_CACHE,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "sandbox; default-src 'none'",
        },
        body: bytes.toString('base64'),
        isBase64Encoded: true,
      };
    } catch (error) {
      if (error instanceof PhotoTooLargeError) return json(413, 'PHOTO_TOO_LARGE', 'Foto acima do limite permitido.');
      console.error('[whatsapp-contact-photo]', safeErrorSummary(error));
      return json(503, 'PHOTO_UNAVAILABLE', 'Foto indisponível na origem.');
    }
  };
}

export const whatsappContactPhoto = createContactPhotoHandler();
