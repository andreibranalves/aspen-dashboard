import type { QuotationSectionsSnapshot } from '@/components/quotation/QuotationSectionsEditor';
import type { Product } from '@/types/domain';

export interface ProjectedAddress {
  endereco?: string;
  numero?: string;
  bairro?: string;
  complemento?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
}

export interface ProjectedLatestQuotation {
  name: string;
  status?: string;
  date?: string;
  grand_total?: number | string;
}

export interface ProjectedDeal {
  name: string;
  status?: string;
  next_step?: string;
}

export interface ProjectedClientRow {
  id: string;
  nome?: string;
  email?: string | null;
  telefone?: string | null;
  documento?: string | null;
  arquivado?: boolean;
  status?: 'active' | 'archived' | string;
}

export interface ProjectedClientDetail extends ProjectedClientRow {
  display_name?: string;
  notes?: string | null;
  observacoes?: string | null;
  person_type?: string | null;
  tax_id?: string | null;
  address?: ProjectedAddress | null;
  latest_quotation?: ProjectedLatestQuotation | null;
  deal?: ProjectedDeal | null;
  quality_flags?: string[];
  creation?: string;
  modified?: string;
}

export interface ProjectedQuotationItem {
  item_code: string;
  item_name: string;
  qty: number | string;
  quantidade?: number | string;
  rate: number | string;
  sku?: string;
  nome?: string;
  descricao?: string;
  unidade?: string;
  suggested_unit_price?: number | string;
  preco_sugerido?: number | string;
  applied_unit_price?: number | string;
  preco_aplicado?: number | string;
  price_difference?: number | string;
  diferenca_preco?: number | string;
  line_total?: number | string;
  total_linha?: number | string;
  manual_rate: boolean;
}

export interface ProjectedQuotationListRow {
  id: string;
  data: string;
  cliente: string;
  valor: number | string;
  status: string;
  status_canonical: 'rascunho' | 'emitido' | 'aprovado' | 'perdido';
  revision_id: string;
  email_sent: boolean;
  email_sent_at: string | null;
}

export interface ProjectedSalesOrderListRow {
  id: string;
  date: string;
  customer_name: string;
  grand_total: number | string;
  status: string;
  delivery_date: string;
  per_delivered: number | string;
  source_quotation?: string;
}

export interface ProjectedProductListRow {
  sku: string;
  item_code?: string;
  nome: string;
  item_name?: string;
  descricao?: string;
  unidade?: string;
  stock_uom?: string;
  preco_minimo?: number | string;
  pricing_available?: boolean;
  ativo?: boolean;
}

export interface ProjectedDashboardSummary {
  total_revenue: number;
  orders_count: number;
  avg_ticket: number;
  open_orders: number;
  conversion_rate: number;
  revenue_delta: number;
  orders_delta: number;
  avg_ticket_delta: number;
  conversion_delta: number;
}

export interface ProjectedDashboardData {
  period: { label: string; from: string; to: string };
  summary: ProjectedDashboardSummary;
  top_products: Array<{ sku: string; product: string; quantity: number; revenue: number; orders: number }>;
  top_customers: Array<{ name: string; revenue: number; orders: number }>;
  sales_by_day: Array<{ date: string; revenue: number; orders: number }>;
  stale_quotations: Array<{ id: string; customer: string; age: number; value: number; status: string }>;
}

export interface ProjectedQuotationRevisionHistoryEntry {
  id: string;
  revision_id: string;
  revision: number;
  revision_number: number;
  created_at?: string;
  createdAt?: string;
  validade_dias?: number;
  validity_date?: string;
  validade?: string;
  subtotal?: number | string;
  total?: number | string;
  valor?: number | string;
  status: string;
  status_canonical?: string;
  derived_expired: boolean;
  expiration_derived: boolean;
  is_expired: boolean;
  expirada: boolean;
  template_key?: string | null;
  template_version?: number | null;
  template_hash?: string | null;
}

export interface ProjectedQuotationData {
  id: string;
  quotation_id?: string;
  quotation_uuid?: string;
  status: string;
  cliente?: string;
  email?: string;
  telefone?: string;
  email_sent: boolean;
  email_sent_at: string | null;
  data?: string;
  validade?: string;
  validity_date?: string;
  items?: ProjectedQuotationItem[];
  status_canonical?: string;
  revision_id?: string;
  revision?: number;
  revision_number?: number;
  client_id?: string;
  validade_dias?: number;
  pagamento?: string;
  entrega?: string;
  frete_padrao?: number | string;
  frete?: number | string;
  observacoes?: string;
  prazo_producao?: string;
  template_key?: string;
  template_hash?: string;
  template_version_id?: string | null;
  template_version?: number | null;
  secoes?: QuotationSectionsSnapshot | null;
  sections_snapshot?: QuotationSectionsSnapshot | null;
  subtotal?: number | string;
  total?: number | string;
  valor?: number | string;
  revision_history?: ProjectedQuotationRevisionHistoryEntry[];
  derived_expired: boolean;
  expiration_derived: boolean;
  is_expired: boolean;
  expirada: boolean;
}

