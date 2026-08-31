import { randomUUID } from 'node:crypto';

import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { appendProductActivityEvents } from './product-activity-repository.js';
import { acquireQuotationWriteLock } from '../quotation-write-lock.js';
import {
  appSettings,
  clients,
  crmDeals,
  products,
  productPricingTiers,
  quoteRevisionItems,
  quoteRevisions,
  quoteSequences,
  quotations,
  quotationTemplateVersions,
  quotationTemplates,
} from '../schema.js';
import {
  ClientInputError,
  normalizeClientAddress,
  normalizeClientDocument,
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientNotes,
  normalizeClientPhone,
  type ClientAddress,
} from '../../../_modules/client-schema.js';
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
} from '../../../_modules/pricing-core.js';
import { DEFAULT_SETTINGS, type Settings } from './settings-repository.js';
import { normalizeQuotationCompanyConfiguration } from '../../../_modules/quotation-company.js';
import {
  normalizeQuotationSections,
  withQuotationProductionDeadline,
  type QuotationSectionsSnapshot,
} from '../../../_modules/quotation-content.js';
import { readCurrentQuotationTemplateVersion } from './quotation-template-library-repository.js';
import {
  getQuotationTemplate,
  HISTORICAL_QUOTATION_TEMPLATES,
} from '../../../_modules/quotation-template-catalog.js';
import { quotationConcurrencyToken } from './quote-draft-management-repository.js';

type DatabaseProvider = () => AppDatabase;
type QuoteTransaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// PostgreSQL numeric(20,2) stores up to 18 integer digits. In cents, the
// exact maximum therefore has 20 decimal digits.
const MONEY_MAX_CENTS = 99999999999999999999n;
const QUOTE_NUMBER_MAX = 9999;

export class QuoteDraftInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'QuoteDraftInputError';
  }
}

export class QuoteDraftNotFoundError extends Error {
  readonly statusCode = 404;
  readonly expose = true;

  constructor(message = 'Cliente não encontrado ou inativo.') {
    super(message);
    this.name = 'QuoteDraftNotFoundError';
  }
}

export class QuoteDraftConflictError extends Error {
  readonly statusCode = 409;
  readonly expose = true;

  constructor(message = 'Não foi possível reservar o número do orçamento.') {
    super(message);
    this.name = 'QuoteDraftConflictError';
  }
}

export class QuoteDraftRepositoryError extends Error {
  readonly statusCode = 503;
  readonly expose = false;

  constructor(message = 'Não foi possível salvar o rascunho do orçamento. Tente novamente.') {
    super(message);
    this.name = 'QuoteDraftRepositoryError';
  }
}

export interface QuoteDraftItemInput {
  item_code?: unknown;
  sku?: unknown;
  item_name?: unknown;
  qty?: unknown;
  rate?: unknown;
  manual_rate?: unknown;
}

export interface QuoteDraftCreateInput {
  /** Existing client aliases accepted at the HTTP boundary. */
  client_id?: unknown;
  clientId?: unknown;
  cliente_id?: unknown;
  clienteId?: unknown;
  client?: Record<string, unknown> | null;
  cliente?: Record<string, unknown> | null;
  template_key?: unknown;
  template_version_id?: unknown;
  template?: unknown;
  secoes?: unknown;
  entrega?: unknown;
  pagamento?: unknown;
  validade_dias?: unknown;
  /** Inline client fields are kept here for callers that pass `extracted` directly. */
  nome?: unknown;
  name?: unknown;
  email?: unknown;
  telefone?: unknown;
  cnpj?: unknown;
  documento?: unknown;
  endereco?: unknown;
  address?: unknown;
  observacoes?: unknown;
  notes?: unknown;
  client_notes?: unknown;
  items?: unknown;
  urgente?: unknown;
  prazo_producao?: unknown;
  frete?: unknown;
  frete_aplicado?: unknown;
  frete_padrao?: unknown;
}

export interface QuoteDraftClientSnapshot {
  id: string;
  nome: string;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  notes: string | null;
  address: ClientAddress | null;
}

export interface QuoteDraftItemSnapshot {
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

export interface QuoteDraftResult {
  success: true;
  quotation_id: string;
  quotation_name: string;
  quote_id: string;
  quotation_uuid: string;
  revision_id: string;
  quote_revision_id: string;
  revision: number;
  revision_number: number;
  status: 'rascunho';
  cliente: string;
  cliente_id: string;
  cliente_snapshot: QuoteDraftClientSnapshot;
  items: QuoteDraftItemSnapshot[];
  subtotal: string;
  frete: string;
  total: string;
  validade_dias: number;
  pagamento: string;
  entrega: string;
  observacoes: string;
  prazo_producao: string;
  template_padrao: string;
  template_key: string;
  template_hash: string;
  template_version_id: string;
  secoes: QuotationSectionsSnapshot;
  concurrency_token: string;
  created_at: string;
}

export interface QuoteDuplicateResult {
  success: true;
  quotation_id: string;
  quotation_name: string;
  quote_id: string;
  quotation_uuid: string;
  revision_id: string;
  quote_revision_id: string;
  revision: 1;
  revision_number: 1;
  status: 'rascunho';
  cliente: string;
  cliente_id: string;
  cliente_snapshot: QuoteDraftClientSnapshot;
  items: QuoteDraftItemSnapshot[];
  subtotal: string;
  frete: string;
  total: string;
  validade_dias: number;
  pagamento: string;
  entrega: string;
  observacoes: string;
  prazo_producao: string;
  template_padrao: string;
  template_key: string;
  template_hash: string;
  template_version_id: string | null;
  secoes: QuotationSectionsSnapshot;
  created_at: string;
  crm_deal_id: string;
}

export interface QuoteDraftRepository {
  createDraft: (input: QuoteDraftCreateInput) => Promise<QuoteDraftResult>;
  create?: (input: QuoteDraftCreateInput) => Promise<QuoteDraftResult>;
  duplicateDraft?: (quotationId: string) => Promise<QuoteDuplicateResult>;
  duplicateQuotation?: (quotationId: string) => Promise<QuoteDuplicateResult>;
}

export interface QuoteDraftRepositoryOptions {
  now?: () => Date;
  idFactory?: () => string;
}

interface NormalizedItem {
  sku: string;
  itemName: string;
  quantityScaled: bigint;
  quantity: string;
  rate: unknown;
  manualRate: boolean;
}

interface ProductWithPricing {
  product: typeof products.$inferSelect;
  pricing: ReturnType<typeof normalizeProductPricing>;
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

function firstNonUndefined(value: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (hasOwn(value, key) && value[key] !== undefined) return value[key];
  }
  return undefined;
}

function ensureDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return new Date();
  return value;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function normalizeAddressInput(value: unknown): ClientAddress | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'string') {
    return normalizeClientAddress({ endereco: value });
  }
  if (!isRecord(value)) throw new QuoteDraftInputError('Endereço do cliente inválido.');
  // ManualOrcamentoPage uses the older UI spellings (`logradouro`/`cidade`),
  // while the canonical client schema accepts `endereco`/`municipio`.
  return normalizeClientAddress({
    ...value,
    endereco: firstNonUndefined(value, ['endereco', 'logradouro', 'street', 'address_line1']),
    municipio: firstNonUndefined(value, ['municipio', 'cidade', 'city']),
    numero: firstNonUndefined(value, ['numero', 'number']),
    complemento: firstNonUndefined(value, ['complemento', 'complement', 'address_line2']),
    bairro: firstNonUndefined(value, ['bairro', 'neighborhood']),
    uf: firstNonUndefined(value, ['uf', 'state']),
    cep: firstNonUndefined(value, ['cep', 'postal_code', 'postalCode', 'pincode']),
  });
}

