import { getKvClient } from '../_infrastructure/integrations/kv/client.js';
import { createHttpError } from '../_shared/http-error.js';
import { KV_KEY_FLOWS } from './media-schema.js';
import { createQuotationTemplateRepository } from '../_infrastructure/db/repositories/quotation-template-repository.js';
import type { FrozenDeliveryStep } from '../_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';
import { loadPostgresSendContext } from './send-whatsapp.js';
import {
  isRevisionBoundPublicQuotationUrl,
} from './public-quotation.js';
import {
  normalizeOwnedBlobUrl,
  readCommunicationMediaRecords,
  safeMediaFilename,
  verifyOwnedBlobRecord,
  isMediaTombstone,
  type BlobHead,
  type PostgresMediaRecord,
} from './postgres-media.js';
import { normalizeWhatsappPhone } from './whatsapp-conversations-store.js';
import { getTimeBasedGreeting } from './time-greeting.js';
import {
  detectProductCategories,
  normalizeProductCategory as normalizeCategory,
} from './product-category.js';

const MAX_STEPS = 64;
const MAX_FLOW_DURATION_MS = 45_000;
const DEFAULT_ORIGIN = 'https://project-xr5jg.vercel.app';

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
type LoadedContext = Awaited<ReturnType<typeof loadPostgresSendContext>>;
type ContextInput = Partial<LoadedContext> & Record<string, unknown>;

export type DeliveryFlow = Record<string, unknown> & {
  id?: string;
  name?: string;
  enabled?: boolean;
  active?: boolean;
  steps?: Array<Record<string, unknown>>;
  vendor_name?: string;
  delay_min_seconds?: number;
  delay_max_seconds?: number;
  max_media_per_product_group?: number;
};

export type DeliveryMediaResolver = (
  categories: string[],
  maxPerGroup: number,
  applicationOrigin: string,
) => Promise<Array<Record<string, unknown>>>;

export interface DeliveryPlan {
  revisionId: string;
  businessNumber: string;
  clientName: string;
  phone: string;
  flowId: string;
  flowName: string;
  steps: FrozenDeliveryStep[];
}

export interface DeliveryPlanInput {
  revisionId: string;
  flowId: string;
  quotationId?: string;
  businessNumber?: string;
  phone?: string;
  baseUrl?: string;
  needPdf?: boolean;
  flow?: DeliveryFlow;
  context?: ContextInput;
  resolveFlow?: (flowId: string) => Promise<DeliveryFlow | null>;
  flowResolver?: (flowId: string) => Promise<DeliveryFlow | null>;
  resolveMedia?: DeliveryMediaResolver;
  mediaResolver?: DeliveryMediaResolver;
  repository?: Parameters<typeof loadPostgresSendContext>[0]['repository'];
  store?: Parameters<typeof loadPostgresSendContext>[0]['store'];
  token?: () => string;
  renderPdf?: Parameters<typeof loadPostgresSendContext>[0]['renderPdf'];
  mediaRecords?: Array<Record<string, unknown>>;
  readMediaRecords?: () => Promise<Array<Record<string, unknown>>>;
  resolveDeal?: Parameters<typeof loadPostgresSendContext>[0]['resolveDeal'];
  headBlob?: BlobHead;
  blobToken?: string;
  blobStoreId?: string;
  random?: () => number;
  onContext?: (context: LoadedContext) => void;
}

function inputError(message: string): never {
  throw createHttpError(400, message);
}

function firstNonEmpty(...values: unknown[]): string {
  const found = values.find((value) => typeof value === 'string' && value.trim());
  return typeof found === 'string' ? found.trim() : '';
}

export function detectCategories(items: Array<Record<string, unknown>> = []): string[] {
  return detectProductCategories(items);
}

function pluralizeProductCategory(category: string): string {
  return PRODUCT_SUMMARY_PLURALS[category] || category;
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
  items: Array<Record<string, unknown>>,
): string {
  return productSummaryFromCategories(detectCategories(items));
}

function normalizeProductSummaryTemplate(template: unknown): string {
  return String(template || '')
    .replace(
      /\(produto_resumo\)\s+personalizado\(a\)/g,
      '(produto_resumo) (produto_adjetivo_personalizado)',
    )
    .replace(
      /\(produto_resumo\)\s+personalizados\(as\)/g,
      '(produto_resumo) (produto_adjetivo_personalizado)',
    );
}

function productPersonalizationAdjectiveFromCategories(categories: string[] = []): string {
  const genders = categories.map((category) => PRODUCT_CATEGORY_GENDERS[category]).filter(Boolean);
  return genders.length > 0 && genders.every((gender) => gender === 'f')
    ? 'personalizadas'
    : 'personalizados';
}