export interface ProjectedQuotationDetail {
  data: ProjectedQuotationData;
  /** Kept outside public React state because it is only used for optimistic writes. */
  concurrencyToken: string;
}

export interface ProjectedQuotationTemplateMetadata {
  key: string;
  name: string;
  is_default?: boolean;
  archived?: boolean;
  hash?: string;
  current_hash?: string | null;
  current_version_id?: string | null;
  current_version?: number | null;
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as RecordValue;
}

function asJsonRecord(value: unknown): RecordValue | null {
  if (typeof value !== 'string') return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return readString(value);
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readMoney(value: unknown, allowNegative = false): number | string | undefined {
  const parsed = numericValue(value);
  if (parsed === undefined || (!allowNegative && parsed < 0)) return undefined;
  return typeof value === 'number' ? value : (value as string).trim();
}

function readNumberOrString(value: unknown): number | string | undefined {
  return numericValue(value) === undefined
    ? undefined
    : typeof value === 'number'
      ? value
      : (value as string).trim();
}

function readPositiveMoney(value: unknown): number | string | undefined {
  const parsed = numericValue(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return typeof value === 'number' ? value : (value as string).trim();
}

function readPositiveQuantity(value: unknown): number | string | undefined {
  const parsed = numericValue(value);
  if (parsed === undefined || parsed <= 0) return undefined;
  return typeof value === 'number' ? value : (value as string).trim();
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = value.trim();
  return Number.isNaN(new Date(normalized).getTime()) ? undefined : normalized;
}

function readPositiveVersion(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function readIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNonnegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readSafeCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readSignedNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function hasAny(source: RecordValue, keys: readonly string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function readAlias<T>(
  source: RecordValue,
  keys: readonly string[],
  reader: (value: unknown) => T | undefined,
): T | undefined {
  let result: T | undefined;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const parsed = reader(source[key]);
    if (parsed === undefined) return undefined;
    if (result === undefined) result = parsed;
  }
  return result;
}

const QUOTATION_STATUSES = new Set(['rascunho', 'emitido', 'aprovado', 'perdido']);
const QUOTATION_STATUS_LABELS = new Set([
  'Rascunho', 'Emitido', 'Enviado', 'Aprovado', 'Perdido',
  'Draft', 'Issued', 'Open', 'Replied', 'Ordered', 'Lost', 'Expired', 'Cancelled',
]);
const SALES_ORDER_STATUSES = new Set([
  'Draft',
  'To Deliver and Bill',
  'To Deliver',
  'To Bill',
  'Completed',
  'Cancelled',
  'Closed',
]);

function projectAddress(value: unknown): ProjectedAddress | null {
  if (value === null) return null;
  const source = asRecord(value);
  if (!source) return null;
  const address: ProjectedAddress = {};
  for (const key of ['endereco', 'numero', 'bairro', 'complemento', 'municipio', 'uf', 'cep'] as const) {
    const field = readString(source[key]);
    if (field !== undefined) address[key] = field;
  }
  return address;
}

function projectLatestQuotation(value: unknown): ProjectedLatestQuotation | null {
  const source = asRecord(value);
  const name = readString(source?.name);
  if (!source || !name) return null;
  const result: ProjectedLatestQuotation = { name };
  const status = readString(source.status);
  const date = readString(source.date);
  const grandTotal = readNumberOrString(source.grand_total);
  if (status !== undefined) result.status = status;
  if (date !== undefined) result.date = date;
  if (grandTotal !== undefined) result.grand_total = grandTotal;
  return result;
}

function projectDeal(value: unknown): ProjectedDeal | null {
  const source = asRecord(value);
  const name = readString(source?.name);
  if (!source || !name) return null;
  const result: ProjectedDeal = { name };
  const status = readString(source.status);
  const nextStep = readString(source.next_step);
  if (status !== undefined) result.status = status;
  if (nextStep !== undefined) result.next_step = nextStep;
  return result;
}

export function projectClientRow(value: unknown): ProjectedClientRow | null {
  const source = asRecord(value);
  const id = readIdentifier(source?.id);
  const nome = readIdentifier(source?.nome);
  if (!source || !id || !nome) return null;
  const result: ProjectedClientRow = { id, nome };
  const email = readNullableString(source.email);
  const telefone = readNullableString(source.telefone);
  const documento = readNullableString(source.documento);
  const arquivado = readBoolean(source.arquivado);
  const status = readString(source.status);
  if (source.email !== undefined && email === undefined) return null;
  if (source.telefone !== undefined && telefone === undefined) return null;
  if (source.documento !== undefined && documento === undefined) return null;
  if (source.arquivado !== undefined && arquivado === undefined) return null;
  if (source.status !== undefined && status === undefined) return null;
  if (email !== undefined) result.email = email;
  if (telefone !== undefined) result.telefone = telefone;
  if (documento !== undefined) result.documento = documento;
  if (arquivado !== undefined) result.arquivado = arquivado;
  if (status !== undefined) result.status = status;
  return result;
}

export function projectClientDetail(value: unknown): ProjectedClientDetail | null {
  const row = projectClientRow(value);
  const source = asRecord(value);
  if (!row || !source) return null;
  const result: ProjectedClientDetail = { ...row };
  const displayName = readString(source.display_name);
  const notes = readNullableString(source.notes);
  const observations = readNullableString(source.observacoes);
  const personType = readNullableString(source.person_type);
  const taxId = readNullableString(source.tax_id);
  const address = projectAddress(source.address);
  const latestQuotation = projectLatestQuotation(source.latest_quotation);
  const deal = projectDeal(source.deal);
  const creation = readString(source.creation);
  const modified = readString(source.modified);
  const qualityFlags = Array.isArray(source.quality_flags)
    ? source.quality_flags.filter((flag): flag is string => typeof flag === 'string')
    : undefined;
  if (displayName !== undefined) result.display_name = displayName;
  if (notes !== undefined) result.notes = notes;
  if (observations !== undefined) result.observacoes = observations;
  if (personType !== undefined) result.person_type = personType;
  if (taxId !== undefined) result.tax_id = taxId;
  if (address !== null) result.address = address;
  if (latestQuotation) result.latest_quotation = latestQuotation;
  if (deal) result.deal = deal;
  if (creation !== undefined) result.creation = creation;
  if (modified !== undefined) result.modified = modified;
  if (qualityFlags) result.quality_flags = qualityFlags;
  return result;
}

function projectSectionSetting(value: unknown, requiresBody: boolean): RecordValue | null {
  const source = asRecord(value);
  if (!source || typeof source.enabled !== 'boolean') return null;
  if (typeof source.title !== 'string' || !source.title.trim()) return null;
  const allowed = requiresBody ? ['enabled', 'title', 'body'] : ['enabled', 'title'];
  if (Object.keys(source).some((key) => !allowed.includes(key))) return null;
  const result: RecordValue = { enabled: source.enabled, title: source.title };
  if (requiresBody) {
    if (typeof source.body !== 'string') return null;
    result.body = source.body;
  } else if (Object.prototype.hasOwnProperty.call(source, 'body')) {
    return null;
  }
  return result;
}

export function projectQuotationSections(value: unknown): QuotationSectionsSnapshot | null {
  const source = asJsonRecord(value);
  if (!source || source.schema_version !== 1) return null;
  const keys = ['prazo_producao', 'pagamento', 'condicoes_gerais'] as const;
  const result: RecordValue = { schema_version: 1 };
  for (const key of keys) {
    const section = asRecord(source[key]);
    const base = projectSectionSetting(section?.base, key !== 'prazo_producao');
    const current = projectSectionSetting(section?.current, key !== 'prazo_producao');
    if (!base || !current) return null;
    result[key] = { base, current };
  }
  return result as unknown as QuotationSectionsSnapshot;
}

export function projectQuotationItem(value: unknown): ProjectedQuotationItem | null {
  const source = asRecord(value);
  if (!source) return null;
  const itemCode = readAlias(source, ['item_code', 'sku'], readIdentifier);
  const itemName = readAlias(source, ['item_name', 'nome'], readIdentifier);
  const qty = readAlias(source, ['qty', 'quantidade'], readPositiveQuantity);
  const rate = readAlias(source, ['rate', 'applied_unit_price', 'preco_aplicado'], readPositiveMoney);
  const suggested = readAlias(source, ['suggested_unit_price', 'preco_sugerido'], readPositiveMoney);
  const difference = readAlias(source, ['price_difference', 'diferenca_preco'], (entry) => readMoney(entry, true));
  const lineTotal = readAlias(source, ['line_total', 'total_linha'], readMoney);
  const manualRate = readBoolean(source.manual_rate);
  if (
    !hasAny(source, ['item_code', 'sku']) || itemCode === undefined ||
    !hasAny(source, ['item_name', 'nome']) || itemName === undefined ||
    !hasAny(source, ['qty', 'quantidade']) || qty === undefined ||
    !hasAny(source, ['rate', 'applied_unit_price', 'preco_aplicado']) || rate === undefined ||
    !hasAny(source, ['suggested_unit_price', 'preco_sugerido']) || suggested === undefined ||
    !hasAny(source, ['price_difference', 'diferenca_preco']) || difference === undefined ||
    !hasAny(source, ['line_total', 'total_linha']) || lineTotal === undefined ||
    manualRate === undefined
  ) return null;

  const result: ProjectedQuotationItem = {
    item_code: itemCode,
    item_name: itemName,
    qty,
    rate,
    manual_rate: manualRate,
  };
  const strings: Array<[keyof ProjectedQuotationItem, string]> = [
    ['sku', 'sku'],
    ['nome', 'nome'],
    ['descricao', 'descricao'],
    ['unidade', 'unidade'],
  ];
  for (const [target, sourceKey] of strings) {
    if (!Object.prototype.hasOwnProperty.call(source, sourceKey)) continue;
    const field = readString(source[sourceKey]);
    if (field === undefined) return null;
    result[target] = field as never;
  }
  const numbers: Array<[keyof ProjectedQuotationItem, string, (entry: unknown) => number | string | undefined]> = [
    ['quantidade', 'quantidade', readPositiveQuantity],
    ['suggested_unit_price', 'suggested_unit_price', readPositiveMoney],
    ['preco_sugerido', 'preco_sugerido', readPositiveMoney],
    ['applied_unit_price', 'applied_unit_price', readPositiveMoney],
    ['preco_aplicado', 'preco_aplicado', readPositiveMoney],
    ['price_difference', 'price_difference', (entry) => readMoney(entry, true)],
    ['diferenca_preco', 'diferenca_preco', (entry) => readMoney(entry, true)],
    ['line_total', 'line_total', readMoney],
    ['total_linha', 'total_linha', readMoney],
  ];
  for (const [target, sourceKey, reader] of numbers) {
    if (!Object.prototype.hasOwnProperty.call(source, sourceKey)) continue;
    const field = reader(source[sourceKey]);
    if (field === undefined) return null;
    result[target] = field as never;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'quantidade') && result.quantidade === undefined) return null;
  return result;
}

function projectRevisionHistory(value: unknown): ProjectedQuotationRevisionHistoryEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: ProjectedQuotationRevisionHistoryEntry[] = [];
  for (const item of value) {
    const source = asRecord(item);
    if (!source) return null;
    const id = readIdentifier(source.id);
    const revisionId = readIdentifier(source.revision_id);
    const revision = readPositiveVersion(source.revision);
    const revisionNumber = readPositiveVersion(source.revision_number);
    const createdAt = readDate(source.created_at) || readDate(source.createdAt);
    const validityDate = readDate(source.validity_date) || readDate(source.validade);
    const validityDays = readPositiveVersion(source.validade_dias);
    const subtotal = readMoney(source.subtotal);
    const total = readMoney(source.total);
    const valueTotal = readMoney(source.valor);
    const status = readString(source.status);
    const rawStatusCanonical = readString(source.status_canonical);
    const statusCanonical = rawStatusCanonical === 'enviado' ? 'emitido' : rawStatusCanonical;
    const hasTemplateKey = Object.prototype.hasOwnProperty.call(source, 'template_key');
    const hasTemplateVersion = Object.prototype.hasOwnProperty.call(source, 'template_version');
    const hasTemplateHash = Object.prototype.hasOwnProperty.call(source, 'template_hash');
    const templateKey = hasTemplateKey
      ? source.template_key === null ? null : readIdentifier(source.template_key)
      : undefined;
    const templateVersion = hasTemplateVersion
      ? source.template_version === null ? null : readPositiveVersion(source.template_version)
      : undefined;
    const templateHash = hasTemplateHash
      ? source.template_hash === null ? null : readString(source.template_hash)
      : undefined;
    const derivedExpired = readBoolean(source.derived_expired);
    const expirationDerived = readBoolean(source.expiration_derived);
    const isExpired = readBoolean(source.is_expired);
    const expired = readBoolean(source.expirada);
    if (
      !id || !revisionId || !revision || !revisionNumber || revision !== revisionNumber ||
      !createdAt || !validityDate || validityDays === undefined || validityDays < 1 || validityDays > 365 ||
      subtotal === undefined || total === undefined || valueTotal === undefined ||
      !status || !QUOTATION_STATUS_LABELS.has(status) || !statusCanonical || !QUOTATION_STATUSES.has(statusCanonical) ||
      derivedExpired === undefined || expirationDerived === undefined || isExpired === undefined || expired === undefined ||
      (hasTemplateKey && templateKey === undefined) ||
      (hasTemplateVersion && templateVersion === undefined) ||
      (hasTemplateHash && templateHash === undefined) ||
      (templateHash !== undefined && templateHash !== null && !/^[0-9a-f]{64}$/i.test(templateHash))
    ) return null;
    const result: ProjectedQuotationRevisionHistoryEntry = {
      id,
      revision_id: revisionId,
      revision,
      revision_number: revisionNumber,
      created_at: createdAt,
      createdAt: createdAt,
      validade_dias: validityDays,
      validity_date: validityDate,
      validade: validityDate,
      subtotal,
      total,
      valor: valueTotal,
      status,
      status_canonical: statusCanonical,
      derived_expired: derivedExpired,
      expiration_derived: expirationDerived,
      is_expired: isExpired,
      expirada: expired,
    };
    if (hasTemplateKey) result.template_key = templateKey!;
    if (hasTemplateVersion) result.template_version = templateVersion!;
    if (hasTemplateHash) result.template_hash = templateHash!;
    entries.push(result);
  }
  return entries;
}

export function projectProduct(value: unknown): Product | null {
  const source = asRecord(value);
  const sku = readAlias(source || {}, ['sku', 'item_code'], readIdentifier);
  const name = readAlias(source || {}, ['nome', 'item_name'], readIdentifier);
  if (!source || !sku || !name) return null;
  const result: Product = { sku, nome: name };
  const strings: Array<[keyof Product, string]> = [
    ['item_code', 'item_code'],
    ['item_name', 'item_name'],
    ['descricao', 'descricao'],
    ['unidade', 'unidade'],
    ['stock_uom', 'stock_uom'],
    ['categoria', 'categoria'],
    ['marca', 'marca'],
    ['imagem', 'imagem'],
    ['criado_em', 'criado_em'],
    ['atualizado_em', 'atualizado_em'],
    ['arquivado_em', 'arquivado_em'],
    ['modificado_em', 'modificado_em'],
  ];
  for (const [target, sourceKey] of strings) {
    if (!Object.prototype.hasOwnProperty.call(source, sourceKey)) continue;
    const raw = source[sourceKey];
    if (raw !== null && readString(raw) === undefined) return null;
    result[target] = raw as never;
  }
  if (source.pricing_available !== undefined) {
    const pricingAvailable = readBoolean(source.pricing_available);
    if (pricingAvailable === undefined) return null;
    result.pricing_available = pricingAvailable;
  }
  if (source.ativo !== undefined) {
    const ativo = readBoolean(source.ativo);
    if (ativo === undefined) return null;
    result.ativo = ativo;
  }
  return result;
}

export function projectQuotationTemplate(value: unknown): ProjectedQuotationTemplateMetadata | null {
  const source = asRecord(value);
  const key = readIdentifier(source?.key);
  const name = readIdentifier(source?.name);
  if (!source || !key || !name) return null;
  const result: ProjectedQuotationTemplateMetadata = { key, name };
  const isDefault = readBoolean(source.is_default);
  const archived = readBoolean(source.archived);
  const hash = readString(source.hash);
  const currentHash = readNullableString(source.current_hash);
  const currentVersionId = readNullableString(source.current_version_id);
  const hasCurrentVersion = Object.prototype.hasOwnProperty.call(source, 'current_version');
  const currentVersion = !hasCurrentVersion
    ? undefined
    : source.current_version === null ? null : readPositiveVersion(source.current_version);
  if (source.is_default !== undefined && isDefault === undefined) return null;
  if (source.archived !== undefined && archived === undefined) return null;
  if (source.hash !== undefined && !hash) return null;
  if (source.current_hash !== undefined && currentHash === undefined) return null;
  if (source.current_version_id !== undefined && currentVersionId === undefined) return null;
  if (hasCurrentVersion && currentVersion === undefined) return null;
  if (isDefault !== undefined) result.is_default = isDefault;
  if (archived !== undefined) result.archived = archived;
  if (hash !== undefined) result.hash = hash;
  if (currentHash !== undefined) result.current_hash = currentHash;
  if (currentVersionId !== undefined) result.current_version_id = currentVersionId;
  if (hasCurrentVersion) result.current_version = currentVersion!;
  return result;
}

export function projectQuotationDetail(value: unknown): ProjectedQuotationDetail | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = readIdentifier(source.id);
  const status = readString(source.status);
  const rawStatusCanonical = readString(source.status_canonical);
  const statusCanonical = rawStatusCanonical === 'enviado' ? 'emitido' : rawStatusCanonical;
  const cliente = readIdentifier(source.cliente);
  const dataDate = readDate(source.data);
  const validade = readDate(source.validade) || readDate(source.validity_date);
  const validityDays = readPositiveVersion(source.validade_dias);
  const revision = readPositiveVersion(source.revision);
  const revisionNumber = readPositiveVersion(source.revision_number);
  const revisionId = readIdentifier(source.revision_id);
  const quotationId = readIdentifier(source.quotation_id);
  const quotationUuid = readIdentifier(source.quotation_uuid);
  const clientId = readIdentifier(source.client_id);
  const clientSnapshot = projectClientRow(source.cliente_snapshot);
  const emailSent = readBoolean(source.email_sent) ?? false;
  const emailSentAt = source.email_sent_at === null || source.email_sent_at === undefined
    ? null
    : readDate(source.email_sent_at) || null;
  const sectionsValue = Object.prototype.hasOwnProperty.call(source, 'secoes')
    ? source.secoes
    : source.sections_snapshot;
  const sections = projectQuotationSections(sectionsValue);
  const items = Array.isArray(source.items)
    ? source.items.map(projectQuotationItem)
    : null;
  const revisionHistory = Object.prototype.hasOwnProperty.call(source, 'revision_history')
    ? projectRevisionHistory(source.revision_history)
    : [];
  const templateKey = readAlias(source, ['template_key', 'template_padrao'], readIdentifier);
  const templateHash = readString(source.template_hash);
  const templateVersionId = readNullableString(source.template_version_id);
  const templateVersion = source.template_version === null
    ? null
    : readPositiveVersion(source.template_version);
  const moneyKeys = ['frete_padrao', 'frete', 'subtotal', 'total', 'valor'] as const;
  const money = Object.fromEntries(
    moneyKeys.map((key) => [key, readMoney(source[key])]),
  ) as Record<(typeof moneyKeys)[number], number | string | undefined>;
  const strings = ['pagamento', 'entrega', 'observacoes', 'prazo_producao'] as const;
  const expirationKeys = ['derived_expired', 'expiration_derived', 'is_expired', 'expirada'] as const;
  const expiration = Object.fromEntries(
    expirationKeys.map((key) => [key, readBoolean(source[key])]),
  ) as Record<(typeof expirationKeys)[number], boolean | undefined>;
  const token = readAlias(
    source,
    ['concurrency_token', 'version_token', 'updated_at', 'updatedAt'],
    readIdentifier,
  );
  if (
    !id || !status || !QUOTATION_STATUS_LABELS.has(status) ||
    !statusCanonical || !QUOTATION_STATUSES.has(statusCanonical) ||
    !cliente || !dataDate || !validade || validityDays === undefined ||
    revision === undefined || revisionNumber === undefined || revision !== revisionNumber ||
    !revisionId || !clientId || !clientSnapshot || !sections || !items || items.some((item) => item === null) ||
    !revisionHistory || templateKey === undefined ||
    !templateHash || !/^[0-9a-f]{64}$/i.test(templateHash) ||
    (source.template_version_id !== null && templateVersionId === undefined) ||
    (source.template_version !== null && templateVersion === undefined) ||
    Object.values(money).some((field) => field === undefined) ||
    strings.some((key) => typeof source[key] !== 'string') ||
    Object.values(expiration).some((field) => field === undefined) ||
    token === undefined
  ) return null;

  const data: ProjectedQuotationData = {
    id,
    ...(quotationId ? { quotation_id: quotationId } : {}),
    ...(quotationUuid ? { quotation_uuid: quotationUuid } : {}),
    status,
    cliente,
    email: clientSnapshot.email || undefined,
    telefone: clientSnapshot.telefone || undefined,
    email_sent: emailSent,
    email_sent_at: emailSentAt,
    data: dataDate,
    validade,
    validity_date: validade,
    status_canonical: statusCanonical,
    revision_id: revisionId,
    revision,
    revision_number: revisionNumber,
    client_id: clientId,
    validade_dias: validityDays,
    pagamento: source.pagamento as string,
    entrega: source.entrega as string,
    observacoes: source.observacoes as string,
    prazo_producao: source.prazo_producao as string,
    template_key: templateKey,
    template_hash: templateHash,
    template_version_id: templateVersionId,
    template_version: source.template_version === null ? null : templateVersion!,
    secoes: sections,
    sections_snapshot: sections,
    subtotal: money.subtotal!,
    total: money.total!,
    valor: money.valor!,
    items: items as ProjectedQuotationItem[],
    revision_history: revisionHistory,
    derived_expired: expiration.derived_expired!,
    expiration_derived: expiration.expiration_derived!,
    is_expired: expiration.is_expired!,
    expirada: expiration.expirada!,
  };
  data.frete_padrao = money.frete_padrao!;
  data.frete = money.frete!;
  return { data, concurrencyToken: token };
}