function normalizeInlineClient(input: QuoteDraftCreateInput): Omit<QuoteDraftClientSnapshot, 'id'> {
  const nested = isRecord(input.client)
    ? input.client
    : isRecord(input.cliente)
      ? input.cliente
      : {};
  const source: Record<string, unknown> = { ...input, ...nested };
  const topLevel = input as unknown as Record<string, unknown>;
  // `observacoes` at the quote envelope belongs to the revision, not the
  // client record. Nested client payloads may still use their historical
  // `observacoes` spelling for client notes.
  const nestedNotes = firstDefined(nested, ['notes', 'client_notes', 'observacoes', 'observação']);
  const clientNotes =
    nestedNotes === undefined ? firstDefined(topLevel, ['notes', 'client_notes']) : nestedNotes;
  let document: string | null;
  try {
    const documentAliases = ['documento', 'cnpj', 'tax_id']
      .filter((key) => hasOwn(source, key) && source[key] !== undefined)
      .map((key) => normalizeClientDocument(source[key]));
    document = documentAliases[0] ?? null;
    if (documentAliases.some((value) => value !== document)) {
      throw new QuoteDraftInputError('Os documentos informados entram em conflito.');
    }
    return {
      nome: normalizeClientName(firstDefined(source, ['nome', 'name'])),
      documento: document,
      email: normalizeClientEmail(firstDefined(source, ['email', 'email_id'])),
      telefone: normalizeClientPhone(
        firstDefined(source, ['telefone', 'phone', 'mobile_no', 'celular'])
      ),
      notes: normalizeClientNotes(clientNotes),
      address: normalizeAddressInput(firstDefined(source, ['endereco', 'address'])),
    };
  } catch (error) {
    if (error instanceof ClientInputError) throw new QuoteDraftInputError(error.message);
    throw error;
  }
}

function normalizeClientId(input: QuoteDraftCreateInput): string | null {
  const nested = isRecord(input.client)
    ? input.client
    : isRecord(input.cliente)
      ? input.cliente
      : null;
  const nestedId = nested
    ? firstDefined(nested, ['id', 'client_id', 'clientId', 'cliente_id', 'clienteId'])
    : undefined;
  const values = [
    firstDefined(input as unknown as Record<string, unknown>, [
      'client_id',
      'clientId',
      'cliente_id',
      'clienteId',
    ]),
    nestedId,
  ]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => String(value).trim());
  if (values.length === 0) return null;
  if (values.some((value) => !isUuid(value)))
    throw new QuoteDraftInputError('Identificador do cliente inválido.');
  if (values.some((value) => value !== values[0]))
    throw new QuoteDraftInputError('Os identificadores do cliente entram em conflito.');
  return values[0];
}

function formatQuantity(quantityScaled: bigint): string {
  const base = 1000n;
  const integer = quantityScaled / base;
  const fraction = (quantityScaled % base).toString().padStart(3, '0');
  return `${integer.toString()}.${fraction}`;
}

function parseNonNegativeMoney(value: unknown, label: string): bigint {
  let cents: bigint;
  try {
    cents = parseScaledInteger(value, 2, label);
  } catch (error) {
    if (error instanceof PricingValidationError) throw new QuoteDraftInputError(error.message);
    throw error;
  }
  if (cents < 0n) throw new QuoteDraftInputError(`${label} deve ser maior ou igual a zero.`);
  if (cents > MONEY_MAX_CENTS)
    throw new QuoteDraftInputError(`${label} está fora do limite permitido.`);
  return cents;
}

function assertMoneyWithinLimit(cents: bigint, label: string): void {
  if (cents > MONEY_MAX_CENTS)
    throw new QuoteDraftInputError(`${label} está fora do limite permitido.`);
}

function signedMoney(cents: bigint): string {
  return cents < 0n ? `-${formatMoneyCents(-cents)}` : formatMoneyCents(cents);
}

function lineTotalCents(quantityScaled: bigint, unitPriceCents: bigint): bigint {
  // quantity is thousandths and money is cents, so the exact denominator is
  // 1000. Round half-up once per line before summing lines.
  const numerator = quantityScaled * unitPriceCents;
  return (numerator + 500n) / 1000n;
}

