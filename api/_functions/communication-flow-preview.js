// POST /api/communication-flow-preview
//
// Renders a CommunicationFlow into a preview array of steps with resolved
// template variables and media selections. Can work with mock context
// (no quotationId) or real context (with quotationId from ERPNext).
//
// Used by the flow editor's preview panel and the pre-send confirmation dialog.

import { kv } from '@vercel/kv';
import { erpGetDoc } from './lib/erpnext.js';
import { KV_KEY_MEDIA_PREFIX, KV_KEY_FLOWS } from '../_lib/media-schema.js';

// ── Template rendering ─────────────────────────────────────────────────────

function normalizeProductSummaryTemplate(template) {
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

function pluralizeProductCategory(category) {
  return PRODUCT_SUMMARY_PLURALS[category] || category;
}

function productPersonalizationAdjectiveFromCategories(categories = []) {
  const genders = categories.map((category) => PRODUCT_CATEGORY_GENDERS[category]).filter(Boolean);
  return genders.length > 0 && genders.every((gender) => gender === 'f')
    ? 'personalizadas'
    : 'personalizados';
}

function renderTemplate(template, context) {
  const ctx = { ...context };
  if (template.includes('(Saudacao)') && !ctx.Saudacao) {
    const h = new Date().getHours();
    ctx.Saudacao = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
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
    .replace(/\(link_orcamento\)/g, ctx.link || '')
    .replace(/\(vendedora\)/g, ctx.vendorName || 'Juliana')
    .replace(/\(produto_resumo\)/g, ctx.productSummary || 'produtos')
    .replace(/\(produto_adjetivo_personalizado\)/g, productPersonalizationAdjective)
    .replace(/\(grupo_produto\)/g, grupoProduto);
}

// ── Product category detection ─────────────────────────────────────────────

const PRODUCT_CATEGORY_BY_PREFIX = {
  CNG: 'canga',
  LNC: 'lenço',
  BNE: 'boné',
  TWL: 'toalha',
  CHP: 'chapéu',
  ECO: 'ecobag',
  CHC: 'cachecol',
};
const PRODUCT_SUMMARY_PLURALS = {
  canga: 'cangas',
  lenço: 'lenços',
  boné: 'bonés',
  toalha: 'toalhas',
  chapéu: 'chapéus',
  ecobag: 'ecobags',
  cachecol: 'cachecóis',
};
const PRODUCT_CATEGORY_GENDERS = {
  canga: 'f',
  lenço: 'm',
  boné: 'm',
  toalha: 'f',
  chapéu: 'm',
  ecobag: 'f',
  cachecol: 'm',
};

function detectCategories(items = []) {
  const categories = [];
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

function productSummaryFromCategories(categories = []) {
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
    link: 'https://orcamento.aspenestamparia.com/api/view?q=ORC-20261289',
    vendorName: 'Juliana',
    empresa: 'Aspen Estamparia',
    productSummary: 'cangas',
    categories: ['canga'],
  };
}

// ── Quotation context resolution ───────────────────────────────────────────

async function resolveQuotationContext(quotationId) {
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
      link: `https://orcamento.aspenestamparia.com/api/view?q=${encodeURIComponent(quotationId)}`,
      vendorName: 'Juliana',
      empresa: 'Aspen Estamparia',
      productSummary,
      categories,
    };
  } catch (err) {
    console.warn('[flow-preview] quotation resolution failed:', err.message);
    return null;
  }
}

// ── Media resolution ───────────────────────────────────────────────────────

async function resolveMediaUrls(categories) {
  if (!categories.length) return [];

  let keys = [];
  try {
    const result = await kv.scan(0, { match: `${KV_KEY_MEDIA_PREFIX}*`, count: 200 });
    keys = result[1] || [];
  } catch {
    /* ignore */
  }

  if (keys.length === 0) return [];

  const entries = await Promise.all(keys.map((k) => kv.get(k)));
  const media = entries.filter(Boolean).filter((m) => m.active !== false);

  const byGroup = {};
  for (const m of media) {
    if (!m.product_group || !m.blob_url) continue;
    (byGroup[m.product_group] = byGroup[m.product_group] || []).push(m);
  }

  const resolved = [];
  for (const cat of categories) {
    const assets = (byGroup[cat] || []).slice(0, 5);
    for (const asset of assets) {
      resolved.push({
        url: asset.blob_url,
        caption: asset.caption || '',
        kind: asset.kind || 'image',
        product_group: asset.product_group,
      });
    }
  }
  return resolved;
}

// ── JSON response ──────────────────────────────────────────────────────────

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function handler(event) {
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
      context = await resolveQuotationContext(quotationId);
      if (!context) {
        return jsonResponse(404, { error: 'Orçamento não encontrado.' });
      }
    } else {
      context = getMockContext();
    }

    // Resolve media for product_media steps
    const mediaUrls = await resolveMediaUrls(context.categories || []);

    // Build preview steps
    const warnings = [];
    const previewSteps = [];
    let pdfAdded = false;

    for (const step of flow.steps || []) {
      if (step.type === 'text') {
        const text = renderTemplate(step.template || '', context).trim();
        if (text) previewSteps.push({ type: 'text', text });
      } else if (step.type === 'document' && step.source === 'quotation_pdf') {
        if (!pdfAdded) {
          previewSteps.push({
            type: 'document',
            fileName: `${context.quotationId || 'ORC-EXEMPLO'}.pdf`,
            caption: step.caption ? renderTemplate(step.caption, context).trim() : '',
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
              ? renderTemplate(step.caption_template, context).trim()
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
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[comm-flow-preview]', err?.logMessage || err?.message || err);
    return jsonResponse(code, { error: err?.message || 'Erro ao gerar preview.' });
  }
}
