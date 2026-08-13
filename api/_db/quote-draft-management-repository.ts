import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from './client.js';
import { appendProductActivityEvents } from './product-activity-repository.js';
import { acquireQuotationWriteLock } from './quotation-write-lock.js';
import {
  clients,
  products,
  productPricingTiers,
  quoteRevisionItems,
  quoteRevisions,
  quotations,
  quotationTemplateVersions,
  quotationTemplates,
} from './schema.js';
import {
  PricingUnavailableError,
  PricingValidationError,
  formatMoneyCents,
  normalizeProductPricing,
  parseMoneyCents,
  parseQuantityScaled,
  parseScaledInteger,
  resolveProductPrice,
  type PricingResolution,
} from '../_functions/pricing-core.js';
import {
  combineLegacyConditions,
  normalizeQuotationSections,
  type QuotationSectionsSnapshot,
} from './quotation-content.js';
import { snapshotFromLegacyRevision } from './quotation-template-snapshot.js';

type DatabaseProvider = () => AppDatabase;
type QuoteTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];
export type QuoteDatabase = AppDatabase | QuoteTransaction;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_MAX_CENTS = 99999999999999999999n;

export class QuoteManagementInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'QuoteManagementInputError';
  }
}

export class QuoteManagementNotFoundError extends Error {
  readonly statusCode = 404;
  readonly expose = true;

  constructor(message = 'Orçamento não encontrado.') {
    super(message);
    this.name = 'QuoteManagementNotFoundError';
  }
}

export class QuoteManagementConflictError extends Error {
  readonly statusCode = 409;
  readonly expose = true;

  constructor(message = 'O orçamento foi alterado ou não está mais disponível para edição.') {
    super(message);
    this.name = 'QuoteManagementConflictError';
  }
}

export class QuoteManagementRepositoryError extends Error {
  readonly statusCode = 503;
  readonly expose = false;

  constructor(message = 'Não foi possível processar o orçamento. Tente novamente.') {
    super(message);
    this.name = 'QuoteManagementRepositoryError';
  }
}

export interface QuoteDraftManagementListOptions {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
  orderBy?: string;
}

export type CanonicalQuotationListStatus = 'rascunho' | 'enviado' | 'aprovado' | 'perdido';

/**
 * Normalize the legacy/UI status vocabulary accepted by the quotations list
 * endpoint to the canonical lifecycle state stored in PostgreSQL. `null`
 * means an empty/All filter, while `undefined` identifies an invalid label.
 */
export function normalizeQuotationListStatus(
  value: string | undefined
): CanonicalQuotationListStatus | null | undefined {
  const normalized = (value || '').trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (lower === 'all') return null;
  if (lower === 'draft' || lower === 'rascunho') return 'rascunho';
  if (
    lower === 'issued' ||
    lower === 'open' ||
    lower === 'replied' ||
    lower === 'expired' ||
    lower === 'emitido' ||
    lower === 'enviado'
  )
    return 'enviado';
  if (lower === 'ordered' || lower === 'aprovado') return 'aprovado';
  if (lower === 'lost' || lower === 'cancelled' || lower === 'perdido') return 'perdido';
  return undefined;
}

export interface QuoteDraftManagementListRow {
  id: string;
  quotation_id: string;
  quotation_uuid: string;
  revision_id: string;
  revision: number;
  revision_number: number;
  client_id: string;
  cliente: string;
  cliente_snapshot: Record<string, unknown>;
  data: string;
  validade: string;
  validade_dias: number;
  subtotal: string;
  total: string;
  valor: string;
  frete: string;
  status: string;
  status_canonical: string;
  updated_at: string;
  updatedAt: string;
  concurrency_token: string;
  optimistic_concurrency_token: string;
}

export interface QuoteDraftManagementListResult {
  rows: QuoteDraftManagementListRow[];
  total: number;
  page: number;
  limit: number;
  statusSummary: Record<string, number>;
}

export interface QuoteDraftManagementItem {
  id: string;
  position: number;
  item_code: string;
  sku: string;
  qty: string;
  quantidade: string;
  nome: string;
  descricao: string;
  unidade: string;
  categoria: string | null;
  marca: string | null;
  price_source: 'base' | 'tier';
  preco_fonte: 'base' | 'tier';
  tier_minimum: string | null;
  preco_minimo_faixa: string | null;
  suggested_unit_price: string;
  preco_sugerido: string;
  applied_unit_price: string;
  preco_aplicado: string;
  price_difference: string;
  diferenca_preco: string;
  line_total: string;
  total_linha: string;
  manual_rate: boolean;
}

export interface QuoteDraftManagementDetail {
  id: string;
  quotation_id: string;
  quotation_name: string;
  quotation_uuid: string;
  quote_id: string;
  revision_id: string;
  quote_revision_id: string;
  revision: number;
  revision_number: number;
  status: string;
  status_canonical: string;
  cliente: string;
  client_id: string;
  cliente_id: string;
  cliente_snapshot: Record<string, unknown>;
  data: string;
  validade: string;
  validity_date: string;
  validade_dias: number;
  pagamento: string;
  entrega: string;
  frete_padrao: string;
  frete: string;
  observacoes: string;
  prazo_producao: string;
  template_padrao: string;
  template_key: string;
  template_hash: string;
  template_version_id: string | null;
  template_version: number | null;
  secoes: QuotationSectionsSnapshot | null;
  sections_snapshot: QuotationSectionsSnapshot | null;
  derived_expired: boolean;
  expiration_derived: boolean;
  is_expired: boolean;
  expirada: boolean;
  revision_history: QuoteRevisionHistoryEntry[];
  subtotal: string;
  total: string;
  valor: string;
  items: QuoteDraftManagementItem[];
  updated_at: string;
  updatedAt: string;
  concurrency_token: string;
  version_token: string;
  optimistic_concurrency_token: string;
  concurrencyToken: string;
}

/**
 * Read-only history metadata.  The row is deliberately made up of snapshot
 * fields only: live clients/products/settings never participate in history
 * rendering, and an issued revision can therefore be audited after those
 * records change.
 */
export interface QuoteRevisionHistoryEntry {
  id: string;
  revision_id: string;
  revision: number;
  revision_number: number;
  created_at: string;
  createdAt: string;
  validade_dias: number;
  validity_date: string;
  validade: string;
  subtotal: string;
  total: string;
  valor: string;
  status: string;
  status_canonical: string;
  derived_expired: boolean;
  expiration_derived: boolean;
  is_expired: boolean;
  expirada: boolean;
  template_key: string | null;
  template_version: number | null;
  template_hash: string | null;
}

export interface QuoteDraftManagementUpdateInput {
  concurrency_token?: unknown;
  concurrencyToken?: unknown;
  version_token?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  client_id?: unknown;
  clientId?: unknown;
  cliente_id?: unknown;
  clienteId?: unknown;
  items?: unknown;
  validade_dias?: unknown;
  validadeDias?: unknown;
  pagamento?: unknown;
  entrega?: unknown;
  frete?: unknown;
  frete_aplicado?: unknown;
  observacoes?: unknown;
  notes?: unknown;
  prazo_producao?: unknown;
  template_key?: unknown;
  template_padrao?: unknown;
  template_version_id?: unknown;
  secoes?: unknown;
  sections_snapshot?: unknown;
}

