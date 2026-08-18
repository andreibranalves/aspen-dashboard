// POST /api/send-whatsapp-flow
//
// Executes a CommunicationFlow via Evolution API.
// Resolves product_media steps from the media library (Vercel Blob).
// Performs duplicate detection (30min window per quotation+phone+flow).
// Records send events in KV for history.
// Keeps send history in local KV and uses Evolution only as transport.
//
// Reuses Evolution delivery patterns from send-whatsapp.js.
// Storage: Vercel KV for flows, media, and send events.

import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_http/types.js';
import type { HttpError } from '../_shared/http-error.js';
import { kv } from '@vercel/kv';
import { assertExternalWritesAllowed } from '../_shared/external-writes.js';
import { createHttpError } from '../_shared/http-error.js';
import { getTimeBasedGreeting } from './time-greeting.js';
import { createQuotationTemplateRepository } from '../infrastructure/db/repositories/quotation-template-repository.js';
import {
  createPostgresQuotationDeliveryRepository,
  QuotationDeliveryPdfError,
  type QuotationDeliveryRepository,
} from '../infrastructure/db/repositories/quotation-delivery-repository.js';
import {
  isRevisionBoundPublicQuotationUrl,
} from './public-quotation.js';
import { loadPostgresSendContext } from './send-whatsapp.js';
import {
  allowedMediaMimeTypes,
  downloadApprovedMedia,
  normalizeOwnedBlobUrl,
  readCommunicationMediaRecords,
  safeMediaFilename,
  stripMediaInternals,
  verifyOwnedBlobRecord,
  isMediaTombstone,
  type BlobHead,
  type PostgresMediaRecord,
} from './postgres-media.js';
import { normalizeEvolutionDelivery, type EvolutionDeliveryResult } from '../infrastructure/integrations/evolution/evolution-delivery.js';
import {
  KV_KEY_FLOWS,
  KV_KEY_SEND_EVENTS_PREFIX,
} from './media-schema.js';
import {
  canonicalWhatsappSendIdempotencyKey,
  defaultWhatsappSendReservationStore,
  isWhatsappSendReservationStale,
  parseWhatsappSendReservationRecord,
  sanitizeWhatsappSendTerminalResult,
  type WhatsappSendAcceptedStepKind,
  type WhatsappSendReservationCasResult,
  type WhatsappSendReservationRecord,
  type WhatsappSendReservationStore,
  WhatsappSendReservationStorageError,
} from './whatsapp-send-reservation-store.js';

