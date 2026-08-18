// POST /api/send-whatsapp — sends quotation messages via Evolution API.
// Keeps commercial context in the app and uses Evolution API only as the WhatsApp transport.

import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createHttpError } from '../_shared/http-error.js';
import { getTimeBasedGreeting } from './lib/time-greeting.js';
import {
  createQuotationTemplateRepository,
  quotationSnapshotViewModel,
  type QuotationTemplateSnapshot,
} from '../_db/quotation-template-repository.js';
import {
  issuePublicQuotationToken,
  isRevisionBoundPublicQuotationUrl,
  renderPublicQuotationPdf,
  type PublicQuotationDependencies,
} from '../modules/public-quotation.js';
import {
  LIVE_DEPS,
  sanitizeWhatsappMediaUrl,
  upsertWhatsappMessages,
  WhatsappAttachment,
} from './lib/whatsapp-conversations-store.js';
import {
  allowedMediaMimeTypes,
  downloadApprovedMedia,
  MAX_DOCUMENT_BYTES,
  normalizePostgresMediaUrl,
  readCommunicationMediaRecords,
  resolveOwnedPostgresMediaUrls,
  safeMediaFilename,
  stripMediaInternals,
  type BlobHead,
  type PostgresMediaRecord,
} from './lib/postgres-media.js';
import { normalizeEvolutionDelivery, type EvolutionDeliveryResult } from './lib/evolution-delivery.js';
import { createPostgresCrmDealRepository, type CrmDealRecord } from '../_db/crm-deals-repository.js';
import {
  createPostgresQuotationDeliveryRepository,
  type QuotationDeliveryRepository,
} from '../_db/quotation-delivery-repository.js';

