// POST /api/send-whatsapp-flow
//
// Executes a CommunicationFlow via Evolution API.
// Resolves product_media steps from the media library (Vercel Blob).
// Performs duplicate detection (30min window per quotation+phone+flow).
// Records send events in KV for history.
// Updates CRM Deal status in parallel.
//
// Reuses Evolution API patterns from send-whatsapp.js.
// Storage: Vercel KV for flows, media, and send events.

import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_lib/types.js';
import type { HttpError } from './lib/erpnext.js';
import { kv } from '@vercel/kv';
import { erpGetDoc, erpGetList, erpPut, createHttpError, ERPNEXT_BASE } from './lib/erpnext.js';
import { generateQuotationPdf } from './lib/quotation-pdf.js';
import { getTimeBasedGreeting } from './lib/time-greeting.js';
import { isOperationalMode } from './operational-mode.js';
import { getDatabase } from '../_db/client.js';
import { createQuotationTemplateRepository, quotationSnapshotViewModel } from '../_db/quotation-template-repository.js';
import { issuePublicQuotationToken, renderPublicQuotationPdf } from './public-quotation.js';
import {
  deriveOpaqueQuotationOutboxIdempotencyKey,
  enqueueQuotationSentEvent,
  QuotationOutboxDurabilityError,
} from '../_db/quotation-outbox-repository.js';
import {
  KV_KEY_MEDIA_PREFIX,
  KV_KEY_FLOWS,
  KV_KEY_SEND_EVENTS_PREFIX,
} from '../_lib/media-schema.js';

const EVOLUTION_BASE_URL = (process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || '';

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

// ── Helpers ─────────────────────────────────────────────────────────────────

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function normalizePhone(phone: unknown): string {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  digits = digits.replace(/^55(\d{10,11})$/, '$1').replace(/^0(\d{10,11})$/, '$1');
  if (!/^\d{10,11}$/.test(digits)) return '';
  return `55${digits}`;
}

function firstNonEmpty(...values: unknown[]): string {
  const found = values.find((v) => typeof v === 'string' && v.trim());
  return typeof found === 'string' ? found.trim() : '';
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

function productPersonalizationAdjectiveFromCategories(categories = []) {
  const genders = categories.map((category) => PRODUCT_CATEGORY_GENDERS[category]).filter(Boolean);
  return genders.length > 0 && genders.every((gender) => gender === 'f')
    ? 'personalizadas'
    : 'personalizados';
}

function renderTemplate(template: string, context: Record<string, any>): string {
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

// ── Evolution API ──────────────────────────────────────────────────────────

function assertEvolutionConfig() {
  const missing = [];
  if (!EVOLUTION_BASE_URL) missing.push('EVOLUTION_BASE_URL');
  if (!EVOLUTION_API_KEY) missing.push('EVOLUTION_API_KEY');
  if (!EVOLUTION_INSTANCE) missing.push('EVOLUTION_INSTANCE');
  if (missing.length > 0) {
    throw createHttpError(
      500,
      'Integração do WhatsApp não configurada.',
      `missing env: ${missing.join(', ')}`
    );
  }
}

async function evolutionPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = `${EVOLUTION_BASE_URL}${path}`;
  let res, responseBody;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      body: JSON.stringify(body),
    });
    responseBody = await res.json().catch(() => null);
    } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw createHttpError(
      502,
      'Falha ao conectar com o WhatsApp.',
      `Evolution fetch failed: ${msg}`
    );
  }
  if (!res.ok) {
    const detail =
      responseBody?.message || responseBody?.error || JSON.stringify(responseBody || {});
    throw createHttpError(
      400,
      'Não foi possível enviar a mensagem.',
      `Evolution ${res.status}: ${detail}`
    );
  }
  return responseBody;
}