function evolutionConfig(): { baseUrl: string; apiKey: string; instance: string } {
  return {
    baseUrl: (process.env.EVOLUTION_BASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: (process.env.EVOLUTION_API_KEY || '').trim(),
    instance: (process.env.EVOLUTION_INSTANCE || '').trim(),
  };
}

const PRODUCT_CATEGORY_BY_PREFIX: Record<string, string> = {
  CNG: 'canga',
  LNC: 'lenço',
  BNE: 'boné',
  TWL: 'toalha',
  CHP: 'chapéu',
  ECO: 'ecobag',
  CHC: 'cachecol',
};
const PRODUCT_SUMMARY_PLURALS: Record<string, string> = {
  canga: 'cangas',
  lenço: 'lenços',
  boné: 'bonés',
  toalha: 'toalhas',
  chapéu: 'chapéus',
  ecobag: 'ecobags',
  cachecol: 'cachecóis',
};
const PRODUCT_CATEGORY_GENDERS: Record<string, string> = {
  canga: 'f',
  lenço: 'm',
  boné: 'm',
  toalha: 'f',
  chapéu: 'm',
  ecobag: 'f',
  cachecol: 'm',
};
const CATEGORY_ALIASES: Record<string, string> = {
  canga: 'canga',
  cangas: 'canga',
  lenco: 'lenço',
  lenço: 'lenço',
  lenços: 'lenço',
  bone: 'boné',
  boné: 'boné',
  bonés: 'boné',
  chapeu: 'chapéu',
  chapéu: 'chapéu',
  chapéus: 'chapéu',
  toalha: 'toalha',
  toalhas: 'toalha',
  ecobag: 'ecobag',
  ecobags: 'ecobag',
  cachecol: 'cachecol',
  cachecóis: 'cachecol',
  cachecois: 'cachecol',
};

const DUPLICATE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

type FlowContext = {
  nome?: string;
  quotationId?: string;
  link?: string;
  pdfBase64?: string;
  postgresPath?: boolean;
  applicationOrigin?: string;
  permittedMedia: string[];
  vendorName?: string;
  productSummary?: string;
  productPersonalizationAdjective?: string;
  categories: string[];
  maxMediaPerGroup?: number;
};

type FlowStep = Record<string, unknown> & {
  type?: string;
  template?: string;
  source?: string;
  caption?: string;
  max_items?: number;
};

type FlowRecord = Record<string, unknown> & {
  steps?: FlowStep[];
  vendor_name?: string;
  max_media_per_product_group?: number;
  delay_min_seconds?: number;
  delay_max_seconds?: number;
  name?: string;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function firstNonEmpty(...values: unknown[]): string {
  const found = values.find((v) => typeof v === 'string' && v.trim());
  return typeof found === 'string' ? found.trim() : '';
}

function minimalLocalIdentifier(value: string, label: string): string {
  if (!value || value.length > 255 || value.includes('://')) {
    throw createHttpError(400, `${label} inválido.`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) throw createHttpError(400, `${label} inválido.`);
  }
  return value;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

// ── Template rendering ─────────────────────────────────────────────────────

function normalizeProductSummaryTemplate(template: unknown): string {
  return String(template || '')
    .replace(
      /\(produto_resumo\)\s+personalizado\(a\)/g,
      '(produto_resumo) (produto_adjetivo_personalizado)'
    )
    .replace(
      /\(produto_resumo\)\s+personalizados\(as\)/g,
      '(produto_resumo) (produto_adjetivo_personalizado)'
    );
}

function pluralizeProductCategory(category: string): string {
  return PRODUCT_SUMMARY_PLURALS[category] || category;
}

function productPersonalizationAdjectiveFromCategories(categories: string[] = []): string {
  const genders = categories.map((category) => PRODUCT_CATEGORY_GENDERS[category]).filter(Boolean);
  return genders.length > 0 && genders.every((gender) => gender === 'f')
    ? 'personalizadas'
    : 'personalizados';
}

function renderTemplate(template: string, context: FlowContext): string {
  const saudacao = getTimeBasedGreeting();
  const nome = context.nome || '';
  const primeiroNome = nome.trim().split(/\s+/)[0] || nome;
  const groups = context.categories || [];
  const grupoProduto = groups.length > 0 ? groups[0] : 'produto';

  const productPersonalizationAdjective =
    context.productPersonalizationAdjective ||
    productPersonalizationAdjectiveFromCategories(context.categories);

  return normalizeProductSummaryTemplate(template)
    .replace(/\(Saudacao\)/g, saudacao)
    .replace(/\(nome\)/g, nome)
    .replace(/\(primeiro_nome\)/g, primeiroNome)
    .replace(/\(numero_pedido\)/g, context.quotationId || '')
    .replace(/\(empresa\)/g, 'Aspen Estamparia')
    .replace(/\(link_orcamento\)/g, context.link || '')
    .replace(/\(vendedora\)/g, context.vendorName || 'Juliana')
    .replace(/\(produto_resumo\)/g, context.productSummary || 'produtos')
    .replace(/\(produto_adjetivo_personalizado\)/g, productPersonalizationAdjective)
    .replace(/\(grupo_produto\)/g, grupoProduto);
}

// ── Category detection ─────────────────────────────────────────────────────

function normalizeCategory(value: unknown): string {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return CATEGORY_ALIASES[key] || key;
}

function detectCategories(items: Record<string, unknown>[] = []): string[] {
  const categories: string[] = [];
  for (const item of items) {
    const sku = String((item.sku as string) || (item.item_code as string) || (item.itemCode as string) || '')
      .trim()
      .toUpperCase();
    const prefix = sku.split('-')[0];
    const category = PRODUCT_CATEGORY_BY_PREFIX[prefix];
    if (category && !categories.includes(category)) categories.push(category);
  }
  return categories;
}

function productSummaryFromCategories(categories: string[] = []): string {
  const labels = categories.map(pluralizeProductCategory);
  if (!labels.length) return 'produtos';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} e ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
}

export function canonicalFlowQuotationId(quotationId: string, businessNumber: string): string {
  return businessNumber || quotationId;
}

export function flowProductSummary(
  _postgresPath: boolean,
  _callerSummary: unknown,
  items: Record<string, unknown>[],
): string {
  return productSummaryFromCategories(detectCategories(items));
}

// ── Evolution API ──────────────────────────────────────────────────────────

function assertEvolutionConfig() {
  const { baseUrl, apiKey, instance } = evolutionConfig();
  const missing = [];
  if (!baseUrl) missing.push('EVOLUTION_BASE_URL');
  if (!apiKey) missing.push('EVOLUTION_API_KEY');
  if (!instance) missing.push('EVOLUTION_INSTANCE');
  if (missing.length > 0) {
    throw createHttpError(
      500,
      'Integração do WhatsApp não configurada.',
      `missing env: ${missing.join(', ')}`
    );
  }
  assertExternalWritesAllowed('evolution');
}

type EvolutionTransportOutcome = 'unknown' | 'retryable';

function transportError(
  statusCode: number,
  message: string,
  outcome: EvolutionTransportOutcome,
  logMessage?: string,
): Error & { transportOutcome: EvolutionTransportOutcome } {
  const error = createHttpError(statusCode, message, logMessage) as Error & {
    transportOutcome?: EvolutionTransportOutcome;
  };
  error.transportOutcome = outcome;
  return error as Error & { transportOutcome: EvolutionTransportOutcome };
}

async function evolutionPost(path: string, body: Record<string, unknown>): Promise<EvolutionDeliveryResult> {
  assertEvolutionConfig();
  const { baseUrl, apiKey } = evolutionConfig();
  assertExternalWritesAllowed('evolution');
  const url = `${baseUrl}${path}`;
  let res, responseBody;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: apiKey },
      body: JSON.stringify(body),
    });
    responseBody = await res.json().catch(() => null);
    } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw transportError(
      502,
      'Falha ao conectar com o WhatsApp.',
      'unknown',
      `Evolution fetch failed: ${msg}`
    );
  }
  if (!res.ok) {
    throw transportError(
      400,
      'Não foi possível enviar a mensagem.',
      'retryable',
      `Evolution HTTP ${res.status}`
    );
  }
  const delivery = normalizeEvolutionDelivery(responseBody);
  if (!delivery) {
    // A response without explicit acceptance may follow an accepted transport.
    throw transportError(502, 'O provedor não confirmou o recebimento da mensagem.', 'unknown');
  }
  return delivery;
}

async function sendText(number: string, text: string): Promise<EvolutionDeliveryResult> {
  const { instance } = evolutionConfig();
  return evolutionPost(`/message/sendText/${encodeURIComponent(instance)}`, {
    number,
    text,
  });
}