export interface QuoteDraftManagementRepository {
  list?: (options?: QuoteDraftManagementListOptions) => Promise<QuoteDraftManagementListResult>;
  get?: (id: string) => Promise<QuoteDraftManagementDetail | null>;
  update?: (
    id: string,
    input: QuoteDraftManagementUpdateInput
  ) => Promise<QuoteDraftManagementDetail>;
  listDrafts?: (
    options?: QuoteDraftManagementListOptions
  ) => Promise<QuoteDraftManagementListResult>;
  getDraft?: (id: string) => Promise<QuoteDraftManagementDetail | null>;
  updateDraft?: (
    id: string,
    input: QuoteDraftManagementUpdateInput
  ) => Promise<QuoteDraftManagementDetail>;
  delete?: (id: string) => Promise<{ id: string; deletedAt: string }>;
}

export interface QuoteDraftManagementRepositoryOptions {
  now?: () => Date;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function firstDefined(value: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (hasOwn(value, key)) return value[key];
  }
  return undefined;
}

function asDate(value: Date | string | null | undefined): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function asIso(value: Date | string | null | undefined): string {
  return asDate(value).toISOString();
}

function formatDbMoney(value: unknown): string {
  const raw = String(value ?? '0').trim();
  try {
    const cents = parseScaledInteger(raw, 2, 'Valor');
    return formatMoneyCents(cents);
  } catch {
    return raw || '0.00';
  }
}

function formatQuantity(value: unknown): string {
  const raw = String(value ?? '0');
  try {
    const scaled = parseScaledInteger(raw, 3, 'Quantidade');
    return `${scaled / 1000n}.${(scaled % 1000n).toString().padStart(3, '0')}`;
  } catch {
    return raw;
  }
}

function signedMoney(cents: bigint): string {
  return cents < 0n ? `-${formatMoneyCents(-cents)}` : formatMoneyCents(cents);
}

function lineTotalCents(quantityScaled: bigint, unitPriceCents: bigint): bigint {
  return (quantityScaled * unitPriceCents + 500n) / 1000n;
}

function parseNonNegativeMoney(value: unknown, label: string): bigint {
  let cents: bigint;
  try {
    cents = parseScaledInteger(value, 2, label);
  } catch (error) {
    if (error instanceof PricingValidationError) throw new QuoteManagementInputError(error.message);
    throw error;
  }
  if (cents < 0n) throw new QuoteManagementInputError(`${label} deve ser maior ou igual a zero.`);
  if (cents > MONEY_MAX_CENTS)
    throw new QuoteManagementInputError(`${label} está fora do limite permitido.`);
  return cents;
}

function assertMoneyWithinLimit(cents: bigint, label: string): void {
  if (cents > MONEY_MAX_CENTS)
    throw new QuoteManagementInputError(`${label} está fora do limite permitido.`);
}

function inputText(value: unknown, label: string, maximum: number, fallback = ''): string {
  if (value === undefined) return fallback;
  if (value === null) return '';
  if (typeof value !== 'string') throw new QuoteManagementInputError(`${label} deve ser texto.`);
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new QuoteManagementInputError(`${label} deve ter no máximo ${maximum} caracteres.`);
  }
  return normalized;
}

function tokenFor(value: Date | string | null | undefined): string {
  return asIso(value);
}