async function sendText(number: string, text: string): Promise<Record<string, unknown>> {
  return evolutionPost(`/message/sendText/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
    number,
    text,
  });
}

async function fetchQuotationPdfBuffer(quotationId: string): Promise<Buffer> {
  try {
    const { buffer } = await generateQuotationPdf(quotationId, { timeout: 30000 });
    if (!buffer || buffer.length === 0) throw createHttpError(502, 'PDF vazio.');
    return buffer;
  } catch (err: unknown) {
    if ((err as HttpError)?.statusCode) throw err;
    throw createHttpError(502, 'Falha ao gerar PDF do orçamento.');
  }
}

async function sendMedia(number: string, step: Record<string, unknown>): Promise<Record<string, unknown>> {
  let media: string | undefined = step.media as string | undefined;

  // PDF marker
  if (media && typeof media === 'string' && media.startsWith('__pdf-base64__:')) {
    media = media.slice('__pdf-base64__:'.length);
  } else if (media && typeof media === 'string' && media.startsWith('__pdf__:')) {
    const qid = media.slice('__pdf__:'.length);
    const buffer = await fetchQuotationPdfBuffer(qid);
    media = buffer.toString('base64');
  }

  // Blob URL → fetch + base64 (Evolution requires base64 for media)
  if (media && /^https?:\/\//.test(media) && !media.startsWith(ERPNEXT_BASE)) {
    try {
      const res = await fetch(media);
      if (!res.ok) throw createHttpError(502, 'Não foi possível baixar a mídia.');
      const buffer = Buffer.from(await res.arrayBuffer());
      media = buffer.toString('base64');
    } catch (err: unknown) {
      if ((err as HttpError)?.statusCode) throw err;
      throw createHttpError(502, 'Falha ao processar mídia.');
    }
  }

  return evolutionPost(`/message/sendMedia/${encodeURIComponent(EVOLUTION_INSTANCE)}`, {
    number,
    mediatype: step.type === 'document' ? 'document' : 'image',
    mimetype: step.mimetype,
    caption: step.caption || '',
    media,
    fileName: step.fileName,
  });
}

async function sendStep(number: string, step: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (step.type === 'text') return sendText(number, step.text as string);
  return sendMedia(number, step);
}

// ── Media resolution ───────────────────────────────────────────────────────

async function resolveProductMedia(categories: string[], maxPerGroup = 1): Promise<Record<string, unknown>[]> {
  if (!categories.length) return [];

  // Scan KV for all media assets
  let keys: string[] = [];
  try {
    const result = await kv.scan(0, { match: `${KV_KEY_MEDIA_PREFIX}*`, count: 200 });
    keys = result[1] || [];
  } catch {
    /* ignore */
  }

  if (keys.length === 0) return [];

  const entries = await Promise.all(keys.map((k) => kv.get(k)));
  const media = (entries.filter(Boolean) as Array<Record<string, unknown>>).filter((m) => m.active !== false);

  // Group by product_group
  const byGroup: Record<string, Array<Record<string, unknown>>> = {};
  for (const m of media) {
    const product_group = m.product_group as string | undefined;
    const blob_url = m.blob_url as string | undefined;
    if (!product_group || !blob_url) continue;
    (byGroup[product_group] = byGroup[product_group] || []).push(m);
  }

  // Resolve for each detected category
  const resolved = [];
  for (const cat of categories) {
    const normalized = normalizeCategory(cat);
    const assets = (byGroup[normalized] || []).slice(0, maxPerGroup);
    for (const asset of assets) {
      resolved.push({
        type: 'image',
        media: asset.blob_url,
        mimetype: asset.content_type || 'image/jpeg',
        fileName: ((asset.pathname as string) || '').split('/').pop() || 'referencia.jpg',
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

// ── CRM Deal update ─────────────────────────────────────────────────────────

async function queuePostgresSentEvent(
  quotationId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const quotationUuid = firstNonEmpty(
    payload.quotation_uuid,
    payload.quotationUuid,
    payload.quote_id,
  );
  const revisionId = firstNonEmpty(
    payload.revision_id,
    payload.revisionId,
    payload.quote_revision_id,
  );
  // Legacy Frappe callers do not carry PostgreSQL ownership references yet.
  const postgresPath = payload.source === 'postgres' || payload.core_mode === true;
  if (!postgresPath && !quotationUuid && !revisionId) return;
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
        payload.business_number,
        payload.businessNumber,
        quotationId,
      ),
      idempotencyKey: deriveOpaqueQuotationOutboxIdempotencyKey(
        payload.idempotency_key ?? payload.idempotencyKey,
        `quotation.sent:crm:${quotationUuid}:${revisionId}`,
        `${quotationUuid}:${revisionId}`,
      ),
    });
  } catch (error) {
    throw new QuotationOutboxDurabilityError(error);
  }
}

async function updateDeal(dealId: string | null, quotationId: string): Promise<void> {
  if (!dealId) return;
  try {
    await erpPut('CRM Deal', dealId, {
      status: 'Orcamento Enviado',
      custom_quotation: quotationId,
      custom_quotation_sent_date: new Date().toISOString().slice(0, 10),
      custom_follow_up_stage: 0,
    });
  } catch (err: unknown) {
    const httpErr = err as HttpError;
    console.warn(
      '[send-whatsapp-flow] deal update failed:',
      httpErr.logMessage || httpErr.message || err
    );
  }
}

// ── Flow resolution ────────────────────────────────────────────────────────

async function resolveFlow(flowId: string): Promise<Record<string, any> | null> {
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

async function buildSteps(flow: Record<string, any>, context: Record<string, any>): Promise<Record<string, unknown>[]> {
  const steps = [];
  let pdfAdded = false;

  for (const rawStep of flow.steps || []) {
    if (rawStep.type === 'text') {
      const text = renderTemplate(rawStep.template || '', context).trim();
      if (text) steps.push({ type: 'text', text });
    } else if (rawStep.type === 'document' && rawStep.source === 'quotation_pdf') {
      if (!pdfAdded && context.quotationId && (!context.postgresPath || context.pdfBase64)) {
        const caption = rawStep.caption ? renderTemplate(rawStep.caption, context).trim() : '';
        steps.push({
          type: 'document',
          media: context.pdfBase64
            ? `__pdf-base64__:${context.pdfBase64}`
            : `__pdf__:${context.quotationId}`,
          mimetype: 'application/pdf',
          fileName: `${context.quotationId}.pdf`,
          caption,
        });
        pdfAdded = true;
      }
    } else if (rawStep.type === 'product_media') {
      const maxItems =
        rawStep.max_items || context.maxMediaPerGroup || flow.max_media_per_product_group || 1;
      const mediaSteps = await resolveProductMedia(context.categories, maxItems);
      for (const ms of mediaSteps) steps.push(ms);
    }
  }

  return steps;
}

// ── N8n webhook ────────────────────────────────────────────────────────────

function fireN8n(payload: Record<string, unknown>): void {
  const n8nUrl = process.env.N8N_WEBHOOK_URL;
  if (!n8nUrl) return;
  fetch(n8nUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'whatsapp_flow_sent',
      ...payload,
    }),
  }).catch((err) => console.error('[send-whatsapp-flow] n8n webhook failed:', err.message));
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (isOperationalMode()) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'send-whatsapp-flow não está disponível no modo operacional.' }) };
  }
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method Not Allowed' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'JSON inválido.' });
  }

  try {
    const dryRun = payload.dry_run === true || payload.dryRun === true;
    if (!dryRun) assertEvolutionConfig();

    const flowId = String(payload.flow_id || payload.flowId || '').trim();
    if (!flowId) throw createHttpError(400, 'ID do fluxo é obrigatório.');

    const flow = await resolveFlow(flowId);
    if (!flow) throw createHttpError(404, 'Fluxo não encontrado.');

    const quotationId = String(payload.quotation_id || payload.quotationId || '').trim();
    const postgresPath = payload.source === 'postgres' || payload.core_mode === true;
    const host = (event.headers?.host as string | undefined) || 'project-xr5jg.vercel.app';
    const proto = ((event.headers?.['x-forwarded-proto'] as string | undefined) || 'https').split(',')[0].trim();
    const baseUrl = `${proto}://${host}`;
    let nome = '';
    let telefone = '';
    let dealId: string | null = null;
    let items: Record<string, unknown>[] = [];
    let link = '';
    let pdfBase64 = '';
    let postgresSnapshot: ReturnType<typeof quotationSnapshotViewModel> | null = null;

    if (postgresPath && quotationId && !dryRun) {
      const revisionId = firstNonEmpty(payload.revision_id, payload.revisionId, payload.quote_revision_id);
      if (!revisionId) throw createHttpError(400, 'Revisão PostgreSQL do orçamento não informada.');
      const repository = createQuotationTemplateRepository();
      const snapshot = await repository.get(revisionId);
      if (!snapshot || snapshot.revision.id !== revisionId)
        throw createHttpError(404, 'Orçamento PostgreSQL não encontrado.');
      postgresSnapshot = quotationSnapshotViewModel(snapshot);
      const publicToken = await issuePublicQuotationToken({ revisionId, repository });
      payload.quotation_uuid = payload.quotation_uuid || publicToken.quotationId;
      payload.revision_id = revisionId;
      link = `${baseUrl}/api/public-quotation?token=${encodeURIComponent(publicToken.token)}`;
      // Render from the immutable PostgreSQL snapshot. This path never calls
      // Frappe or the legacy print/PDF renderer.
      if (
        (flow.steps || []).some(
          (step: Record<string, unknown>) => step.type === 'document' && step.source === 'quotation_pdf',
        )
      ) {
        const pdf = await renderPublicQuotationPdf(revisionId, { repository });
        pdfBase64 = pdf.toString('base64');
      }
      const client = (postgresSnapshot.client || {}) as unknown as Record<string, unknown>;
      nome = firstNonEmpty(payload.nome, client.name, client.nome);
      telefone = firstNonEmpty(payload.phone || payload.telefone, client.phone, client.telefone);
      items = (postgresSnapshot.items || []) as Record<string, unknown>[];
    } else if (quotationId && !postgresPath) {
      try {
        const quotation = await erpGetDoc('Quotation', quotationId) as Record<string, unknown>;
        nome = firstNonEmpty(payload.nome, quotation?.customer_name, quotation?.party_name);
        telefone = firstNonEmpty(payload.phone || payload.telefone, quotation?.contact_mobile, quotation?.contact_phone);
        items = (quotation?.items as Record<string, unknown>[]) || [];
        const deals = await erpGetList('CRM Deal', {
          filters: [['custom_quotation', '=', quotationId]],
          fields: ['name', 'mobile_no'],
          limit: 1,
        });
        if (deals.length > 0) {
          dealId = deals[0].name;
          telefone = firstNonEmpty(telefone, deals[0].mobile_no);
        }
        // Legacy links cannot use the protected generic view route. Keep the
        // legacy send behavior but omit an unsupported customer link.
      } catch {
        // Non-fatal for explicit legacy callers: use provided contact fields.
      }
    }

    nome = firstNonEmpty(payload.nome, nome);
    telefone = firstNonEmpty(payload.phone || payload.telefone, telefone);
    items = (payload.items || items || []) as Record<string, unknown>[];
    dealId = payload.deal_id || payload.dealId || dealId;
    if (!link) link = firstNonEmpty(payload.public_link, payload.link_orcamento, payload.short_url);
    if (/\/api\/view(?:[/?]|$)/i.test(link)) link = '';

    const number = normalizePhone(telefone);
    if (!number) throw createHttpError(400, 'Telefone inválido ou ausente.');

    const categories = detectCategories(items);
    const productSummary = firstNonEmpty(payload.product_summary, productSummaryFromCategories(categories));
    const context = {
      nome,
      quotationId,
      link,
      pdfBase64,
      postgresPath,
      vendorName: flow.vendor_name || payload.vendedora || 'Juliana',
      productSummary,
      categories,
      maxMediaPerGroup: flow.max_media_per_product_group || 1,
    };

    // Build steps
    const steps = await buildSteps(flow, context);
    if (steps.length === 0) throw createHttpError(400, 'Fluxo não gerou nenhuma etapa válida.');

    // Duplicate check
    let duplicateWarning = false;
    if (quotationId && !dryRun) {
      duplicateWarning = await checkDuplicate(quotationId, number, flowId);
    }

    // Send
    const evolution = [];
    if (!dryRun) {
      for (let i = 0; i < steps.length; i++) {
        if (i > 0)
          await wait(randomDelay(flow.delay_min_seconds * 1000, flow.delay_max_seconds * 1000));
        const resp = await sendStep(number, steps[i]);
        evolution.push(resp);
      }
      await queuePostgresSentEvent(quotationId, payload);
      if (!postgresPath) await updateDeal(dealId, quotationId);
    }

    // Record send event
    let sendEventId = null;
    if (!dryRun) {
      sendEventId = await recordSendEvent({
        quotationId,
        phone: number,
        flowId,
        flowName: flow.name,
        steps,
        evolution,
        duplicateWarning,
      });
    }

    // N8n webhook (fire-and-forget)
    if (!dryRun) {
      fireN8n({ quotation_id: quotationId, deal_id: dealId, nome, phone: number, flow_id: flowId });
    }

    return jsonResponse(200, {
      success: true,
      dry_run: dryRun,
      duplicate_warning: duplicateWarning,
      duplicate_message: duplicateWarning
        ? 'Este fluxo já foi enviado para este telefone há menos de 30 minutos.'
        : '',
      flow_id: flowId,
      flow_name: flow.name,
      quotation_id: quotationId || null,
      deal_id: dealId || null,
      phone: number,
      product_summary: productSummary,
      categories,
      steps_count: steps.length,
      steps,
      evolution,
      send_event_id: sendEventId,
    });
  } catch (err: unknown) {
    const httpErr = err as HttpError & {
      providerAccepted?: boolean;
      outboxDurable?: boolean;
      alertId?: string;
    };
    const code = Number.isInteger(httpErr?.statusCode) ? httpErr.statusCode : 500;
    console.error('[send-whatsapp-flow]', httpErr?.logMessage || httpErr?.message || err);
    if (err instanceof QuotationOutboxDurabilityError) {
      console.error(`[send-whatsapp-flow] durable outbox alert ${err.alertId}`);
      return jsonResponse(code, {
        error: err.message,
        provider_accepted: true,
        outbox_durable: false,
        alert_id: err.alertId,
      });
    }
    return jsonResponse(code, { error: httpErr?.message || 'Erro interno.' });
  }
}
