// POST /api/communication-flow-preview
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_lib/types.js';
//
// Renders a CommunicationFlow into a preview array of steps with resolved
// template variables and media selections. Can work with mock context
// (no quotationId) or real context (with quotationId from ERPNext).
//
// Used by the flow editor's preview panel and the pre-send confirmation dialog.

import { kv } from '@vercel/kv';
import { createHttpError, erpGetDoc } from './lib/erpnext.js';
import { getTimeBasedGreeting } from './lib/time-greeting.js';
import { KV_KEY_MEDIA_PREFIX, KV_KEY_FLOWS } from '../_lib/media-schema.js';
import { createQuotationTemplateRepository, quotationSnapshotViewModel } from '../_db/quotation-template-repository.js';
import { isOperationalMode } from './operational-mode.js';
import { isRevisionBoundPublicQuotationUrl } from './public-quotation.js';
import { normalizePostgresMediaUrl } from './lib/postgres-media.js';

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

export function renderTemplate(
  template: string,
  context: Record<string, any>,
  applicationOrigin = '',
): string {
  const ctx = { ...context };
  if (template.includes('(Saudacao)') && !ctx.Saudacao) {
    ctx.Saudacao = getTimeBasedGreeting();
  }
  const primeiroNome = (ctx.nome || '').trim().split(/\s+/)[0] || ctx.nome || '';
  const groups = ctx.categories || [];
  const grupoProduto = groups.length > 0 ? groups[0] : 'produto';

  const productPersonalizationAdjective =
    ctx.productPersonalizationAdjective ||
    productPersonalizationAdjectiveFromCategories(ctx.categories);

  return normalizeProductSummaryTemplate(template)
    .replace(/\(Saudacao\)/g, ctx.Saudacao || '')
    .replace(/\(nome\)/g, ctx.nome || '')
    .replace(/\(primeiro_nome\)/g, primeiroNome)
    .replace(/\(numero_pedido\)/g, ctx.quotationId || '')
    .replace(/\(empresa\)/g, ctx.empresa || 'Aspen Estamparia')
    .replace(
      /\(link_orcamento\)/g,
      isRevisionBoundPublicQuotationUrl(ctx.link, applicationOrigin) ? ctx.link : '',
    )
    .replace(/\(vendedora\)/g, ctx.vendorName || 'Juliana')
    .replace(/\(produto_resumo\)/g, ctx.productSummary || 'produtos')
    .replace(/\(produto_adjetivo_personalizado\)/g, productPersonalizationAdjective)
    .replace(/\(grupo_produto\)/g, grupoProduto);
}

// ── Product category detection ─────────────────────────────────────────────

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