export function projectQuotationListRow(value: unknown): ProjectedQuotationListRow | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = readIdentifier(source.id);
  const data = readDate(source.data);
  const cliente = readIdentifier(source.cliente);
  const valor = readMoney(source.valor);
  const status = readString(source.status);
  const rawStatusCanonical = readString(source.status_canonical);
  const statusCanonical = rawStatusCanonical === 'enviado' ? 'emitido' : rawStatusCanonical;
  const revisionId = readIdentifier(source.revision_id);
  const emailSent = readBoolean(source.email_sent) ?? false;
  const emailSentAt = source.email_sent_at === null || source.email_sent_at === undefined
    ? null
    : readDate(source.email_sent_at) || null;
  if (
    !id || !data || !cliente || valor === undefined ||
    !status || !QUOTATION_STATUS_LABELS.has(status) ||
    !statusCanonical || !QUOTATION_STATUSES.has(statusCanonical) || !revisionId
  ) return null;
  return {
    id,
    data,
    cliente,
    valor,
    status,
    status_canonical: statusCanonical as ProjectedQuotationListRow['status_canonical'],
    revision_id: revisionId,
    email_sent: emailSent,
    email_sent_at: emailSentAt,
  };
}

export function projectSalesOrderListRow(value: unknown): ProjectedSalesOrderListRow | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = readIdentifier(source.id);
  const date = readDate(source.date);
  const customerName = typeof source.customer_name === 'string' ? source.customer_name : undefined;
  const grandTotal = readMoney(source.grand_total);
  const status = readString(source.status);
  const deliveryDate = typeof source.delivery_date === 'string' ? source.delivery_date : undefined;
  const delivered = readMoney(source.per_delivered);
  const sourceQuotation = readNullableString(source.source_quotation);
  const deliveredNumber = numericValue(source.per_delivered);
  if (
    !id || !date || customerName === undefined || grandTotal === undefined ||
    !status || !SALES_ORDER_STATUSES.has(status) || deliveryDate === undefined ||
    delivered === undefined || deliveredNumber === undefined || deliveredNumber > 100 ||
    (source.source_quotation !== null && sourceQuotation === undefined)
  ) return null;
  const result: ProjectedSalesOrderListRow = {
    id,
    date,
    customer_name: customerName,
    grand_total: grandTotal,
    status,
    delivery_date: deliveryDate,
    per_delivered: delivered,
  };
  if (sourceQuotation) result.source_quotation = sourceQuotation;
  return result;
}