function normalizeItems(input: unknown): NormalizedItem[] {
  if (!Array.isArray(input)) throw new QuoteDraftInputError('Items deve ser um array.');
  if (input.length === 0) throw new QuoteDraftInputError('Adicione ao menos um item ao orçamento.');

  return input.map((raw, index) => {
    if (!isRecord(raw)) throw new QuoteDraftInputError(`Item ${index + 1} é inválido.`);
    const skuValue = firstDefined(raw, ['item_code', 'sku']);
    if (typeof skuValue !== 'string' || !skuValue.trim()) {
      throw new QuoteDraftInputError(`SKU do item ${index + 1} é obrigatório.`);
    }
    const itemName = inputText(
      firstDefined(raw, ['item_name', 'nome']),
      'Nome exibido no orçamento',
      255,
    );
    let quantityScaled: bigint;
    try {
      quantityScaled = parseQuantityScaled(raw.qty, `Quantidade do item ${index + 1}`);
    } catch (error) {
      if (error instanceof PricingValidationError) throw new QuoteDraftInputError(error.message);
      throw error;
    }
    const manualRate = raw.manual_rate === true;
    if (manualRate && !hasOwn(raw, 'rate')) {
      throw new QuoteDraftInputError(`Preço manual do item ${index + 1} é obrigatório.`);
    }
    return {
      sku: skuValue.trim(),
      itemName,
      quantityScaled,
      quantity: formatQuantity(quantityScaled),
      rate: raw.rate,
      manualRate,
    };
  });
}

function mapClient(row: typeof clients.$inferSelect): QuoteDraftClientSnapshot {
  const address = {
    endereco: row.endereco ?? null,
    numero: row.numero ?? null,
    bairro: row.bairro ?? null,
    complemento: row.complemento ?? null,
    municipio: row.municipio ?? null,
    uf: row.uf ?? null,
    cep: row.cep ?? null,
  } satisfies ClientAddress;
  return {
    id: row.id,
    nome: row.nome,
    documento: row.documento ?? null,
    email: row.email ?? null,
    telefone: row.telefone ?? null,
    notes: row.notes ?? null,
    address: Object.values(address).some(Boolean) ? address : null,
  };
}

function snapshotHasAddress(client: QuoteDraftClientSnapshot): ClientAddress | null {
  if (!client.address || !Object.values(client.address).some(Boolean)) return null;
  return client.address;
}

function toClientRow(
  snapshot: QuoteDraftClientSnapshot,
  createdAt: Date
): typeof clients.$inferInsert {
  return {
    id: snapshot.id,
    nome: snapshot.nome,
    documento: snapshot.documento,
    email: snapshot.email,
    telefone: snapshot.telefone,
    notes: snapshot.notes,
    endereco: snapshot.address?.endereco ?? null,
    numero: snapshot.address?.numero ?? null,
    bairro: snapshot.address?.bairro ?? null,
    complemento: snapshot.address?.complemento ?? null,
    municipio: snapshot.address?.municipio ?? null,
    uf: snapshot.address?.uf ?? null,
    cep: snapshot.address?.cep ?? null,
    arquivado: false,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

function isDuplicateDocument(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const value = current as {
      code?: unknown;
      constraint?: unknown;
      constraint_name?: unknown;
      cause?: unknown;
    };
    if (
      value.code === '23505' &&
      (String(value.constraint || value.constraint_name || '').includes('documento') ||
        !value.constraint)
    )
      return true;
    if (
      String(value.constraint || value.constraint_name || '').includes('clients_documento_unique')
    )
      return true;
    if (value.cause && typeof value.cause === 'object') pending.push(value.cause);
  }
  return false;
}

function safeErrorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

async function readSettings(tx: QuoteTransaction): Promise<Settings> {
  const [row] = await tx.select().from(appSettings).where(eq(appSettings.singletonId, 1)).limit(1);
  if (!row) return { ...DEFAULT_SETTINGS };
  const secoes = normalizeQuotationSections(row.quotationSections);
  return {
    validade_dias: row.validadeDias,
    pagamento: secoes.pagamento.body,
    entrega: row.entrega,
    frete_padrao: row.fretePadrao,
    aliquota: row.aliquota ?? DEFAULT_SETTINGS.aliquota,
    observacoes: secoes.condicoes_gerais.body,
    template_padrao: row.templatePadrao,
    secoes,
    empresa: normalizeQuotationCompanyConfiguration(row.companyConfiguration),
    settings_version: row.settingsVersion,
  };
}

async function reserveBusinessNumber(tx: QuoteTransaction, year: number): Promise<string> {
  const [row] = await tx
    .insert(quoteSequences)
    .values({ year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: quoteSequences.year,
      set: { lastNumber: sql`${quoteSequences.lastNumber} + 1` },
    })
    .returning({ lastNumber: quoteSequences.lastNumber });
  const number = Number(row?.lastNumber ?? 0);
  if (!Number.isInteger(number) || number < 1 || number > QUOTE_NUMBER_MAX) {
    throw new QuoteDraftConflictError('A numeração anual de orçamentos atingiu o limite.');
  }
  return `ORC-${year}${String(number).padStart(4, '0')}`;
}

function inputValidityDays(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 365) {
    throw new QuoteDraftInputError('Validade deve ser um número inteiro entre 1 e 365 dias.');
  }
  return normalized;
}

function inputText(value: unknown, label: string, maximum: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new QuoteDraftInputError(`${label} deve ser texto.`);
  const normalized = value.trim();
  if (normalized.length > maximum)
    throw new QuoteDraftInputError(`${label} deve ter no máximo ${maximum} caracteres.`);
  return normalized;
}

function clientSnapshotToRow(
  snapshot: QuoteDraftClientSnapshot
): Pick<
  typeof quoteRevisions.$inferInsert,
  | 'clienteNome'
  | 'clienteDocumento'
  | 'clienteEmail'
  | 'clienteTelefone'
  | 'clienteEndereco'
  | 'clienteNumero'
  | 'clienteBairro'
  | 'clienteComplemento'
  | 'clienteMunicipio'
  | 'clienteUf'
  | 'clienteCep'
  | 'clienteNotas'
> {
  const address = snapshotHasAddress(snapshot);
  return {
    clienteNome: snapshot.nome,
    clienteDocumento: snapshot.documento,
    clienteEmail: snapshot.email,
    clienteTelefone: snapshot.telefone,
    clienteEndereco: address?.endereco ?? null,
    clienteNumero: address?.numero ?? null,
    clienteBairro: address?.bairro ?? null,
    clienteComplemento: address?.complemento ?? null,
    clienteMunicipio: address?.municipio ?? null,
    clienteUf: address?.uf ?? null,
    clienteCep: address?.cep ?? null,
    clienteNotas: snapshot.notes,
  };
}