async function prepareFlowSteps(
  steps: Record<string, unknown>[],
  baseUrl: string,
  records: PostgresMediaRecord[] = [],
  revisionUrls: string[] = [],
  verification: { headFn?: BlobHead; blobToken?: string; blobStoreId?: string } = {},
): Promise<Record<string, unknown>[]> {
  for (const step of steps) {
    if (step.type === 'text' || step.generatedMedia === 'quotation_pdf') continue;
    const source = String(step.media || '').trim();
    if (!source) throw createHttpError(400, 'A etapa de mídia não possui conteúdo.');
    const stepType = step.type === 'document' ? 'document' : step.type === 'video' ? 'video' : 'image';
    const declaredMime = String(step.mimetype || '').split(';', 1)[0].trim().toLowerCase();
    if (declaredMime && !allowedMediaMimeTypes(stepType).includes(declaredMime)) {
      throw createHttpError(400, 'O tipo MIME não corresponde à etapa do fluxo.');
    }
    const downloaded = await downloadApprovedMedia({
      url: source,
      origin: baseUrl,
      stepType,
      records,
      revisionUrls,
      headFn: verification.headFn,
      blobToken: verification.blobToken,
      blobStoreId: verification.blobStoreId,
    });
    step.deliveryMedia = downloaded.base64;
    step.mimetype = downloaded.mimeType;
  }
  return steps;
}

async function sendMedia(
  number: string,
  step: Record<string, unknown>,
  baseUrl: string,
  records: PostgresMediaRecord[] = [],
  revisionUrls: string[] = [],
  verification: { headFn?: BlobHead; blobToken?: string; blobStoreId?: string } = {},
): Promise<EvolutionDeliveryResult> {
  let media = String(step.deliveryMedia || '').trim();
  if (!media) {
    const source = String(step.media || '').trim();
    if (!source) throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
    const stepType = step.type === 'document' ? 'document' : step.type === 'video' ? 'video' : 'image';
    const declaredMime = String(step.mimetype || '').split(';', 1)[0].trim().toLowerCase();
    if (declaredMime && !allowedMediaMimeTypes(stepType).includes(declaredMime)) {
      throw createHttpError(400, 'O tipo MIME não corresponde à etapa do fluxo.');
    }
    const downloaded = await downloadApprovedMedia({
      url: source,
      origin: baseUrl,
      stepType,
      records,
      revisionUrls,
      headFn: verification.headFn,
      blobToken: verification.blobToken,
      blobStoreId: verification.blobStoreId,
    });
    media = downloaded.base64;
    step.mimetype = downloaded.mimeType;
  }
  if (!/^[A-Za-z0-9+/=_-]+$/.test(media)) {
    throw createHttpError(400, 'Dados de mídia não autorizados.');
  }

  const { instance } = evolutionConfig();
  const mimeType = String(step.mimetype || '').split(';', 1)[0].trim().toLowerCase();
  const mediaType = step.type === 'document'
    ? 'document'
    : mimeType === 'video/mp4'
      ? 'video'
      : 'image';
  if (!allowedMediaMimeTypes(mediaType).includes(mimeType)) {
    throw createHttpError(400, 'O tipo MIME de mídia não é permitido.');
  }
  return evolutionPost(`/message/sendMedia/${encodeURIComponent(instance)}`, {
    number,
    mediatype: mediaType,
    mimetype: mimeType,
    caption: step.caption || '',
    media,
    fileName: safeMediaFilename(step.fileName, mimeType, mediaType === 'video' ? 'referencia' : mediaType),
  });
}

async function sendStep(
  number: string,
  step: Record<string, unknown>,
  baseUrl: string,
  records: PostgresMediaRecord[] = [],
  revisionUrls: string[] = [],
  verification: { headFn?: BlobHead; blobToken?: string; blobStoreId?: string } = {},
): Promise<EvolutionDeliveryResult> {
  if (step.type === 'text') return sendText(number, String(step.text || ''));
  return sendMedia(number, step, baseUrl, records, revisionUrls, verification);
}

// ── Media resolution ───────────────────────────────────────────────────────