function renderTemplate(
  template: unknown,
  context: {
    nome: string;
    quotationId: string;
    link: string;
    vendorName: string;
    productSummary: string;
    categories: string[];
  },
): string {
  const nome = context.nome || '';
  const primeiroNome = nome.trim().split(/\s+/)[0] || nome;
  const grupoProduto = context.categories[0] || 'produto';
  return normalizeProductSummaryTemplate(template)
    .replace(/\(Saudacao\)/g, getTimeBasedGreeting())
    .replace(/\(nome\)/g, nome)
    .replace(/\(primeiro_nome\)/g, primeiroNome)
    .replace(/\(numero_pedido\)/g, context.quotationId)
    .replace(/\(empresa\)/g, 'Aspen Estamparia')
    .replace(/\(link_orcamento\)/g, context.link)
    .replace(/\(vendedora\)/g, context.vendorName || 'Juliana')
    .replace(/\(produto_resumo\)/g, context.productSummary || 'produtos')
    .replace(
      /\(produto_adjetivo_personalizado\)/g,
      productPersonalizationAdjectiveFromCategories(context.categories),
    )
    .replace(/\(grupo_produto\)/g, grupoProduto);
}

function normalizeDelay(value: unknown, fallback: number): number {
  const seconds = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) inputError('O atraso do fluxo é inválido.');
  return Math.round(seconds * 1000);
}

function randomDelay(minMs: number, maxMs: number, random: () => number): number {
  if (maxMs <= minMs) return minMs;
  const sample = Number(random());
  const bounded = Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 0;
  return Math.round(minMs + bounded * (maxMs - minMs));
}

function flowEnabled(flow: DeliveryFlow): boolean {
  return flow.enabled !== false && flow.active !== false;
}

async function defaultResolveFlow(flowId: string): Promise<DeliveryFlow | null> {
  try {
    const flows = await getKvClient().get(KV_KEY_FLOWS);
    if (!Array.isArray(flows)) return null;
    const flow = flows.find((value) => (
      value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>).id === flowId
    ));
    return flow && typeof flow === 'object' && !Array.isArray(flow) ? flow as DeliveryFlow : null;
  } catch {
    return null;
  }
}