function itemSnapshot(
  row: typeof quoteRevisionItems.$inferSelect,
  product: typeof products.$inferSelect
): QuoteDraftItemSnapshot {
  const source = row.precoFonte === 'tier' ? 'tier' : 'base';
  const tier = row.precoMinimoFaixa == null ? null : String(row.precoMinimoFaixa);
  const qty = String(row.quantidade);
  const suggested = String(row.precoSugerido);
  const applied = String(row.precoAplicado);
  const difference = String(row.diferencaPreco);
  const total = String(row.totalLinha);
  return {
    id: row.id,
    position: row.position,
    item_code: product.sku,
    sku: product.sku,
    qty,
    quantidade: qty,
    nome: row.produtoNome || product.nome,
    descricao: product.descricao,
    unidade: product.unidade,
    categoria: product.categoria ?? null,
    marca: product.marca ?? null,
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
    line_total: total,
    total_linha: total,
    manual_rate: Boolean(row.manualRate),
  };
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function quotationPredicate(id: string) {
  return isUuid(id)
    ? or(eq(quotations.id, id), eq(quotations.businessNumber, id))
    : eq(quotations.businessNumber, id);
}

function clientSnapshotFromRevision(
  revision: typeof quoteRevisions.$inferSelect,
  clientId: string,
): QuoteDraftClientSnapshot {
  const address = {
    endereco: revision.clienteEndereco ?? null,
    numero: revision.clienteNumero ?? null,
    bairro: revision.clienteBairro ?? null,
    complemento: revision.clienteComplemento ?? null,
    municipio: revision.clienteMunicipio ?? null,
    uf: revision.clienteUf ?? null,
    cep: revision.clienteCep ?? null,
  } satisfies ClientAddress;
  return {
    id: clientId,
    nome: revision.clienteNome,
    documento: revision.clienteDocumento ?? null,
    email: revision.clienteEmail ?? null,
    telefone: revision.clienteTelefone ?? null,
    notes: revision.clienteNotas ?? null,
    address: Object.values(address).some(Boolean) ? address : null,
  };
}

function duplicateItemSnapshot(
  row: typeof quoteRevisionItems.$inferSelect,
  id: string,
): QuoteDraftItemSnapshot {
  const source = row.precoFonte === 'tier' ? 'tier' : 'base';
  const tier = row.precoMinimoFaixa == null ? null : String(row.precoMinimoFaixa);
  const qty = String(row.quantidade);
  const suggested = String(row.precoSugerido);
  const applied = String(row.precoAplicado);
  const difference = String(row.diferencaPreco);
  const total = String(row.totalLinha);
  const sku = row.produtoSku || row.productSku;
  return {
    id,
    position: row.position,
    item_code: sku,
    sku,
    qty,
    quantidade: qty,
    nome: row.produtoNome,
    descricao: row.produtoDescricao,
    unidade: row.produtoUnidade,
    categoria: row.produtoCategoria ?? null,
    marca: row.produtoMarca ?? null,
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
    line_total: total,
    total_linha: total,
    manual_rate: Boolean(row.manualRate),
  };
}

function resolutionSource(resolution: PricingResolution): 'base' | 'tier' {
  return resolution.source === 'tier' ? 'tier' : 'base';
}

interface SelectedTemplate {
  model: { id: string; key: string; name: string; archived: boolean };
  version: {
    id: string;
    version: number;
    source: string;
    sourceHash: string;
    contractVersion?: number;
  };
}

export interface TemplateSelectionLookup {
  byVersion(id: string): Promise<SelectedTemplate | null>;
  current(selection: string | { id: string }): Promise<SelectedTemplate | null>;
  seedLegacy(template: { key: string; name: string; source: string; hash: string }): Promise<SelectedTemplate | null>;
}

export async function readSelectedTemplate(
  tx: QuoteTransaction,
  settings: Settings,
  input: QuoteDraftCreateInput,
  injectedLookup?: TemplateSelectionLookup
): Promise<SelectedTemplate | null> {
  const lookup = injectedLookup || {
    byVersion: async (id: string) => {
      const [row] = await tx
        .select({
          modelId: quotationTemplates.id,
          modelKey: quotationTemplates.key,
          modelName: quotationTemplates.name,
          archived: quotationTemplates.archived,
          versionId: quotationTemplateVersions.id,
          version: quotationTemplateVersions.version,
          source: quotationTemplateVersions.source,
          sourceHash: quotationTemplateVersions.sourceHash,
          contractVersion: quotationTemplateVersions.contractVersion,
        })
        .from(quotationTemplateVersions)
        .innerJoin(quotationTemplates, eq(quotationTemplateVersions.templateId, quotationTemplates.id))
        .where(eq(quotationTemplateVersions.id, id))
        .limit(1);
      return row && {
        model: { id: row.modelId, key: row.modelKey, name: row.modelName, archived: row.archived },
        version: {
          id: row.versionId,
          version: row.version,
          source: row.source,
          sourceHash: row.sourceHash,
          contractVersion: row.contractVersion === 2 ? 2 : 1,
        },
      };
    },
    current: (selection: string | { id: string }) => readCurrentQuotationTemplateVersion(tx, selection),
    seedLegacy: async (legacy: { key: string; name: string; source: string; hash: string }) => {
      const modelId = randomUUID();
      const versionId = randomUUID();
      await tx
        .insert(quotationTemplates)
        .values({ id: modelId, key: legacy.key, name: legacy.name, archived: false })
        .onConflictDoNothing({ target: quotationTemplates.key });
      const [model] = await tx
        .select()
        .from(quotationTemplates)
        .where(eq(quotationTemplates.key, legacy.key))
        .limit(1);
      if (!model || model.archived) return null;
      await tx
        .insert(quotationTemplateVersions)
        .values({
          id: versionId,
          templateId: model.id,
          version: 2,
          source: legacy.source,
          sourceHash: legacy.hash,
          contractVersion: 2,
        })
        .onConflictDoNothing({ target: [quotationTemplateVersions.templateId, quotationTemplateVersions.version] });
      return readCurrentQuotationTemplateVersion(tx, { id: model.id });
    },
  };
  const versionId = typeof input.template_version_id === 'string' ? input.template_version_id.trim() : '';
  const key = typeof input.template_key === 'string' ? input.template_key.trim() : '';
  if (versionId) {
    if (!isUuid(versionId)) return null;
    const selected = await lookup.byVersion(versionId);
    if (!selected || selected.model.archived || (key && key !== selected.model.key)) return null;
    return selected;
  }

  const selected = await lookup.current(key || settings.template_padrao);
  const currentBuiltin = getQuotationTemplate(key || settings.template_padrao);
  if (selected && !selected.model.archived) {
    // Existing official rows created before the v2 publication remain immutable
    // v1 history. New drafts select the current v2 source and persist it as a
    // separate version instead of mutating the historical row. Custom versions
    // under an official key remain selected and are never replaced silently.
    const historicalBuiltin = currentBuiltin
      ? HISTORICAL_QUOTATION_TEMPLATES.find((template) => template.key === currentBuiltin.key)
      : undefined;
    const isHistoricalBuiltin = Boolean(
      historicalBuiltin &&
        selected.version.contractVersion === 1 &&
        selected.version.source === historicalBuiltin.source &&
        selected.version.sourceHash === historicalBuiltin.hash,
    );
    if (!isHistoricalBuiltin) return selected;
    return lookup.seedLegacy(currentBuiltin!);
  }
  // Seed a missing static template so the revision FK and historical resolver
  // have persisted identity, even when another static template already exists.
  if (!currentBuiltin) return null;
  return lookup.seedLegacy(currentBuiltin);
}

/** PostgreSQL quote-draft writer. Every mutation is intentionally kept in one
 * transaction, including client creation and annual number reservation. */
export function createPostgresQuoteDraftRepository(
  getDb: DatabaseProvider = getDatabase,
  options: QuoteDraftRepositoryOptions = {}
): QuoteDraftRepository {
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || randomUUID;

  const createDraft = async (input: QuoteDraftCreateInput): Promise<QuoteDraftResult> => {
    if (!isRecord(input))
      throw new QuoteDraftInputError('Envie os dados do orçamento em um objeto válido.');
    const items = normalizeItems(input.items);
    const clientId = normalizeClientId(input);
    const requestUrgent = input.urgente === true;
    const requestObservations = hasOwn(input as unknown as Record<string, unknown>, 'observacoes') && input.observacoes !== undefined
      ? input.observacoes
      : undefined;
    const requestPayment = hasOwn(input as unknown as Record<string, unknown>, 'pagamento') && input.pagamento !== undefined
      ? input.pagamento
      : undefined;
    const requestDeadline = input.prazo_producao;
    const requestFreight = firstDefined(input as unknown as Record<string, unknown>, [
      'frete',
      'frete_aplicado',
      'frete_padrao',
    ]);
    let inlineClient: Omit<QuoteDraftClientSnapshot, 'id'> | null = null;
    if (!clientId) inlineClient = normalizeInlineClient(input);

    let database: AppDatabase;
    try {
      database = getDb();
    } catch {
      throw new QuoteDraftRepositoryError();
    }

    try {
      const createdAt = ensureDate(now());
      const result = await database.transaction(async (tx) => {
        await acquireQuotationWriteLock(tx);
        let client: QuoteDraftClientSnapshot;
        if (clientId) {
          const [existing] = await tx
            .select()
            .from(clients)
            .where(and(eq(clients.id, clientId), eq(clients.arquivado, false)))
            .limit(1);
          if (!existing) throw new QuoteDraftNotFoundError();
          client = mapClient(existing);
        } else {
          const id = idFactory();
          if (!isUuid(id))
            throw new QuoteDraftRepositoryError(
              'Não foi possível gerar o identificador do cliente.'
            );
          const snapshot: QuoteDraftClientSnapshot = {
            id,
            ...(inlineClient as Omit<QuoteDraftClientSnapshot, 'id'>),
          };
          const [created] = await tx
            .insert(clients)
            .values(toClientRow(snapshot, createdAt))
            .returning();
          if (!created) throw new QuoteDraftRepositoryError();
          client = mapClient(created);
        }

        const skus = [...new Set(items.map((item) => item.sku))];
        const productRows = await tx
          .select()
          .from(products)
          .where(and(inArray(products.sku, skus), eq(products.ativo, true)));
        const productBySku = new Map(productRows.map((row) => [row.sku, row]));
        const missing = skus.find((sku) => !productBySku.has(sku));
        if (missing)
          throw new QuoteDraftNotFoundError(`Produto "${missing}" não encontrado ou inativo.`);

        const tierRows = await tx
          .select()
          .from(productPricingTiers)
          .where(inArray(productPricingTiers.productSku, skus))
          .orderBy(asc(productPricingTiers.productSku), asc(productPricingTiers.minimumQuantity));
        const tiersBySku = new Map<string, (typeof productPricingTiers.$inferSelect)[]>();
        for (const row of tierRows) {
          const rows = tiersBySku.get(row.productSku) || [];
          rows.push(row);
          tiersBySku.set(row.productSku, rows);
        }

        const pricingBySku = new Map<string, ProductWithPricing>();
        for (const sku of skus) {
          const product = productBySku.get(sku)!;
          try {
            pricingBySku.set(sku, {
              product,
              pricing: normalizeProductPricing({
                preco_base: product.precoBase,
                precos: (tiersBySku.get(sku) || []).map((tier) => ({
                  minimum_quantity: String(tier.minimumQuantity),
                  unit_price: String(tier.unitPrice),
                })),
              }),
            });
          } catch (error) {
            if (
              error instanceof PricingValidationError ||
              error instanceof PricingUnavailableError
            ) {
              throw new QuoteDraftInputError(`Preço indisponível para o produto "${sku}".`);
            }
            throw error;
          }
        }

        const settings = await readSettings(tx);
        const validityDays = inputValidityDays(input.validade_dias, settings.validade_dias);
        const template = await readSelectedTemplate(tx, settings, input);
        if (!template) throw new QuoteDraftInputError('Template do orçamento inválido.');
        const baseSections = normalizeQuotationSections(settings.secoes);
        const deadline = inputText(requestDeadline, 'Prazo de produção', 500);
        let currentSections = baseSections;
        if (input.secoes !== undefined || requestObservations !== undefined || requestPayment !== undefined) {
          try {
            if (
              input.secoes !== undefined &&
              (!input.secoes || typeof input.secoes !== 'object' || Array.isArray(input.secoes))
            ) {
              throw new Error('Seções devem ser um objeto.');
            }
            const supplied = (input.secoes || {}) as Record<string, unknown>;
            const mergeSection = (key: 'prazo_producao' | 'pagamento' | 'condicoes_gerais') => {
              const base = baseSections[key];
              const override = supplied[key];
              if (override === undefined) return { ...base };
              if (!override || typeof override !== 'object' || Array.isArray(override)) return override;
              return { ...base, ...(override as Record<string, unknown>) };
            };
            const legacyOverride =
              input.secoes === undefined && requestObservations !== undefined
                ? {
                    ...baseSections.condicoes_gerais,
                    body: inputText(requestObservations, 'Observações', 4000),
                  }
                : undefined;
            const paymentOverride =
              input.secoes === undefined && requestPayment !== undefined
                ? {
                    ...baseSections.pagamento,
                    body: inputText(requestPayment, 'Pagamento', 4000),
                  }
                : undefined;
            currentSections = normalizeQuotationSections({
              schema_version: baseSections.schema_version,
              show_summary: baseSections.show_summary,
              rich_text: baseSections.rich_text,
              prazo_producao: mergeSection('prazo_producao'),
              pagamento: paymentOverride || mergeSection('pagamento'),
              condicoes_gerais: legacyOverride || mergeSection('condicoes_gerais'),
            });
            if (requestObservations !== undefined && input.secoes !== undefined) {
              inputText(requestObservations, 'Observações', 4000);
            }
            if (requestPayment !== undefined && input.secoes !== undefined) {
              inputText(requestPayment, 'Pagamento', 4000);
            }
          } catch (error) {
            throw new QuoteDraftInputError(error instanceof Error ? error.message : 'Seções inválidas.');
          }
        }
        const canonicalDeadline =
          currentSections.prazo_producao.value === undefined
            ? deadline
            : currentSections.prazo_producao.value;
        const baseSectionsWithDeadline = withQuotationProductionDeadline(
          baseSections,
          canonicalDeadline
        );
        const currentSectionsWithDeadline = withQuotationProductionDeadline(
          currentSections,
          canonicalDeadline
        );
        const sectionsSnapshot: QuotationSectionsSnapshot = {
          schema_version: baseSections.schema_version,
          show_summary: baseSections.show_summary,
          rich_text: baseSections.rich_text,
          prazo_producao: {
            base: copy(baseSectionsWithDeadline.prazo_producao),
            current: copy(currentSectionsWithDeadline.prazo_producao),
          },
          pagamento: {
            base: copy(baseSections.pagamento),
            current: copy(currentSections.pagamento),
          },
          condicoes_gerais: {
            base: copy(baseSections.condicoes_gerais),
            current: copy(currentSections.condicoes_gerais),
          },
        };
        const freightCents =
          requestFreight === undefined
            ? parseNonNegativeMoney(settings.frete_padrao, 'Frete')
            : parseNonNegativeMoney(requestFreight, 'Frete');
        const resolvedItems: Array<{
          id: string;
          position: number;
          quantity: string;
          itemName: string;
          product: typeof products.$inferSelect;
          resolution: PricingResolution;
          appliedCents: bigint;
          differenceCents: bigint;
          lineTotalCents: bigint;
          manualRate: boolean;
        }> = [];
        let subtotalCents = 0n;

        for (let index = 0; index < items.length; index += 1) {
          const item = items[index];
          const priced = pricingBySku.get(item.sku)!;
          let resolution: PricingResolution;
          try {
            resolution = resolveProductPrice(priced.pricing, item.quantity, requestUrgent);
          } catch (error) {
            if (
              error instanceof PricingValidationError ||
              error instanceof PricingUnavailableError
            ) {
              throw new QuoteDraftInputError(`Preço indisponível para o produto "${item.sku}".`);
            }
            throw error;
          }
          let appliedCents = resolution.rate_cents;
          if (item.manualRate) {
            try {
              appliedCents = parseMoneyCents(item.rate, `Preço manual do item ${index + 1}`);
            } catch (error) {
              if (error instanceof PricingValidationError)
                throw new QuoteDraftInputError(error.message);
              throw error;
            }
          }
          const differenceCents = appliedCents - resolution.rate_cents;
          const totalCents = lineTotalCents(item.quantityScaled, appliedCents);
          assertMoneyWithinLimit(totalCents, `Total da linha ${index + 1}`);
          subtotalCents += totalCents;
          assertMoneyWithinLimit(subtotalCents, 'Subtotal');
          resolvedItems.push({
            id: idFactory(),
            position: index,
            quantity: item.quantity,
            itemName: item.itemName,
            product: priced.product,
            resolution,
            appliedCents,
            differenceCents,
            lineTotalCents: totalCents,
            manualRate: item.manualRate,
          });
        }

        const totalCents = subtotalCents + freightCents;
        assertMoneyWithinLimit(totalCents, 'Total do orçamento');
        const year = createdAt.getUTCFullYear();
        const businessNumber = await reserveBusinessNumber(tx, year);
        const quotationId = idFactory();
        const revisionId = idFactory();
        if (![quotationId, revisionId, ...resolvedItems.map((item) => item.id)].every(isUuid)) {
          throw new QuoteDraftRepositoryError(
            'Não foi possível gerar os identificadores do orçamento.'
          );
        }

        await tx.insert(quotations).values({
          id: quotationId,
          businessNumber,
          clientId: client.id,
          status: 'rascunho',
          createdAt,
          updatedAt: createdAt,
        });

        await tx.insert(quoteRevisions).values({
          id: revisionId,
          quotationId,
          version: 1,
          status: 'rascunho',
          validadeDias: validityDays,
          entrega:
            input.entrega !== undefined
              ? inputText(input.entrega, 'Entrega', 500)
              : settings.entrega,
          fretePadrao: settings.frete_padrao,
          frete: formatMoneyCents(freightCents),
          templatePadrao: template.model.key,
          templateHash: template.version.sourceHash,
          templateVersionId: template.version.id,
          sectionsSnapshot,
          companySnapshot: settings.empresa,
          ...clientSnapshotToRow(client),
          subtotal: formatMoneyCents(subtotalCents),
          total: formatMoneyCents(totalCents),
          createdAt,
        });

        await tx.insert(quoteRevisionItems).values(
          resolvedItems.map((item) => ({
            id: item.id,
            revisionId,
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
            texto: `Orçamento ${businessNumber} criado`,
            reference_id: `orcamento:${quotationId}:${sku}`,
            created_at: createdAt,
          })),
        );

        const savedItems = resolvedItems.map(
          (item) =>
            ({
              id: item.id,
              position: item.position,
              item_code: item.product.sku,
              sku: item.product.sku,
              qty: item.quantity,
              quantidade: item.quantity,
              nome: item.itemName || item.product.nome,
              descricao: item.product.descricao,
              unidade: item.product.unidade,
              categoria: item.product.categoria ?? null,
              marca: item.product.marca ?? null,
              price_source: resolutionSource(item.resolution),
              preco_fonte: resolutionSource(item.resolution),
              tier_minimum: item.resolution.minimum_quantity,
              preco_minimo_faixa: item.resolution.minimum_quantity,
              suggested_unit_price: item.resolution.rate,
              preco_sugerido: item.resolution.rate,
              applied_unit_price: formatMoneyCents(item.appliedCents),
              preco_aplicado: formatMoneyCents(item.appliedCents),
              price_difference: signedMoney(item.differenceCents),
              diferenca_preco: signedMoney(item.differenceCents),
              line_total: formatMoneyCents(item.lineTotalCents),
              total_linha: formatMoneyCents(item.lineTotalCents),
              manual_rate: item.manualRate,
            }) satisfies QuoteDraftItemSnapshot
        );

        return {
          success: true as const,
          quotation_id: businessNumber,
          quotation_name: businessNumber,
          quote_id: quotationId,
          quotation_uuid: quotationId,
          revision_id: revisionId,
          quote_revision_id: revisionId,
          revision: 1,
          revision_number: 1,
          status: 'rascunho' as const,
          cliente: client.nome,
          cliente_id: client.id,
          cliente_snapshot: client,
          items: savedItems,
          subtotal: formatMoneyCents(subtotalCents),
          frete: formatMoneyCents(freightCents),
          total: formatMoneyCents(totalCents),
          validade_dias: validityDays,
          pagamento: sectionsSnapshot.pagamento.current.body,
          entrega: input.entrega !== undefined
            ? inputText(input.entrega, 'Entrega', 500)
            : settings.entrega,
          observacoes: sectionsSnapshot.condicoes_gerais.current.body,
          prazo_producao: canonicalDeadline,
          template_padrao: template.model.key,
          template_key: template.model.key,
          template_hash: template.version.sourceHash,
          template_version_id: template.version.id,
          secoes: sectionsSnapshot,
          // Optimistic-concurrency token for issuing this draft by reference.
          concurrency_token: quotationConcurrencyToken(createdAt),
          created_at: createdAt.toISOString(),
        } satisfies QuoteDraftResult;
      });
      return result;
    } catch (error) {
      if (
        error instanceof QuoteDraftInputError ||
        error instanceof QuoteDraftNotFoundError ||
        error instanceof QuoteDraftConflictError ||
        error instanceof QuoteDraftRepositoryError
      )
        throw error;
      if (isDuplicateDocument(error))
        throw new QuoteDraftConflictError('Documento já cadastrado para outro cliente.');
      console.error(`[quote-repository] create failed (${safeErrorKind(error)})`);
      throw new QuoteDraftRepositoryError();
    }
  };

  const duplicateDraft = async (quotationIdValue: string): Promise<QuoteDuplicateResult> => {
    const normalizedId = String(quotationIdValue || '').trim();
    if (!normalizedId) throw new QuoteDraftInputError('ID do orçamento não informado.');

    let database: AppDatabase;
    try {
      database = getDb();
    } catch {
      throw new QuoteDraftRepositoryError('Não foi possível duplicar o orçamento. Tente novamente.');
    }

    try {
      const createdAt = ensureDate(now());
      return await database.transaction(async (tx) => {
        await acquireQuotationWriteLock(tx);
        const [sourceQuotation] = await tx
          .select()
          .from(quotations)
          .where(quotationPredicate(normalizedId))
          .for('update')
          .limit(1);
        if (!sourceQuotation) throw new QuoteDraftNotFoundError('Orçamento não encontrado.');

        const [sourceRevision] = await tx
          .select()
          .from(quoteRevisions)
          .where(eq(quoteRevisions.quotationId, sourceQuotation.id))
          .orderBy(sql`${quoteRevisions.version} DESC`)
          .limit(1);
        if (!sourceRevision) {
          throw new QuoteDraftNotFoundError('Revisão do orçamento não encontrada.');
        }

        const sourceItems = await tx
          .select()
          .from(quoteRevisionItems)
          .where(eq(quoteRevisionItems.revisionId, sourceRevision.id))
          .orderBy(asc(quoteRevisionItems.position));
        if (sourceItems.length === 0) {
          throw new QuoteDraftInputError('Orçamento sem itens não pode ser duplicado.');
        }

        if (!sourceRevision.sectionsSnapshot) {
          throw new QuoteDraftNotFoundError('Revisão do orçamento não encontrada.');
        }

        const settings = await readSettings(tx);
        const clientSnapshot = clientSnapshotFromRevision(sourceRevision, sourceQuotation.clientId);
        const businessNumber = await reserveBusinessNumber(tx, createdAt.getUTCFullYear());
        const quotationId = idFactory();
        const revisionId = idFactory();
        const itemIds = sourceItems.map(() => idFactory());
        const dealId = idFactory();
        const generatedIds = [quotationId, revisionId, dealId, ...itemIds];
        if (
          generatedIds.some((id) => !isUuid(id)) ||
          new Set(generatedIds).size !== generatedIds.length
        ) {
          throw new QuoteDraftRepositoryError(
            'Não foi possível gerar os identificadores da duplicação.'
          );
        }

        await tx.insert(quotations).values({
          id: quotationId,
          businessNumber,
          clientId: sourceQuotation.clientId,
          status: 'rascunho',
          createdAt,
          updatedAt: createdAt,
        });
        await tx.insert(quoteRevisions).values({
          id: revisionId,
          quotationId,
          version: 1,
          status: 'rascunho',
          validadeDias: sourceRevision.validadeDias,
          entrega: sourceRevision.entrega,
          fretePadrao: sourceRevision.fretePadrao,
          frete: sourceRevision.frete,
          templatePadrao: sourceRevision.templatePadrao,
          templateHash: sourceRevision.templateHash,
          templateVersionId: sourceRevision.templateVersionId,
          sectionsSnapshot: copy(sourceRevision.sectionsSnapshot),
          companySnapshot: settings.empresa,
          ...clientSnapshotToRow(clientSnapshot),
          subtotal: sourceRevision.subtotal,
          total: sourceRevision.total,
          createdAt,
        });
        await tx.insert(quoteRevisionItems).values(
          sourceItems.map((item, index) => ({
            id: itemIds[index],
            revisionId,
            position: item.position,
            productSku: item.productSku,
            quantidade: item.quantidade,
            produtoSku: item.produtoSku,
            produtoNome: item.produtoNome,
            produtoDescricao: item.produtoDescricao,
            produtoUnidade: item.produtoUnidade,
            produtoCategoria: item.produtoCategoria,
            produtoMarca: item.produtoMarca,
            notas: item.notas,
            precoFonte: item.precoFonte,
            precoMinimoFaixa: item.precoMinimoFaixa,
            precoSugerido: item.precoSugerido,
            precoAplicado: item.precoAplicado,
            diferencaPreco: item.diferencaPreco,
            totalLinha: item.totalLinha,
            manualRate: item.manualRate,
          }))
        );

        await appendProductActivityEvents(
          tx,
          [...new Set(sourceItems.map((item) => item.produtoSku || item.productSku))].map((sku) => ({
            sku,
            tipo: 'orcamento' as const,
            texto: `Orçamento ${businessNumber} criado`,
            reference_id: `orcamento:${quotationId}:${sku}`,
            created_at: createdAt,
          })),
        );

        const [existingDeal] = await tx
          .select()
          .from(crmDeals)
          .where(and(eq(crmDeals.quotationId, quotationId), ne(crmDeals.status, 'Perdido')))
          .for('update')
          .limit(1);
        let linkedDealId = existingDeal?.id;
        if (!linkedDealId) {
          const [createdDeal] = await tx
            .insert(crmDeals)
            .values({
              id: dealId,
              quoteLeadId: null,
              clientId: sourceQuotation.clientId,
              quotationId,
              nome: clientSnapshot.nome,
              email: clientSnapshot.email,
              telefone: clientSnapshot.telefone,
              status: 'Orcamento Enviado',
              followUpStage: 0,
              nextStep: null,
              lostReason: null,
              createdAt,
              updatedAt: createdAt,
            })
            .onConflictDoNothing()
            .returning({ id: crmDeals.id });
          linkedDealId = createdDeal?.id;
        }
        if (!linkedDealId) {
          const [winner] = await tx
            .select({ id: crmDeals.id })
            .from(crmDeals)
            .where(and(eq(crmDeals.quotationId, quotationId), ne(crmDeals.status, 'Perdido')))
            .limit(1);
          linkedDealId = winner?.id;
        }
        if (!linkedDealId) {
          throw new QuoteDraftRepositoryError('Não foi possível duplicar o orçamento. Tente novamente.');
        }

        return {
          success: true as const,
          quotation_id: businessNumber,
          quotation_name: businessNumber,
          quote_id: quotationId,
          quotation_uuid: quotationId,
          revision_id: revisionId,
          quote_revision_id: revisionId,
          revision: 1,
          revision_number: 1,
          status: 'rascunho' as const,
          cliente: clientSnapshot.nome,
          cliente_id: clientSnapshot.id,
          cliente_snapshot: clientSnapshot,
          items: sourceItems.map((item, index) => duplicateItemSnapshot(item, itemIds[index])),
          subtotal: String(sourceRevision.subtotal),
          frete: String(sourceRevision.frete),
          total: String(sourceRevision.total),
          validade_dias: sourceRevision.validadeDias,
          pagamento: sourceRevision.sectionsSnapshot.pagamento.current.body,
          entrega: sourceRevision.entrega,
          observacoes: sourceRevision.sectionsSnapshot.condicoes_gerais.current.body,
          prazo_producao: sourceRevision.sectionsSnapshot.prazo_producao.current.value ?? '',
          template_padrao: sourceRevision.templatePadrao,
          template_key: sourceRevision.templatePadrao,
          template_hash: sourceRevision.templateHash,
          template_version_id: sourceRevision.templateVersionId,
          secoes: copy(sourceRevision.sectionsSnapshot),
          created_at: createdAt.toISOString(),
          crm_deal_id: linkedDealId,
        } satisfies QuoteDuplicateResult;
      });
    } catch (error) {
      if (
        error instanceof QuoteDraftInputError ||
        error instanceof QuoteDraftNotFoundError ||
        error instanceof QuoteDraftConflictError ||
        error instanceof QuoteDraftRepositoryError
      )
        throw error;
      console.error(`[quote-repository] duplicate failed (${safeErrorKind(error)})`);
      throw new QuoteDraftRepositoryError('Não foi possível duplicar o orçamento. Tente novamente.');
    }
  };

  return {
    createDraft,
    create: createDraft,
    duplicateDraft,
    duplicateQuotation: duplicateDraft,
  };
}

export function quoteDraftItemFromRow(
  row: typeof quoteRevisionItems.$inferSelect,
  product: typeof products.$inferSelect
): QuoteDraftItemSnapshot {
  return itemSnapshot(row, product);
}

// Naming aliases follow the existing client/product repository factories and
// keep future callers independent from the draft-specific wording.
export const createPostgresQuoteRepository = createPostgresQuoteDraftRepository;
export const createPostgresQuotationRepository = createPostgresQuoteDraftRepository;
export type QuoteRepository = QuoteDraftRepository;
