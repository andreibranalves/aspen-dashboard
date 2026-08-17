import { normalizeEvolutionDelivery } from './evolution-delivery.js';
import type { PreparedDeliveryDocument } from '../../_db/quotation-delivery-repository.js';
import type { FrozenDeliveryStep } from '../../_db/quotation-delivery-outbox-repository.js';
import type { TransportFailureKind } from './quotation-delivery-state.js';
import { normalizeWhatsappPhone } from './whatsapp-conversations-store.js';

const DEFAULT_TIMEOUT_MS = 15_000;

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

export class EvolutionTransportError extends Error {
  constructor(
    message: string,
    readonly kind: TransportFailureKind,
    readonly code: string,
  ) {
    super(message);
    this.name = 'EvolutionTransportError';
  }
}

export interface EvolutionAccepted {
  accepted: true;
  providerMessageId: string;
}

export interface EvolutionTransportDependencies {
  fetch?: typeof fetch;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  instance?: string;
  timeoutMs?: number;
}

export const defaultDependencies: EvolutionTransportDependencies = {
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
};

function failure(
  message: string,
  kind: TransportFailureKind,
  code: string,
): EvolutionTransportError {
  return new EvolutionTransportError(message, kind, code);
}

function permanentInput(message: string): never {
  throw failure(message, 'permanent_pre_transport', 'EVOLUTION_INVALID_INPUT');
}

function text(value: unknown, label: string, required = true): string {
  if (typeof value !== 'string') {
    if (!required) return '';
    permanentInput(`${label} inválido.`);
  }
  const result = String(value).trim();
  if (hasControlCharacters(result) || (required && !result) || result.length > 4_000) {
    permanentInput(`${label} inválido.`);
  }
  return result;
}

