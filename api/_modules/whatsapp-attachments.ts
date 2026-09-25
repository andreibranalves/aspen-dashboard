import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createWhatsappAttachment } from '../_infrastructure/db/repositories/whatsapp-attachments-repository.js';
import { validateOperatorMedia } from './whatsapp-media-validation.js';
import { safeErrorSummary } from '../_shared/safe-error.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(statusCode: number, body: unknown): FunctionResult {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

export async function whatsappAttachments(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
  try {
    const body = JSON.parse(event.body || '') as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.conversationId !== 'string' || !UUID.test(body.conversationId)) {
      return json(400, { error: 'Conversa inválida.' });
    }
    if ('url' in body || 'blobUrl' in body) return json(400, { error: 'URL de anexo não permitida.' });
    if (typeof body.base64 !== 'string' || typeof body.mimeType !== 'string' || typeof body.fileName !== 'string') {
      return json(400, { error: 'Anexo inválido.' });
    }
    const media = validateOperatorMedia({ base64: body.base64, mimeType: body.mimeType, fileName: body.fileName });
    const id = await createWhatsappAttachment({
      conversationId: body.conversationId.toLowerCase(), mediaType: media.mediaType, mimeType: media.mimeType,
      fileName: media.fileName, sizeBytes: media.sizeBytes, checksum: media.checksum, contentBase64: body.base64,
    });
    return id ? json(201, { id, fileName: media.fileName, mimeType: media.mimeType, sizeBytes: media.sizeBytes })
      : json(404, { error: 'Conversa não encontrada.' });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && error.message === 'INVALID_MEDIA')) {
      return json(400, { error: 'Formato ou tamanho do anexo inválido.' });
    }
    console.error('[whatsapp-attachments]', safeErrorSummary(error));
    return json(503, { error: 'Não foi possível guardar o anexo. Tente novamente.' });
  }
}
