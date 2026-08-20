// POST /api/communication-flow-preview
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_http/types.js';
//
// Renders a CommunicationFlow into a preview array of steps with resolved
// template variables and media selections. Can work with mock context
// (no quotationId) or an immutable local revision snapshot.
//
// Used by flow editor preview and pre-send confirmation dialog.

import { getKvClient } from '../_infrastructure/integrations/kv/client.js';
import { createHttpError } from '../_shared/http-error.js';
import { getTimeBasedGreeting } from './time-greeting.js';
import { KV_KEY_FLOWS } from './media-schema.js';
import { createQuotationTemplateRepository, quotationSnapshotViewModel } from '../_infrastructure/db/repositories/quotation-template-repository.js';
import { isRevisionBoundPublicQuotationUrl } from './public-quotation.js';
import {
  readCommunicationMediaRecords,
  verifyOwnedBlobRecord,
  isMediaTombstone,
  MediaStoreReadError,
  type BlobHead,
  type PostgresMediaRecord,
} from './postgres-media.js';
import {
  detectProductCategories,
  normalizeProductCategory as normalizeCategory,
} from './product-category.js';

const kv = getKvClient();

type CommunicationFlowContext = Record<string, unknown> & {
  Saudacao?: string;
  nome?: string;
  link?: string;
  vendorName?: string;
  empresa?: string;
  productSummary?: string;
  categories?: string[];
  productPersonalizationAdjective?: string;
  quotationId?: string;
};

type CommunicationFlowStep = Record<string, unknown> & {
  type?: string;
  template?: string;
  source?: string;
  caption?: string;
  caption_template?: string;
  max_items?: number;
};

