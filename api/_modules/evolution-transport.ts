import {
  getEvolutionClient,
  type EvolutionClient,
  type EvolutionConfig,
} from '../_infrastructure/integrations/evolution/client.js';
import { normalizeEvolutionDelivery } from '../_infrastructure/integrations/evolution/evolution-delivery.js';
import type {
  PreparedDeliveryDocument,
  PreparedDeliveryImage,
} from '../_infrastructure/db/repositories/quotation-delivery-repository.js';
import type { FrozenDeliveryStep } from '../_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';
import type { TransportFailureKind } from './quotation-delivery-state.js';
import { hasDisallowedWhatsappControls } from './quotation-follow-up-state.js';
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
  client?: EvolutionClient;
  fetch?: typeof fetch;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  instance?: string;
  timeoutMs?: number;
}

export const defaultDependencies: EvolutionTransportDependencies = {};

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
  if (hasDisallowedWhatsappControls(value) || value.length > 4_000) {
    permanentInput(`${label} inválido.`);
  }
  const result = value.trim();
  if (required && !result) permanentInput(`${label} inválido.`);
  return result;
}

function validConfiguration(config: EvolutionConfig): EvolutionConfig {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
  const apiKey = config.apiKey.trim();
  const instance = config.instance.trim();
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

function transportClient(dependencies: EvolutionTransportDependencies): EvolutionClient {
  if (dependencies.client) return dependencies.client;
  const hasOverrides =
    dependencies.baseUrl !== undefined ||
    dependencies.apiKey !== undefined ||
    dependencies.instance !== undefined ||
    dependencies.fetch !== undefined ||
    dependencies.fetchImpl !== undefined;
  if (!hasOverrides) return getEvolutionClient();
  const config: EvolutionConfig = {
    baseUrl: String(dependencies.baseUrl || ''),
    apiKey: String(dependencies.apiKey || ''),
    instance: String(dependencies.instance || ''),
  };
  const hasInjectedFetch = dependencies.fetch !== undefined || dependencies.fetchImpl !== undefined;
  return getEvolutionClient({
    getConfig: () => config,
    fetchImpl: dependencies.fetchImpl || dependencies.fetch || globalThis.fetch,
    ...(hasInjectedFetch ? { assertWriteAllowed: () => {} } : {}),
  });
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
    if (!step.payload) permanentInput('Texto do passo inválido.');
    text(step.payload.text, 'Texto do passo');
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
  if (step.type === 'quotation_webp') {
    if (!step.payload || !text(step.payload.revisionId, 'Identificador da revisão')) {
      permanentInput('Referência da imagem inválida.');
    }
    if (
      !Number.isSafeInteger(step.payload.page) ||
      !Number.isSafeInteger(step.payload.pageCount) ||
      step.payload.page < 1 ||
      step.payload.page > step.payload.pageCount
    ) {
      permanentInput('Página da imagem inválida.');
    }
    text(step.payload.fileName, 'Nome do arquivo');
    text(step.payload.caption, 'Legenda do passo', false);
    return;
  }
  permanentInput('Tipo de passo inválido.');
}

function requestForStep(
  input: {
    phone: string;
    step: FrozenDeliveryStep;
    document?: PreparedDeliveryDocument;
    image?: PreparedDeliveryImage;
  },
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
  if (step.type === 'quotation_webp') {
    const image = input.image;
    if (!image || !Buffer.isBuffer(image.webp) || image.webp.length === 0) {
      permanentInput('Imagem do orçamento indisponível.');
    }
    if (!Number.isSafeInteger(image.webpSize) || image.webpSize !== image.webp.length) {
      permanentInput('Imagem do orçamento inválida.');
    }
    return {
      path: `/message/sendMedia/${encodeURIComponent(instance)}`,
      body: {
        number,
        mediatype: 'image',
        mimetype: 'image/webp',
        media: image.webp.toString('base64'),
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
  input: {
    phone: string;
    step: FrozenDeliveryStep;
    document?: PreparedDeliveryDocument;
    image?: PreparedDeliveryImage;
  },
  dependencies: EvolutionTransportDependencies = defaultDependencies,
): Promise<EvolutionAccepted> {
  const client = transportClient(dependencies);
  const config = validConfiguration(client.config());
  const request = requestForStep(input, config.instance);
  const timeoutMs = dependencies.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(dependencies.timeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    permanentInput('Tempo limite do transporte inválido.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const unrefTimer = timer as ReturnType<typeof setTimeout> & { unref?: () => void };
  unrefTimer.unref?.();
  try {
    let response: Response;
    try {
      response = await client.request(request.path, request.body, { signal: controller.signal });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'statusCode' in error &&
        error.statusCode === 503
      ) {
        throw failure(
          'Integração do WhatsApp desativada neste ambiente.',
          'permanent_pre_transport',
          'EXTERNAL_WRITES_DISABLED',
        );
      }
      throw failure('Falha ao conectar com o WhatsApp.', 'ambiguous', 'EVOLUTION_NETWORK');
    }

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
      // The same deadline must cover the body: headers arriving does not mean
      // the provider decided, and a hung body would otherwise outlive the timeout.
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
  } finally {
    clearTimeout(timer);
  }
}