async function resolveProductMedia(
  categories: string[],
  maxPerGroup = 1,
  applicationOrigin = '',
  readRecords: () => Promise<PostgresMediaRecord[]> = readCommunicationMediaRecords,
  verification: { headFn?: BlobHead; blobToken?: string; blobStoreId?: string } = {},
): Promise<Record<string, unknown>[]> {
  if (!categories.length) return [];
  const media = (await readRecords()).filter((item) => item.active === true && !isMediaTombstone(item));
  const byGroup: Record<string, Array<Record<string, unknown>>> = {};
  for (const item of media as Array<Record<string, unknown>>) {
    const group = normalizeCategory(item.product_group);
    if (!group || !item.blob_url) continue;
    (byGroup[group] = byGroup[group] || []).push(item);
  }

  const resolved: Record<string, unknown>[] = [];
  for (const cat of categories) {
    const assets = (byGroup[normalizeCategory(cat)] || []).slice(0, maxPerGroup);
    for (const asset of assets) {
      let verified;
      try {
        verified = await verifyOwnedBlobRecord(asset, applicationOrigin, {
          headFn: verification.headFn,
          token: verification.blobToken,
          storeId: verification.blobStoreId,
          expectedProductGroup: normalizeCategory(cat),
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) throw error;
        throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
      }
      const type = verified.contentType === 'video/mp4' ? 'video' : 'image';
      resolved.push({
        type,
        media: verified.url,
        approvedRecord: asset,
        mimetype: verified.contentType,
        fileName: safeMediaFilename(asset.pathname, verified.contentType),
        caption: asset.caption || '',
      });
    }
  }
  return resolved;
}

// ── Duplicate detection ─────────────────────────────────────────────────────

async function checkDuplicate(quotationId: string, phone: string, flowId: string): Promise<boolean> {
  try {
    let keys = [];
    const result = await kv.scan(0, { match: `${KV_KEY_SEND_EVENTS_PREFIX}*`, count: 200 });
    keys = result[1] || [];

    const now = Date.now();
    for (const key of keys) {
      const event = await kv.get(key) as Record<string, unknown> | null;
      if (!event) continue;
      const eventTime = new Date((event.created_at || event.createdAt) as string).getTime();
      if (now - eventTime > DUPLICATE_WINDOW_MS) continue;
      if (event.quotation_id === quotationId && event.phone === phone && event.flow_id === flowId) {
        return true;
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

// ── Send event recording ────────────────────────────────────────────────────

async function recordSendEvent({
  quotationId,
  phone,
  flowId,
  flowName,
  steps,
  evolution,
  duplicateWarning,
  errorMsg,
}: {
  quotationId: string;
  phone: string;
  flowId: string;
  flowName: string;
  steps: Array<Record<string, unknown>>;
  evolution: Array<Record<string, unknown>>;
  duplicateWarning: boolean;
  errorMsg?: string;
}) {
  const eventId = `send_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;
  const event = {
    id: eventId,
    quotation_id: quotationId,
    phone,
    flow_id: flowId,
    flow_name: flowName,
    status: errorMsg ? 'failed' : 'sent',
    steps_planned: steps.length,
    steps_sent: evolution ? evolution.filter(Boolean).length : 0,
    duplicate_warning: !!duplicateWarning,
    error_message: errorMsg || '',
    sent_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  try {
    await kv.set(`${KV_KEY_SEND_EVENTS_PREFIX}${eventId}`, event, { ex: 7 * 24 * 60 * 60 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[send-whatsapp-flow] KV send-event write failed:', msg);
  }
  return eventId;
}

// ── Flow resolution ────────────────────────────────────────────────────────

async function resolveFlow(flowId: string): Promise<FlowRecord | null> {
  try {
    const flows = await kv.get(KV_KEY_FLOWS);
    if (Array.isArray(flows)) {
      const flow = flows.find((f) => f.id === flowId);
      if (flow) return flow;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// ── Build planned steps from flow ──────────────────────────────────────────

function publicFlowStep(step: Record<string, unknown>): Record<string, unknown> {
  const publicStep = { ...step };
  delete publicStep.approvedData;
  delete publicStep.deliveryMedia;
  delete publicStep.approvedRecord;
  if (step.generatedMedia === 'quotation_pdf') {
    publicStep.media = 'quotation_pdf';
    publicStep.media_ref = 'quotation_pdf';
  }
  return stripMediaInternals(publicStep);
}

async function buildSteps(
  flow: FlowRecord,
  context: FlowContext,
  mediaResolver: typeof resolveProductMedia = resolveProductMedia,
): Promise<Record<string, unknown>[]> {
  const steps: Record<string, unknown>[] = [];
  let pdfAdded = false;

  for (const rawStep of flow.steps || []) {
    if (rawStep.type === 'text') {
      const text = renderTemplate(rawStep.template || '', context).trim();
      if (text) steps.push({ type: 'text', text });
    } else if (rawStep.type === 'document' && rawStep.source === 'quotation_pdf') {
      if (!pdfAdded) {
        if (!context.quotationId || !context.pdfBase64) {
          throw createHttpError(503, 'Não foi possível preparar o PDF do orçamento.');
        }
        const caption = rawStep.caption ? renderTemplate(rawStep.caption, context).trim() : '';
        steps.push({
          type: 'document',
          media: 'quotation_pdf',
          deliveryMedia: context.pdfBase64,
          generatedMedia: 'quotation_pdf',
          approvedData: true,
          mimetype: 'application/pdf',
          fileName: `${context.quotationId}.pdf`,
          caption,
        });
        pdfAdded = true;
      }
    } else if (rawStep.type === 'product_media') {
      const maxItems = rawStep.max_items || context.maxMediaPerGroup || flow.max_media_per_product_group || 1;
      const mediaSteps = await mediaResolver(
        context.categories,
        maxItems,
        context.applicationOrigin || '',
      );
      if (mediaSteps.length === 0) {
        throw createHttpError(400, 'A etapa de mídia não encontrou imagens autorizadas.');
      }
      for (const mediaStep of mediaSteps) {
        const media = String(mediaStep.media || '').trim();
        if (!media) throw createHttpError(400, 'A etapa de mídia não possui conteúdo.');
        try {
          normalizeOwnedBlobUrl(media, context.applicationOrigin || '');
        } catch {
          throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
        }
        if (media && !context.permittedMedia.includes(media)) context.permittedMedia.push(media);
        steps.push(mediaStep);
      }
    }
  }

  return steps;
}

export function resolveServerIssuedPublicLink(
  postgresPath: boolean,
  serverIssuedLink: unknown,
  applicationOrigin: string,
): string {
  return postgresPath && isRevisionBoundPublicQuotationUrl(serverIssuedLink, applicationOrigin)
    ? serverIssuedLink
    : '';
}

// ── Handler ─────────────────────────────────────────────────────────────────

export type SendWhatsappFlowDependencies = {
  repository?: ReturnType<typeof createQuotationTemplateRepository>;
  store?: Parameters<typeof loadPostgresSendContext>[0]['store'];
  token?: () => string;
  headBlob?: BlobHead;
  blobToken?: string;
  blobStoreId?: string;
  renderPdf?: Parameters<typeof loadPostgresSendContext>[0]['renderPdf'];
  mediaRecords?: Array<Record<string, unknown>>;
  readMediaRecords?: () => Promise<Array<Record<string, unknown>>>;
  resolveDeal?: Parameters<typeof loadPostgresSendContext>[0]['resolveDeal'];
  resolveMedia?: typeof resolveProductMedia;
  resolveFlow?: (flowId: string) => Promise<FlowRecord | null>;
  checkDuplicate?: typeof checkDuplicate;
  recordSendEvent?: typeof recordSendEvent;
  reservationStore?: WhatsappSendReservationStore;
  deliveryRepository?: Pick<QuotationDeliveryRepository, 'reserve' | 'recordState' | 'prepareDelivery'>;
  beforeTransport?: (idempotencyKey: string) => Promise<void>;
};

function reservationPhase(record: WhatsappSendReservationRecord): string {
  return record.phase;
}

function stepKind(step: Record<string, unknown>): WhatsappSendAcceptedStepKind {
  if (step.type === 'text') return 'text';
  if (step.type === 'video') return 'video';
  if (step.type === 'document') return 'document';
  return 'image';
}

function neutralTerminalResult(result: Record<string, unknown>, steps: Record<string, unknown>[]): Record<string, unknown> {
  const neutral = { ...result };
  delete neutral.phone;
  return { ...neutral, steps: steps.map((step) => ({ type: stepKind(step) })) };
}

function reconciliationBody(phase = 'reconciling'): Record<string, unknown> {
  return {
    error: 'O envio permanece em reconciliação. Não reenvie automaticamente.',
    send_status: phase,
    reconciliation_required: true,
  };
}

function existingReservationResponse(
  record: WhatsappSendReservationRecord,
  flowId: string,
): FunctionResult | null {
  const existingPhase = reservationPhase(record);
  if (existingPhase === 'completed') {
    if (!record.result) throw new WhatsappSendReservationStorageError();
    return jsonResponse(200, sanitizeWhatsappSendTerminalResult(record.result, flowId));
  }
  if (existingPhase === 'accepted_partial') {
    return jsonResponse(503, {
      error: 'O transporte foi aceito e aguarda reconciliação. Não reenvie automaticamente.',
      send_status: 'accepted_partial',
      accepted_partial: true,
      provider_accepted: true,
      partial_send: true,
      reconciliation_required: true,
    });
  }
  if (existingPhase === 'transporting') return jsonResponse(409, reconciliationBody());
  if (existingPhase === 'reserved' && !isWhatsappSendReservationStale(record)) {
    return jsonResponse(409, {
      error: 'Já existe uma reserva para esta revisão e fluxo. Aguarde a reconciliação.',
      send_status: 'reserved',
      reconciliation_required: true,
    });
  }
  return null;
}

function validatedReservationRecord(
  value: unknown,
  key: string,
): WhatsappSendReservationRecord {
  return parseWhatsappSendReservationRecord(value, key);
}

function explicitCasResult(value: unknown, key: string): WhatsappSendReservationCasResult {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { ok?: unknown }).ok !== 'boolean') {
    return { ok: false, reason: 'invalid' };
  }
  const source = value as { ok: boolean; record?: unknown; reason?: unknown };
  if (source.ok) {
    try {
      return { ok: true, record: validatedReservationRecord(source.record, key) };
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  }
  if (!['missing', 'conflict', 'invalid', 'storage'].includes(String(source.reason))) {
    return { ok: false, reason: 'invalid' };
  }
  if (source.record === undefined) return { ok: false, reason: source.reason as 'missing' | 'conflict' | 'invalid' | 'storage' };
  try {
    return {
      ok: false,
      reason: source.reason as 'missing' | 'conflict' | 'invalid' | 'storage',
      record: validatedReservationRecord(source.record, key),
    };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

async function casReservation(
  store: WhatsappSendReservationStore,
  input: Parameters<WhatsappSendReservationStore['compareAndSet']>[0],
): Promise<WhatsappSendReservationCasResult> {
  const candidate = store as WhatsappSendReservationStore & {
    compareAndSet?: WhatsappSendReservationStore['compareAndSet'];
    cas?: WhatsappSendReservationStore['cas'];
  };
  const raw = typeof candidate.compareAndSet === 'function'
    ? await candidate.compareAndSet(input)
    : typeof candidate.cas === 'function'
      ? await candidate.cas(input)
      : undefined;
  return explicitCasResult(raw, input.key);
}

async function casWithRetry(
  store: WhatsappSendReservationStore,
  input: Parameters<WhatsappSendReservationStore['compareAndSet']>[0],
): Promise<WhatsappSendReservationCasResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await casReservation(store, input);
      if (!result.ok && result.reason === 'storage') {
        if (attempt === 2) throw new WhatsappSendReservationStorageError();
        await wait(10 * (attempt + 1));
        continue;
      }
      return result;
    } catch (error) {
      if (attempt === 2) {
        if (error instanceof WhatsappSendReservationStorageError) throw error;
        throw new WhatsappSendReservationStorageError();
      }
      await wait(10 * (attempt + 1));
    }
  }
  throw new WhatsappSendReservationStorageError();
}

async function reservationConflictResponse(
  store: WhatsappSendReservationStore,
  key: string,
  flowId: string,
  conflict: WhatsappSendReservationCasResult,
): Promise<FunctionResult> {
  if (conflict.ok) {
    try {
      if (conflict.record.phase !== 'completed' || !conflict.record.result) return jsonResponse(503, reconciliationBody());
      return jsonResponse(200, sanitizeWhatsappSendTerminalResult(conflict.record.result, flowId));
    } catch {
      return jsonResponse(503, reconciliationBody());
    }
  }
  try {
    const current = await store.get(key);
    if (current) {
      const validated = parseWhatsappSendReservationRecord(current, key);
      if (validated.phase === 'completed' && validated.result) {
        return jsonResponse(200, sanitizeWhatsappSendTerminalResult(validated.result, flowId));
      }
    }
    return jsonResponse(conflict.reason === 'missing' ? 503 : 409, reconciliationBody());
  } catch {
    return jsonResponse(503, reconciliationBody());
  }
}

async function acceptedProviderCasFailure(
  store: WhatsappSendReservationStore,
  key: string,
  flowId: string,
  failure: WhatsappSendReservationCasResult,
): Promise<FunctionResult> {
  try {
    const current = await store.get(key);
    if (current) {
      const validated = parseWhatsappSendReservationRecord(current, key);
      if (validated.phase === 'completed' && validated.result) {
        return jsonResponse(200, sanitizeWhatsappSendTerminalResult(validated.result, flowId));
      }
    }
    if (!failure.ok && failure.reason === 'conflict') return jsonResponse(409, reconciliationBody());
  } catch {
    // Keep the neutral reconciliation response below when the state cannot be read.
  }
  return jsonResponse(503, {
    error: 'O transporte foi aceito, mas a reconciliação não pôde ser persistida. Não reenvie automaticamente.',
    send_status: 'reconciling',
    reconciliation_required: true,
  });
}

export async function handler(
  event: FunctionEvent,
  dependencies: SendWhatsappFlowDependencies = {},
): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método não permitido.' });

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.body || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object');
    payload = parsed;
  } catch {
    return jsonResponse(400, { error: 'JSON inválido.' });
  }

  const flowResolver = dependencies.resolveFlow || resolveFlow;
  const duplicateChecker = dependencies.checkDuplicate || checkDuplicate;
  const sendEventRecorder = dependencies.recordSendEvent || recordSendEvent;
  const reservationStore = dependencies.reservationStore || defaultWhatsappSendReservationStore;
  const deliveryRepository = dependencies.deliveryRepository
    || (Object.keys(dependencies).length === 0 ? createPostgresQuotationDeliveryRepository() : undefined);
  let reservation: WhatsappSendReservationRecord | null = null;
  let reservationKey!: string;

  try {
    const dryRun = payload.dry_run === true || payload.dryRun === true;
    const rawFlowId = firstNonEmpty(payload.flow_id, payload.flowId);
    const rawQuotationId = firstNonEmpty(
      payload.quotation_uuid,
      payload.quotationUuid,
      payload.quotation_id,
      payload.quotationId,
      payload.business_number,
      payload.businessNumber,
      payload.quote_id,
    );
    const rawRevisionId = firstNonEmpty(payload.revision_id, payload.revisionId, payload.quote_revision_id);
    if (!rawFlowId) throw createHttpError(400, 'ID do fluxo é obrigatório.');
    if (!rawQuotationId) throw createHttpError(400, 'Cotação PostgreSQL é obrigatória.');
    if (!rawRevisionId) throw createHttpError(400, 'Revisão PostgreSQL do orçamento é obrigatória.');
    const flowId = minimalLocalIdentifier(rawFlowId, 'ID do fluxo');
    const quotationId = minimalLocalIdentifier(rawQuotationId, 'Identificador do orçamento');
    const revisionId = minimalLocalIdentifier(rawRevisionId, 'Identificador da revisão');

    reservationKey = canonicalWhatsappSendIdempotencyKey(quotationId, revisionId, flowId);
    if (!dryRun) {
      let current: WhatsappSendReservationRecord | null;
      try {
        current = await reservationStore.get(reservationKey);
      } catch (error) {
        if (error instanceof WhatsappSendReservationStorageError) throw error;
        throw new WhatsappSendReservationStorageError();
      }
      if (current) {
        const validated = validatedReservationRecord(current, reservationKey);
        const replay = existingReservationResponse(validated, flowId);
        if (replay) return replay;
      }
    }

    const flow = await flowResolver(flowId);
    if (!flow) throw createHttpError(404, 'Fluxo não encontrado.');
    const configuredPdfSteps = (Array.isArray(flow.steps) ? flow.steps : []).filter(
      (step: Record<string, unknown>) => step.type === 'document' && step.source === 'quotation_pdf',
    ).length;
    if (configuredPdfSteps !== 1) throw createHttpError(400, 'O fluxo deve conter exatamente um PDF do orçamento.');
    const configuredSteps = Array.isArray(flow.steps) ? flow.steps.length : 0;
    const maximumDelayMs = Math.max(0, configuredSteps - 1) * Math.max(0, Number(flow.delay_max_seconds || 0)) * 1000;
    if (!Number.isFinite(maximumDelayMs) || maximumDelayMs > 45_000) {
      throw createHttpError(400, 'O fluxo deve caber no limite de 45 segundos.');
    }
    if (!dryRun) assertEvolutionConfig();

    const host = (event.headers?.host as string | undefined) || 'project-xr5jg.vercel.app';
    const proto = ((event.headers?.['x-forwarded-proto'] as string | undefined) || 'https').split(',')[0].trim();
    const baseUrl = `${proto}://${host}`;
    const context = await loadPostgresSendContext({
      quotationId,
      revisionId,
      businessNumber: firstNonEmpty(payload.business_number, payload.businessNumber),
      recipientPhone: firstNonEmpty(payload.phone, payload.telefone) || undefined,
      needPdf: !deliveryRepository,
      baseUrl,
      repository: dependencies.repository || createQuotationTemplateRepository(),
      store: dependencies.store,
      token: dependencies.token,
      renderPdf: dependencies.renderPdf,
      mediaRecords: dependencies.mediaRecords,
      readMediaRecords: dependencies.readMediaRecords,
      resolveDeal: dependencies.resolveDeal,
    });
    if (!dryRun && deliveryRepository) {
      try {
        const prepared = await deliveryRepository.prepareDelivery({ revisionId, phone: context.phone, flowId });
        context.pdfBase64 = prepared.pdf.toString('base64');
      } catch (error) {
        if (error instanceof QuotationDeliveryPdfError) {
          const publicError = 'PDF indisponível. Tentar novamente.';
          try {
            await deliveryRepository.recordState({ revisionId, state: 'retryable', publicError });
            return jsonResponse(503, { error: publicError, send_status: 'retryable' });
          } catch {
            await deliveryRepository.recordState({
              revisionId,
              state: 'reconciling',
              publicError: 'A falha do PDF não pôde ser persistida. Reconciliação necessária.',
            }).catch(() => undefined);
            return jsonResponse(503, reconciliationBody());
          }
        }
        throw error;
      }
    }
    const businessNumber = canonicalFlowQuotationId(quotationId, context.businessNumber);
    const link = resolveServerIssuedPublicLink(true, context.publicLink, baseUrl);
    const items = context.view.items as Record<string, unknown>[];
    const categories = detectCategories(items);
    const productSummary = flowProductSummary(true, undefined, items);
    const flowContext = {
      nome: context.nome,
      quotationId: businessNumber,
      link,
      pdfBase64: context.pdfBase64,
      postgresPath: true,
      applicationOrigin: baseUrl,
      permittedMedia: link ? [link] : [],
      vendorName: flow.vendor_name || 'Juliana',
      productSummary,
      categories,
      maxMediaPerGroup: flow.max_media_per_product_group || 1,
    };
    const mediaVerification = { headFn: dependencies.headBlob, blobToken: dependencies.blobToken, blobStoreId: dependencies.blobStoreId };
    const injectedMediaReader = dependencies.mediaRecords
      ? async () => dependencies.mediaRecords as PostgresMediaRecord[]
      : dependencies.readMediaRecords
        ? async () => (await dependencies.readMediaRecords!()) as PostgresMediaRecord[]
        : readCommunicationMediaRecords;
    const mediaResolver = dependencies.resolveMedia || ((cats, maxItems, origin) => resolveProductMedia(cats, maxItems, origin, injectedMediaReader, mediaVerification));
    const steps = await buildSteps(flow, flowContext, mediaResolver);
    if (steps.length === 0) throw createHttpError(400, 'Fluxo não gerou nenhuma etapa válida.');
    if (steps.length > 64) throw createHttpError(400, 'O fluxo excede o limite de etapas reconciliáveis.');
    const expandedDelayMaxMs = Math.max(0, Number(flow.delay_max_seconds || 0)) * 1000;
    const expandedMaximumDurationMs = Math.max(0, steps.length - 1) * expandedDelayMaxMs;
    if (!Number.isFinite(expandedMaximumDurationMs) || expandedMaximumDurationMs > 45_000) {
      throw createHttpError(400, 'O fluxo deve caber no limite de 45 segundos.');
    }
    const approvedRecords = steps.map((step) => step.approvedRecord).filter((record): record is PostgresMediaRecord => Boolean(record));
    await prepareFlowSteps(steps, baseUrl, approvedRecords, link ? [link] : [], mediaVerification);

    if (!dryRun) {
      let decision;
      try {
        decision = await reservationStore.reserve({
          key: reservationKey,
          quotationId,
          revisionId,
          flowId,
          stepsCount: steps.length,
        });
      } catch (error) {
        if (error instanceof WhatsappSendReservationStorageError) throw error;
        throw new WhatsappSendReservationStorageError();
      }
      const validated = validatedReservationRecord(decision.record, reservationKey);
      if (decision.kind === 'existing') {
        const replay = existingReservationResponse(validated, flowId);
        if (replay) return replay;
        if (validated.stepsCount !== steps.length) {
          throw new WhatsappSendReservationStorageError('O fluxo mudou enquanto o envio estava pendente.');
        }
        return jsonResponse(409, reconciliationBody());
      }
      if (validated.stepsCount !== steps.length) {
        throw new WhatsappSendReservationStorageError('A quantidade de etapas da reserva não corresponde ao fluxo.');
      }
      reservation = validated;
      await deliveryRepository?.recordState({ revisionId, state: 'pending' });
    }

    let duplicateWarning = false;
    if (businessNumber && !dryRun) duplicateWarning = await duplicateChecker(businessNumber, context.phone, flowId);

    const evolution: EvolutionDeliveryResult[] = [];
    if (!dryRun) {
      await dependencies.beforeTransport?.(reservationKey);
      for (let index = 0; index < steps.length; index += 1) {
        if (index > 0) await wait(randomDelay(
          Number(flow.delay_min_seconds || 0) * 1000,
          Number(flow.delay_max_seconds || 0) * 1000,
        ));
        if (!reservation) throw new WhatsappSendReservationStorageError();
        const transporting = await casWithRetry(reservationStore, {
          key: reservation.key,
          owner: reservation.owner,
          expectedVersion: reservation.version,
          from: reservationPhase(reservation) as 'reserved' | 'accepted_partial',
          to: 'transporting',
          currentStep: index,
        });
        if (!transporting.ok) {
          await deliveryRepository?.recordState({ revisionId, state: 'reconciling', publicError: 'A reserva de transporte mudou. Reconciliação necessária.' });
          return await reservationConflictResponse(reservationStore, reservation.key, flowId, transporting);
        }
        reservation = transporting.record;
        await deliveryRepository?.recordState({ revisionId, state: 'transporting' });
        const response = await sendStep(context.phone, steps[index], baseUrl, approvedRecords, link ? [link] : [], mediaVerification);
        if (!response.accepted) {
          await deliveryRepository?.recordState({ revisionId, state: 'reconciling', publicError: 'A resposta do transporte não confirmou o resultado. Reconciliação necessária.' }).catch(() => undefined);
          return jsonResponse(503, reconciliationBody());
        }
        // Persist neutral acceptance before any next step or bookkeeping.
        const accepted = await casWithRetry(reservationStore, {
          key: reservation.key,
          owner: reservation.owner,
          expectedVersion: reservation.version,
          from: 'transporting',
          to: 'accepted_partial',
          currentStep: index,
          acceptedStep: { step: index, kind: stepKind(steps[index]) },
          errorMessage: 'O transporte foi aceito e aguarda reconciliação.',
        });
        if (!accepted.ok) {
          await deliveryRepository?.recordState({ revisionId, state: 'reconciling', publicError: 'O transporte foi aceito. Reconciliação necessária.' });
          return await acceptedProviderCasFailure(reservationStore, reservation.key, flowId, accepted);
        }
        reservation = accepted.record;
        await deliveryRepository?.recordState({
          revisionId,
          state: 'accepted_partial',
          providerAcceptanceId: response.providerMessageId,
        });
        evolution.push(response);
      }
    }

    let sendEventId = null;
    if (!dryRun) {
      sendEventId = await sendEventRecorder({
        quotationId: businessNumber,
        phone: context.phone,
        flowId,
        flowName: String(flow.name || 'Fluxo'),
        steps: steps.map(publicFlowStep),
        evolution,
        duplicateWarning,
      });
    }
    const resultBody: Record<string, unknown> = {
      success: true,
      dry_run: dryRun,
      send_status: dryRun ? 'dry_run' : 'completed',
      duplicate_warning: duplicateWarning,
      duplicate_message: duplicateWarning ? 'Este fluxo já foi enviado para este telefone há menos de 30 minutos.' : '',
      flow_id: flowId,
      flow_name: String(flow.name || 'Fluxo'),
      quotation_id: businessNumber || null,
      deal_id: context.dealId || null,
      phone: context.phone,
      product_summary: productSummary,
      categories,
      steps_count: steps.length,
      steps: steps.map(publicFlowStep),
      send_event_id: sendEventId,
    };
    if (reservation) {
      const completed = await casWithRetry(reservationStore, {
        key: reservation.key,
        owner: reservation.owner,
        expectedVersion: reservation.version,
        from: 'accepted_partial',
        to: 'completed',
        result: neutralTerminalResult(resultBody, steps),
      });
      if (!completed.ok) {
        await deliveryRepository?.recordState({ revisionId: reservation.revisionId, state: 'reconciling', publicError: 'A conclusão requer reconciliação.' });
        return await reservationConflictResponse(reservationStore, reservation.key, flowId, completed);
      }
      try {
        await deliveryRepository?.recordState({ revisionId: reservation.revisionId, state: 'completed' });
      } catch {
        await deliveryRepository?.recordState({ revisionId: reservation.revisionId, state: 'reconciling', publicError: 'A conclusão não pôde ser confirmada. Reconciliação necessária.' }).catch(() => undefined);
        return jsonResponse(503, reconciliationBody());
      }
    }
    return jsonResponse(200, resultBody);
  } catch (err: unknown) {
    const httpErr = err as HttpError;
    const code = Number.isInteger(httpErr?.statusCode) ? httpErr.statusCode : 500;
    console.error('[send-whatsapp-flow]', httpErr?.logMessage || httpErr?.message || err);
    if (err instanceof WhatsappSendReservationStorageError) {
      return jsonResponse(503, { error: 'Não foi possível consultar o estado durável do envio. Tente novamente sem repetir automaticamente.', send_status: 'reconciling', reconciliation_required: true });
    }
    if (reservation) {
      const currentPhase = reservationPhase(reservation);
      if (currentPhase === 'reserved') {
        try {
          const transitioned = await casWithRetry(reservationStore, {
            key: reservation.key,
            owner: reservation.owner,
            expectedVersion: reservation.version,
            from: 'reserved',
            to: 'retryable',
            errorMessage: 'Falha antes do transporte.',
          });
          if (!transitioned.ok) return await reservationConflictResponse(reservationStore, reservation.key, reservation.flowId, transitioned);
        } catch {
          return jsonResponse(503, { error: 'Não foi possível persistir a falha segura antes do transporte. Não repita automaticamente.', send_status: 'reconciling', reconciliation_required: true });
        }
        await deliveryRepository?.recordState({ revisionId: reservation.revisionId, state: 'retryable', publicError: 'Falha antes do transporte.' });
        return jsonResponse(code, { error: 'Falha antes do transporte. Tente novamente.', send_status: 'retryable' });
      }
      await deliveryRepository?.recordState({
        revisionId: reservation.revisionId,
        state: 'reconciling',
        publicError: 'O envio permanece em reconciliação.',
      }).catch(() => undefined);
      return jsonResponse(503, {
        error: 'O envio permanece em reconciliação. Não reenvie automaticamente.',
        send_status: currentPhase === 'accepted_partial' ? 'accepted_partial' : 'reconciling',
        accepted_partial: currentPhase === 'accepted_partial',
        provider_accepted: currentPhase === 'accepted_partial',
        reconciliation_required: true,
      });
    }
    return jsonResponse(code, { error: httpErr?.message || 'Erro interno.' });
  }
}