// ponytail: .trim() guards against CRLF .env files (\r glued to the instance name corrupts the URL)
function evolutionConfig(): { baseUrl: string; apiKey: string; instance: string } {
  return {
    baseUrl: (process.env.EVOLUTION_BASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: (process.env.EVOLUTION_API_KEY || '').trim(),
    instance: (process.env.EVOLUTION_INSTANCE || '').trim(),
  };
}
const DEFAULT_TEMPLATE =
  '(Saudacao), (primeiro_nome)! Tudo bem?\n\nSegue o orçamento (numero_pedido):\n(link_orcamento)\n\nQualquer dúvida estamos à disposição.\nAspen Estamparia';
export const MAX_QUOTATION_PDF_BYTES = MAX_DOCUMENT_BYTES;

const DEFAULT_SEQUENCE_STEPS: SequenceStep[] = [
  { type: 'text', template: 'Olá, (primeiro_nome), tudo bem?' },
  {
    type: 'text',
    template:
      'Meu nome é (vendedora), da (empresa). Estou entrando em contato sobre o seu orçamento de (produto_resumo) (produto_adjetivo_personalizado).',
  },
  { type: 'text', template: 'Segue o orçamento (numero_pedido):\n(link_orcamento)' },
  {
    type: 'text',
    template:
      'Também estou te enviando algumas fotos de referência dos modelos para você visualizar melhor as opções.',
  },
  { type: 'product_images' },
];
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

// ── Basic helpers ───────────────────────────────────────────────────────────

function jsonResponse(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function normalizePhone(phone: unknown): string {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  digits = digits.replace(/^55(\d{10,11})$/, '$1').replace(/^0(\d{10,11})$/, '$1');
  if (!/^\d{10,11}$/.test(digits)) return '';
  return `55${digits}`;
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function toPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function collectMediaCandidates(
  sequence: Record<string, unknown> | null,
  payload: Record<string, unknown>,
): unknown[] {
  const candidates: unknown[] = [];
  const steps = Array.isArray(sequence?.steps) ? sequence.steps as Array<Record<string, unknown>> : [];
  for (const step of steps) {
    if (step.media || step.url) candidates.push(step.media || step.url);
  }
  for (const candidate of [payload.media_url, payload.mediaUrl, payload.url, payload.media]) {
    if (candidate) candidates.push(candidate);
  }
  for (const sampleImages of [sequence?.sample_images, payload.sample_images]) {
    if (!sampleImages || typeof sampleImages !== 'object' || Array.isArray(sampleImages)) continue;
    for (const value of Object.values(sampleImages as Record<string, unknown>)) {
      if (Array.isArray(value)) candidates.push(...value);
      else if (value) candidates.push(...String(value).split(/\n|,/));
    }
  }
  return candidates;
}

function publicBaseUrl(event: { headers?: Record<string, string | string[] | undefined> }): string {
  const host = (event.headers?.host as string | undefined) || 'project-xr5jg.vercel.app';
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i.test(host);
  const protocol = isLocalHost
    ? 'http'
    : String(event.headers?.['x-forwarded-proto'] || 'https')
        .split(',')[0]
        .trim();
  return `${protocol}://${host}`;
}

function normalizeProductSummaryTemplate(template: string): string {
  return String(template || DEFAULT_TEMPLATE)
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

interface TemplateContext {
  nome: string;
  quotationId: string;
  link: string;
  vendorName: string;
  productSummary: string;
  categories: string[];
  pdfBase64?: string;
  postgresPath?: boolean;
  permittedMedia?: string[];
  mediaRecords?: PostgresMediaRecord[];
  revisionUrls?: string[];
  productPersonalizationAdjective?: string;
}

function renderTemplate(template: string, context: TemplateContext): string {
  const saudacao = getTimeBasedGreeting();
  const nome = context.nome || '';
  const primeiroNome = nome.trim().split(/\s+/)[0] || nome;
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
    .replace(/\(produto_adjetivo_personalizado\)/g, productPersonalizationAdjective);
}

function normalizeCategory(value: unknown): string {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return CATEGORY_ALIASES[key] || String(value);
}

function detectCategories(items: Array<Record<string, unknown>> = []): string[] {
  const categories: string[] = [];
  for (const item of items || []) {
    const sku = String(item?.sku || item?.item_code || item?.itemCode || '')
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

function normalizeSampleImages(
  sampleImages: Record<string, unknown> = {},
  baseUrl: string,
  permittedMedia: string[] = [],
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [rawCategory, rawUrls] of Object.entries(sampleImages || {})) {
    const category = normalizeCategory(rawCategory);
    const urls = Array.isArray(rawUrls) ? rawUrls : String(rawUrls || '').split(/\n|,/);
    normalized[category] = urls.filter(Boolean).map((url) => {
      try {
        return normalizePostgresMediaUrl(url, baseUrl, permittedMedia);
      } catch {
        throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
      }
    });
  }
  return normalized;
}

interface SequenceStep {
  type: string;
  template?: string;
  text?: string;
  media?: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
  source?: string;
  url?: string;
  category?: string;
  selection?: string;
  max_items?: number;
  caption_template?: string;
  approvedData?: boolean;
  generatedMedia?: 'quotation_pdf';
  deliveryMedia?: string;
  approvedRecord?: PostgresMediaRecord;
}

function buildSequenceSteps({
  payload,
  sequence,
  context,
  baseUrl,
}: {
  payload: Record<string, unknown>;
  sequence: Record<string, unknown> | null;
  context: TemplateContext;
  baseUrl: string;
}): SequenceStep[] {
  const rawSteps =
    Array.isArray(sequence?.steps) && (sequence.steps as unknown[]).length > 0
      ? (sequence.steps as SequenceStep[])
      : DEFAULT_SEQUENCE_STEPS;
  const maxImagesPerCategory = toPositiveInt(
    (sequence as Record<string, unknown>)?.max_images_per_category,
    2,
    0,
    6,
  );
  const categories = context.categories;
  const sampleImages = normalizeSampleImages(
    (sequence?.sample_images as Record<string, unknown> | undefined) ||
      (payload.sample_images as Record<string, unknown> | undefined) ||
      {},
    baseUrl,
    context.permittedMedia || [],
  );
  const planned: SequenceStep[] = [];

  for (const rawStep of rawSteps.slice(0, 12)) {
    const type = String(rawStep?.type || 'text');
    if (type === 'product_images') {
      let resolvedCount = 0;
      for (const category of categories) {
        const urls = (sampleImages[category] || []).slice(0, maxImagesPerCategory);
        for (let i = 0; i < urls.length; i++) {
          resolvedCount += 1;
          planned.push({
            type: 'image',
            media: urls[i],
            mimetype: rawStep.mimetype || 'image/jpeg',
            fileName: `${category}-${i + 1}.jpg`,
            caption: rawStep.caption ? renderTemplate(rawStep.caption, context) : '',
            category,
          });
        }
      }
      if (categories.length > 0 && resolvedCount === 0) {
        throw createHttpError(400, 'A etapa de mídia não encontrou imagens autorizadas.');
      }
      continue;
    }

    if (type === 'image' || type === 'video') {
      const sourceMedia = String(rawStep.media || rawStep.url || '').trim();
      if (!sourceMedia) throw createHttpError(400, 'A etapa de mídia não possui uma URL.');
      let media: string;
      try {
        media = normalizePostgresMediaUrl(sourceMedia, baseUrl, context.permittedMedia || []);
      } catch {
        throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
      }
      planned.push({
        type,
        media,
        mimetype: rawStep.mimetype || (type === 'video' ? 'video/mp4' : 'image/jpeg'),
        fileName: rawStep.fileName || 'referencia.jpg',
        caption: rawStep.caption ? renderTemplate(rawStep.caption, context) : '',
      });
      continue;
    }

    if (type === 'document') {
      if (rawStep.source === 'quotation_pdf') {
        if (!context.quotationId || !context.pdfBase64) {
          throw createHttpError(503, 'Não foi possível preparar o PDF do orçamento.');
        }
        const caption = rawStep.caption ? renderTemplate(rawStep.caption, context).trim() : '';
        planned.push({
          type: 'document',
          media: 'quotation_pdf',
          deliveryMedia: context.pdfBase64,
          generatedMedia: 'quotation_pdf',
          approvedData: true,
          mimetype: 'application/pdf',
          fileName: `${context.quotationId}.pdf`,
          caption,
        });
        continue;
      }

      const sourceMedia = String(rawStep.media || rawStep.url || '').trim();
      if (!sourceMedia) throw createHttpError(400, 'A etapa de documento não possui uma URL.');
      let media: string;
      try {
        media = normalizePostgresMediaUrl(sourceMedia, baseUrl, context.permittedMedia || []);
      } catch {
        throw createHttpError(400, 'Documento público inválido para cotação PostgreSQL.');
      }
      planned.push({
        type: 'document',
        media,
        mimetype: rawStep.mimetype || 'application/pdf',
        fileName: rawStep.fileName || 'documento.pdf',
        caption: rawStep.caption ? renderTemplate(rawStep.caption, context).trim() : '',
      });
      continue;
    }

    const text = renderTemplate(rawStep.template || rawStep.text || '', context).trim();
    if (text) planned.push({ type: 'text', text });
  }

  return planned;
}

function publicSequenceStep(step: SequenceStep): Record<string, unknown> {
  const publicStep: Record<string, unknown> = { ...step };
  delete publicStep.approvedData;
  delete publicStep.deliveryMedia;
  delete publicStep.approvedRecord;
  if (step.generatedMedia === 'quotation_pdf') {
    publicStep.media = 'quotation_pdf';
    publicStep.media_ref = 'quotation_pdf';
  }
  return stripMediaInternals(publicStep);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

// ── Quotation snapshot context resolution ───────────────────────────────────

type QuotationSnapshotRepository = ReturnType<typeof createQuotationTemplateRepository>;
type PublicQuotationStore = NonNullable<PublicQuotationDependencies['store']>;
type LocalDealResolver = (quotationId: string, businessNumber: string) => Promise<CrmDealRecord | null>;

type PostgresSendContext = {
  snapshot: QuotationTemplateSnapshot;
  view: ReturnType<typeof quotationSnapshotViewModel>;
  quotation: Record<string, unknown>;
  dealId: string | null;
  quotationUuid: string;
  revisionId: string;
  businessNumber: string;
  nome: string;
  email: string;
  telefone: string;
  phone: string;
  publicLink: string;
  pdfBase64: string;
  permittedMedia: string[];
  mediaRecords: PostgresMediaRecord[];
};

async function defaultLocalDealResolver(
  quotationId: string,
  businessNumber: string,
): Promise<CrmDealRecord | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const deals = await createPostgresCrmDealRepository().list({ search: businessNumber, limit: 500 });
    return deals.find(
      (deal) =>
        deal.quotationId === quotationId ||
        deal.quotation === businessNumber ||
        deal.quotationId === businessNumber,
    ) || null;
  } catch {
    return null;
  }
}

export async function loadPostgresSendContext(input: {
  quotationId: string;
  revisionId: string;
  businessNumber?: string;
  recipientPhone?: unknown;
  needPdf: boolean;
  baseUrl: string;
  repository: QuotationSnapshotRepository;
  store?: PublicQuotationStore;
  token?: () => string;
  renderPdf?: NonNullable<PublicQuotationDependencies['renderPdf']>;
  mediaCandidates?: unknown[];
  mediaRecords?: Array<Record<string, unknown>>;
  readMediaRecords?: () => Promise<Array<Record<string, unknown>>>;
  resolveDeal?: LocalDealResolver;
}): Promise<PostgresSendContext> {
  const quotationId = String(input.quotationId || '').trim();
  const revisionId = String(input.revisionId || '').trim();
  const businessNumber = String(input.businessNumber || '').trim();
  if (!quotationId) throw createHttpError(400, 'Cotação PostgreSQL é obrigatória.');
  if (!revisionId) throw createHttpError(400, 'Revisão PostgreSQL do orçamento é obrigatória.');

  const snapshot = await input.repository.get(revisionId);
  if (!snapshot || snapshot.revision.id !== revisionId) {
    throw createHttpError(404, 'Orçamento PostgreSQL não encontrado.');
  }
  const requestedQuotationMatches =
    quotationId === snapshot.quotation.id || quotationId === snapshot.quotation.businessNumber;
  if (!requestedQuotationMatches) {
    throw createHttpError(409, 'A cotação não corresponde à revisão PostgreSQL informada.');
  }
  if (businessNumber && businessNumber !== snapshot.quotation.businessNumber) {
    throw createHttpError(409, 'O número do orçamento não corresponde à revisão PostgreSQL informada.');
  }

  const view = quotationSnapshotViewModel(snapshot);
  const client = view.client as unknown as Record<string, unknown>;
  const telefone = String(client.phone || client.telefone || '').trim();
  const phone = normalizePhone(telefone);
  if (!phone) throw createHttpError(400, 'A cotação não possui telefone válido para envio via WhatsApp.');
  if (input.recipientPhone != null && normalizePhone(input.recipientPhone) !== phone) {
    throw createHttpError(400, 'O telefone informado não pertence à cotação PostgreSQL.');
  }

  let permittedMedia: string[] = [];
  let mediaRecords: PostgresMediaRecord[] = [];
  const candidates = (input.mediaCandidates || []).filter(Boolean);
  if (candidates.length > 0) {
    try {
      mediaRecords = (input.mediaRecords ||
        (input.readMediaRecords ? await input.readMediaRecords() : await readCommunicationMediaRecords())) as PostgresMediaRecord[];
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      throw createHttpError(503, 'Não foi possível validar as mídias cadastradas.');
    }
    try {
      permittedMedia = resolveOwnedPostgresMediaUrls(candidates, input.baseUrl, mediaRecords);
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
    }
  }

  let pdfBase64 = '';
  if (input.needPdf) {
    try {
      const pdf = Buffer.from(
        await renderPublicQuotationPdf(revisionId, {
          repository: input.repository,
          renderPdf: input.renderPdf,
        }),
      );
      if (!pdf.length) throw createHttpError(503, 'PDF do orçamento veio vazio.');
      if (pdf.length > MAX_QUOTATION_PDF_BYTES) {
        throw createHttpError(413, 'O PDF do orçamento excede o limite permitido.');
      }
      const encodedPdf = pdf.toString('base64');
      if (encodedPdf.length > Math.ceil((MAX_QUOTATION_PDF_BYTES / 3)) * 4) {
        throw createHttpError(413, 'O PDF do orçamento excede o limite permitido.');
      }
      pdfBase64 = encodedPdf;
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      if (error instanceof Error && /rascunho|compartilh/i.test(error.message)) {
        throw createHttpError(409, 'Emita o orçamento antes de enviar WhatsApp.');
      }
      throw createHttpError(503, 'Não foi possível preparar o PDF do orçamento.');
    }
  }

  let token;
  try {
    token = await issuePublicQuotationToken({
      revisionId,
      repository: input.repository,
      store: input.store,
      token: input.token,
    });
  } catch (error) {
    if (error instanceof Error && /rascunho|compartilh/i.test(error.message)) {
      throw createHttpError(409, 'A cotação não está disponível para envio.');
    }
    throw createHttpError(503, 'Não foi possível preparar o link público do orçamento.');
  }

  const canonicalBusinessNumber = snapshot.quotation.businessNumber;
  const resolveDeal = input.resolveDeal || defaultLocalDealResolver;
  const deal = await resolveDeal(snapshot.quotation.id, canonicalBusinessNumber);
  return {
    snapshot,
    view,
    quotation: { items: view.items },
    dealId: deal?.id || null,
    quotationUuid: snapshot.quotation.id,
    revisionId,
    businessNumber: canonicalBusinessNumber,
    nome: String(client.name || client.nome || ''),
    email: String(client.email || ''),
    telefone,
    phone,
    publicLink: `${input.baseUrl}/api/public-quotation?token=${encodeURIComponent(token.token)}`,
    pdfBase64,
    permittedMedia,
    mediaRecords,
  };
}

// ── Evolution API ───────────────────────────────────────────────────────────

function assertEvolutionConfig(): void {
  const { baseUrl, apiKey, instance } = evolutionConfig();
  const missing: string[] = [];
  if (!baseUrl) missing.push('EVOLUTION_BASE_URL');
  if (!apiKey) missing.push('EVOLUTION_API_KEY');
  if (!instance) missing.push('EVOLUTION_INSTANCE');
  if (missing.length > 0) {
    throw createHttpError(
      500,
      'Integração do WhatsApp não configurada. Verifique as variáveis da Evolution API.',
      `[send-whatsapp] missing env: ${missing.join(', ')}`
    );
  }
}

async function evolutionPost(path: string, body: Record<string, unknown>): Promise<EvolutionDeliveryResult> {
  const { baseUrl, apiKey } = evolutionConfig();
  const url = `${baseUrl}${path}`;
  let res: Response;
  let responseBody: unknown;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify(body),
    });
    responseBody = await res.json().catch(() => null);
  } catch (err) {
    throw createHttpError(
      502,
      'Falha ao conectar com o WhatsApp. Tente novamente.',
      `[send-whatsapp] Evolution fetch failed: ${(err as Error).message}`
    );
  }

  if (!res.ok) {
    throw createHttpError(
      res.status === 401 || res.status === 403 ? 502 : 400,
      'Não foi possível enviar a mensagem pelo WhatsApp. Verifique se a instância está conectada.',
      `[send-whatsapp] Evolution HTTP ${res.status}`
    );
  }

  const delivery = normalizeEvolutionDelivery(responseBody);
  if (!delivery) {
    throw createHttpError(502, 'O provedor não confirmou o recebimento da mensagem.');
  }
  return delivery;
}

export async function sendText(number: string, text: string): Promise<EvolutionDeliveryResult> {
  const { instance } = evolutionConfig();
  return evolutionPost(`/message/sendText/${encodeURIComponent(instance)}`, {
    number,
    text,
  });
}

async function prepareSequenceSteps(
  steps: SequenceStep[],
  baseUrl: string,
  records: PostgresMediaRecord[] = [],
  revisionUrls: string[] = [],
  verification: { headFn?: BlobHead; blobToken?: string; blobStoreId?: string } = {},
): Promise<SequenceStep[]> {
  for (const step of steps) {
    if (step.type === 'text' || step.generatedMedia === 'quotation_pdf') continue;
    const media = String(step.media || '').trim();
    if (!media) throw createHttpError(400, 'A etapa de mídia não possui conteúdo.');
    const stepType = step.type === 'document' ? 'document' : step.type === 'video' ? 'video' : 'image';
    const declaredMime = String(step.mimetype || '').split(';', 1)[0].trim().toLowerCase();
    if (declaredMime && !allowedMediaMimeTypes(stepType).includes(declaredMime)) {
      throw createHttpError(400, 'O tipo MIME não corresponde à etapa do fluxo.');
    }
    const downloaded = await downloadApprovedMedia({
      url: media,
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
  step: SequenceStep,
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
  step: SequenceStep,
  baseUrl: string,
  records: PostgresMediaRecord[] = [],
  revisionUrls: string[] = [],
  verification: { headFn?: BlobHead; blobToken?: string; blobStoreId?: string } = {},
): Promise<EvolutionDeliveryResult> {
  if (step.type === 'text') return sendText(number, step.text || '');
  return sendMedia(number, step, baseUrl, records, revisionUrls, verification);
}

// ── Handler ─────────────────────────────────────────────────────────────────


export type SendWhatsappHandlerDependencies = {
  repository?: QuotationSnapshotRepository;
  store?: PublicQuotationStore;
  token?: () => string;
  headBlob?: BlobHead;
  blobToken?: string;
  blobStoreId?: string;
  renderPdf?: NonNullable<PublicQuotationDependencies['renderPdf']>;
  mediaRecords?: Array<Record<string, unknown>>;
  readMediaRecords?: () => Promise<Array<Record<string, unknown>>>;
  resolveDeal?: LocalDealResolver;
  deliveryRepository?: Pick<QuotationDeliveryRepository, 'claimTransport' | 'getByRevision' | 'prepareDelivery' | 'recordState'>;
  deliveryRepositoryFactory?: () => Pick<QuotationDeliveryRepository, 'claimTransport' | 'getByRevision' | 'prepareDelivery' | 'recordState'>;
};

export async function handler(
  event: FunctionEvent,
  dependencies: SendWhatsappHandlerDependencies = {},
): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Método não permitido.' });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.body || '{}') as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'JSON inválido' });
  }

  let providerAcceptedCount = 0;
  let providerStarted = false;
  let transportClaimed = false;
  let deliveryRepository: SendWhatsappHandlerDependencies['deliveryRepository'];
  let normalizedRevisionId = '';
  try {
    const dryRun = payload.dry_run === true || payload.dryRun === true;
    const quotationId = firstNonEmpty(
      payload.quotation_id as string | undefined,
      payload.quotationId as string | undefined,
      payload.business_number as string | undefined,
      payload.businessNumber as string | undefined,
      payload.quotation_uuid as string | undefined,
      payload.quote_id as string | undefined,
    );
    const revisionId = firstNonEmpty(
      payload.revisionId as string | undefined,
      payload.quote_revision_id as string | undefined,
      payload.revision_id as string | undefined,
    );
    normalizedRevisionId = revisionId;
    // Legacy provider/core markers are ignored. Quote and revision identifiers
    // alone select the immutable local snapshot path.
    const postgresPath = Boolean(quotationId || revisionId);
    deliveryRepository = dependencies.deliveryRepository
      || (postgresPath && dependencies.deliveryRepositoryFactory ? dependencies.deliveryRepositoryFactory() : undefined)
      || (!dependencies.repository && postgresPath ? createPostgresQuotationDeliveryRepository() : undefined);
    const baseUrl = publicBaseUrl(event);
    const sequenceForResolution =
      (payload.whatsapp_sequence as Record<string, unknown> | undefined) ||
      (payload.sequence as Record<string, unknown> | undefined) ||
      null;
    const mediaCandidates = collectMediaCandidates(sequenceForResolution, payload);
    if (postgresPath && !quotationId) {
      throw createHttpError(400, 'Cotação PostgreSQL é obrigatória.');
    }
    if (postgresPath && !revisionId) {
      throw createHttpError(400, 'Revisão PostgreSQL do orçamento é obrigatória.');
    }
    if (!postgresPath && mediaCandidates.length > 0) {
      throw createHttpError(400, 'Mídia pública só pode ser enviada com uma revisão PostgreSQL.');
    }

    const quotationPdfSteps = sequenceForResolution && Array.isArray(sequenceForResolution.steps)
      ? (sequenceForResolution.steps as Array<Record<string, unknown>>).filter(
          (step) => step.type === 'document' && step.source === 'quotation_pdf',
        ).length
      : 0;
    if (postgresPath && quotationPdfSteps !== 1) {
      throw createHttpError(400, 'O fluxo deve conter exatamente um PDF do orçamento.');
    }
    const needPdf = quotationPdfSteps === 1;
    const resolved = postgresPath
      ? await loadPostgresSendContext({
          quotationId,
          revisionId,
          businessNumber: firstNonEmpty(
            payload.business_number as string | undefined,
            payload.businessNumber as string | undefined,
          ),
          recipientPhone: firstNonEmpty(
            payload.telefone as string | undefined,
            payload.phone as string | undefined,
          ) || undefined,
          needPdf,
          baseUrl,
          repository: dependencies.repository || createQuotationTemplateRepository(),
          store: dependencies.store,
          token: dependencies.token,
          renderPdf: dependencies.renderPdf,
          mediaCandidates,
          mediaRecords: dependencies.mediaRecords,
          readMediaRecords: dependencies.readMediaRecords,
          resolveDeal: dependencies.resolveDeal,
        })
      : null;

    const nome = resolved
      ? resolved.nome
      : firstNonEmpty(payload.nome as string | undefined);
    const number = resolved
      ? resolved.phone
      : normalizePhone(
          firstNonEmpty(
            payload.telefone as string | undefined,
            payload.phone as string | undefined,
          ),
        );
    if (!number) throw createHttpError(400, 'Telefone inválido ou ausente para envio via WhatsApp.');

    const link = resolved && isRevisionBoundPublicQuotationUrl(resolved.publicLink, baseUrl)
      ? resolved.publicLink
      : '';
    const sequence = sequenceForResolution;
    const items = (resolved
      ? resolved.view.items
      : payload.items || payload.order_items || payload.quotation_items || []) as Array<Record<string, unknown>>;
    const categories = detectCategories(items);
    const productSummary = resolved
      ? productSummaryFromCategories(categories)
      : firstNonEmpty(
          payload.produto_resumo as string | undefined,
          payload.product_summary as string | undefined,
          sequence?.product_summary as string | undefined,
          productSummaryFromCategories(categories),
        );
    const messageQuotationId = resolved?.businessNumber || quotationId;
    const context: TemplateContext = {
      nome,
      quotationId: messageQuotationId,
      link,
      vendorName:
        (sequence?.vendor_name as string | undefined) ||
        (payload.vendedora as string | undefined) ||
        (payload.vendor_name as string | undefined) ||
        'Juliana',
      productSummary,
      categories,
      pdfBase64: resolved?.pdfBase64,
      postgresPath: Boolean(resolved),
      permittedMedia: [
        ...(resolved?.permittedMedia || []),
        ...(link ? [link] : []),
      ],
      mediaRecords: resolved?.mediaRecords || [],
      revisionUrls: link ? [link] : [],
    };

    if (sequence) {
      const delayMinMs = toPositiveInt(
        (sequence as Record<string, unknown>)?.delay_min_ms ??
          (sequence as Record<string, unknown>)?.delayMinMs,
        5000,
        0,
        30000,
      );
      const delayMaxMs = toPositiveInt(
        (sequence as Record<string, unknown>)?.delay_max_ms ??
          (sequence as Record<string, unknown>)?.delayMaxMs,
        Math.max(delayMinMs, 8000),
        delayMinMs,
        45000,
      );
      const steps = buildSequenceSteps({ payload, sequence, context, baseUrl });
      const maximumDurationMs = Math.max(0, steps.length - 1) * delayMaxMs;
      if (maximumDurationMs > 45_000) throw createHttpError(400, 'O fluxo deve caber no limite de 45 segundos.');
      if (steps.length === 0) {
        throw createHttpError(400, 'Sequência de WhatsApp vazia. Configure ao menos uma mensagem ou mídia.');
      }
      const mediaVerification = {
        headFn: dependencies.headBlob,
        blobToken: dependencies.blobToken,
        blobStoreId: dependencies.blobStoreId,
      };
      await prepareSequenceSteps(
        steps,
        baseUrl,
        context.mediaRecords || [],
        context.revisionUrls || [],
        mediaVerification,
      );

      const evolution: EvolutionDeliveryResult[] = [];
      if (!dryRun && deliveryRepository && resolved) {
        const existing = await deliveryRepository.getByRevision(resolved.revisionId);
        if (existing?.state === 'completed') return jsonResponse(200, { success: true, send_status: 'completed', quotation_id: messageQuotationId, number, steps: steps.map(publicSequenceStep) });
        if (existing?.state === 'reconciling' || existing?.state === 'transporting' || existing?.state === 'accepted_partial' || existing?.readOnly) return jsonResponse(409, { error: 'O envio permanece em reconciliação. Não reenvie automaticamente.', send_status: existing?.state === 'transporting' ? 'transporting' : 'reconciling', reconciliation_required: true });
        await deliveryRepository.prepareDelivery({ revisionId: resolved.revisionId, phone: resolved.phone, flowId: firstNonEmpty(payload.flow_id as string | undefined, payload.flowId as string | undefined) || 'direct-send' });
        const claimed = await deliveryRepository.claimTransport(resolved.revisionId);
        if (!claimed) return jsonResponse(409, { error: 'O envio já está em andamento ou requer reconciliação.', send_status: 'reconciling', reconciliation_required: true });
        transportClaimed = true;
      }
      if (!dryRun) {
        assertEvolutionConfig();
        for (let i = 0; i < steps.length; i++) {
          if (i > 0) await wait(randomDelay(delayMinMs, delayMaxMs));
          const step = steps[i];
          providerStarted = true;
          const response = await sendStep(
            number,
            step,
            baseUrl,
            context.mediaRecords || [],
            context.revisionUrls || [],
            mediaVerification,
          );
          if (!response.accepted) {
            if (deliveryRepository && resolved) await deliveryRepository.recordState({ revisionId: resolved.revisionId, state: 'reconciling', publicError: 'A resposta do transporte não confirmou o resultado.' }).catch(() => undefined);
            throw createHttpError(502, 'O provedor não confirmou a mensagem.');
          }
          providerAcceptedCount += 1;
          if (deliveryRepository && resolved) await deliveryRepository.recordState({ revisionId: resolved.revisionId, state: 'accepted_partial', providerAcceptanceId: response.providerMessageId });
          evolution.push(response);

          if (step.type === 'document' && step.approvedData === true && resolved) {
            try {
              const conversations = await LIVE_DEPS.readConversations();
              const conversation = conversations.find((item) => item.providerConversationId === number);
              if (conversation) {
                const attachment: WhatsappAttachment = {
                  id: LIVE_DEPS.id(),
                  kind: 'document',
                  mimeType: step.mimetype || 'application/pdf',
                  fileName: step.fileName || `${messageQuotationId}.pdf`,
                  mediaUrl: sanitizeWhatsappMediaUrl(context.link, { applicationOrigin: baseUrl }),
                  caption: step.caption || '',
                  origin: 'internal_generated',
                  documentRole: 'quotation_pdf',
                  quotationId: resolved.quotationUuid,
                  quotationBusinessNumber: resolved.businessNumber,
                  leadId: null,
                  customerId: null,
                };
                await upsertWhatsappMessages(conversation.id, [{
                  direction: 'outbound',
                  fromMe: true,
                  type: 'document',
                  body: step.caption || '',
                  attachments: [attachment],
                  timestamp: new Date().toISOString(),
                }]);
              }
            } catch (error) {
              console.error(
                '[send-whatsapp] persistence failed:',
                error instanceof Error ? error.name : typeof error,
              );
            }
          }
        }
      }

      if (!dryRun && deliveryRepository && resolved) await deliveryRepository.recordState({ revisionId: resolved.revisionId, state: 'completed' });
      return jsonResponse(200, {
        success: true,
        dry_run: dryRun,
        quotation_id: messageQuotationId || null,
        deal_id: resolved?.dealId || null,
        number,
        delay_min_ms: delayMinMs,
        delay_max_ms: delayMaxMs,
        product_summary: productSummary,
        categories,
        steps: steps.map(publicSequenceStep),
        evolution,
      });
    }

    const text = firstNonEmpty(
      payload.mensagem as string | undefined,
      payload.message as string | undefined,
    ) || renderTemplate(String(payload.template || ''), context);
    if (!text.trim()) throw createHttpError(400, 'Mensagem vazia.');

    let evolution: EvolutionDeliveryResult | null = null;
    if (!dryRun) {
      assertEvolutionConfig();
      evolution = await sendText(number, text);
      if (!evolution.accepted) throw createHttpError(502, 'O provedor não confirmou a mensagem.');
      providerAcceptedCount = 1;
    }

    return jsonResponse(200, {
      success: true,
      dry_run: dryRun,
      quotation_id: messageQuotationId || null,
      deal_id: resolved?.dealId || null,
      number,
      message: text,
      evolution,
    });
  } catch (err) {
    const typedErr = err as {
      statusCode?: number;
      logMessage?: string;
      message?: string;
      providerAccepted?: boolean;
    };
    const code = Number.isInteger(typedErr?.statusCode) ? typedErr.statusCode! : 500;
    console.error(
      '[send-whatsapp]',
      err instanceof Error ? err.name : typeof err,
      code,
    );
    if (deliveryRepository && normalizedRevisionId && (providerStarted || transportClaimed)) {
      const uncertain = providerAcceptedCount > 0 || providerStarted;
      await deliveryRepository.recordState({ revisionId: normalizedRevisionId, state: uncertain ? 'reconciling' : 'retryable', publicError: uncertain ? 'O envio permanece em reconciliação.' : 'Falha antes do transporte.' }).catch(() => undefined);
    }
    if (providerAcceptedCount > 0) {
      return jsonResponse(502, {
        error: 'Parte da mensagem foi aceita; o envio foi interrompido após confirmação parcial.',
        provider_accepted: true,
        partial_send: true,
        accepted_steps: providerAcceptedCount,
      });
    }
    return jsonResponse(code, { error: typedErr?.message || 'Erro interno.' });
  }
}
