// POST /api/send-whatsapp — sends quotation messages via Evolution API.
// Keeps commercial context in the app and uses Evolution API only as the WhatsApp transport.

import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import {
  erpGetList,
  erpGetDoc,
  erpPut,
  createHttpError,
  ERPNEXT_BASE,
  ERPNEXT_TOKEN,
} from './lib/erpnext.js';
import { generateQuotationPdf } from './lib/quotation-pdf.js';
import { getTimeBasedGreeting } from './lib/time-greeting.js';
import { isOperationalMode } from './operational-mode.js';
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
} from './public-quotation.js';
import { getDatabase } from '../_db/client.js';
import {
  deriveOpaqueQuotationOutboxIdempotencyKey,
  enqueueQuotationSentEvent,
  QuotationOutboxDurabilityError,
} from '../_db/quotation-outbox-repository.js';
import {
  LIVE_DEPS,
  upsertWhatsappMessages,
  WhatsappAttachment,
} from './lib/whatsapp-conversations-store.js';
import { normalizePostgresMediaUrl } from './lib/postgres-media.js';
import { normalizeEvolutionDelivery, type EvolutionDeliveryResult } from './lib/evolution-delivery.js';

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

function absoluteUrl(url: unknown, baseUrl: string): string {
  if (!url) return '';
  const value = String(url).trim();
  if (/^https?:\/\//i.test(value) || /^data:/i.test(value)) return value;
  if (value.startsWith('/')) return `${baseUrl}${value}`;
  return `${baseUrl}/${value}`;
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
  pdfUrl?: string;
  pdfBase64?: string;
  postgresPath?: boolean;
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

function parseContactFromRemarks(remarks = ''): { nome: string; email: string; telefone: string } {
  const match = String(remarks).match(/Contato:\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)/i);
  if (!match) return { nome: '', email: '', telefone: '' };
  return {
    nome: match[1]?.trim() || '',
    email: match[2]?.trim() || '',
    telefone: match[3]?.trim() || '',
  };
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
  postgresPath = false,
): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [rawCategory, rawUrls] of Object.entries(sampleImages || {})) {
    const category = normalizeCategory(rawCategory);
    const urls = Array.isArray(rawUrls) ? rawUrls : String(rawUrls || '').split(/\n|,/);
    normalized[category] = urls.filter(Boolean).map((url) => {
      try {
        return postgresPath ? normalizePostgresMediaUrl(url, baseUrl) : absoluteUrl(url, baseUrl);
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
    6
  );
  const categories = context.categories;
  const sampleImages = normalizeSampleImages(
    (sequence?.sample_images as Record<string, unknown> | undefined) ||
      (payload.sample_images as Record<string, unknown> | undefined) ||
      {},
    baseUrl,
    context.postgresPath,
  );
  const planned: SequenceStep[] = [];

  for (const rawStep of rawSteps.slice(0, 12)) {
    const type = String(rawStep?.type || 'text');
    if (type === 'product_images') {
      for (const category of categories) {
        const urls = (sampleImages[category] || []).slice(0, maxImagesPerCategory);
        for (let i = 0; i < urls.length; i++) {
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
      continue;
    }

    if (type === 'image') {
      const sourceMedia = String(rawStep.media || rawStep.url || '');
      let media = absoluteUrl(rawStep.media || rawStep.url, baseUrl);
      if (context.postgresPath && sourceMedia) {
        try {
          media = normalizePostgresMediaUrl(sourceMedia, baseUrl);
        } catch {
          throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
        }
      }
      if (!media) continue;
      planned.push({
        type: 'image',
        media,
        mimetype: rawStep.mimetype || 'image/jpeg',
        fileName: rawStep.fileName || 'referencia.jpg',
        caption: rawStep.caption ? renderTemplate(rawStep.caption, context) : '',
      });
      continue;
    }

    if (type === 'document') {
      // quotation_pdf: send the actual PDF as a WhatsApp document attachment
      if (
        rawStep.source === 'quotation_pdf' &&
        context.quotationId &&
        (!context.postgresPath || context.pdfBase64)
      ) {
        const caption = rawStep.caption ? renderTemplate(rawStep.caption, context).trim() : '';
        const fileName = `${context.quotationId}.pdf`;
        planned.push({
          type: 'document',
          media: context.pdfBase64
            ? `__pdf-base64__:${context.pdfBase64}`
            : `__pdf__:${context.quotationId}`,
          mimetype: rawStep.mimetype || 'application/pdf',
          fileName,
          caption,
        });
        continue;
      }

      // For external documents: convert URL to text message instead of sendMedia
      const sourceMedia = String(rawStep.media || rawStep.url || context.pdfUrl || '');
      let media = absoluteUrl(rawStep.media || rawStep.url || context.pdfUrl, baseUrl);
      if (context.postgresPath && sourceMedia) {
        try {
          media = normalizePostgresMediaUrl(sourceMedia, baseUrl);
        } catch {
          throw createHttpError(400, 'Documento público inválido para cotação PostgreSQL.');
        }
      }
      if (media) {
        const captionText = rawStep.caption ? `\n${renderTemplate(rawStep.caption, context)}` : '';
        planned.push({ type: 'text', text: `Documento: ${media}${captionText}` });
      }
      continue;
    }

    const text = renderTemplate(rawStep.template || rawStep.text || '', context).trim();
    if (text) planned.push({ type: 'text', text });
  }

  return planned;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return Math.round(minMs + Math.random() * (maxMs - minMs));
}

// ── Quotation context resolution ────────────────────────────────────────────

async function resolveContactFromQuotation(quotationId: string): Promise<{
  quotation: Record<string, unknown>;
  dealId: string | null;
  nome: string;
  email: string;
  telefone: string;
}> {
  if (!quotationId) return { quotation: {}, dealId: null, nome: '', email: '', telefone: '' };

  const quotation = await erpGetDoc('Quotation', quotationId).catch((err) => {
    throw createHttpError(
      (err as { statusCode?: number })?.statusCode === 404 ? 404 : 502,
      'Orçamento não encontrado.',
      `[send-whatsapp] erpGetDoc(Quotation, ${quotationId}) failed: ${(err as { logMessage?: string })?.logMessage || (err as Error)?.message || String(err)}`
    );
  });

  if (!quotation) {
    throw createHttpError(
      404,
      'Orçamento não encontrado.',
      `[send-whatsapp] null quotation ${quotationId}`
    );
  }

  const remarksContact = parseContactFromRemarks(quotation.remarks as string | undefined);
  let nome = firstNonEmpty(
    quotation.customer_name as string | undefined,
    remarksContact.nome,
    quotation.party_name as string | undefined
  );
  let email = firstNonEmpty(quotation.contact_email as string | undefined, remarksContact.email);
  let telefone = firstNonEmpty(
    quotation.contact_mobile as string | undefined,
    quotation.contact_phone as string | undefined,
    remarksContact.telefone
  );

  // Party fallback: Lead/Customer data.
  if ((!telefone || !email || !nome) && quotation.quotation_to && quotation.party_name) {
    try {
      const party = await erpGetDoc(
        quotation.quotation_to as string,
        quotation.party_name as string
      );
      telefone = firstNonEmpty(
        telefone,
        party?.mobile_no as string | undefined,
        party?.phone as string | undefined,
        party?.phone_no as string | undefined
      );
      email = firstNonEmpty(
        email,
        party?.email_id as string | undefined,
        party?.email as string | undefined
      );
      nome = firstNonEmpty(
        nome,
        party?.first_name as string | undefined,
        party?.lead_name as string | undefined,
        party?.customer_name as string | undefined,
        party?.name as string | undefined
      );
    } catch (err) {
      console.warn(
        '[send-whatsapp] party lookup failed:',
        (err as { logMessage?: string })?.logMessage || (err as Error)?.message || err
      );
    }
  }

  // Contact fallback by contact_person or email.
  if ((!telefone || !email) && quotation.contact_person) {
    try {
      const contact = await erpGetDoc('Contact', quotation.contact_person as string);
      telefone = firstNonEmpty(
        telefone,
        contact?.mobile_no as string | undefined,
        contact?.phone as string | undefined,
        (
          contact?.phone_nos as
            | Array<{ is_primary_mobile_no?: boolean; phone?: string }>
            | undefined
        )?.find((p) => p.is_primary_mobile_no)?.phone,
        (contact?.phone_nos as Array<{ phone?: string }> | undefined)?.[0]?.phone
      );
      email = firstNonEmpty(
        email,
        contact?.email_id as string | undefined,
        (
          contact?.email_ids as Array<{ is_primary?: boolean; email_id?: string }> | undefined
        )?.find((e) => e.is_primary)?.email_id,
        (contact?.email_ids as Array<{ email_id?: string }> | undefined)?.[0]?.email_id
      );
    } catch (err) {
      console.warn(
        '[send-whatsapp] contact_person lookup failed:',
        (err as { logMessage?: string })?.logMessage || (err as Error)?.message || err
      );
    }
  }

  // CRM Deal fallback — orcamento.js stores mobile_no and custom_quotation there.
  let dealId: string | null = null;
  try {
    const deals = await erpGetList('CRM Deal', {
      filters: [['custom_quotation', '=', quotationId]],
      fields: ['name', 'lead_name', 'email', 'mobile_no'],
      limit: 1,
    });
    if (deals.length > 0) {
      const deal = deals[0];
      dealId = deal.name as string;
      telefone = firstNonEmpty(telefone, deal.mobile_no as string | undefined);
      email = firstNonEmpty(email, deal.email as string | undefined);
      nome = firstNonEmpty(nome, deal.lead_name as string | undefined);
    }
  } catch (err) {
    console.warn(
      '[send-whatsapp] deal lookup failed:',
      (err as { logMessage?: string })?.logMessage || (err as Error)?.message || err
    );
  }

  return {
    quotation,
    dealId,
    nome,
    email,
    telefone,
  };
}

type QuotationSnapshotRepository = ReturnType<typeof createQuotationTemplateRepository>;
type PublicQuotationStore = NonNullable<PublicQuotationDependencies['store']>;

type ResolvedWhatsappContact = {
  quotation: Record<string, unknown>;
  dealId: string | null;
  nome: string;
  email: string;
  telefone: string;
  phone?: string;
  businessNumber?: string;
  revisionId?: string;
  publicLink?: string;
  pdfBase64?: string;
  quotationUuid?: string;
};

type PostgresSendContext = {
  snapshot: QuotationTemplateSnapshot;
  view: ReturnType<typeof quotationSnapshotViewModel>;
  quotation: Record<string, unknown>;
  dealId: null;
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
};

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

  const permittedMedia = (input.mediaCandidates || []).filter(Boolean).map((candidate) => {
    try {
      return normalizePostgresMediaUrl(candidate, input.baseUrl);
    } catch {
      throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
    }
  });

  let pdfBase64 = '';
  if (input.needPdf) {
    try {
      pdfBase64 = (
        await renderPublicQuotationPdf(revisionId, {
          repository: input.repository,
          renderPdf: input.renderPdf,
        })
      ).toString('base64');
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
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

  return {
    snapshot,
    view,
    quotation: { items: view.items },
    dealId: null,
    quotationUuid: snapshot.quotation.id,
    revisionId,
    businessNumber: snapshot.quotation.businessNumber,
    nome: String(client.name || client.nome || ''),
    email: String(client.email || ''),
    telefone,
    phone,
    publicLink: `${input.baseUrl}/api/public-quotation?token=${encodeURIComponent(token.token)}`,
    pdfBase64,
    permittedMedia,
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
    const rb = responseBody as Record<string, unknown> | null;
    const detail =
      rb?.message ||
      rb?.error ||
      (rb?.response as Record<string, unknown> | undefined)?.message ||
      JSON.stringify(responseBody || {});
    throw createHttpError(
      res.status === 401 || res.status === 403 ? 502 : 400,
      'Não foi possível enviar a mensagem pelo WhatsApp. Verifique se a instância está conectada.',
      `[send-whatsapp] Evolution ${res.status}: ${String(detail)}`
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

async function fetchQuotationPdfBuffer(quotationId: string): Promise<Buffer> {
  try {
    const { buffer } = await generateQuotationPdf(quotationId, { timeout: 30000 });
    if (!buffer || buffer.length === 0) {
      throw createHttpError(
        502,
        'PDF do orçamento veio vazio.',
        `[send-whatsapp] empty PDF buffer for ${quotationId}`
      );
    }
    return buffer;
  } catch (err) {
    if ((err as { statusCode?: number })?.statusCode) throw err;
    throw createHttpError(
      502,
      'Falha ao gerar o PDF do orçamento.',
      `[send-whatsapp] generateQuotationPdf error for ${quotationId}: ${(err as Error).message}`
    );
  }
}

async function sendMedia(number: string, step: SequenceStep, postgresPath = false, baseUrl = ''): Promise<EvolutionDeliveryResult> {
  // ── Quotation PDF marker ──
  let media = step.media;
  if (postgresPath && typeof media === 'string' && media.startsWith('__pdf__:')) {
    throw createHttpError(400, 'O PDF PostgreSQL precisa ser gerado a partir da revisão.');
  }
  if (postgresPath && typeof media === 'string' && !media.startsWith('__pdf-')) {
    try {
      media = normalizePostgresMediaUrl(media, baseUrl);
    } catch {
      throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
    }
  }
  if (media && typeof media === 'string' && media.startsWith('__pdf-base64__:')) {
    media = media.slice('__pdf-base64__:'.length);
  } else if (media && typeof media === 'string' && media.startsWith('__pdf__:')) {
    const quotationId = media.slice('__pdf__:'.length);
    const buffer = await fetchQuotationPdfBuffer(quotationId);
    media = buffer.toString('base64');
  }

  // ── External media URL ──
  if (
    media &&
    ERPNEXT_TOKEN &&
    ERPNEXT_BASE &&
    typeof media === 'string' &&
    media.startsWith(ERPNEXT_BASE)
  ) {
    try {
      const res = await fetch(media, {
        headers: { Authorization: `token ${ERPNEXT_TOKEN}` },
      });
      if (!res.ok) {
        throw createHttpError(
          502,
          'Não foi possível baixar a mídia.',
          `[send-whatsapp] ERPNext media fetch failed: ${res.status} for ${media}`
        );
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      media = buffer.toString('base64');
    } catch (err) {
      if ((err as { statusCode?: number })?.statusCode) throw err;
      throw createHttpError(
        502,
        'Falha ao processar a mídia para envio.',
        `[send-whatsapp] media download error: ${(err as Error).message}`
      );
    }
  }

  const { instance } = evolutionConfig();
  return evolutionPost(`/message/sendMedia/${encodeURIComponent(instance)}`, {
    number,
    mediatype: step.type === 'document' ? 'document' : 'image',
    mimetype: step.mimetype,
    caption: step.caption || '',
    media,
    fileName: step.fileName,
  });
}

async function sendStep(number: string, step: SequenceStep, postgresPath = false, baseUrl = ''): Promise<EvolutionDeliveryResult> {
  if (step.type === 'text') return sendText(number, step.text || '');
  return sendMedia(number, step, postgresPath, baseUrl);
}

async function queuePostgresSentEvent(
  quotationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const quotationUuid = firstNonEmpty(
    payload.quotation_uuid as string | undefined,
    payload.quotationUuid as string | undefined,
    payload.quote_id as string | undefined,
  );
  const revisionId = firstNonEmpty(
    payload.revision_id as string | undefined,
    payload.revisionId as string | undefined,
    payload.quote_revision_id as string | undefined,
  );
  // Only a validated PostgreSQL send may create quotation.sent.
  const postgresPath = payload.source === 'postgres' || payload.core_mode === true;
  if (!postgresPath) return;
  if (!quotationUuid || !revisionId || !process.env.DATABASE_URL) {
    throw new QuotationOutboxDurabilityError(new Error('Referências PostgreSQL ausentes.'));
  }
  try {
    await enqueueQuotationSentEvent(getDatabase(), {
      eventType: 'quotation.sent',
      provider: 'crm',
      quotationId: quotationUuid,
      revisionId,
      businessNumber: firstNonEmpty(
        payload.business_number as string | undefined,
        payload.businessNumber as string | undefined,
        quotationId,
      ),
      idempotencyKey: deriveOpaqueQuotationOutboxIdempotencyKey(
        payload.idempotency_key ?? payload.idempotencyKey,
        `quotation.sent:crm:${quotationUuid}:${revisionId}`,
        `${quotationUuid}:${revisionId}`,
      ),
    });
  } catch (error) {
    // Evolution already accepted the message; expose tracking failure without
    // pretending that provider delivery failed or asking an automatic retry.
    throw new QuotationOutboxDurabilityError(error);
  }
}

async function markDealAsSent(dealId: string | null, quotationId: string): Promise<void> {
  if (!dealId) return;
  try {
    await erpPut('CRM Deal', dealId, {
      status: 'Orcamento Enviado',
      custom_quotation: quotationId,
      custom_quotation_sent_date: new Date().toISOString().slice(0, 10),
      custom_follow_up_stage: 0,
    });
  } catch (err) {
    console.warn(
      '[send-whatsapp] deal update failed:',
      (err as { logMessage?: string })?.logMessage || (err as Error)?.message || err
    );
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────

async function dispatchN8n(payload: Record<string, unknown>, email?: string): Promise<void> {
  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (!n8nUrl) return;
  const timeoutSignal =
    typeof globalThis.AbortSignal?.timeout === 'function'
      ? globalThis.AbortSignal.timeout(5000)
      : undefined;
  const webhookPayload = {
    event: 'whatsapp_sent',
    quotation_id: payload.quotationId,
    deal_id: payload.dealId,
    nome: payload.nome,
    email: (email || '').trim(),
    telefone: payload.number,
  };
  fetch(n8nUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(webhookPayload),
    signal: timeoutSignal,
  }).catch((err: Error) => console.error('[send-whatsapp] n8n webhook failed:', err.message));
}

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (isOperationalMode()) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'send-whatsapp não está disponível no modo operacional.' }) };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.body || '{}') as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: 'JSON inválido' });
  }

  let providerAcceptedCount = 0;
  let postgresOutboxContext: { quotationId: string; payload: Record<string, unknown> } | null = null;
  try {
    const dryRun = payload.dry_run === true || payload.dryRun === true;
    const quotationId = String(payload.quotation_id || payload.quotationId || '').trim();
    const postgresPath = payload.source === 'postgres' || payload.core_mode === true;
    const baseUrl = publicBaseUrl(event);
    const sequenceForResolution =
      (payload.whatsapp_sequence as Record<string, unknown> | undefined) ||
      (payload.sequence as Record<string, unknown> | undefined) ||
      null;
    const needPdf = Boolean(
      sequenceForResolution &&
      Array.isArray(sequenceForResolution.steps) &&
      (sequenceForResolution.steps as Array<Record<string, unknown>>).some(
        (step) => step.type === 'document' && step.source === 'quotation_pdf',
      )
    );
    const revisionId = String(
      payload.revision_id || payload.revisionId || payload.quote_revision_id || ''
    ).trim();
    if (postgresPath && !quotationId) {
      throw createHttpError(400, 'Cotação PostgreSQL é obrigatória.');
    }
    if (postgresPath && !revisionId) {
      throw createHttpError(400, 'Revisão PostgreSQL do orçamento é obrigatória.');
    }
    const shouldResolveQuotation = Boolean(quotationId && (!dryRun || postgresPath));
    const resolved: ResolvedWhatsappContact = postgresPath
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
          repository: createQuotationTemplateRepository(),
          mediaCandidates: collectMediaCandidates(sequenceForResolution, payload),
        })
      : shouldResolveQuotation
        ? await resolveContactFromQuotation(quotationId)
        : ({ quotation: {}, dealId: null, nome: '', email: '', telefone: '', publicLink: '', pdfBase64: '' } satisfies ResolvedWhatsappContact);

    const nome = postgresPath
      ? resolved.nome
      : firstNonEmpty(payload.nome as string | undefined, resolved.nome);
    const number = postgresPath
      ? resolved.phone || normalizePhone(resolved.telefone)
      : normalizePhone(
          firstNonEmpty(
            payload.telefone as string | undefined,
            payload.phone as string | undefined,
            resolved.telefone
          )
        );
    if (!number) {
      throw createHttpError(400, 'Telefone inválido ou ausente para envio via WhatsApp.');
    }

    const link = postgresPath && isRevisionBoundPublicQuotationUrl(resolved.publicLink, baseUrl)
      ? resolved.publicLink
      : '';

    const sequence = sequenceForResolution;
    const items = (postgresPath
      ? (resolved.quotation as Record<string, unknown>)?.items
      : payload.items ||
        payload.order_items ||
        payload.quotation_items ||
        (resolved.quotation as Record<string, unknown>)?.items ||
        []) as Array<Record<string, unknown>>;
    const categories = detectCategories(items);
    const productSummary = postgresPath
      ? productSummaryFromCategories(categories)
      : firstNonEmpty(
          payload.produto_resumo as string | undefined,
          payload.product_summary as string | undefined,
          sequence?.product_summary as string | undefined,
          productSummaryFromCategories(categories)
        );
    const messageQuotationId = postgresPath
      ? resolved.businessNumber || quotationId
      : quotationId;
    const outboxPayload = postgresPath
      ? {
          ...payload,
          source: 'postgres',
          quotation_uuid: resolved.quotationUuid,
          revision_id: resolved.revisionId,
          business_number: resolved.businessNumber,
        }
      : payload;
    if (postgresPath) {
      postgresOutboxContext = { quotationId: messageQuotationId, payload: outboxPayload };
    }
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
      pdfUrl: postgresPath
        ? ''
        : firstNonEmpty(
            payload.pdf_url as string | undefined,
            payload.pdfUrl as string | undefined,
            sequence?.pdf_url as string | undefined
          ),
      pdfBase64: resolved.pdfBase64,
      postgresPath,
    };

    if (sequence) {
      const delayMinMs = toPositiveInt(
        (sequence as Record<string, unknown>)?.delay_min_ms ??
          (sequence as Record<string, unknown>)?.delayMinMs,
        5000,
        0,
        30000
      );
      const delayMaxMs = toPositiveInt(
        (sequence as Record<string, unknown>)?.delay_max_ms ??
          (sequence as Record<string, unknown>)?.delayMaxMs,
        Math.max(delayMinMs, 8000),
        delayMinMs,
        45000
      );
      const steps = buildSequenceSteps({ payload, sequence, context, baseUrl });
      if (steps.length === 0) {
        throw createHttpError(
          400,
          'Sequência de WhatsApp vazia. Configure ao menos uma mensagem ou mídia.'
        );
      }

      const evolution: EvolutionDeliveryResult[] = [];
      if (!dryRun) {
        assertEvolutionConfig();
        for (let i = 0; i < steps.length; i++) {
          if (i > 0) await wait(randomDelay(delayMinMs, delayMaxMs));
          const step = steps[i];
          const response = await sendStep(number, step, postgresPath, baseUrl);
          if (!response.accepted) throw createHttpError(502, 'O provedor não confirmou a mensagem.');
          providerAcceptedCount += 1;
          evolution.push(response);

          // Persist outbound quotation PDF message
          if (step.type === 'document' && step.media && step.media.startsWith('__pdf__:')) {
            try {
              const conversations = await LIVE_DEPS.readConversations();
              const conversation = conversations.find((c) => c.providerConversationId === number);

              if (conversation) {
                const quotation = resolved.quotation as Record<string, unknown>;
                const leadId = (quotation.lead as string | undefined) || null;
                const customerId = (quotation.customer as string | undefined) || null;

                const attachment: WhatsappAttachment = {
                  id: LIVE_DEPS.id(),
                  kind: 'document',
                  mimeType: step.mimetype || 'application/pdf',
                  fileName: step.fileName || `${messageQuotationId}.pdf`,
                  mediaUrl: context.link, // PDF URL
                  caption: step.caption || '',
                  origin: 'internal_generated',
                  documentRole: 'quotation_pdf',
                  quotationId: messageQuotationId,
                  leadId,
                  customerId,
                };

                await upsertWhatsappMessages(conversation.id, [
                  {
                    direction: 'outbound',
                    type: 'document',
                    body: step.caption || '',
                    attachments: [attachment],
                    timestamp: new Date().toISOString(),
                    // Attach the response info if useful
                  },
                ]);
              }
            } catch (err) {
              console.error('[send-whatsapp] persistence failed:', (err as Error).message);
            }
          }
        }
        await queuePostgresSentEvent(messageQuotationId, outboxPayload);
        if (!postgresPath) await markDealAsSent((payload.deal_id as string) || resolved.dealId, quotationId);
      }

      const dealId = (payload.deal_id as string) || resolved.dealId || null;
      if (!dryRun) {
        await dispatchN8n(
          { quotationId: messageQuotationId, dealId, nome, number },
          resolved.email || (payload.email as string | undefined)
        );
      }

      return jsonResponse(200, {
        success: true,
        dry_run: dryRun,
        quotation_id: messageQuotationId || null,
        deal_id: (payload.deal_id as string) || resolved.dealId || null,
        number,
        delay_min_ms: delayMinMs,
        delay_max_ms: delayMaxMs,
        product_summary: productSummary,
        categories,
        steps,
        evolution,
      });
    }

    const text =
      firstNonEmpty(
        payload.mensagem as string | undefined,
        payload.message as string | undefined
      ) || renderTemplate(payload.template as string, context);
    if (!text.trim()) {
      throw createHttpError(400, 'Mensagem vazia.');
    }

    let evolution: EvolutionDeliveryResult | null = null;
    if (!dryRun) {
      assertEvolutionConfig();
      evolution = await sendText(number, text);
      if (!evolution.accepted) throw createHttpError(502, 'O provedor não confirmou a mensagem.');
      providerAcceptedCount = 1;
      await queuePostgresSentEvent(messageQuotationId, outboxPayload);
      if (!postgresPath) await markDealAsSent((payload.deal_id as string) || resolved.dealId, quotationId);
      await dispatchN8n(
        {
          quotationId: messageQuotationId,
          dealId: (payload.deal_id as string) || resolved.dealId || null,
          nome,
          number,
        },
        resolved.email || (payload.email as string | undefined)
      );
    }

    return jsonResponse(200, {
      success: true,
      dry_run: dryRun,
      quotation_id: messageQuotationId || null,
      deal_id: (payload.deal_id as string) || resolved.dealId || null,
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
      outboxDurable?: boolean;
      alertId?: string;
    };
    const code = Number.isInteger(typedErr?.statusCode) ? typedErr.statusCode! : 500;
    console.error('[send-whatsapp]', typedErr?.logMessage || typedErr?.message || err);
    if (err instanceof QuotationOutboxDurabilityError) {
      console.error(`[send-whatsapp] durable outbox alert ${err.alertId}`);
      return jsonResponse(code, {
        error: err.message,
        provider_accepted: true,
        outbox_durable: false,
        partial_send: providerAcceptedCount > 0,
        alert_id: err.alertId,
      });
    }
    if (providerAcceptedCount > 0) {
      if (postgresOutboxContext) {
        try {
          await queuePostgresSentEvent(
            postgresOutboxContext.quotationId,
            postgresOutboxContext.payload,
          );
          return jsonResponse(502, {
            error: 'Parte da mensagem foi aceita; o envio foi interrompido após confirmação parcial.',
            provider_accepted: true,
            outbox_durable: true,
            partial_send: true,
            accepted_steps: providerAcceptedCount,
          });
        } catch (queueError) {
          const durability = queueError as { alertId?: string; message?: string };
          return jsonResponse(503, {
            error: 'Parte da mensagem foi aceita, mas o rastreamento durável falhou.',
            provider_accepted: true,
            outbox_durable: false,
            partial_send: true,
            accepted_steps: providerAcceptedCount,
            alert_id: durability.alertId,
          });
        }
      }
      return jsonResponse(502, {
        error: 'Parte da mensagem foi aceita; o envio foi interrompido após confirmação parcial.',
        provider_accepted: true,
        outbox_durable: true,
        partial_send: true,
        accepted_steps: providerAcceptedCount,
      });
    }
    return jsonResponse(code, { error: typedErr?.message || 'Erro interno.' });
  }
}