async function readTemplateSelection(
  tx: QuoteDatabase,
  input: Record<string, unknown>,
  revision: typeof quoteRevisions.$inferSelect
): Promise<{ key: string; hash: string; versionId: string; version: number } | undefined> {
  const rawKey = hasOwn(input, 'template_key') ? input.template_key : undefined;
  const rawLegacy = hasOwn(input, 'template_padrao') ? input.template_padrao : undefined;
  const rawVersion = hasOwn(input, 'template_version_id') ? input.template_version_id : undefined;
  const values = [rawKey, rawLegacy].filter((value) => value !== undefined);
  if (values.some((value) => typeof value !== 'string' || !value.trim()))
    throw new QuoteManagementInputError('Template do orçamento inválido.');
  const keys = values.map((value) => String(value).trim());
  if (new Set(keys).size > 1)
    throw new QuoteManagementInputError('Os templates informados entram em conflito.');
  if (rawVersion !== undefined && (typeof rawVersion !== 'string' || !rawVersion.trim() || !isUuid(rawVersion.trim())))
    throw new QuoteManagementInputError('Versão de template inválida.');
  if (rawVersion === undefined && values.length === 0) {
    if (revision.templateVersionId) {
      const [selected] = await tx
        .select({ key: quotationTemplates.key, archived: quotationTemplates.archived, hash: quotationTemplateVersions.sourceHash, versionId: quotationTemplateVersions.id, version: quotationTemplateVersions.version })
        .from(quotationTemplateVersions)
        .innerJoin(quotationTemplates, eq(quotationTemplateVersions.templateId, quotationTemplates.id))
        .where(eq(quotationTemplateVersions.id, revision.templateVersionId))
        .limit(1);
      if (selected && (!selected.archived || selected.versionId === revision.templateVersionId)) return selected;
      if (selected?.archived) throw new QuoteManagementInputError('Template do orçamento inválido ou arquivado.');
    }
    const [resolved] = await tx
      .select({ key: quotationTemplates.key, hash: quotationTemplateVersions.sourceHash, versionId: quotationTemplateVersions.id, version: quotationTemplateVersions.version })
      .from(quotationTemplateVersions)
      .innerJoin(quotationTemplates, eq(quotationTemplateVersions.templateId, quotationTemplates.id))
      .where(
        and(
          eq(quotationTemplates.key, revision.templatePadrao),
          eq(quotationTemplateVersions.sourceHash, revision.templateHash),
          eq(quotationTemplates.archived, false),
        ),
      )
      .limit(1);
    if (!resolved) throw new QuoteManagementInputError('Versão de template do orçamento não encontrada.');
    return resolved;
  }
  const versionId = typeof rawVersion === 'string' ? rawVersion.trim() : undefined;
  const [selected] = await tx
    .select({ key: quotationTemplates.key, archived: quotationTemplates.archived, hash: quotationTemplateVersions.sourceHash, versionId: quotationTemplateVersions.id, version: quotationTemplateVersions.version })
    .from(quotationTemplateVersions)
    .innerJoin(quotationTemplates, eq(quotationTemplateVersions.templateId, quotationTemplates.id))
    .where(versionId ? eq(quotationTemplateVersions.id, versionId) : eq(quotationTemplates.key, keys[0]))
    .orderBy(desc(quotationTemplateVersions.version))
    .limit(1);
  if (!selected || (selected.archived && selected.versionId !== revision.templateVersionId))
    throw new QuoteManagementInputError('Template do orçamento inválido ou arquivado.');
  if (keys[0] && keys[0] !== selected.key)
    throw new QuoteManagementInputError('A versão de template não pertence ao template informado.');
  return { key: selected.key, hash: selected.hash, versionId: selected.versionId, version: selected.version };
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function legacySectionsSnapshotForUpdate(
  revision: typeof quoteRevisions.$inferSelect,
  values: { pagamento: string; entrega: string; observacoes: string; prazoProducao: string }
): QuotationSectionsSnapshot {
  const stored = revision.sectionsSnapshot || snapshotFromLegacyRevision(revision);
  return {
    schema_version: stored.schema_version,
    prazo_producao: {
      base: copy(stored.prazo_producao.base),
      current: { ...copy(stored.prazo_producao.current), enabled: Boolean(values.prazoProducao) },
    },
    pagamento: {
      base: copy(stored.pagamento.base),
      current: { ...copy(stored.pagamento.current), body: values.pagamento },
    },
    condicoes_gerais: {
      base: copy(stored.condicoes_gerais.base),
      current: {
        ...copy(stored.condicoes_gerais.current),
        body: combineLegacyConditions(values.entrega, values.observacoes),
      },
    },
  };
}

function sectionSnapshotForUpdate(
  input: Record<string, unknown>,
  revision: typeof quoteRevisions.$inferSelect
): QuotationSectionsSnapshot | undefined {
  const supplied = input.secoes ?? input.sections_snapshot;
  if (supplied === undefined) return undefined;
  if (!isRecord(supplied)) throw new QuoteManagementInputError('Seções devem ser um objeto.');
  const stored = revision.sectionsSnapshot || snapshotFromLegacyRevision(revision);
  const candidate = supplied as Record<string, unknown>;
  if (hasOwn(candidate, 'base')) {
    const expectedBase = {
      prazo_producao: stored.prazo_producao.base,
      pagamento: stored.pagamento.base,
      condicoes_gerais: stored.condicoes_gerais.base,
    };
    if (!isRecord(candidate.base) || canonicalJson(candidate.base) !== canonicalJson(expectedBase))
      throw new QuoteManagementInputError('A base das seções não pode ser alterada.');
  }
  for (const key of ['prazo_producao', 'pagamento', 'condicoes_gerais'] as const) {
    const section = candidate[key];
    if (isRecord(section) && section.base !== undefined && JSON.stringify(section.base) !== JSON.stringify(stored[key].base))
      throw new QuoteManagementInputError('A base das seções não pode ser alterada.');
  }
  const current = isRecord(candidate.current) ? candidate.current : candidate;
  const sectionValue = (key: 'prazo_producao' | 'pagamento' | 'condicoes_gerais') => {
    const value = current[key];
    const suppliedCurrent = isRecord(value) && value.current !== undefined ? value.current : value;
    if (!isRecord(suppliedCurrent)) return stored[key].current;
    return { ...stored[key].current, ...suppliedCurrent };
  };
  try {
    const merged = normalizeQuotationSections({
      schema_version: stored.schema_version,
      prazo_producao: sectionValue('prazo_producao'),
      pagamento: sectionValue('pagamento'),
      condicoes_gerais: sectionValue('condicoes_gerais'),
    });
    return {
      schema_version: stored.schema_version,
      prazo_producao: { base: copy(stored.prazo_producao.base), current: copy(merged.prazo_producao) },
      pagamento: { base: copy(stored.pagamento.base), current: copy(merged.pagamento) },
      condicoes_gerais: { base: copy(stored.condicoes_gerais.base), current: copy(merged.condicoes_gerais) },
    };
  } catch (error) {
    throw new QuoteManagementInputError(error instanceof Error ? error.message : 'Seções inválidas.');
  }
}

function mapSnapshot(
  revision: typeof quoteRevisions.$inferSelect,
  client: typeof clients.$inferSelect | null
): Record<string, unknown> {
  return {
    id: client?.id || revision.quotationId,
    nome: revision.clienteNome,
    documento: revision.clienteDocumento ?? null,
    email: revision.clienteEmail ?? null,
    telefone: revision.clienteTelefone ?? null,
    notes: revision.clienteNotas ?? null,
    address: {
      endereco: revision.clienteEndereco ?? null,
      numero: revision.clienteNumero ?? null,
      bairro: revision.clienteBairro ?? null,
      complemento: revision.clienteComplemento ?? null,
      municipio: revision.clienteMunicipio ?? null,
      uf: revision.clienteUf ?? null,
      cep: revision.clienteCep ?? null,
    },
  };
}

function validUntil(createdAt: Date | string, days: number): string {
  const date = asDate(createdAt);
  date.setUTCDate(date.getUTCDate() + Math.max(1, days));
  return date.toISOString().slice(0, 10);
}

function validityDeadline(createdAt: Date | string, days: number): Date {
  const date = asDate(createdAt);
  date.setUTCDate(date.getUTCDate() + Math.max(1, days));
  return date;
}

function isDerivedExpired(createdAt: Date | string, days: number, now: () => Date): boolean {
  const candidate = now();
  const clock =
    candidate instanceof Date && !Number.isNaN(candidate.getTime()) ? candidate : new Date();
  return clock.getTime() >= validityDeadline(createdAt, days).getTime();
}

function validUntilTime(createdAt: Date | string, days: number): number {
  const date = asDate(createdAt);
  date.setUTCDate(date.getUTCDate() + Math.max(1, days));
  return date.getTime();
}

function compareMoneyValues(left: unknown, right: unknown): number {
  try {
    const leftCents = parseScaledInteger(left, 2, 'Valor');
    const rightCents = parseScaledInteger(right, 2, 'Valor');
    return leftCents < rightCents ? -1 : leftCents > rightCents ? 1 : 0;
  } catch {
    return String(left ?? '').localeCompare(String(right ?? ''));
  }
}

function statusUi(value: string): string {
  // Keep a concise UI vocabulary while exposing the canonical Portuguese
  // state separately.  The aliases retain compatibility with old list
  // consumers that still send/expect English labels.
  if (value === 'rascunho') return 'Rascunho';
  if (value === 'enviado' || value === 'emitido') return 'Enviado';
  if (value === 'aprovado') return 'Aprovado';
  if (value === 'perdido') return 'Perdido';
  return value || 'Rascunho';
}

function productPricingRowsBySku(
  rows: (typeof productPricingTiers.$inferSelect)[]
): Map<string, (typeof productPricingTiers.$inferSelect)[]> {
  const bySku = new Map<string, (typeof productPricingTiers.$inferSelect)[]>();
  for (const row of rows) {
    const existing = bySku.get(row.productSku) || [];
    existing.push(row);
    bySku.set(row.productSku, existing);
  }
  return bySku;
}

function itemFromRows(
  row: typeof quoteRevisionItems.$inferSelect,
  product: typeof products.$inferSelect | null
): QuoteDraftManagementItem {
  // Revision snapshots are authoritative for display/history. The current
  // product row is only a fallback for old rows that predate a complete
  // snapshot; update validation still reads the active catalog separately.
  const sku = row.produtoSku || row.productSku || product?.sku || '';
  const name = row.produtoNome || product?.nome || '';
  const description = row.produtoDescricao ?? product?.descricao ?? '';
  const unit = row.produtoUnidade ?? product?.unidade ?? '';
  const source = row.precoFonte === 'tier' ? 'tier' : 'base';
  const tier = row.precoMinimoFaixa == null ? null : String(row.precoMinimoFaixa);
  const qty = formatQuantity(row.quantidade);
  const suggested = formatDbMoney(row.precoSugerido);
  const applied = formatDbMoney(row.precoAplicado);
  const difference = formatDbMoney(row.diferencaPreco);
  const lineTotal = formatDbMoney(row.totalLinha);
  return {
    id: row.id,
    position: row.position,
    item_code: sku,
    sku,
    qty,
    quantidade: qty,
    nome: name,
    descricao: description,
    unidade: unit,
    categoria: row.produtoCategoria ?? product?.categoria ?? null,
    marca: row.produtoMarca ?? product?.marca ?? null,
    price_source: source,
    preco_fonte: source,
    tier_minimum: tier,
    preco_minimo_faixa: tier,
    suggested_unit_price: suggested,
    preco_sugerido: suggested,
    applied_unit_price: applied,
    preco_aplicado: applied,
    price_difference: difference,
    diferenca_preco: difference,
    line_total: lineTotal,
    total_linha: lineTotal,
    manual_rate: Boolean(row.manualRate),
  };
}

function quoteWhere(id: string) {
  const normalized = String(id || '').trim();
  if (isUuid(normalized))
    return or(eq(quotations.id, normalized), eq(quotations.businessNumber, normalized));
  return eq(quotations.businessNumber, normalized);
}

async function readRevision(tx: QuoteDatabase, quotationId: string) {
  const [revision] = await tx
    .select()
    .from(quoteRevisions)
    .where(eq(quoteRevisions.quotationId, quotationId))
    .orderBy(desc(quoteRevisions.version))
    .limit(1);
  return revision || null;
}

async function readRevisionHistory(
  tx: QuoteDatabase,
  quotationId: string,
  now: () => Date
): Promise<QuoteRevisionHistoryEntry[]> {
  const revisions = await tx
    .select()
    .from(quoteRevisions)
    .where(eq(quoteRevisions.quotationId, quotationId))
    .orderBy(desc(quoteRevisions.version));
  const versionIds = revisions
    .map((revision) => revision.templateVersionId)
    .filter((id): id is string => Boolean(id));
  const versionRows = versionIds.length
    ? await tx
        .select({ id: quotationTemplateVersions.id, version: quotationTemplateVersions.version })
        .from(quotationTemplateVersions)
        .where(inArray(quotationTemplateVersions.id, versionIds))
    : [];
  const versionById = new Map(versionRows.map((row) => [row.id, row.version]));
  return revisions.map((revision) => {
    const validityDate = validUntil(revision.createdAt, revision.validadeDias);
    const createdAt = asIso(revision.createdAt);
    const expired = isDerivedExpired(revision.createdAt, revision.validadeDias, now);
    const statusCanonical = revision.status === 'emitido' ? 'enviado' : revision.status;
    return {
      id: revision.id,
      revision_id: revision.id,
      revision: revision.version,
      revision_number: revision.version,
      created_at: createdAt,
      createdAt,
      validade_dias: revision.validadeDias,
      validity_date: validityDate,
      validade: validityDate,
      subtotal: formatDbMoney(revision.subtotal),
      total: formatDbMoney(revision.total),
      valor: formatDbMoney(revision.total),
      status: statusUi(statusCanonical),
      status_canonical: statusCanonical,
      derived_expired: expired,
      expiration_derived: expired,
      is_expired: expired,
      expirada: expired,
      template_key: revision.templatePadrao || null,
      template_version: revision.templateVersionId
        ? versionById.get(revision.templateVersionId) || null
        : null,
      template_hash: revision.templateHash || null,
    };
  });
}

export async function readPostgresQuotationDetail(
  tx: QuoteDatabase,
  id: string,
  now: () => Date = () => new Date()
): Promise<QuoteDraftManagementDetail | null> {
  const [quotation] = await tx.select().from(quotations).where(quoteWhere(id)).limit(1);
  if (!quotation) return null;
  const revision = await readRevision(tx, quotation.id);
  if (!revision) return null;
  const [client] = await tx
    .select()
    .from(clients)
    .where(eq(clients.id, quotation.clientId))
    .limit(1);
  const itemRows = await tx
    .select()
    .from(quoteRevisionItems)
    .where(eq(quoteRevisionItems.revisionId, revision.id))
    .orderBy(asc(quoteRevisionItems.position));
  const skus = [...new Set(itemRows.map((row) => row.productSku))];
  const productRows = skus.length
    ? await tx
        .select()
        .from(products)
        .where(or(...skus.map((sku) => eq(products.sku, sku))))
    : [];
  const productBySku = new Map(productRows.map((row) => [row.sku, row]));
  const updatedAt = asIso(quotation.updatedAt);
  const snapshot = mapSnapshot(revision, client || null);
  const canonicalStatus =
    (quotation.status === 'rascunho' ? revision.status : quotation.status) === 'emitido'
      ? 'enviado'
      : quotation.status === 'rascunho'
        ? revision.status
        : quotation.status;
  const history = await readRevisionHistory(tx, quotation.id, now);
  const [templateVersion] = revision.templateVersionId
    ? await tx
        .select({ version: quotationTemplateVersions.version })
        .from(quotationTemplateVersions)
        .where(eq(quotationTemplateVersions.id, revision.templateVersionId))
        .limit(1)
    : [];
  const sectionsSnapshot = revision.sectionsSnapshot || snapshotFromLegacyRevision(revision);
  const currentExpired = isDerivedExpired(revision.createdAt, revision.validadeDias, now);
  const currentValidityDate = validUntil(revision.createdAt, revision.validadeDias);
  return {
    id: quotation.businessNumber,
    quotation_id: quotation.businessNumber,
    quotation_name: quotation.businessNumber,
    quotation_uuid: quotation.id,
    quote_id: quotation.id,
    revision_id: revision.id,
    quote_revision_id: revision.id,
    revision: revision.version,
    revision_number: revision.version,
    status: statusUi(canonicalStatus),
    status_canonical: canonicalStatus,
    cliente: revision.clienteNome,
    client_id: quotation.clientId,
    cliente_id: quotation.clientId,
    cliente_snapshot: snapshot,
    data: asIso(quotation.createdAt).slice(0, 10),
    validade: currentValidityDate,
    validity_date: currentValidityDate,
    derived_expired: currentExpired,
    expiration_derived: currentExpired,
    is_expired: currentExpired,
    expirada: currentExpired,
    validade_dias: revision.validadeDias,
    pagamento: revision.pagamento,
    entrega: revision.entrega,
    frete_padrao: formatDbMoney(revision.fretePadrao),
    frete: formatDbMoney(revision.frete),
    observacoes: revision.observacoes,
    prazo_producao: revision.prazoProducao,
    template_padrao: revision.templatePadrao,
    template_key: revision.templatePadrao,
    template_hash: revision.templateHash,
    template_version_id: revision.templateVersionId || null,
    template_version: templateVersion?.version || null,
    secoes: sectionsSnapshot,
    sections_snapshot: sectionsSnapshot,
    subtotal: formatDbMoney(revision.subtotal),
    total: formatDbMoney(revision.total),
    valor: formatDbMoney(revision.total),
    items: itemRows.map((row) => itemFromRows(row, productBySku.get(row.productSku) || null)),
    revision_history: history,
    updated_at: updatedAt,
    updatedAt,
    concurrency_token: tokenFor(quotation.updatedAt),
    version_token: tokenFor(quotation.updatedAt),
    optimistic_concurrency_token: tokenFor(quotation.updatedAt),
    concurrencyToken: tokenFor(quotation.updatedAt),
  };
}

// Kept as a private-name alias for the existing repository implementation and
// exported above for the lifecycle repository to reuse inside its transaction.
const readDetail = readPostgresQuotationDetail;

function safeOrderValue(value: string | undefined): string {
  const allowed = new Set([
    'creation desc',
    'creation asc',
    'transaction_date desc',
    'transaction_date asc',
    'valid_till desc',
    'valid_till asc',
    'updated_at desc',
    'updated_at asc',
    'name desc',
    'name asc',
    'grand_total desc',
    'grand_total asc',
  ]);
  return allowed.has((value || '').trim().toLowerCase())
    ? (value || '').trim().toLowerCase()
    : 'creation desc';
}

function asListStatus(value: string | undefined): string | null {
  const normalized = (value || '').trim();
  const canonical = normalizeQuotationListStatus(normalized);
  if (canonical !== undefined) return canonical;
  // Keep direct repository callers deterministic for unknown labels; the HTTP
  // handler rejects these before reaching the database.
  return normalized;
}

function normalizePage(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : fallback;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return Math.min(200, Math.max(1, normalizePage(value, fallback)));
}

async function listRows(
  tx: QuoteDatabase,
  options: QuoteDraftManagementListOptions
): Promise<QuoteDraftManagementListResult> {
  const page = normalizePage(options.page, 1);
  const limit = normalizeLimit(options.limit, 50);
  const search = (options.search || '').trim().toLocaleLowerCase();
  const wantedStatus = asListStatus(options.status);
  const quoteRows = await tx.select().from(quotations);
  const revisions = await tx.select().from(quoteRevisions);
  const revisionsByQuote = new Map<string, typeof quoteRevisions.$inferSelect>();
  for (const revision of revisions) {
    const current = revisionsByQuote.get(revision.quotationId);
    if (!current || revision.version > current.version)
      revisionsByQuote.set(revision.quotationId, revision);
  }
  const clientRows = await tx.select().from(clients);
  const clientsById = new Map(clientRows.map((row) => [row.id, row]));
  const mappedRows = quoteRows
    .map((quotation) => {
      const revision = revisionsByQuote.get(quotation.id);
      if (!revision) return null;
      const client = clientsById.get(quotation.clientId) || null;
      const name = revision.clienteNome || client?.nome || '';
      return { quotation, revision, client, name };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  const searchMatches = mappedRows.filter((row) => {
    if (!search) return true;
    return [
      row.quotation.businessNumber,
      row.name,
      row.client?.email || '',
      row.client?.documento || '',
    ].some((part) => String(part).toLocaleLowerCase().includes(search));
  });
  const candidates = searchMatches.filter((row) => {
    const rawState =
      row.quotation.status === 'rascunho' ? row.revision.status : row.quotation.status;
    const state = rawState === 'emitido' ? 'enviado' : rawState;
    return !wantedStatus || state === wantedStatus;
  });
  const statusSummary: Record<string, number> = {
    Rascunho: 0,
    Enviado: 0,
    Aprovado: 0,
    Perdido: 0,
    // Legacy keys remain present so list consumers compiled against the
    // previous vocabulary do not crash while migrating to canonical states.
    Draft: 0,
    Issued: 0,
    Open: 0,
    Replied: 0,
    Ordered: 0,
    Lost: 0,
    Expired: 0,
    Cancelled: 0,
  };
  for (const row of searchMatches) {
    const rawState =
      row.quotation.status === 'rascunho' ? row.revision.status : row.quotation.status;
    const state = rawState === 'emitido' ? 'enviado' : rawState;
    const key = statusUi(state);
    if (Object.prototype.hasOwnProperty.call(statusSummary, key)) statusSummary[key] += 1;
    if (key === 'Rascunho') statusSummary.Draft += 1;
    if (key === 'Enviado') statusSummary.Issued += 1;
    if (key === 'Perdido') statusSummary.Lost += 1;
  }
  const order = safeOrderValue(options.orderBy);
  const tieBreak = (
    left: (typeof candidates)[number],
    right: (typeof candidates)[number]
  ): number => left.quotation.businessNumber.localeCompare(right.quotation.businessNumber);
  const compareWithTie = (
    primary: number,
    left: (typeof candidates)[number],
    right: (typeof candidates)[number]
  ): number => primary || tieBreak(left, right);
  candidates.sort((left, right) => {
    if (order === 'creation asc' || order === 'transaction_date asc') {
      return compareWithTie(
        asDate(left.quotation.createdAt).getTime() - asDate(right.quotation.createdAt).getTime(),
        left,
        right
      );
    }
    if (order === 'creation desc' || order === 'transaction_date desc') {
      return compareWithTie(
        asDate(right.quotation.createdAt).getTime() - asDate(left.quotation.createdAt).getTime(),
        left,
        right
      );
    }
    if (order === 'valid_till asc') {
      return compareWithTie(
        validUntilTime(left.revision.createdAt, left.revision.validadeDias) -
          validUntilTime(right.revision.createdAt, right.revision.validadeDias),
        left,
        right
      );
    }
    if (order === 'valid_till desc') {
      return compareWithTie(
        validUntilTime(right.revision.createdAt, right.revision.validadeDias) -
          validUntilTime(left.revision.createdAt, left.revision.validadeDias),
        left,
        right
      );
    }
    if (order === 'name asc')
      return compareWithTie(
        left.quotation.businessNumber.localeCompare(right.quotation.businessNumber),
        left,
        right
      );
    if (order === 'name desc')
      return compareWithTie(
        right.quotation.businessNumber.localeCompare(left.quotation.businessNumber),
        left,
        right
      );
    if (order === 'grand_total asc')
      return compareWithTie(
        compareMoneyValues(left.revision.total, right.revision.total),
        left,
        right
      );
    if (order === 'grand_total desc')
      return compareWithTie(
        compareMoneyValues(right.revision.total, left.revision.total),
        left,
        right
      );
    if (order === 'updated_at asc') {
      return compareWithTie(
        asDate(left.quotation.updatedAt).getTime() - asDate(right.quotation.updatedAt).getTime(),
        left,
        right
      );
    }
    return compareWithTie(
      asDate(right.quotation.updatedAt).getTime() - asDate(left.quotation.updatedAt).getTime(),
      left,
      right
    );
  });
  const total = candidates.length;
  const rows = candidates
    .slice((page - 1) * limit, page * limit)
    .map(({ quotation, revision, client, name }) => {
      const updatedAt = asIso(quotation.updatedAt);
      const rawStatus = quotation.status === 'rascunho' ? revision.status : quotation.status;
      const canonicalStatus = rawStatus === 'emitido' ? 'enviado' : rawStatus;
      return {
        id: quotation.businessNumber,
        quotation_id: quotation.businessNumber,
        quotation_uuid: quotation.id,
        revision_id: revision.id,
        revision: revision.version,
        revision_number: revision.version,
        client_id: quotation.clientId,
        cliente: name,
        cliente_snapshot: mapSnapshot(revision, client),
        data: asIso(quotation.createdAt).slice(0, 10),
        validade: validUntil(revision.createdAt, revision.validadeDias),
        validade_dias: revision.validadeDias,
        subtotal: formatDbMoney(revision.subtotal),
        total: formatDbMoney(revision.total),
        valor: formatDbMoney(revision.total),
        frete: formatDbMoney(revision.frete),
        status: statusUi(canonicalStatus),
        status_canonical: canonicalStatus,
        updated_at: updatedAt,
        updatedAt,
        concurrency_token: tokenFor(quotation.updatedAt),
        optimistic_concurrency_token: tokenFor(quotation.updatedAt),
      };
    });
  return { rows, total, page, limit, statusSummary };
}

function normalizeUpdateItems(
  input: unknown
): Array<{
  sku: string;
  itemName: string;
  quantityScaled: bigint;
  quantity: string;
  rate: unknown;
  manualRate: boolean;
}> {
  if (!Array.isArray(input) || input.length === 0) {
    throw new QuoteManagementInputError('Campo "items" obrigatório (array não vazio).');
  }
  return input.map((raw, index) => {
    if (!isRecord(raw)) throw new QuoteManagementInputError(`Item ${index + 1} é inválido.`);
    const skuValue = firstDefined(raw, ['item_code', 'sku', 'product_sku']);
    if (typeof skuValue !== 'string' || !skuValue.trim()) {
      throw new QuoteManagementInputError(`SKU do item ${index + 1} é obrigatório.`);
    }
    const itemName = inputText(
      firstDefined(raw, ['item_name', 'nome']),
      'Nome exibido no orçamento',
      255,
    );
    let quantityScaled: bigint;
    try {
      quantityScaled = parseQuantityScaled(
        firstDefined(raw, ['qty', 'quantidade', 'quantity']),
        `Quantidade do item ${index + 1}`
      );
    } catch (error) {
      if (error instanceof PricingValidationError)
        throw new QuoteManagementInputError(error.message);
      throw error;
    }
    const manualRate = raw.manual_rate === true || raw.manualRate === true;
    const rate = firstDefined(raw, [
      'rate',
      'applied_unit_price',
      'preco_aplicado',
      'precoAplicado',
    ]);
    if (manualRate && rate === undefined) {
      throw new QuoteManagementInputError(`Preço manual do item ${index + 1} é obrigatório.`);
    }
    return {
      sku: skuValue.trim(),
      itemName,
      quantityScaled,
      quantity: `${quantityScaled / 1000n}.${(quantityScaled % 1000n).toString().padStart(3, '0')}`,
      rate,
      manualRate,
    };
  });
}

function readClientId(input: Record<string, unknown>): string | undefined {
  const value = firstDefined(input, ['client_id', 'clientId', 'cliente_id', 'clienteId']);
  if (value === undefined || value === null || String(value).trim() === '') return undefined;
  const id = String(value).trim();
  if (!isUuid(id)) throw new QuoteManagementInputError('Identificador do cliente inválido.');
  return id;
}

function readConcurrencyToken(input: Record<string, unknown>): string {
  const value = firstDefined(input, [
    'concurrency_token',
    'concurrencyToken',
    'version_token',
    'updated_at',
    'updatedAt',
  ]);
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new QuoteManagementConflictError(
      'Token de concorrência obrigatório para salvar o rascunho. Recarregue o orçamento.'
    );
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return String(value).trim();
}

function readValidity(input: Record<string, unknown>, current: number): number {
  const raw = firstDefined(input, ['validade_dias', 'validadeDias']);
  if (raw === undefined) return current;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 365) {
    throw new QuoteManagementInputError('Validade deve ser um número inteiro entre 1 e 365 dias.');
  }
  return value;
}

function updatedAtFor(now: () => Date, previous: Date): Date {
  const candidate = now();
  if (!(candidate instanceof Date) || Number.isNaN(candidate.getTime()))
    return new Date(previous.getTime() + 1);
  return candidate.getTime() <= previous.getTime() ? new Date(previous.getTime() + 1) : candidate;
}

async function readLockedQuotation(tx: QuoteTransaction, id: string) {
  const query = tx.select().from(quotations).where(quoteWhere(id)).for('update').limit(1);
  const [quotation] = await query;
  return quotation || null;
}

function resolutionSource(resolution: PricingResolution): 'base' | 'tier' {
  return resolution.source === 'tier' ? 'tier' : 'base';
}

export function createPostgresQuoteDraftManagementRepository(
  getDb: DatabaseProvider = getDatabase,
  options: QuoteDraftManagementRepositoryOptions = {}
): QuoteDraftManagementRepository {
  const now = options.now || (() => new Date());

  const repository: QuoteDraftManagementRepository = {
    async list(listOptions = {}): Promise<QuoteDraftManagementListResult> {
      try {
        return await listRows(getDb(), listOptions);
      } catch (error) {
        if (
          error instanceof QuoteManagementInputError ||
          error instanceof QuoteManagementNotFoundError ||
          error instanceof QuoteManagementConflictError ||
          error instanceof QuoteManagementRepositoryError
        )
          throw error;
        console.error(
          `[quote-draft-management] list failed (${error instanceof Error ? error.name : typeof error})`
        );
        throw new QuoteManagementRepositoryError(
          'Não foi possível consultar os orçamentos. Tente novamente.'
        );
      }
    },

    async get(id: string): Promise<QuoteDraftManagementDetail | null> {
      const normalized = String(id || '').trim();
      if (!normalized) throw new QuoteManagementInputError('ID do orçamento não informado.');
      try {
        return await readDetail(getDb(), normalized, now);
      } catch (error) {
        if (
          error instanceof QuoteManagementInputError ||
          error instanceof QuoteManagementNotFoundError ||
          error instanceof QuoteManagementConflictError ||
          error instanceof QuoteManagementRepositoryError
        )
          throw error;
        console.error(
          `[quote-draft-management] detail failed (${error instanceof Error ? error.name : typeof error})`
        );
        throw new QuoteManagementRepositoryError(
          'Não foi possível consultar o orçamento. Tente novamente.'
        );
      }
    },

    async update(
      id: string,
      rawInput: QuoteDraftManagementUpdateInput
    ): Promise<QuoteDraftManagementDetail> {
      const normalizedId = String(id || '').trim();
      if (!normalizedId) throw new QuoteManagementInputError('ID do orçamento não informado.');
      if (!isRecord(rawInput))
        throw new QuoteManagementInputError('Envie os dados do orçamento em um objeto válido.');
      const input = rawInput as Record<string, unknown>;
      const expectedToken = readConcurrencyToken(input);
      const items = normalizeUpdateItems(input.items);
      const selectedClientId = readClientId(input);
      try {
        const db = getDb();
        const detail = await db.transaction(async (tx) => {
          await acquireQuotationWriteLock(tx);
          const quotation = await readLockedQuotation(tx, normalizedId);
          if (!quotation) throw new QuoteManagementNotFoundError();
          const currentToken = tokenFor(quotation.updatedAt);
          if (expectedToken !== currentToken) {
            throw new QuoteManagementConflictError(
              'O orçamento foi alterado por outro usuário. Recarregue antes de salvar.'
            );
          }
          if (quotation.status !== 'rascunho') {
            throw new QuoteManagementConflictError(
              'Somente orçamentos em rascunho podem ser editados.'
            );
          }
          const revision = await readRevision(tx, quotation.id);
          if (!revision || revision.status !== 'rascunho') {
            throw new QuoteManagementConflictError(
              'A revisão do orçamento não está mais em rascunho.'
            );
          }
          const templateSelection = await readTemplateSelection(tx, input, revision);
          const sectionsSnapshot = sectionSnapshotForUpdate(input, revision);
          const hasDedicatedPrazo = hasOwn(input, 'prazo_producao');
          const clientId = selectedClientId || quotation.clientId;
          const [client] = await tx
            .select()
            .from(clients)
            .where(and(eq(clients.id, clientId), eq(clients.arquivado, false)))
            .limit(1);
          if (!client) throw new QuoteManagementNotFoundError('Cliente não encontrado ou inativo.');

          const skus = [...new Set(items.map((item) => item.sku))];
          const productRows = await tx
            .select()
            .from(products)
            .where(and(or(...skus.map((sku) => eq(products.sku, sku))), eq(products.ativo, true)));
          const productBySku = new Map(productRows.map((row) => [row.sku, row]));
          const missingSku = skus.find((sku) => !productBySku.has(sku));
          if (missingSku)
            throw new QuoteManagementNotFoundError(
              `Produto "${missingSku}" não encontrado ou inativo.`
            );
          const tiers = await tx
            .select()
            .from(productPricingTiers)
            .where(or(...skus.map((sku) => eq(productPricingTiers.productSku, sku))))
            .orderBy(asc(productPricingTiers.productSku), asc(productPricingTiers.minimumQuantity));
          const tiersBySku = productPricingRowsBySku(tiers);

          const resolvedItems: Array<{
            id: string;
            position: number;
            product: typeof products.$inferSelect;
            quantity: string;
            itemName: string;
            resolution: PricingResolution;
            appliedCents: bigint;
            differenceCents: bigint;
            lineTotalCents: bigint;
            manualRate: boolean;
          }> = [];
          let subtotalCents = 0n;
          for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            const product = productBySku.get(item.sku)!;
            let pricing;
            try {
              pricing = normalizeProductPricing({
                preco_base: product.precoBase,
                precos: (tiersBySku.get(item.sku) || []).map((tier) => ({
                  minimum_quantity: String(tier.minimumQuantity),
                  unit_price: String(tier.unitPrice),
                })),
              });
            } catch (error) {
              if (
                error instanceof PricingValidationError ||
                error instanceof PricingUnavailableError
              ) {
                throw new QuoteManagementInputError(
                  `Preço indisponível para o produto "${item.sku}".`
                );
              }
              throw error;
            }
            let resolution: PricingResolution;
            try {
              resolution = resolveProductPrice(pricing, item.quantity, false);
            } catch (error) {
              if (
                error instanceof PricingValidationError ||
                error instanceof PricingUnavailableError
              ) {
                throw new QuoteManagementInputError(
                  `Preço indisponível para o produto "${item.sku}".`
                );
              }
              throw error;
            }
            let appliedCents = resolution.rate_cents;
            if (item.manualRate) {
              try {
                appliedCents = parseMoneyCents(item.rate, `Preço manual do item ${index + 1}`);
              } catch (error) {
                if (error instanceof PricingValidationError)
                  throw new QuoteManagementInputError(error.message);
                throw error;
              }
            }
            const differenceCents = appliedCents - resolution.rate_cents;
            const totalCents = lineTotalCents(item.quantityScaled, appliedCents);
            assertMoneyWithinLimit(totalCents, `Total da linha ${index + 1}`);
            subtotalCents += totalCents;
            assertMoneyWithinLimit(subtotalCents, 'Subtotal');
            resolvedItems.push({
              id: randomUUID(),
              position: index,
              product,
              quantity: item.quantity,
              itemName: item.itemName,
              resolution,
              appliedCents,
              differenceCents,
              lineTotalCents: totalCents,
              manualRate: item.manualRate,
            });
          }

          const freightRaw = firstDefined(input, ['frete', 'frete_aplicado']);
          const freightCents =
            freightRaw === undefined
              ? parseNonNegativeMoney(revision.frete, 'Frete')
              : parseNonNegativeMoney(freightRaw, 'Frete');
          const totalCents = subtotalCents + freightCents;
          assertMoneyWithinLimit(totalCents, 'Total do orçamento');
          const validadeDias = readValidity(input, revision.validadeDias);
          const pagamento = hasOwn(input, 'pagamento')
            ? inputText(input.pagamento, 'Pagamento', 4000, revision.pagamento)
            : sectionsSnapshot
              ? sectionsSnapshot.pagamento.current.body
              : revision.pagamento;
          const entrega = hasOwn(input, 'entrega')
            ? inputText(input.entrega, 'Entrega', 500, revision.entrega)
            : sectionsSnapshot
              ? ''
              : revision.entrega;
          const observacoes = hasOwn(input, 'observacoes') || hasOwn(input, 'notes')
            ? inputText(
                firstDefined(input, ['observacoes', 'notes']),
                'Observações',
                4000,
                revision.observacoes
              )
            : sectionsSnapshot
              ? sectionsSnapshot.condicoes_gerais.current.body
              : revision.observacoes;
          const prazoProducao = inputText(
            input.prazo_producao,
            'Prazo de produção',
            500,
            sectionsSnapshot && !sectionsSnapshot.prazo_producao.current.enabled
              ? ''
              : revision.prazoProducao
          );
          const revisionSections = sectionsSnapshot || legacySectionsSnapshotForUpdate(revision, {
            pagamento,
            entrega,
            observacoes,
            prazoProducao,
          });
          // Dedicated legacy input wins when both forms are supplied. Otherwise
          // disabling the section clears its legacy mirror; enabling preserves
          // the existing duration because the section has no body field.
          if (sectionsSnapshot) {
            if (hasOwn(input, 'pagamento')) revisionSections.pagamento.current.body = pagamento;
            if (hasOwn(input, 'observacoes') || hasOwn(input, 'notes')) {
              revisionSections.condicoes_gerais.current.body = observacoes;
            }
            revisionSections.prazo_producao.current.enabled = hasDedicatedPrazo
              ? Boolean(prazoProducao)
              : Boolean(prazoProducao) && sectionsSnapshot.prazo_producao.current.enabled;
          }
          const synchronizedPrazoProducao = revisionSections.prazo_producao.current.enabled
            ? prazoProducao
            : '';
          const updatedAt = updatedAtFor(now, asDate(quotation.updatedAt));
          const revisionMetadata = {
            templateVersionId: templateSelection!.versionId,
            sectionsSnapshot: revisionSections,
          };

          await tx
            .update(quoteRevisions)
            .set({
              validadeDias,
              pagamento,
              entrega,
              // fretePadrao and templatePadrao are snapshots from Settings and
              // are deliberately never accepted from the edit payload.
              frete: formatMoneyCents(freightCents),
              observacoes,
              prazoProducao: synchronizedPrazoProducao,
              templatePadrao: templateSelection?.key || revision.templatePadrao,
              templateHash: templateSelection?.hash || revision.templateHash,
              templateVersionId: revisionMetadata.templateVersionId,
              sectionsSnapshot: revisionMetadata.sectionsSnapshot,
              ...{
                clienteNome: client.nome,
                clienteDocumento: client.documento,
                clienteEmail: client.email,
                clienteTelefone: client.telefone,
                clienteEndereco: client.endereco,
                clienteNumero: client.numero,
                clienteBairro: client.bairro,
                clienteComplemento: client.complemento,
                clienteMunicipio: client.municipio,
                clienteUf: client.uf,
                clienteCep: client.cep,
                clienteNotas: client.notes,
              },
              subtotal: formatMoneyCents(subtotalCents),
              total: formatMoneyCents(totalCents),
            })
            .where(eq(quoteRevisions.id, revision.id));
          await tx.delete(quoteRevisionItems).where(eq(quoteRevisionItems.revisionId, revision.id));
          await tx.insert(quoteRevisionItems).values(
            resolvedItems.map((item) => ({
              id: item.id,
              revisionId: revision.id,
              position: item.position,
              productSku: item.product.sku,
              quantidade: item.quantity,
              produtoSku: item.product.sku,
              produtoNome: item.itemName || item.product.nome,
              produtoDescricao: item.product.descricao,
              produtoUnidade: item.product.unidade,
              produtoCategoria: item.product.categoria,
              produtoMarca: item.product.marca,
              precoFonte: resolutionSource(item.resolution),
              precoMinimoFaixa: item.resolution.minimum_quantity,
              precoSugerido: item.resolution.rate,
              precoAplicado: formatMoneyCents(item.appliedCents),
              diferencaPreco: signedMoney(item.differenceCents),
              totalLinha: formatMoneyCents(item.lineTotalCents),
              manualRate: item.manualRate,
            }))
          );
          await appendProductActivityEvents(
            tx,
            [...new Set(resolvedItems.map((item) => item.product.sku))].map((sku) => ({
              sku,
              tipo: 'orcamento' as const,
              texto: `Orçamento ${quotation.businessNumber} atualizado`,
              reference_id: `orcamento:${quotation.id}:${revision.id}:${updatedAt.toISOString()}:${sku}`,
              created_at: updatedAt,
            })),
          );
          await tx
            .update(quotations)
            .set({ clientId: client.id, status: 'rascunho', updatedAt })
            .where(eq(quotations.id, quotation.id));
          const refreshed = await readDetail(tx, quotation.businessNumber, now);
          if (!refreshed) throw new QuoteManagementRepositoryError();
          return refreshed;
        });
        return detail;
      } catch (error) {
        if (
          error instanceof QuoteManagementInputError ||
          error instanceof QuoteManagementNotFoundError ||
          error instanceof QuoteManagementConflictError ||
          error instanceof QuoteManagementRepositoryError
        )
          throw error;
        console.error(
          `[quote-draft-management] update failed (${error instanceof Error ? error.name : typeof error})`
        );
        throw new QuoteManagementRepositoryError(
          'Não foi possível salvar as alterações do orçamento. Tente novamente.'
        );
      }
    },

    async delete(id: string): Promise<{ id: string; deletedAt: string }> {
      const normalizedId = String(id || '').trim();
      if (!normalizedId) throw new QuoteManagementInputError('ID do orçamento não informado.');
      try {
        const db = getDb();
        const result = await db.transaction(async (tx) => {
          const quotation = await readLockedQuotation(tx, normalizedId);
          if (!quotation) throw new QuoteManagementNotFoundError();
          if (quotation.status !== 'rascunho') {
            throw new QuoteManagementConflictError(
              'Somente orçamentos em rascunho podem ser excluídos.'
            );
          }
          const deletedAt = now().toISOString();
          await tx.delete(quotations).where(eq(quotations.id, quotation.id));
          return { id: quotation.businessNumber, deletedAt };
        });
        return result;
      } catch (error) {
        if (
          error instanceof QuoteManagementInputError ||
          error instanceof QuoteManagementNotFoundError ||
          error instanceof QuoteManagementConflictError ||
          error instanceof QuoteManagementRepositoryError
        )
          throw error;
        console.error(
          `[quote-draft-management] delete failed (${error instanceof Error ? error.name : typeof error})`
        );
        throw new QuoteManagementRepositoryError(
          'Não foi possível excluir o orçamento. Tente novamente.'
        );
      }
    },
  };
  repository.listDrafts = repository.list;
  repository.getDraft = repository.get;
  repository.updateDraft = repository.update;
  return repository;
}

export const createPostgresQuoteManagementRepository = createPostgresQuoteDraftManagementRepository;
export const createPostgresQuotationManagementRepository =
  createPostgresQuoteDraftManagementRepository;
export const createPostgresQuoteDraftRepository = createPostgresQuoteDraftManagementRepository;
export const createQuoteDraftManagementRepository = createPostgresQuoteDraftManagementRepository;
export const createQuotationDraftManagementRepository =
  createPostgresQuoteDraftManagementRepository;
export const QuoteDraftManagementInputError = QuoteManagementInputError;
export const QuoteDraftManagementNotFoundError = QuoteManagementNotFoundError;
export const QuoteDraftManagementConflictError = QuoteManagementConflictError;
export const QuoteDraftManagementRepositoryError = QuoteManagementRepositoryError;
export type QuoteManagementRepository = QuoteDraftManagementRepository;