function validConfiguration(dependencies: EvolutionTransportDependencies): {
  baseUrl: string;
  apiKey: string;
  instance: string;
} {
  const baseUrl = (dependencies.baseUrl ?? process.env.EVOLUTION_BASE_URL ?? '').trim().replace(/\/+$/, '');
  const apiKey = (dependencies.apiKey ?? process.env.EVOLUTION_API_KEY ?? '').trim();
  const instance = (dependencies.instance ?? process.env.EVOLUTION_INSTANCE ?? '').trim();
  if (!baseUrl || !apiKey || !instance || hasControlCharacters(baseUrl) || hasControlCharacters(apiKey) || hasControlCharacters(instance)) {
    throw failure('Integração do WhatsApp não configurada.', 'permanent_pre_transport', 'EVOLUTION_CONFIGURATION');
  }
  let parsed: URL;
  try { parsed = new URL(baseUrl); }
  catch { throw failure('Integração do WhatsApp não configurada.', 'permanent_pre_transport', 'EVOLUTION_CONFIGURATION'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw failure('Integração do WhatsApp não configurada.', 'permanent_pre_transport', 'EVOLUTION_CONFIGURATION');
  }
  return { baseUrl, apiKey, instance };
}

function providerMessageId(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
  const record = body as Record<string, unknown>;
  const key = record.key && typeof record.key === 'object' && !Array.isArray(record.key)
    ? record.key as Record<string, unknown>
    : {};
  for (const value of [
    record.provider_message_id,
    record.providerMessageId,
    record.message_id,
    record.messageId,
    key.id,
  ]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function validateStep(step: FrozenDeliveryStep): void {
  if (!step || typeof step !== 'object' || !Number.isInteger(step.position) || step.position < 0) {
    permanentInput('Passo de entrega inválido.');
  }
  if (step.type === 'text') {
    if (!step.payload || typeof step.payload.text !== 'string' || !step.payload.text.trim()) {
      permanentInput('Texto do passo inválido.');
    }
    return;
  }
  if (step.type === 'media') {
    const payload = step.payload;
    if (!payload || (payload.mediaType !== 'image' && payload.mediaType !== 'document')) {
      permanentInput('Mídia do passo inválida.');
    }
    const url = text(payload.url, 'URL do passo');
    let parsed: URL;
    try { parsed = new URL(url); }
    catch { permanentInput('URL do passo inválida.'); }
    if (parsed.protocol !== 'https:') permanentInput('URL do passo inválida.');
    text(payload.fileName, 'Nome do arquivo');
    text(payload.caption, 'Legenda do passo', false);
    return;
  }
  if (step.type === 'quotation_pdf') {
    if (!step.payload || !text(step.payload.revisionId, 'Identificador da revisão')) {
      permanentInput('Referência do PDF inválida.');
    }
    text(step.payload.fileName, 'Nome do arquivo');
    text(step.payload.caption, 'Legenda do passo', false);
    return;
  }
  permanentInput('Tipo de passo inválido.');
}

function requestForStep(
  input: { phone: string; step: FrozenDeliveryStep; document?: PreparedDeliveryDocument },
  instance: string,
): { path: string; body: Record<string, unknown> } {
  const number = normalizeWhatsappPhone(input.phone);
  if (!number) permanentInput('Telefone do destinatário inválido.');
  const step = input.step;
  validateStep(step);
  if (step.type === 'text') {
    return {
      path: `/message/sendText/${encodeURIComponent(instance)}`,
      body: { number, text: step.payload.text },
    };
  }
  if (step.type === 'media') {
    const isVideo = step.payload.mediaType === 'image' && /\.mp4$/i.test(step.payload.fileName);
    return {
      path: `/message/sendMedia/${encodeURIComponent(instance)}`,
      body: {
        number,
        mediatype: isVideo ? 'video' : step.payload.mediaType,
        ...(isVideo ? { mimetype: 'video/mp4' } : {}),
        media: step.payload.url,
        fileName: step.payload.fileName,
        caption: step.payload.caption,
      },
    };
  }
  const document = input.document;
  if (!document || !Buffer.isBuffer(document.pdf) || document.pdf.length === 0) {
    permanentInput('Documento do orçamento indisponível.');
  }
  if (!Number.isSafeInteger(document.pdfSize) || document.pdfSize !== document.pdf.length) {
    permanentInput('Documento do orçamento inválido.');
  }
  return {
    path: `/message/sendMedia/${encodeURIComponent(instance)}`,
    body: {
      number,
      mediatype: 'document',
      mimetype: 'application/pdf',
      media: document.pdf.toString('base64'),
      fileName: step.payload.fileName,
      caption: step.payload.caption,
    },
  };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response || typeof response.json !== 'function') throw new Error('malformed response');
  return response.json();
}

export async function sendFrozenStep(
  input: { phone: string; step: FrozenDeliveryStep; document?: PreparedDeliveryDocument },
  dependencies: EvolutionTransportDependencies = defaultDependencies,
): Promise<EvolutionAccepted> {
  const config = validConfiguration(dependencies);
  const request = requestForStep(input, config.instance);
  const fetchImpl = dependencies.fetchImpl || dependencies.fetch || defaultDependencies.fetch!;
  const timeoutMs = dependencies.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(dependencies.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    permanentInput('Tempo limite do transporte inválido.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const unrefTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
  unrefTimer.unref?.();
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}${request.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: config.apiKey },
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    throw failure('Falha ao conectar com o WhatsApp.', 'ambiguous', 'EVOLUTION_NETWORK');
  }
  clearTimeout(timer);

  const status = Number(response?.status);
  if (status === 429) {
    throw failure('O provedor limitou temporariamente o transporte.', 'transient_pre_transport', 'EVOLUTION_RATE_LIMIT');
  }
  if (status >= 400 && status < 500) {
    throw failure('O provedor rejeitou o transporte.', 'permanent_pre_transport', `EVOLUTION_HTTP_${status}`);
  }
  if (status < 200 || status >= 300) {
    throw failure('O resultado do transporte requer reconciliação.', 'ambiguous', `EVOLUTION_HTTP_${status || 'UNKNOWN'}`);
  }

  let body: unknown;
  try {
    body = await readJson(response);
  } catch {
    throw failure('O provedor não confirmou o transporte.', 'ambiguous', 'EVOLUTION_MALFORMED_RESPONSE');
  }
  const normalized = normalizeEvolutionDelivery(body);
  const id = providerMessageId(body);
  if (!normalized || !id) {
    throw failure('O provedor não confirmou o transporte.', 'ambiguous', 'EVOLUTION_MISSING_PROVIDER_ID');
  }
  return { accepted: true, providerMessageId: id };
}