type CommunicationFlow = Record<string, unknown> & {
  steps?: CommunicationFlowStep[];
  max_media_per_product_group?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asCommunicationFlow(value: unknown): CommunicationFlow | null {
  if (!isRecord(value)) return null;
  if (value.steps !== undefined && !Array.isArray(value.steps)) return null;
  if (Array.isArray(value.steps) && value.steps.some((step) => !isRecord(step))) return null;
  const steps = Array.isArray(value.steps)
    ? value.steps.map((step) => step as CommunicationFlowStep)
    : undefined;
  return {
    ...value,
    ...(steps ? { steps } : {}),
  } as CommunicationFlow;
}

function errorDetails(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
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

export function renderTemplate(
  template: string,
  context: CommunicationFlowContext,
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

function detectCategories(items: Record<string, unknown>[] = []): string[] {
  return detectProductCategories(items);
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
  repository = createQuotationTemplateRepository(),
): Promise<CommunicationFlowContext | null> {
  const snapshot = await repository.get(revisionId);
  if (!snapshot || snapshot.revision.id !== revisionId) return null;
  if (quotationId !== snapshot.quotation.id && quotationId !== snapshot.quotation.businessNumber) return null;
  const view = quotationSnapshotViewModel(snapshot);
  const client = view.client as Record<string, unknown>;
  const items = (view.items || []) as Record<string, unknown>[];
  const categories = detectCategories(items);
  return {
    nome: String(client.name || client.nome || ''),
    quotationId: snapshot.quotation.businessNumber,
    link: '',
    vendorName: 'Juliana',
    empresa: 'Aspen Estamparia',
    productSummary: productSummaryFromCategories(categories),
    categories,
  };
}

// ── Media resolution ───────────────────────────────────────────────────────

async function resolveMediaUrls(
  categories: string[],
  applicationOrigin = '',
  _postgresPath = false,
  verification: {
    headFn?: BlobHead;
    blobToken?: string;
    blobStoreId?: string;
    readRecords?: () => Promise<PostgresMediaRecord[]>;
  } = {},
) {
  if (!categories.length) return [];
  let mediaRecords: PostgresMediaRecord[];
  try {
    mediaRecords = await (verification.readRecords || readCommunicationMediaRecords)();
  } catch (error) {
    if (error instanceof MediaStoreReadError) throw error;
    throw new MediaStoreReadError(error);
  }
  const media = mediaRecords.filter((item) => item.active === true && !isMediaTombstone(item)) as Array<Record<string, unknown>>;
  const byGroup: Record<string, Record<string, unknown>[]> = {};
  for (const asset of media) {
    const group = normalizeCategory(asset.product_group);
    if (!group || !asset.blob_url) continue;
    (byGroup[group] = byGroup[group] || []).push(asset);
  }

  const resolved: Record<string, unknown>[] = [];
  for (const cat of categories) {
    const category = normalizeCategory(cat);
    const assets = (byGroup[category] || []).slice(0, 5);
    for (const asset of assets) {
      let verified;
      try {
        verified = await verifyOwnedBlobRecord(asset, applicationOrigin, {
          headFn: verification.headFn,
          token: verification.blobToken,
          storeId: verification.blobStoreId,
          expectedProductGroup: category,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) throw error;
        throw createHttpError(400, 'Mídia pública inválida para cotação PostgreSQL.');
      }
      resolved.push({
        url: verified.url,
        caption: asset.caption || '',
        kind: verified.contentType === 'video/mp4' ? 'video' : 'image',
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

export type CommunicationFlowPreviewDependencies = {
  resolveFlow?: (flowId: string) => Promise<CommunicationFlow | null>;
  resolvePostgresContext?: typeof resolvePostgresQuotationContext;
  resolveMedia?: typeof resolveMediaUrls;
  headBlob?: BlobHead;
  blobToken?: string;
  blobStoreId?: string;
  readMediaRecords?: () => Promise<PostgresMediaRecord[]>;
};

export async function handler(
  event: FunctionEvent,
  dependencies: CommunicationFlowPreviewDependencies = {},
): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'Método não permitido.' });

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(event.body || '{}');
    payload = isRecord(parsed) ? parsed : {};
  } catch {
    return jsonResponse(400, { error: 'JSON inválido.' });
  }

  try {
    const flowId = String(payload.flow_id || payload.flowId || '').trim();
    const quotationId = String(
      payload.quotation_id || payload.quotationId || payload.business_number || payload.businessNumber || ''
    ).trim();
    const revisionId = String(
      payload.revision_id || payload.revisionId || payload.quote_revision_id || ''
    ).trim();
    // Legacy provider/core markers are ignored. Snapshot identifiers select the
    // immutable local context when present.
    const quoteContextRequested = Boolean(quotationId || revisionId);
    if (quoteContextRequested && !quotationId) {
      return jsonResponse(400, { error: 'Cotação PostgreSQL é obrigatória.' });
    }
    if (quoteContextRequested && !revisionId) {
      return jsonResponse(400, { error: 'Revisão PostgreSQL do orçamento é obrigatória.' });
    }
    const host = (event.headers?.host as string | undefined) || 'project-xr5jg.vercel.app';
    const proto = ((event.headers?.['x-forwarded-proto'] as string | undefined) || 'https').split(',')[0].trim();
    const applicationOrigin = `${proto}://${host}`;

    // Resolve flow
    let flow: CommunicationFlow | null = null;
    if (flowId && !dependencies.resolveFlow) {
      try {
        const flows: unknown = await kv.get(KV_KEY_FLOWS);
        if (Array.isArray(flows)) {
          const candidate = flows.find((entry) => isRecord(entry) && entry.id === flowId);
          flow = asCommunicationFlow(candidate);
        }
      } catch {
        /* ignore */
      }
    }
    if (flowId && dependencies.resolveFlow) flow = await dependencies.resolveFlow(flowId);

    // Use provided flow or fallback to mock
    if (!flow) {
      flow = asCommunicationFlow(payload.flow);
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
    const context = quoteContextRequested
      ? await (dependencies.resolvePostgresContext || resolvePostgresQuotationContext)(quotationId, revisionId)
      : getMockContext();
    if (!context) return jsonResponse(404, { error: 'Orçamento não encontrado.' });

    // Resolve only active local Blob records for product_media steps.
    const mediaUrls = await (dependencies.resolveMedia || resolveMediaUrls)(
      context.categories || [],
      applicationOrigin,
      quoteContextRequested,
      {
        headFn: dependencies.headBlob,
        blobToken: dependencies.blobToken,
        blobStoreId: dependencies.blobStoreId,
        readRecords: dependencies.readMediaRecords,
      },
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
              : typeof m.caption === 'string' ? m.caption : '';
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
  } catch (err: unknown) {
    const details = errorDetails(err);
    const code = Number.isInteger(details.statusCode) ? Number(details.statusCode) : 500;
    const message = typeof details.message === 'string' ? details.message : 'Erro ao gerar preview.';
    console.error('[comm-flow-preview]', details.logMessage || details.message || err);
    return jsonResponse(code, { error: message });
  }
}