async function defaultResolveMedia(
  categories: string[],
  maxPerGroup: number,
  applicationOrigin: string,
  readRecords: () => Promise<PostgresMediaRecord[]>,
  verification: { headFn?: BlobHead; blobToken?: string; blobStoreId?: string },
): Promise<Array<Record<string, unknown>>> {
  if (categories.length === 0 || maxPerGroup <= 0) return [];
  const media = (await readRecords()).filter((item) => item.active === true && !isMediaTombstone(item));
  const byGroup: Record<string, PostgresMediaRecord[]> = {};
  for (const item of media) {
    const group = normalizeCategory(item.product_group);
    if (!group || !item.blob_url) continue;
    (byGroup[group] ||= []).push(item);
  }
  const resolved: Array<Record<string, unknown>> = [];
  for (const category of categories) {
    for (const asset of (byGroup[normalizeCategory(category)] || []).slice(0, maxPerGroup)) {
      let verified;
      try {
        verified = await verifyOwnedBlobRecord(asset, applicationOrigin, {
          headFn: verification.headFn,
          token: verification.blobToken,
          storeId: verification.blobStoreId,
          expectedProductGroup: normalizeCategory(category),
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'statusCode' in error) throw error;
        inputError('Mídia pública inválida para cotação PostgreSQL.');
      }
      resolved.push({
        type: verified.contentType === 'video/mp4' ? 'video' : 'image',
        media: verified.url,
        mimetype: verified.contentType,
        fileName: safeMediaFilename(asset.pathname, verified.contentType),
        caption: typeof (asset as Record<string, unknown>).caption === 'string'
          ? String((asset as Record<string, unknown>).caption)
          : '',
      });
    }
  }
  return resolved;
}

function contextItems(context: ContextInput): Array<Record<string, unknown>> {
  const view = context.view;
  if (view && typeof view === 'object' && !Array.isArray(view)) {
    const items = (view as Record<string, unknown>).items;
    if (Array.isArray(items)) return items as Array<Record<string, unknown>>;
  }
  const items = context.items;
  return Array.isArray(items) ? items as Array<Record<string, unknown>> : [];
}

function contextClientName(context: ContextInput): string {
  const view = context.view;
  const client = view && typeof view === 'object' && !Array.isArray(view)
    ? (view as Record<string, unknown>).client
    : undefined;
  if (client && typeof client === 'object' && !Array.isArray(client)) {
    return firstNonEmpty((client as Record<string, unknown>).name, (client as Record<string, unknown>).nome);
  }
  return firstNonEmpty(context.nome, context.clientName, context.name);
}

function contextPhone(context: ContextInput, fallback: unknown): string {
  const value = firstNonEmpty(context.phone, context.telefone, fallback);
  const normalized = normalizeWhatsappPhone(value);
  if (!normalized) inputError('Telefone do destinatário inválido.');
  return normalized;
}

function contextBusinessNumber(context: ContextInput, input: DeliveryPlanInput): string {
  const businessNumber = firstNonEmpty(
    context.businessNumber,
    context.quotationBusinessNumber,
    input.businessNumber,
    input.quotationId,
    context.quotationId,
  );
  if (!businessNumber) inputError('Número do orçamento inválido.');
  return businessNumber;
}

async function resolveContext(input: DeliveryPlanInput, baseUrl: string): Promise<ContextInput> {
  if (input.context) return input.context;
  const quotationId = firstNonEmpty(input.quotationId, input.businessNumber);
  if (!quotationId) inputError('Cotação PostgreSQL é obrigatória.');
  const context = await loadPostgresSendContext({
    quotationId,
    revisionId: input.revisionId,
    businessNumber: input.businessNumber,
    recipientPhone: input.phone,
    needPdf: input.needPdf === true,
    baseUrl,
    repository: input.repository || createQuotationTemplateRepository(),
    store: input.store,
    token: input.token,
    renderPdf: input.renderPdf,
    mediaRecords: input.mediaRecords,
    readMediaRecords: input.readMediaRecords,
    resolveDeal: input.resolveDeal,
  });
  input.onContext?.(context);
  return context as ContextInput;
}

function contextLink(context: ContextInput, baseUrl: string): string {
  const candidate = firstNonEmpty(context.publicLink, context.link);
  return isRevisionBoundPublicQuotationUrl(candidate, baseUrl) ? candidate : '';
}

function normalizedMediaStep(
  raw: Record<string, unknown>,
  templateContext: Parameters<typeof renderTemplate>[1],
  baseUrl: string,
): FrozenDeliveryStep {
  const rawType = String(raw.type || '').trim().toLowerCase();
  const mediaType = rawType === 'document' ? 'document' : 'image';
  const source = firstNonEmpty(raw.media, raw.url);
  if (!source) inputError('A etapa de mídia não possui conteúdo.');
  let url: string;
  try {
    url = normalizeOwnedBlobUrl(source, baseUrl);
  } catch {
    inputError('Mídia pública inválida para cotação PostgreSQL.');
  }
  const caption = raw.caption_template !== undefined
    ? renderTemplate(raw.caption_template, templateContext).trim()
    : renderTemplate(raw.caption, templateContext).trim();
  return {
    position: 0,
    type: 'media',
    payload: {
      mediaType,
      url,
      fileName: safeMediaFilename(
        raw.fileName || raw.filename,
        String(raw.mimetype || (mediaType === 'document' ? 'application/pdf' : 'image/jpeg')),
        mediaType === 'document' ? 'documento' : 'referencia',
      ),
      caption,
    },
    delayMs: 0,
  };
}

function frozenFromResolvedMedia(
  raw: Record<string, unknown>,
  templateContext: Parameters<typeof renderTemplate>[1],
  baseUrl: string,
): FrozenDeliveryStep {
  return normalizedMediaStep({
    ...raw,
    media: raw.media || raw.url,
    caption: raw.caption_template ?? raw.caption,
  }, templateContext, baseUrl);
}

export async function createDeliveryPlan(input: DeliveryPlanInput): Promise<DeliveryPlan> {
  const revisionId = firstNonEmpty(input?.revisionId);
  const flowId = firstNonEmpty(input?.flowId);
  if (!revisionId) inputError('Identificador da revisão inválido.');
  if (!flowId) inputError('ID do fluxo é obrigatório.');
  const flow = input.flow || await (input.resolveFlow || input.flowResolver || defaultResolveFlow)(flowId);
  if (!flow || !flowEnabled(flow)) {
    throw createHttpError(404, 'Fluxo não encontrado.');
  }
  const rawFlowSteps = Array.isArray(flow.steps) ? flow.steps : [];
  const pdfSteps = rawFlowSteps.filter((step) => step.type === 'document' && step.source === 'quotation_pdf');
  if (pdfSteps.length !== 1) inputError('O fluxo deve conter exatamente um PDF do orçamento.');

  const baseUrl = firstNonEmpty(input.baseUrl) || DEFAULT_ORIGIN;
  const context = await resolveContext(input, baseUrl);
  const businessNumber = contextBusinessNumber(context, input);
  const clientName = contextClientName(context);
  const phone = contextPhone(context, input.phone);
  const categories = detectCategories(contextItems(context));
  const templateContext = {
    nome: clientName,
    quotationId: businessNumber,
    link: contextLink(context, baseUrl),
    vendorName: firstNonEmpty(flow.vendor_name) || 'Juliana',
    productSummary: productSummaryFromCategories(categories),
    categories,
  };
  const minDelayMs = normalizeDelay(flow.delay_min_seconds, 0);
  const maxDelayMs = Math.max(minDelayMs, normalizeDelay(flow.delay_max_seconds, minDelayMs / 1000));
  const random = input.random || Math.random;
  const steps: FrozenDeliveryStep[] = [];
  const mediaResolver = input.resolveMedia || input.mediaResolver || (async (
    resolvedCategories: string[],
    maxPerGroup: number,
    origin: string,
  ) => defaultResolveMedia(
    resolvedCategories,
    maxPerGroup,
    origin,
    input.mediaRecords
      ? async () => input.mediaRecords as PostgresMediaRecord[]
      : input.readMediaRecords
        ? async () => (await input.readMediaRecords!()) as PostgresMediaRecord[]
        : readCommunicationMediaRecords,
    { headFn: input.headBlob, blobToken: input.blobToken, blobStoreId: input.blobStoreId },
  ));

  for (const rawStep of rawFlowSteps) {
    let expanded: FrozenDeliveryStep[] = [];
    if (rawStep.type === 'text') {
      const text = renderTemplate(rawStep.template ?? rawStep.text, templateContext).trim();
      if (text) expanded = [{ position: 0, type: 'text', payload: { text }, delayMs: 0 }];
    } else if (rawStep.type === 'document' && rawStep.source === 'quotation_pdf') {
      expanded = [{
        position: 0,
        type: 'quotation_pdf',
        payload: {
          revisionId,
          fileName: `${businessNumber}.pdf`,
          caption: renderTemplate(rawStep.caption, templateContext).trim(),
        },
        delayMs: 0,
      }];
    } else if (rawStep.type === 'product_media') {
      const configuredMax = Number(rawStep.max_items ?? flow.max_media_per_product_group ?? 1);
      if (!Number.isFinite(configuredMax) || configuredMax < 0) inputError('Quantidade de mídia do fluxo inválida.');
      const resolved = await mediaResolver(categories, Math.floor(configuredMax), baseUrl);
      if (resolved.length === 0) inputError('A etapa de mídia não encontrou imagens autorizadas.');
      expanded = resolved.map((media) => frozenFromResolvedMedia(media, templateContext, baseUrl));
    } else if (rawStep.type === 'image' || rawStep.type === 'document' || rawStep.type === 'media') {
      expanded = [normalizedMediaStep({ ...rawStep, type: rawStep.type === 'media' ? 'image' : rawStep.type }, templateContext, baseUrl)];
    }
    for (const step of expanded) {
      if (steps.length >= MAX_STEPS) inputError('O fluxo excede o limite de etapas reconciliáveis.');
      const delayMs = steps.length === 0 ? 0 : randomDelay(minDelayMs, maxDelayMs, random);
      steps.push({ ...step, position: steps.length, delayMs });
    }
  }

  if (steps.length === 0) inputError('Fluxo não gerou nenhuma etapa válida.');
  if (steps.filter((step) => step.type === 'quotation_pdf').length !== 1) {
    inputError('O fluxo deve conter exatamente um PDF do orçamento.');
  }
  const maximumDurationMs = Math.max(0, steps.length - 1) * maxDelayMs;
  const plannedDurationMs = steps.reduce((total, step) => total + step.delayMs, 0);
  if (!Number.isFinite(maximumDurationMs) || !Number.isFinite(plannedDurationMs) || maximumDurationMs > MAX_FLOW_DURATION_MS || plannedDurationMs > MAX_FLOW_DURATION_MS) {
    inputError('O fluxo deve caber no limite de 45 segundos.');
  }
  return {
    revisionId,
    businessNumber,
    clientName,
    phone,
    flowId,
    flowName: firstNonEmpty(flow.name) || flowId,
    steps,
  };
}

export const createQuotationDeliveryPlan = createDeliveryPlan;