function detectCategories(items: Record<string, any>[] = []): string[] {
  const categories: string[] = [];
  for (const item of items || []) {
    const sku = String(item?.sku || item?.item_code || item?.itemCode || '')
      .trim()
      .toUpperCase();
    const prefix = sku.split('-')[0];
    const category = (PRODUCT_CATEGORY_BY_PREFIX as Record<string, string>)[prefix];
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

// ── Mock context ───────────────────────────────────────────────────────────

function getMockContext() {
  return {
    nome: 'Labo Buriti',
    quotationId: 'ORC-20261289',
    link: '',
    vendorName: 'Juliana',
    empresa: 'Aspen Estamparia',
    productSummary: 'cangas',
    categories: ['canga'],
  };
}

// ── Quotation context resolution ───────────────────────────────────────────

async function resolvePostgresQuotationContext(
  quotationId: string,
  revisionId: string,
): Promise<Record<string, any> | null> {
  const repository = createQuotationTemplateRepository();
  const snapshot = await repository.get(revisionId);
  if (!snapshot || snapshot.revision.id !== revisionId) return null;
  if (quotationId !== snapshot.quotation.id && quotationId !== snapshot.quotation.businessNumber) return null;
  const view = quotationSnapshotViewModel(snapshot);
  const client = view.client as Record<string, unknown>;
  const items = (view.items || []) as Record<string, unknown>[];
  const categories = detectCategories(items);
  return {
    nome: client.name || client.nome || '',
    quotationId: snapshot.quotation.businessNumber,
    link: '',
    vendorName: 'Juliana',
    empresa: 'Aspen Estamparia',
    productSummary: productSummaryFromCategories(categories),
    categories,
  };
}

async function resolveQuotationContext(quotationId: string): Promise<Record<string, any> | null> {
  try {
    const quotation = await erpGetDoc('Quotation', quotationId);
    if (!quotation) return null;

    const nome = quotation.customer_name || quotation.party_name || '';
    const items = quotation.items || [];
    const categories = detectCategories(items);
    const productSummary = productSummaryFromCategories(categories);

    return {
      nome,
      quotationId,
      link: '',
      vendorName: 'Juliana',
      empresa: 'Aspen Estamparia',
      productSummary,
      categories,
    };
  } catch (err: any) {
    console.warn('[flow-preview] quotation resolution failed:', err.message);
    return null;
  }
}

// ── Media resolution ───────────────────────────────────────────────────────

async function resolveMediaUrls(categories: string[], applicationOrigin = '', postgresPath = false) {
  if (!categories.length) return [];

  let keys: string[] = [];
  try {
    const result = await kv.scan(0, { match: `${KV_KEY_MEDIA_PREFIX}*`, count: 200 });
    keys = result[1] || [];
  } catch {
    /* ignore */
  }

  if (keys.length === 0) return [];

  const entries = await Promise.all(keys.map((k) => kv.get(k)));
  const media: Record<string, unknown>[] = (
    entries.filter(Boolean) as Record<string, unknown>[]
  ).filter((m) => m.active !== false);

  const byGroup: Record<string, Record<string, unknown>[]> = {};
  for (const m of media) {
    const group = String(m.product_group || '');
    if (!group || !m.blob_url) continue;
    (byGroup[group] = byGroup[group] || []).push(m);
  }

  const resolved: Record<string, unknown>[] = [];
  for (const cat of categories) {
    const assets = (byGroup[cat] || []).slice(0, 5);
    for (const asset of assets) {
      let url = String(asset.blob_url || '').trim();
      if (postgresPath) {
        try {
          url = normalizePostgresMediaUrl(url, applicationOrigin);
        } catch {
          throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
        }
      }
      resolved.push({
        url,
        caption: asset.caption || '',
        kind: asset.kind || 'image',
        product_group: asset.product_group,
      });
    }
  }
  return resolved;
}

// ── JSON response ──────────────────────────────────────────────────────────

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (isOperationalMode()) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'communication-flow-preview não está disponível no modo operacional.' }) };
  }
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Method Not Allowed' });

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'JSON inválido.' });
  }

  try {
    const flowId = String(payload.flow_id || payload.flowId || '').trim();
    const quotationId = String(payload.quotation_id || payload.quotationId || '').trim();
    const postgresPath = payload.source === 'postgres' || payload.core_mode === true;
    const revisionId = String(
      payload.revision_id || payload.revisionId || payload.quote_revision_id || ''
    ).trim();
    if (postgresPath && !quotationId) {
      return jsonResponse(400, { error: 'Cotação PostgreSQL é obrigatória.' });
    }
    if (postgresPath && !revisionId) {
      return jsonResponse(400, { error: 'Revisão PostgreSQL do orçamento é obrigatória.' });
    }
    const host = (event.headers?.host as string | undefined) || 'project-xr5jg.vercel.app';
    const proto = ((event.headers?.['x-forwarded-proto'] as string | undefined) || 'https').split(',')[0].trim();
    const applicationOrigin = `${proto}://${host}`;

    // Resolve flow
    let flow = null;
    if (flowId) {
      try {
        const flows = await kv.get(KV_KEY_FLOWS);
        if (Array.isArray(flows)) flow = flows.find((f) => f.id === flowId);
      } catch {
        /* ignore */
      }
    }

    // Use provided flow or fallback to mock
    if (!flow && payload.flow) {
      flow = payload.flow;
    }

    if (!flow) {
      // Return mock preview
      flow = {
        id: 'mock',
        name: 'Preview de exemplo',
        vendor_name: 'Juliana',
        delay_min_seconds: 1,
        delay_max_seconds: 3,
        max_media_per_product_group: 1,
        steps: [
          { id: '1', type: 'text', template: '(Saudacao), (primeiro_nome)! Tudo bem?' },
          { id: '2', type: 'text', template: 'Segue o orçamento (numero_pedido).' },
          { id: '3', type: 'document', source: 'quotation_pdf' },
        ],
      };
    }

    // Resolve context
    let context;
    if (quotationId) {
      context = postgresPath
        ? await resolvePostgresQuotationContext(quotationId, revisionId)
        : await resolveQuotationContext(quotationId);
      if (!context) {
        return jsonResponse(404, { error: 'Orçamento não encontrado.' });
      }
    } else {
      context = getMockContext();
    }

    // Resolve media for product_media steps
    const mediaUrls = await resolveMediaUrls(
      context.categories || [],
      applicationOrigin,
      postgresPath,
    );

    // Build preview steps
    const warnings = [];
    const previewSteps = [];
    let pdfAdded = false;

    for (const step of flow.steps || []) {
      if (step.type === 'text') {
        const text = renderTemplate(step.template || '', context, applicationOrigin).trim();
        if (text) previewSteps.push({ type: 'text', text });
      } else if (step.type === 'document' && step.source === 'quotation_pdf') {
        if (!pdfAdded) {
          previewSteps.push({
            type: 'document',
            fileName: `${context.quotationId || 'ORC-EXEMPLO'}.pdf`,
            caption: step.caption ? renderTemplate(step.caption, context, applicationOrigin).trim() : '',
          });
          pdfAdded = true;
        }
      } else if (step.type === 'product_media') {
        if (mediaUrls.length > 0) {
          for (const m of mediaUrls.slice(
            0,
            step.max_items || flow.max_media_per_product_group || 1
          )) {
            const caption = step.caption_template
              ? renderTemplate(step.caption_template, context, applicationOrigin).trim()
              : m.caption || '';
            previewSteps.push({
              type: m.kind === 'video' ? 'video' : 'image',
              url: m.url,
              caption,
              product_group: m.product_group,
            });
          }
        } else {
          warnings.push(
            `Nenhuma mídia cadastrada para: ${(context.categories || []).join(', ') || 'os produtos do orçamento'}.`
          );
        }
      }
    }

    return jsonResponse(200, {
      success: true,
      context: {
        customer_name: context.nome,
        quotation_id: context.quotationId,
        product_summary: context.productSummary,
        product_groups: context.categories || [],
      },
      steps: previewSteps,
      warnings,
    });
  } catch (err: any) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[comm-flow-preview]', err?.logMessage || err?.message || err);
    return jsonResponse(code, { error: err?.message || 'Erro ao gerar preview.' });
  }
}