export interface ProjectedClientListResponse {
  data: ProjectedClientRow[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

function projectPagination(value: unknown): ProjectedClientListResponse['pagination'] | null {
  const source = asRecord(value);
  if (!source) return null;
  const page = source.page;
  const limit = source.limit;
  const total = readSafeCount(source.total);
  const totalPages = readSafeCount(source.total_pages);
  if (
    typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1 ||
    typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 ||
    total === undefined || totalPages === undefined
  ) return null;
  return { page, limit, total, total_pages: totalPages };
}

export function projectClientListResponse(value: unknown): ProjectedClientListResponse | null {
  const source = asRecord(value);
  if (!source || !Array.isArray(source.data)) return null;
  const pagination = projectPagination(source.pagination);
  const rows = source.data.map(projectClientRow);
  if (!pagination || rows.some((row): row is null => row === null)) return null;
  return { data: rows as ProjectedClientRow[], pagination };
}

export function projectProductListRow(value: unknown): ProjectedProductListRow | null {
  const source = asRecord(value);
  if (!source) return null;
  const sku = readAlias(source, ['sku', 'item_code'], readIdentifier);
  const name = readAlias(source, ['nome', 'item_name'], readIdentifier);
  const pricingAvailable = readBoolean(source.pricing_available);
  const active = readBoolean(source.ativo);
  if (!sku || !name) return null;
  if (source.pricing_available !== undefined && pricingAvailable === undefined) return null;
  if (source.ativo !== undefined && active === undefined) return null;
  const result: ProjectedProductListRow = { sku, nome: name };
  if (pricingAvailable !== undefined) result.pricing_available = pricingAvailable;
  if (active !== undefined) result.ativo = active;
  const optionalStrings: Array<keyof ProjectedProductListRow> = [
    'item_code', 'item_name', 'descricao', 'unidade', 'stock_uom',
  ];
  for (const key of optionalStrings) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const field = source[key];
    if (field !== null && typeof field !== 'string') return null;
    if (typeof field === 'string') result[key] = field as never;
  }
  if (Object.prototype.hasOwnProperty.call(source, 'preco_minimo')) {
    if (source.preco_minimo !== null) {
      const minimum = readMoney(source.preco_minimo);
      if (minimum === undefined) return null;
      result.preco_minimo = minimum;
    }
  }
  return result;
}

export interface ProjectedProductListResponse {
  data: ProjectedProductListRow[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

export function projectProductListResponse(value: unknown): ProjectedProductListResponse | null {
  const source = asRecord(value);
  if (!source || !Array.isArray(source.data)) return null;
  const pagination = projectPagination(source.pagination);
  const rows = source.data.map(projectProductListRow);
  if (!pagination || rows.some((row): row is null => row === null)) return null;
  return { data: rows as ProjectedProductListRow[], pagination };
}

export function projectDashboardData(value: unknown): ProjectedDashboardData | null {
  const source = asRecord(value);
  if (!source || source.success !== true) return null;
  const periodSource = asRecord(source.period);
  const periodLabel = readIdentifier(periodSource?.label);
  const periodFrom = readDate(periodSource?.from);
  const periodTo = readDate(periodSource?.to);
  const summarySource = asRecord(source.summary);
  if (!periodSource || !periodLabel || !periodFrom || !periodTo || !summarySource) return null;

  const summary: ProjectedDashboardSummary = {
    total_revenue: readNonnegativeNumber(summarySource.total_revenue)!,
    orders_count: readSafeCount(summarySource.orders_count)!,
    avg_ticket: readNonnegativeNumber(summarySource.avg_ticket)!,
    open_orders: readSafeCount(summarySource.open_orders)!,
    conversion_rate: readNonnegativeNumber(summarySource.conversion_rate)!,
    revenue_delta: readSignedNumber(summarySource.revenue_delta)!,
    orders_delta: readSignedNumber(summarySource.orders_delta)!,
    avg_ticket_delta: readSignedNumber(summarySource.avg_ticket_delta)!,
    conversion_delta: readSignedNumber(summarySource.conversion_delta)!,
  };
  if (
    summary.total_revenue === undefined || summary.orders_count === undefined ||
    summary.avg_ticket === undefined || summary.open_orders === undefined ||
    summary.conversion_rate === undefined || summary.conversion_rate > 1 ||
    summary.revenue_delta === undefined || summary.orders_delta === undefined ||
    summary.avg_ticket_delta === undefined || summary.conversion_delta === undefined
  ) return null;

  const topProductsSource = source.top_products;
  const topCustomersSource = source.top_customers;
  const salesByDaySource = source.sales_by_day;
  const staleQuotationsSource = source.stale_quotations;
  if (
    !Array.isArray(topProductsSource) || !Array.isArray(topCustomersSource) ||
    !Array.isArray(salesByDaySource) || !Array.isArray(staleQuotationsSource)
  ) return null;

  const topProducts = topProductsSource.map((value): ProjectedDashboardData['top_products'][number] | null => {
    const row = asRecord(value);
    const sku = readIdentifier(row?.sku);
    const product = readIdentifier(row?.product);
    const quantity = readNonnegativeNumber(row?.quantity);
    const revenue = readNonnegativeNumber(row?.revenue);
    const orders = readSafeCount(row?.orders);
    if (!sku || !product || quantity === undefined || revenue === undefined || orders === undefined) return null;
    return { sku, product, quantity, revenue, orders };
  });
  const topCustomers = topCustomersSource.map((value): ProjectedDashboardData['top_customers'][number] | null => {
    const row = asRecord(value);
    const name = readIdentifier(row?.name);
    const revenue = readNonnegativeNumber(row?.revenue);
    const orders = readSafeCount(row?.orders);
    if (!name || revenue === undefined || orders === undefined) return null;
    return { name, revenue, orders };
  });
  const salesByDay = salesByDaySource.map((value): ProjectedDashboardData['sales_by_day'][number] | null => {
    const row = asRecord(value);
    const date = readDate(row?.date);
    const revenue = readNonnegativeNumber(row?.revenue);
    const orders = readSafeCount(row?.orders);
    if (!date || revenue === undefined || orders === undefined) return null;
    return { date, revenue, orders };
  });
  const staleQuotations = staleQuotationsSource.map((value): ProjectedDashboardData['stale_quotations'][number] | null => {
    const row = asRecord(value);
    const id = readIdentifier(row?.id);
    const customer = readIdentifier(row?.customer);
    const age = readSafeCount(row?.age);
    const amount = readNonnegativeNumber(row?.value);
    const status = readIdentifier(row?.status);
    if (!id || !customer || age === undefined || amount === undefined || !status) return null;
    return { id, customer, age, value: amount, status };
  });
  if (
    topProducts.some((row): row is null => row === null) ||
    topCustomers.some((row): row is null => row === null) ||
    salesByDay.some((row): row is null => row === null) ||
    staleQuotations.some((row): row is null => row === null)
  ) return null;
  return {
    period: { label: periodLabel, from: periodFrom, to: periodTo },
    summary,
    top_products: topProducts as ProjectedDashboardData['top_products'],
    top_customers: topCustomers as ProjectedDashboardData['top_customers'],
    sales_by_day: salesByDay as ProjectedDashboardData['sales_by_day'],
    stale_quotations: staleQuotations as ProjectedDashboardData['stale_quotations'],
  };
}
