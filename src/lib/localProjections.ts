import type { QuotationSectionsSnapshot } from '@/features/quotations/components/QuotationSectionsEditor';
import type { Product } from '@/types/domain';
import { projectQuotationOrigin, type QuotationOriginView } from '../features/quotations/quotationOrigin.ts';
import { DEFAULT_PRODUCTION_DAYS, isProductionDays, isSurchargePercent } from './productionDeadline.ts';
import type {
  CanonicalQuotationDetail,
  CanonicalQuotationListRow,
  CanonicalQuotationRevisionEntry,
  QuotationStatus,
} from '@/types/quotation-contract';

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
  empresa?: string | null;
  email?: string | null;
  telefone?: string | null;
  municipio?: string | null;
  uf?: string | null;
  documento?: string | null;
  arquivado?: boolean;
  status?: 'active' | 'archived' | string;
}

export interface ProjectedClientOrder {
  name: string;
  status?: string;
  date?: string;
  grand_total?: number | string;
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
  orders?: ProjectedClientOrder[];
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

export interface ProjectedQuotationListRow extends CanonicalQuotationListRow {
  /** Timestamp do último e-mail, ainda lido do payload raiz até virar contrato canônico (#126). */
  emailSentAt?: string | null;
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
  /** Prazo final de produção; ausente até a arte ser aprovada. */
  deadline?: string;
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

/** Entrada do histórico com extras de template ainda transportados fora do contrato canônico (#124). */
export interface ProjectedQuotationRevisionHistoryEntry extends CanonicalQuotationRevisionEntry {
  templateKey?: string | null;
  templateVersion?: number | null;
  /** Data de validade da revisão; ainda lida do payload raiz até virar canônica (#126). */
  validade?: string;
}

/** Cliente embutido para pré-preencher e-mail/telefone na edição. */
interface EmbeddedClientSnapshot {
  id: string;
  nome: string;
  email?: string | null;
  telefone?: string | null;
}

export interface ProjectedQuotationData extends
    Omit<CanonicalQuotationDetail, 'items' | 'revisionHistory'> {
  clienteSnapshot?: EmbeddedClientSnapshot;
  revisionHistory: ProjectedQuotationRevisionHistoryEntry[];
  /** Extras de template ainda fora do contrato canônico (#126). */
  templateVersionId?: string | null;
  templateVersion?: number | null;
  /** Campos derivados de e-mail/telefone para conveniência da página de detalhe. */
  email?: string;
  telefone?: string;
  /** Bridge de itens para o editor — permanece no shape legado (#125 batch 2). */
  items: ProjectedQuotationItem[];
  secoes?: QuotationSectionsSnapshot | null;
  quotationOrigin?: QuotationOriginView;
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

function readSafeCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
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

function projectClientOrder(value: unknown): ProjectedClientOrder | null {
  const source = asRecord(value);
  const name = readString(source?.name);
  if (!source || !name) return null;
  const result: ProjectedClientOrder = { name };
  const status = readString(source.status);
  const date = readString(source.date);
  const grandTotal = readNumberOrString(source.grand_total);
  if (status !== undefined) result.status = status;
  if (date !== undefined) result.date = date;
  if (grandTotal !== undefined) result.grand_total = grandTotal;
  return result;
}

export function projectClientRow(value: unknown): ProjectedClientRow | null {
  const source = asRecord(value);
  const id = readIdentifier(source?.id);
  const nome = readIdentifier(source?.nome);
  if (!source || !id || !nome) return null;
  const result: ProjectedClientRow = { id, nome };
  const empresa = readNullableString(source.empresa);
  const email = readNullableString(source.email);
  const telefone = readNullableString(source.telefone);
  const municipio = readNullableString(source.municipio);
  const uf = readNullableString(source.uf);
  const documento = readNullableString(source.documento);
  const arquivado = readBoolean(source.arquivado);
  const status = readString(source.status);
  if (source.empresa !== undefined && empresa === undefined) return null;
  if (source.email !== undefined && email === undefined) return null;
  if (source.telefone !== undefined && telefone === undefined) return null;
  if (source.municipio !== undefined && municipio === undefined) return null;
  if (source.uf !== undefined && uf === undefined) return null;
  if (source.documento !== undefined && documento === undefined) return null;
  if (source.arquivado !== undefined && arquivado === undefined) return null;
  if (source.status !== undefined && status === undefined) return null;
  if (empresa !== undefined) result.empresa = empresa;
  if (email !== undefined) result.email = email;
  if (telefone !== undefined) result.telefone = telefone;
  if (municipio !== undefined) result.municipio = municipio;
  if (uf !== undefined) result.uf = uf;
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
  const orders = Array.isArray(source.orders)
    ? source.orders.map(projectClientOrder).filter((order): order is ProjectedClientOrder => order !== null)
    : undefined;
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
  if (orders) result.orders = orders;
  if (creation !== undefined) result.creation = creation;
  if (modified !== undefined) result.modified = modified;
  if (qualityFlags) result.quality_flags = qualityFlags;
  return result;
}

function projectSectionSetting(
  value: unknown,
  requiresBody: boolean,
  allowsValue = false
): RecordValue | null {
  const source = asRecord(value);
  if (!source || typeof source.enabled !== 'boolean') return null;
  if (typeof source.title !== 'string' || !source.title.trim()) return null;
  const allowed = requiresBody
    ? ['enabled', 'title', 'body']
    : allowsValue
      ? ['enabled', 'title', 'value']
      : ['enabled', 'title'];
  if (Object.keys(source).some((key) => !allowed.includes(key))) return null;
  const result: RecordValue = { enabled: source.enabled, title: source.title };
  if (allowsValue && source.value !== undefined) {
    if (typeof source.value !== 'string' || source.value.length > 500) return null;
    result.value = source.value;
  }
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
    const base = projectSectionSetting(
      section?.base,
      key !== 'prazo_producao',
      key === 'prazo_producao'
    );
    const current = projectSectionSetting(
      section?.current,
      key !== 'prazo_producao',
      key === 'prazo_producao'
    );
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

function parseTemplateExtras(source: RecordValue | null): Partial<Pick<ProjectedQuotationRevisionHistoryEntry, 'templateKey' | 'templateVersion' | 'validade'>> {
  if (!source) return {};
  const result: Partial<Pick<ProjectedQuotationRevisionHistoryEntry, 'templateKey' | 'templateVersion' | 'validade'>> = {};
  const templateKey = source.template_key === null ? null : readIdentifier(source.template_key);
  if (templateKey !== undefined) result.templateKey = templateKey;
  if (Object.prototype.hasOwnProperty.call(source, 'template_version')) {
    const version = source.template_version === null ? null : readPositiveVersion(source.template_version);
    if (version !== undefined) result.templateVersion = version;
  }
  const validade = readDate(source.validity_date ?? source.validade);
  if (validade !== undefined) result.validade = validade;
  return result;
}

function projectRevisionHistory(
  canonicalEntries: unknown,
  legacyExtras: unknown,
): ProjectedQuotationRevisionHistoryEntry[] | null {
  if (!Array.isArray(canonicalEntries)) return null;
  const extrasSource = Array.isArray(legacyExtras) ? legacyExtras : [];
  const entries: ProjectedQuotationRevisionHistoryEntry[] = [];
  for (let index = 0; index < canonicalEntries.length; index += 1) {
    const entry = asRecord(canonicalEntries[index]);
    if (!entry) return null;
    const revisionId = readIdentifier(entry.revisionId);
    const revision = readPositiveVersion(entry.revision);
    const createdAt = readDate(entry.createdAt);
    const validadeDias = readPositiveVersion(entry.validadeDias);
    const subtotal = readMoney(entry.subtotal);
    const total = readMoney(entry.total);
    const statusRaw = readString(entry.status) as QuotationStatus | undefined;
    const expired = readBoolean(entry.expired);
    if (
      !revisionId || !revision || !createdAt || validadeDias === undefined ||
      subtotal === undefined || total === undefined || expired === undefined ||
      !statusRaw || !QUOTATION_STATUSES.has(statusRaw)
    ) return null;
    entries.push({
      ...parseTemplateExtras(asRecord(extrasSource[index])),
      revisionId,
      revision,
      createdAt,
      validadeDias,
      subtotal: String(subtotal),
      total: String(total),
      status: statusRaw,
      expired,
    });
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

function parseEmbeddedClientSnapshot(source: RecordValue): EmbeddedClientSnapshot | null {
  const row = projectClientRow(source);
  if (!row || !row.nome) return null;
  return {
    id: row.id,
    nome: row.nome,
    ...(row.email === undefined ? {} : { email: row.email }),
    ...(row.telefone === undefined ? {} : { telefone: row.telefone }),
  };
}

/** Data/hora ISO de atualização; aceita datetime completo. */
function readUpdatedAt(value: unknown): string | undefined {
  return readDate(value);
}

export function projectQuotationDetail(value: unknown): ProjectedQuotationDetail | null {
  const source = asRecord(value);
  if (!source) return null;
  const canonical = asRecord(source.canonical);
  if (!canonical) return null;
  const id = readIdentifier(canonical.id);
  const businessNumber = readIdentifier(canonical.businessNumber);
  const name = readIdentifier(canonical.name);
  const revisionId = readIdentifier(canonical.revisionId);
  const revision = readPositiveVersion(canonical.revision);
  const statusRaw = readString(canonical.status) as QuotationStatus | undefined;
  const clienteId = readIdentifier(canonical.clienteId);
  const cliente = readIdentifier(canonical.cliente);
  const dataDate = readDate(canonical.data);
  const validade = readDate(canonical.validade);
  const validadeDias = readPositiveVersion(canonical.validadeDias);
  const subtotal = readMoney(canonical.subtotal);
  const total = readMoney(canonical.total);
  const frete = readMoney(canonical.frete);
  const expired = readBoolean(canonical.expired);
  const concurrencyToken = readIdentifier(canonical.concurrencyToken);
  const updatedAt = readUpdatedAt(canonical.updatedAt);
  const emailSent = readBoolean(canonical.emailSent) ?? false;
  const emailSentAt = canonical.emailSentAt === null || canonical.emailSentAt === undefined
    ? null
    : readDate(canonical.emailSentAt) || null;
  const clienteSnapshotSource = asRecord(source.cliente_snapshot);
  const clienteSnapshot = clienteSnapshotSource ? parseEmbeddedClientSnapshot(clienteSnapshotSource) : null;
  const email = clienteSnapshot?.email || undefined;
  const telefone = clienteSnapshot?.telefone || undefined;
  const sectionsValue = Object.prototype.hasOwnProperty.call(source, 'secoes')
    ? source.secoes
    : source.sections_snapshot;
  const sections = projectQuotationSections(sectionsValue);
  const items = Array.isArray(source.items)
    ? source.items.map(projectQuotationItem)
    : null;
  const templateKey = readIdentifier(canonical.templateKey);
  const templateHash = readString(canonical.templateHash);
  const templateVersionId = readNullableString(source.template_version_id);
  const hasTemplateVersion = Object.prototype.hasOwnProperty.call(source, 'template_version');
  const templateVersion = hasTemplateVersion && source.template_version !== null
    ? readPositiveVersion(source.template_version)
    : (hasTemplateVersion ? null : undefined);
  const quotationOrigin = projectQuotationOrigin(source.quotation_origin);
  if (
    !id || !businessNumber || !name ||
    revision === undefined || !statusRaw || !QUOTATION_STATUSES.has(statusRaw) ||
    !revisionId || !clienteId || !cliente || !dataDate || !validade || validadeDias === undefined ||
    subtotal === undefined || total === undefined || frete === undefined || expired === undefined ||
    !clienteSnapshot || !sections || !items || items.some((item) => item === null) ||
    typeof canonical.pagamento !== 'string' || typeof canonical.entrega !== 'string' ||
    typeof canonical.observacoes !== 'string' || typeof canonical.prazoProducao !== 'string' ||
    !templateKey || !templateHash || !/^[0-9a-f]{64}$/i.test(templateHash) ||
    (source.template_version_id !== null && templateVersionId === undefined) ||
    !concurrencyToken || !updatedAt
  ) return null;

  const projectedRevisionHistory = Object.prototype.hasOwnProperty.call(canonical, 'revisionHistory')
    ? projectRevisionHistory(canonical.revisionHistory, source.revision_history)
    : [];
  if (projectedRevisionHistory === null) return null;

  const data: ProjectedQuotationData = {
    id,
    businessNumber,
    name,
    revisionId,
    revision: revision!,
    status: statusRaw!,
    clienteId,
    cliente,
    ...(clienteSnapshot ? { clienteSnapshot } : {}),
    ...(email === undefined ? {} : { email }),
    ...(telefone === undefined ? {} : { telefone }),
    email,
    telefone,
    data: dataDate,
    validade,
    validadeDias,
    subtotal: String(subtotal),
    total: String(total),
    frete: String(frete),
    expired,
    updatedAt: updatedAt!,
    emailSent,
    emailSentAt,
    pagamento: canonical.pagamento as string,
    entrega: canonical.entrega as string,
    observacoes: canonical.observacoes as string,
    prazoProducao: canonical.prazoProducao as string,
    prazoProducaoDias: isProductionDays(canonical.prazoProducaoDias) ? canonical.prazoProducaoDias : DEFAULT_PRODUCTION_DAYS,
    acrescimoPercent: isSurchargePercent(canonical.acrescimoPercent) ? canonical.acrescimoPercent : 0,
    templateKey,
    templateHash,
    ...(templateVersionId === undefined ? {} : { templateVersionId: templateVersionId }),
    ...(hasTemplateVersion ? { templateVersion: templateVersion! } : {}),
    concurrencyToken: concurrencyToken!,
    secoes: sections,
    items: items as ProjectedQuotationItem[],
    revisionHistory: Object.prototype.hasOwnProperty.call(canonical, 'revisionHistory') ? projectedRevisionHistory : [],
    ...(quotationOrigin ? { quotationOrigin } : {}),
  };
  return { data, concurrencyToken: concurrencyToken! };
}

export function projectQuotationListRow(value: unknown): ProjectedQuotationListRow | null {
  const source = asRecord(value);
  if (!source) return null;
  const canonical = asRecord(source.canonical);
  if (!canonical) return null;
  const id = readIdentifier(canonical.id);
  const businessNumber = readIdentifier(canonical.businessNumber);
  const name = readIdentifier(canonical.name);
  const revisionId = readIdentifier(canonical.revisionId);
  const revision = readPositiveVersion(canonical.revision);
  const statusRaw = readString(canonical.status) as QuotationStatus | undefined;
  const clienteId = readIdentifier(canonical.clienteId);
  const cliente = readIdentifier(canonical.cliente);
  const dataDate = readDate(canonical.data);
  const validade = readDate(canonical.validade);
  const validadeDias = readPositiveVersion(canonical.validadeDias);
  const subtotal = readMoney(canonical.subtotal);
  const total = readMoney(canonical.total);
  const frete = readMoney(canonical.frete);
  const expired = readBoolean(canonical.expired);
  const concurrencyToken = readIdentifier(canonical.concurrencyToken);
  const updatedAt = readUpdatedAt(canonical.updatedAt);
  const emailSent = readBoolean(canonical.emailSent) ?? false;
  const emailSentAt = source.email_sent_at === null || source.email_sent_at === undefined
    ? null
    : readDate(source.email_sent_at) || null;
  if (
    !id || !businessNumber || !name || !dataDate || !cliente || !clienteId ||
    revision === undefined || !statusRaw || !QUOTATION_STATUSES.has(statusRaw) || !revisionId ||
    validade === undefined || validadeDias === undefined ||
    subtotal === undefined || total === undefined || frete === undefined ||
    expired === undefined || !concurrencyToken || !updatedAt
  ) return null;
  return {
    id,
    businessNumber,
    name,
    revisionId,
    revision,
    status: statusRaw!,
    clienteId,
    cliente,
    data: dataDate,
    validade,
    validadeDias,
    subtotal: String(subtotal),
    total: String(total),
    frete: String(frete),
    expired,
    concurrencyToken,
    updatedAt: updatedAt!,
    emailSent,
    emailSentAt,
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
  const production = asRecord(source.production);
  if (typeof production?.deadline === 'string' && production.deadline) {
    result.deadline = production.deadline;
  }
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
