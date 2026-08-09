import { createHash } from 'node:crypto';

import {
  normalizeClientAddress,
  normalizeClientDocument,
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientNotes,
  normalizeClientPhone,
  type ClientAddress,
} from '../client-schema.js';
import { normalizeProductPricing, type PricingTierInput } from '../pricing-core.js';
export type { PricingTierInput } from '../pricing-core.js';
import { QUOTATION_PDF_MIME_TYPE } from './quotation-document-storage.js';
import { ERPNEXT_BASE } from './erpnext.js';

/** Values intentionally mirror the report vocabulary used by the CLI. */
export const IMPORT_STATUSES = [
  'lidos',
  'criados',
  'atualizados',
  'ignorados',
  'aprovadas',
  'divergentes',
  'erros',
  'estimativa_volume',
] as const;

export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export type SourceRecord = Record<string, unknown>;

export interface FrappeLineageEntry {
  /** Contract provider. Migration entries are sourced from Frappe. */
  provider: 'frappe';
  sourceDoctype: string;
  sourceId: string;
  entityType: 'produto' | 'faixa' | 'cliente' | 'orcamento';
  /** Stable local identity. `localKey` remains for pre-Task-4 callers. */
  localId: string;
  localKey: string;
  canonicalHash: string;
  /** Contract content fingerprint persisted as `source_hash`. */
  sourceHash: string;
  /** Denormalized business number (ORC-YYYYNNNN), null for non-quotations. */
  businessNumber: string | null;
  migrationRunId: string | null;
  /** Original source timestamp, or null when Frappe provided none. */
  sourceUpdatedAt: Date | null;
  importedAt: Date | null;
}

export interface NormalizedProduct {
  sourceDoctype: 'Item';
  sourceId: string;
  sourceUpdatedAt: Date | null;
  sku: string;
  legacyId: string;
  nome: string;
  descricao: string;
  unidade: string;
  categoria: string | null;
  marca: string | null;
  ativo: boolean;
  precoBase: string | null;
  precos: PricingTierInput[];
  source: SourceRecord;
}

export interface NormalizedPriceDocument {
  sourceDoctype: 'Pricing Rule' | 'Item Price';
  sourceId: string;
  sourceUpdatedAt: Date | null;
  sku: string;
  minimumQuantity: string;
  unitPrice: string;
  isBase: boolean;
  source: SourceRecord;
}

export interface NormalizedClient {
  sourceDoctype: 'Customer' | 'Lead';
  sourceId: string;
  sourceUpdatedAt: Date | null;
  localKey: string;
  nome: string;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  notes: string | null;
  address: ClientAddress | null;
  links: string[];
  source: SourceRecord;
}

export interface ProductUnit {
  product: NormalizedProduct;
  pricing: { preco_base: string | null; precos: PricingTierInput[] };
  lineage: FrappeLineageEntry[];
  divergences: string[];
}

export interface ClientUnit {
  client: NormalizedClient;
  members: NormalizedClient[];
  lineage: FrappeLineageEntry[];
  conflicts: string[];
}

export type QuotationStatus = 'rascunho' | 'enviado' | 'aprovado' | 'perdido';

/** One row of the `items` child table of a Frappe Quotation. */
export interface NormalizedQuotationItem {
  position: number;
  sku: string;
  nome: string;
  quantidade: string;
  unidade: string;
  precoSugerido: string | null;
  precoAplicado: string | null;
  totalLinha: string | null;
  notas: string | null;
  source: SourceRecord;
}

export interface QuotationTerms {
  validadeDias: number;
  pagamento: string | null;
  entrega: string | null;
  frete: string | null;
  observacoes: string | null;
}

export interface NormalizedQuotation {
  sourceDoctype: 'Quotation';
  sourceId: string;
  sourceUpdatedAt: Date | null;
  businessNumber: string;
  year: number;
  /** `Customer:<id>` or `Lead:<id>` reference used to resolve the local client. */
  clientRef: string | null;
  clientId: string | null;
  status: QuotationStatus;
  /** Raw legacy status text (e.g. `Submitted`) or empty when only docstatus was available. */
  statusSource: string;
  statusKnown: boolean;
  orderLinkage: 'ordered' | 'completed' | 'closed' | null;
  orderPending: boolean;
  createdAt: string;
  modifiedAt: string;
  items: NormalizedQuotationItem[];
  terms: QuotationTerms;
  subtotal: string | null;
  total: string | null;
  source: SourceRecord;
}

export interface IssuedDocumentUnit {
  id: string;
  kind: 'historical_pdf_import';
  blobPathname: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  templateKey: string;
  templateHash: string;
}

export interface QuotationItemUnit {
  id: string;
  position: number;
  productSku: string;
  produtoSku: string;
  produtoNome: string;
  produtoDescricao: string;
  produtoUnidade: string;
  produtoCategoria: string | null;
  produtoMarca: string | null;
  quantidade: string;
  precoFonte: string;
  precoMinimoFaixa: string | null;
  precoSugerido: string;
  precoAplicado: string;
  diferencaPreco: string;
  totalLinha: string;
  manualRate: boolean;
  notas: string | null;
}

export interface QuotationRevisionUnit {
  id: string;
  version: number;
  status: QuotationStatus;
  /** Original Frappe status and order reconciliation markers. */
  statusOriginal?: string;
  orderLinkage?: 'ordered' | 'completed' | 'closed' | null;
  orderPending?: boolean;
  validadeDias: number;
  pagamento: string;
  entrega: string;
  fretePadrao: string;
  frete: string;
  observacoes: string;
  prazoProducao: string;
  templatePadrao: string;
  templateHash: string;
  clienteNome: string;
  clienteDocumento: string | null;
  clienteEmail: string | null;
  clienteTelefone: string | null;
  clienteEndereco: string | null;
  clienteNumero: string | null;
  clienteBairro: string | null;
  clienteComplemento: string | null;
  clienteMunicipio: string | null;
  clienteUf: string | null;
  clienteCep: string | null;
  clienteNotas: string | null;
  subtotal: string;
  total: string;
  createdAt: Date;
}

export interface QuotationUnit {
  id: string;
  revision: QuotationRevisionUnit;
  quotation: NormalizedQuotation;
  items: QuotationItemUnit[];
  document: IssuedDocumentUnit | null;
  lineage: FrappeLineageEntry[];
  /** Source hash of the complete quotation payload, including metadata. */
  sourceHash: string;
}

export interface QuotationBuildContext {
  clients: ExistingClient[];
  products: ExistingProduct[];
}

export interface ExistingProduct {
  sku: string;
  nome: string;
  descricao?: string | null;
  unidade?: string | null;
  categoria?: string | null;
  marca?: string | null;
  ativo?: boolean;
  precoBase?: string | null;
  precos?: PricingTierInput[];
}

export interface ExistingClient {
  id: string;
  nome: string;
  documento?: string | null;
  email?: string | null;
  telefone?: string | null;
  notes?: string | null;
  address?: ClientAddress | null;
}

export type LineageVerificationStatus = 'verified' | 'legacy-unverified';

export interface ExistingLineage {
  provider: string;
  sourceDoctype: string;
  sourceId: string;
  entityType: string;
  localId: string;
  localKey: string;
  canonicalHash: string;
  /** Null for historical rows that predate source-payload hashing. */
  sourceHash: string | null;
  businessNumber: string | null;
  migrationRunId: string | null;
  sourceUpdatedAt: Date | null;
  importedAt: Date | null;
  /** Historical rows remain auditable but unverified until re-imported. */
  lineageStatus?: LineageVerificationStatus;
  // legacyPayload intentionally excluded from the read-side interface.
  // Raw Frappe payloads are only accessible through an internal repository boundary.
}

export interface ImportDetail {
  status: Exclude<ImportStatus, 'lidos' | 'estimativa_volume' | 'aprovadas'>;
  aprovada?: boolean;
  source_doctype?: string;
  source_id?: string;
  local_key?: string;
  mensagem: string;
}

export interface EntityReport {
  lidos: number;
  criados: number;
  atualizados: number;
  ignorados: number;
  aprovadas: number;
  divergentes: number;
  erros: number;
  estimativa_volume: number;
  detalhes: ImportDetail[];
}

export interface ImportReport {
  modo: 'dry-run' | 'apply';
  dry_run: boolean;
  produtos: EntityReport;
  faixas: EntityReport;
  clientes: EntityReport;
  orcamentos: EntityReport;
  /** Historical PDF archival: placeholders replaced by real Vercel Blob uploads. */
  documentos: EntityReport;
  total: EntityReport;
  /** English/structural aliases make the report convenient for integrations. */
  entities: {
    produtos: EntityReport;
    faixas: EntityReport;
    clientes: EntityReport;
    orcamentos: EntityReport;
    documentos: EntityReport;
  };
}

export interface FrappeDataset {
  items: SourceRecord[];
  pricingRules?: SourceRecord[];
  itemPrices?: SourceRecord[];
  customers?: SourceRecord[];
  leads?: SourceRecord[];
  quotations?: SourceRecord[];
}

export interface NormalizedDataset {
  products: NormalizedProduct[];
  priceDocuments: NormalizedPriceDocument[];
  clients: NormalizedClient[];
  productUnits: ProductUnit[];
  clientUnits: ClientUnit[];
}

const DATASET_ARRAY_FIELDS = [
  'pricingRules',
  'itemPrices',
  'customers',
  'leads',
  'quotations',
] as const;

/**
 * Validate the runtime boundary before any normalization or persistence. An
 * empty ERP dataset is valid only when it explicitly contains `items: []`;
 * silently treating a malformed fixture/module as an empty import would be
 * operationally unsafe.
 */
export function validateFrappeDataset(value: unknown): asserts value is FrappeDataset {
  if (!isRecord(value)) throw new Error('Dataset Frappe inválido: informe um objeto.');
  if (!Array.isArray(value.items))
    throw new Error('Dataset Frappe inválido: items deve ser uma lista.');
  for (const field of DATASET_ARRAY_FIELDS) {
    if (value[field] !== undefined && !Array.isArray(value[field])) {
      throw new Error(`Dataset Frappe inválido: ${field} deve ser uma lista.`);
    }
  }
  const fields = ['items', ...DATASET_ARRAY_FIELDS] as const;
  for (const field of fields) {
    const rows = value[field];
    if (!Array.isArray(rows)) continue;
    for (let index = 0; index < rows.length; index += 1) {
      if (!isRecord(rows[index])) {
        throw new Error(`Dataset Frappe inválido: ${field}[${index}] deve ser um registro.`);
      }
    }
  }
}

function isRecord(value: unknown): value is SourceRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deterministic RFC 4122 version-5-layout UUID for one source identity.  The
 * migration idempotency contract depends on these values: a rerun over the
 * same source data must reproduce the exact same local identifiers.
 */
export function stableId(kind: string, sourceId: string): string {
  const digest = createHash('sha256').update(`aspen-migration:${kind}:${sourceId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result || null;
}

function first(record: SourceRecord, keys: string[], fallback: unknown = ''): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && text(value) !== '') return value;
  }
  return fallback;
}

export function sourceIdOf(record: SourceRecord): string {
  return text(first(record, ['name', 'id', 'source_id', 'sourceId']));
}

/** Preserve Frappe's last-modified timestamp when present; absent/invalid
 * source metadata is represented explicitly as null in lineage. */
function sourceUpdatedAtOf(record: SourceRecord): Date | null {
  const value = first(
    record,
    [
      'modified',
      'modified_at',
      'updated',
      'updated_at',
      'last_modified',
      'lastModified',
      'source_updated_at',
      'sourceUpdatedAt',
    ],
    null
  );
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const textValue = text(value);
  if (!textValue) return null;
  const frappeTimestamp =
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(textValue)
      ? `${textValue.replace(' ', 'T')}Z`
      : textValue;
  const parsed = new Date(frappeTimestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function cloneRecord(record: SourceRecord): SourceRecord {
  // Structured clone is unavailable in older Node versions used by local
  // scripts; JSON is sufficient for sanitized Frappe payloads and strips
  // accidental prototype data before hashing/persisting.
  return JSON.parse(JSON.stringify(record)) as SourceRecord;
}

function canonicalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const child = value[key];
        if (child !== undefined) result[key] = canonicalize(child);
        return result;
      }, {});
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Centralized PII mask for report/CLI messages.  Strips formatted CPF,
 *  CNPJ and e-mail patterns so no raw PII crosses the report boundary. */
export function sanitizeReportMessage(message: string): string {
  // Formatted CPF: XXX.XXX.XXX-XX
  let result = message.replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, (m) => m.slice(0, -2) + '**');
  // Formatted CNPJ: XX.XXX.XXX/XXXX-XX
  result = result.replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, (m) => m.slice(0, -2) + '**');
  // Frappe often returns documents without punctuation in validation errors.
  result = result.replace(/(?<!\d)\d{14}(?!\d)/g, (m) => `${m.slice(0, 3)}***********`);
  result = result.replace(/(?<!\d)\d{11}(?!\d)/g, (m) => `${m.slice(0, 3)}********`);
  // E-mail addresses
  result = result.replace(/([\w.-]+)@([\w.-]+\.\w+)/g, (_, user, domain) => `${user[0]}***@${domain}`);
  return result;
}

function hashFor(entity: string, value: unknown): string {
  return canonicalHash({ entity, payload: value });
}

/** Fingerprint the source document itself, independently from normalized
 * local identity. This keeps `source_hash` useful when the source changes in
 * fields intentionally omitted from the canonical local representation. */
function sourceHashFor(source: SourceRecord): string {
  return canonicalHash(source);
}

function safeSource(record: SourceRecord): SourceRecord {
  return cloneRecord(record);
}

function itemSku(record: SourceRecord): string {
  for (const key of ['item_code', 'sku', 'codigo', 'itemCode']) {
    if (Object.prototype.hasOwnProperty.call(record, key)) return text(record[key]);
  }
  return text(record.name);
}

interface TitlePriceIdentity {
  sku: string;
  minimumQuantity: string;
}

function titlePriceIdentity(
  record: SourceRecord,
  knownSkus: string[] = []
): TitlePriceIdentity | null {
  const title = text(first(record, ['title', 'rule_title']));
  if (!title) return null;
  const exact = knownSkus.filter((sku) => sku === title);
  if (exact.length === 1) return { sku: exact[0], minimumQuantity: '1' };
  const matches = knownSkus
    .filter((sku) => title.startsWith(`${sku}-`))
    .map((sku) => ({ sku, suffix: title.slice(sku.length + 1) }))
    .filter(
      (candidate) =>
        /^\d+(?:[.,]\d+)?$/.test(candidate.suffix) && Number(candidate.suffix.replace(',', '.')) > 0
    );
  if (matches.length > 0) {
    const longest = Math.max(...matches.map((candidate) => candidate.sku.length));
    const selected = matches.filter((candidate) => candidate.sku.length === longest);
    if (selected.length !== 1) return null;
    return { sku: selected[0].sku, minimumQuantity: selected[0].suffix.replace(',', '.') };
  }
  // Fixtures and older ERP records may be imported without Items in the same
  // response. A final numeric suffix is safe only when the prefix is nonempty;
  // callers with known SKUs still get the longest-prefix disambiguation above.
  const generic = /^(.*)-(\d+(?:[.,]\d+)?)$/.exec(title);
  if (generic && generic[1].trim() && Number(generic[2].replace(',', '.')) > 0)
    return { sku: generic[1].trim(), minimumQuantity: generic[2].replace(',', '.') };
  return { sku: title, minimumQuantity: '1' };
}

function parseLegacyBoolean(value: unknown, fallback = true): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = text(value).toLowerCase();
  if (['0', 'false', 'não', 'nao', 'disabled', 'inativo'].includes(normalized)) return false;
  if (['1', 'true', 'sim', 'ativo', 'enabled'].includes(normalized)) return true;
  return fallback;
}

export function normalizeFrappeItem(record: SourceRecord): NormalizedProduct {
  const sourceId = sourceIdOf(record);
  const sku = itemSku(record);
  if (!sourceId) throw new Error('Item sem identificador legado (name).');
  if (!sku) throw new Error('Item sem SKU (item_code).');

  const nome = text(first(record, ['item_name', 'nome', 'name', 'description'], sku));
  if (!nome) throw new Error(`Item ${sourceId} sem nome.`);
  return {
    sourceDoctype: 'Item',
    sourceId,
    sourceUpdatedAt: sourceUpdatedAtOf(record),
    sku,
    legacyId: sourceId,
    nome,
    descricao: text(first(record, ['description', 'descricao'], '')),
    unidade: text(first(record, ['stock_uom', 'uom', 'unidade', 'unit'], 'Und')) || 'Und',
    categoria: nullableText(first(record, ['item_group', 'categoria', 'category'], null)),
    marca: nullableText(first(record, ['brand', 'marca'], null)),
    ativo: !parseLegacyBoolean(first(record, ['disabled', 'inativo'], false), false),
    // The legacy resolver never reads Item.standard_rate. Keep pricing
    // exclusively sourced from Pricing Rule/Item Price; an unpriced product
    // remains unpriced instead of silently changing the quote contract.
    precoBase: null,
    precos: [],
    source: safeSource(record),
  };
}

function childItems(record: SourceRecord): SourceRecord[] {
  const values = first(record, ['items', 'pricing_rules', 'item_prices'], []);
  return Array.isArray(values) ? values.filter(isRecord) : [];
}

function priceValue(record: SourceRecord): string {
  return text(first(record, ['price_list_rate', 'rate', 'unit_price', 'price', 'preco', 'valor']));
}

function minimumValue(record: SourceRecord): string {
  return text(
    first(record, ['min_qty', 'minimum_quantity', 'minimum_qty', 'qty', 'quantidade_minima'], '')
  );
}

function priceSku(record: SourceRecord): string {
  return text(first(record, ['item_code', 'sku', 'itemCode', 'product_sku']));
}

export function normalizeFrappePriceDocuments(
  records: SourceRecord[],
  doctype: 'Pricing Rule' | 'Item Price',
  knownSkus: string[] = []
): NormalizedPriceDocument[] {
  const result: NormalizedPriceDocument[] = [];
  for (const record of records) {
    const sourceId = sourceIdOf(record);
    if (!sourceId) throw new Error(`${doctype} sem identificador legado (name).`);
    if (record.__migration_enrichment_error === true)
      throw new Error(`${doctype} ${sourceId} não pôde ser enriquecido.`);
    if (
      doctype === 'Item Price' &&
      text(record.price_list) &&
      text(record.price_list).toLowerCase() !== 'standard selling'
    )
      continue;
    const titleIdentity = doctype === 'Pricing Rule' ? titlePriceIdentity(record, knownSkus) : null;
    const rows = childItems(record);
    const candidates = rows.length ? rows : [record];
    for (const child of candidates) {
      const sku = priceSku(child) || priceSku(record) || titleIdentity?.sku || '';
      const unitPrice = priceValue(child) || priceValue(record);
      if (!sku || !unitPrice) {
        throw new Error(`${doctype} ${sourceId} sem SKU ou preço.`);
      }
      const explicitMinimumQuantity = minimumValue(child) || minimumValue(record);
      // The legacy resolver queries Item Price without a quantity/min_qty
      // filter, so Standard Selling is a global fallback rather than a tiered
      // schedule. Preserve the raw min_qty in `source`, but normalize every
      // effective Item Price row to the base bracket.
      const effectiveMinimumQuantity =
        doctype === 'Item Price'
          ? '1'
          : explicitMinimumQuantity || titleIdentity?.minimumQuantity || '1';
      try {
        if (decimal(unitPrice).integer <= 0n) throw new Error('preço não positivo');
        if (decimal(effectiveMinimumQuantity).integer < 0n) throw new Error('limite negativo');
      } catch {
        throw new Error(`${doctype} ${sourceId} com preço ou limite inválido.`);
      }
      result.push({
        sourceDoctype: doctype,
        sourceId,
        sourceUpdatedAt: sourceUpdatedAtOf(record),
        sku,
        minimumQuantity: effectiveMinimumQuantity,
        unitPrice,
        isBase: effectiveMinimumQuantity === '0' || effectiveMinimumQuantity === '1',
        source: safeSource(record),
      });
    }
  }
  return result;
}

function normalizeAddress(record: SourceRecord): ClientAddress | null {
  const candidate = {
    endereco: first(record, ['address_line1', 'address', 'endereco', 'street'], null),
    numero: first(record, ['address_line2', 'numero', 'number'], null),
    bairro: first(record, ['bairro', 'neighborhood', 'district'], null),
    complemento: first(record, ['complemento', 'complement'], null),
    municipio: first(record, ['city', 'municipio', 'town'], null),
    uf: first(record, ['state', 'uf', 'province'], null),
    cep: first(record, ['pincode', 'cep', 'postal_code'], null),
  };
  if (!Object.values(candidate).some((value) => text(value))) return null;
  return normalizeClientAddress(candidate);
}

function linkedIds(
  record: SourceRecord,
  sourceDoctype: 'Customer' | 'Lead',
  sourceId: string
): string[] {
  const values = [
    // Names are display fields, not identity links. A Customer and a Lead may
    // legitimately share the same name while representing different people;
    // only Frappe's explicit cross-reference fields are safe to consolidate.
    first(record, ['customer', 'linked_customer'], null),
    first(record, ['lead', 'linked_lead'], null),
  ]
    .map(text)
    .filter(Boolean);
  const links = [`${sourceDoctype}:${sourceId}`, ...values.map((value) => `link:${value}`)];
  return [...new Set(links)].sort();
}

export function normalizeFrappeClientRecord(
  record: SourceRecord,
  sourceDoctype: 'Customer' | 'Lead'
): NormalizedClient {
  const sourceId = sourceIdOf(record);
  if (!sourceId) throw new Error(`${sourceDoctype} sem identificador legado (name).`);
  const rawName = first(
    record,
    sourceDoctype === 'Lead'
      ? ['lead_name', 'company_name', 'customer_name', 'name']
      : ['customer_name', 'name', 'nome'],
    ''
  );
  const nome = normalizeClientName(rawName);
  const documento = normalizeClientDocument(
    first(record, ['tax_id', 'cnpj', 'cpf', 'documento', 'customer_tax_id'], null)
  );
  const email = normalizeClientEmail(first(record, ['email_id', 'email', 'e_mail'], null));
  const telefone = normalizeClientPhone(
    first(record, ['mobile_no', 'phone', 'telefone', 'phone_number'], null)
  );
  const notes = normalizeClientNotes(
    first(record, ['notes', 'observacoes', 'description', 'remarks'], null)
  );
  const links = linkedIds(record, sourceDoctype, sourceId);
  const localKey = documento
    ? `documento:${documento}`
    : links.find((value) => value.startsWith('link:')) || `frappe:${sourceDoctype}:${sourceId}`;
  return {
    sourceDoctype,
    sourceId,
    sourceUpdatedAt: sourceUpdatedAtOf(record),
    localKey,
    nome,
    documento,
    email,
    telefone,
    notes,
    address: normalizeAddress(record),
    links,
    source: safeSource(record),
  };
}

export const HISTORICAL_VALIDITY_DAYS = 15;
export const HISTORICAL_TEMPLATE_KEY = 'padrao';
// The current default template content hash (schema default for quote_revisions.template_hash).
export const HISTORICAL_TEMPLATE_HASH =
  'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e';

/** Print format requested from Frappe when archiving historical PDFs. */
export const HISTORICAL_PDF_PRINT_FORMAT = 'padrao';
/** Root folder of every historical PDF blob key. */
export const HISTORICAL_PDF_BLOB_PREFIX = 'quotations-migration';

/**
 * Deterministic printview URL for one Frappe Quotation.  Purely name-based:
 * `printing_settings` is not a standard Quotation field and must never be
 * consulted here. The HTML returned by this endpoint is piped through the
 * Puppeteer pipeline (never ERPNext `download_pdf`), consistent with
 * `quotation-html.ts` and `quotation-pdf.ts`.
 */
export function historicalPdfPrintviewUrl(sourceId: string): string {
  const name = text(sourceId);
  if (!name) throw new Error('Quotation sem name; impossível construir a URL do PDF.');
  return `${ERPNEXT_BASE}/printview?doctype=Quotation&name=${encodeURIComponent(name)}&format=${encodeURIComponent(HISTORICAL_PDF_PRINT_FORMAT)}&no_letterhead=0`;
}

/**
 * PDF metadata extracted from a Frappe Quotation record at normalization
 * time.  `checksumSha256`/`sizeBytes` come from the source record when the
 * ERP exposes them (integrity hints); the authoritative checksum is always
 * computed from the downloaded bytes during archival.
 */
export interface HistoricalPdfRecord {
  sourceId: string;
  businessNumber: string;
  /** Source identity of the revision: `stableId('revision', revisionSourceId)` is the revision id. */
  revisionSourceId: string;
  fileUrl: string;
  fileName: string | null;
  mimeType: string;
  checksumSha256: string | null;
  sizeBytes: number | null;
}

/**
 * Deterministic Vercel Blob key for one historical PDF:
 * `quotations-migration/{businessNumber}/{sourceId}-{checksum}.pdf`.  The
 * business number keeps listings human-readable, the source id re-associates
 * the blob with its Frappe document on reruns, and the checksum detects
 * content changes between migrations.
 */
export function deriveHistoricalPdfBlobPath(
  businessNumber: string,
  sourceId: string,
  checksum: string
): string {
  const number = text(businessNumber);
  const id = text(sourceId);
  const hash = text(checksum).toLowerCase();
  if (!number || number.includes('/') || !id || id.includes('/') || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error('Não foi possível derivar a chave do PDF histórico.');
  }
  return `${HISTORICAL_PDF_BLOB_PREFIX}/${number}/${id}-${hash}.pdf`;
}

function historicalPdfChecksumOf(record: SourceRecord): string | null {
  const nested = isRecord(record.pdf_metadata)
    ? first(record.pdf_metadata, ['checksum_sha256', 'checksum'], null)
    : null;
  const value =
    nullableText(nested) ||
    nullableText(first(record, ['pdf_checksum_sha256', 'checksum_sha256', 'pdf_checksum'], null));
  if (!value) return null;
  const normalized = value.toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function historicalPdfSizeOf(record: SourceRecord): number | null {
  const nested = isRecord(record.pdf_metadata)
    ? first(record.pdf_metadata, ['size_bytes', 'size'], null)
    : null;
  const raw =
    text(nested) || text(first(record, ['pdf_size_bytes', 'pdf_size', 'size_bytes'], null));
  if (!raw) return null;
  const size = Number(raw);
  return Number.isInteger(size) && size >= 0 ? size : null;
}

/**
 * Extract PDF metadata from a Frappe Quotation record.  Returns `null` when
 * the record has no usable identifier (missing `name`), which makes the
 * printview URL unconstructable and the PDF unreachable.  A record with a
 * `name` but no derivable business number throws; callers report it as an
 * error/divergence without crashing the import.
 */
export function normalizeHistoricalPdf(record: SourceRecord): HistoricalPdfRecord | null {
  const sourceId = sourceIdOf(record);
  if (!sourceId) return null;
  let businessNumber: string;
  try {
    businessNumber = deriveBusinessNumber(record, sourceId).businessNumber;
  } catch (error) {
    throw new Error(`Quotation ${sourceId} sem número comercial derivável para o PDF histórico.`, {
      cause: error,
    });
  }
  return {
    sourceId,
    businessNumber,
    revisionSourceId: `${sourceId}:v1`,
    fileUrl: historicalPdfPrintviewUrl(sourceId),
    fileName: `${sourceId}.pdf`,
    mimeType: QUOTATION_PDF_MIME_TYPE,
    checksumSha256: historicalPdfChecksumOf(record),
    sizeBytes: historicalPdfSizeOf(record),
  };
}

const QUOTATION_STATUS_MAP: Record<string, QuotationStatus> = {
  draft: 'rascunho',
  submitted: 'enviado',
  open: 'enviado',
  sent: 'enviado',
  ordered: 'aprovado',
  completed: 'aprovado',
  closed: 'aprovado',
  lost: 'perdido',
  cancelled: 'perdido',
  expired: 'perdido',
};

export interface QuotationStatusInfo {
  status: QuotationStatus;
  source: string;
  known: boolean;
  orderLinkage: 'ordered' | 'completed' | 'closed' | null;
  orderPending: boolean;
}

export function mapQuotationStatus(raw: string): QuotationStatusInfo {
  const source = text(raw);
  const normalized = source.toLowerCase();
  const status = QUOTATION_STATUS_MAP[normalized];
  const orderLinkage =
    normalized === 'ordered' || normalized === 'completed' || normalized === 'closed'
      ? (normalized as 'ordered' | 'completed' | 'closed')
      : null;
  return status
    ? { status, source, known: true, orderLinkage, orderPending: orderLinkage !== null }
    : { status: 'rascunho', source, known: false, orderLinkage: null, orderPending: false };
}

function rawQuotationStatus(record: SourceRecord): string {
  const explicit = text(first(record, ['status', 'workflow_state']));
  if (explicit) return explicit;
  const docstatus = text(first(record, ['docstatus']));
  if (docstatus === '0') return 'Draft';
  if (docstatus === '1') return 'Submitted';
  if (docstatus === '2') return 'Cancelled';
  return '';
}

function yearOf(value: string): number | null {
  const match = /(?:^|\D)(20\d{2})(?:\D|$)/.exec(text(value));
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 2000 && year <= 9999 ? year : null;
}

/** Last numeric run of the legacy name, e.g. `42` from `QTN-2024-00042`. */
function nameSequence(name: string): number | null {
  const runs = text(name).match(/\d+/g);
  if (!runs) return null;
  const last = runs[runs.length - 1];
  // Handle names where year and sequence are concatenated (e.g. ORC-20261147).
  // The last digit run has 8 digits (YYYYNNNN); extract the last 4 as sequence.
  if (last.length === 8) {
    const sequence = Number(last.slice(4));
    return Number.isInteger(sequence) ? sequence : null;
  }
  const value = Number(last);
  return Number.isInteger(value) ? value : null;
}

/**
 * Map a legacy Quotation name to the local `ORC-YYYYNNNN` business number.
 * The year comes from the creation date (fallback: the year embedded in the
 * name); the four-digit sequence is preserved from the name's numeric suffix
 * so the per-year numbering counter can advance past the highest import.
 */
export function deriveBusinessNumber(
  record: SourceRecord,
  sourceId: string
): { businessNumber: string; year: number } {
  const creation = text(first(record, ['creation', 'created', 'created_on']));
  const year = yearOf(creation) ?? yearOf(sourceId);
  if (!year) throw new Error(`Quotation ${sourceId} sem ano identificável (creation/name).`);
  const sequence = nameSequence(sourceId);
  if (sequence === null) throw new Error(`Quotation ${sourceId} sem sequência numérica no nome.`);
  if (sequence > 9999) throw new Error(`Quotation ${sourceId} com sequência fora do limite anual.`);
  return { businessNumber: `ORC-${year}${String(sequence).padStart(4, '0')}`, year };
}

function resolveQuotationClient(
  record: SourceRecord,
  clientLineage: Map<string, string>
): { clientRef: string | null; clientId: string | null } {
  const partyType = text(first(record, ['quotation_to', 'party_type'])).toLowerCase();
  const partyName = text(first(record, ['party_name', 'party', 'customer_name']));
  const customer = text(first(record, ['customer', 'customer_id'])) || (partyType === 'customer' ? partyName : '');
  const lead = text(first(record, ['lead', 'lead_id'])) || (partyType === 'lead' ? partyName : '');
  let clientRef: string | null = null;
  if (partyType === 'lead' && lead) clientRef = `Lead:${lead}`;
  else if (partyType === 'customer' && customer) clientRef = `Customer:${customer}`;
  else if (customer) clientRef = `Customer:${customer}`;
  else if (lead) clientRef = `Lead:${lead}`;
  return { clientRef, clientId: clientRef ? clientLineage.get(clientRef) || null : null };
}

/**
 * Client references may embed CPF/CNPJ/e-mail when the ERP uses them as
 * source names. Reports must never echo them; keep a stable one-way token.
 */
export function reportClientRef(clientRef: string): string {
  const separator = clientRef.indexOf(':');
  const doctype = separator > 0 ? clientRef.slice(0, separator) : clientRef;
  const id = separator > 0 ? clientRef.slice(separator + 1) : '';
  if ((doctype !== 'Customer' && doctype !== 'Lead') || !id) return clientRef;
  if (/^[0-9a-f]{12}$/i.test(id)) return `${doctype}:${id.toLowerCase()}`;
  return `${doctype}:${canonicalHash(`${doctype}:${id}`).slice(0, 12)}`;
}

const APPROVABLE_SOURCE_DOCTYPES = new Set([
  'Customer',
  'Lead',
  'Item',
  'Pricing Rule',
  'Item Price',
  'Quotation',
]);

/**
 * Build the only approval-key representation accepted by reports and CLI.
 * Customer/Lead identifiers are always one-way hashed unless already carrying
 * the report's opaque cliente token.
 */
const OPAQUE_CLIENT_TOKEN = /^cliente-[0-9a-f]{12}$/i;

export function canonicalApprovalKey(sourceDoctype: string, sourceId: string): string | null {
  const doctype = text(sourceDoctype);
  const id = text(sourceId);
  if (!doctype || !id || id.includes(':') || !APPROVABLE_SOURCE_DOCTYPES.has(doctype)) return null;
  if (doctype === 'Customer' || doctype === 'Lead') {
    const token = OPAQUE_CLIENT_TOKEN.test(id)
      ? id.toLowerCase()
      : `cliente-${canonicalHash(`${doctype}:${id}`).slice(0, 12)}`;
    return `${doctype}:${token}`;
  }
  return `${doctype}:${id}`;
}

export function safeApprovalKey(key: string): string {
  const parts = String(key).split(':');
  if (parts.length !== 2) throw new Error('Chave de aprovação inválida.');
  const canonical = canonicalApprovalKey(parts[0], parts[1]);
  if (!canonical) throw new Error('Chave de aprovação inválida.');
  return canonical;
}

function parseDate(value: string | null): Date | null {
  if (!text(value)) return null;
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function quotationTerms(record: SourceRecord, creation: string): QuotationTerms {
  let validadeDias = HISTORICAL_VALIDITY_DAYS;
  const created = parseDate(creation);
  const validTill = parseDate(text(first(record, ['valid_till', 'expiry', 'validade'])));
  if (created && validTill && validTill.getTime() > created.getTime()) {
    // Compare calendar dates rather than local-midnight offsets. Frappe date
    // fields are date-only while creation is a timestamp, so timezone offsets
    // must not turn a 30-day validity into 29 days.
    const start = Date.UTC(created.getFullYear(), created.getMonth(), created.getDate());
    const end = Date.UTC(validTill.getUTCFullYear(), validTill.getUTCMonth(), validTill.getUTCDate());
    const days = Math.round((end - start) / 86_400_000);
    validadeDias = Math.min(365, Math.max(1, days));
  }
  return {
    validadeDias,
    pagamento: nullableText(
      first(record, ['payment_terms_template', 'payment_terms', 'condicao_pagamento'])
    ),
    entrega: nullableText(first(record, ['delivery_terms', 'condicao_entrega'])),
    frete: nullableText(first(record, ['shipping_amount', 'frete', 'valor_frete'])),
    observacoes: nullableText(first(record, ['terms', 'remarks', 'observacoes', 'notes'])),
  };
}

export function normalizeQuotationItem(
  record: SourceRecord,
  quotationId: string,
  index: number
): NormalizedQuotationItem {
  const sku = text(first(record, ['item_code', 'sku', 'codigo', 'itemCode']));
  if (!sku) throw new Error(`Item de ${quotationId} sem item_code.`);
  const positionValue = text(first(record, ['idx', 'position']));
  const position = positionValue && /^\d+$/.test(positionValue) ? Number(positionValue) : index + 1;
  return {
    position,
    sku,
    nome: text(first(record, ['item_name', 'nome', 'description'], sku)) || sku,
    quantidade: text(first(record, ['qty', 'quantidade'])),
    unidade: text(first(record, ['uom', 'stock_uom', 'unidade'], 'Und')) || 'Und',
    precoSugerido: text(first(record, ['price_list_rate', 'preco_sugerido'])) || null,
    precoAplicado: text(first(record, ['rate', 'preco_aplicado'])) || null,
    totalLinha: text(first(record, ['amount', 'total_linha', 'total'])) || null,
    notas: nullableText(first(record, ['notes', 'observacoes', 'item_notes'])),
    source: safeSource(record),
  };
}

export function normalizeFrappeQuotation(
  record: SourceRecord,
  clientLineage: Map<string, string>
): NormalizedQuotation {
  if (record.__migration_enrichment_error === true)
    throw new Error('Quotation não pôde ser enriquecida.');
  const sourceId = sourceIdOf(record);
  if (!sourceId) throw new Error('Quotation sem identificador legado (name).');
  const { businessNumber, year } = deriveBusinessNumber(record, sourceId);
  const statusInfo = mapQuotationStatus(rawQuotationStatus(record));
  const { clientRef, clientId } = resolveQuotationClient(record, clientLineage);
  const items = childItems(record).map((row, index) =>
    normalizeQuotationItem(row, sourceId, index)
  );
  return {
    sourceDoctype: 'Quotation',
    sourceId,
    sourceUpdatedAt: sourceUpdatedAtOf(record),
    businessNumber,
    year,
    clientRef,
    clientId,
    status: statusInfo.status,
    statusSource: statusInfo.source,
    statusKnown: statusInfo.known,
    orderLinkage: statusInfo.orderLinkage,
    orderPending: statusInfo.orderPending,
    createdAt: text(first(record, ['creation', 'created', 'created_on'])),
    modifiedAt: text(first(record, ['modified', 'updated', 'updated_on'])),
    items,
    terms: quotationTerms(record, text(first(record, ['creation', 'created', 'created_on']))),
    subtotal: text(first(record, ['net_total', 'subtotal'])) || null,
    total: text(first(record, ['grand_total', 'total'])) || null,
    source: safeSource(record),
  };
}

function moneyDifference(suggested: string, applied: string): string {
  const a = decimal(text(suggested));
  const b = decimal(text(applied));
  const scale = Math.max(a.scale, b.scale);
  const left = a.integer * 10n ** BigInt(scale - a.scale);
  const right = b.integer * 10n ** BigInt(scale - b.scale);
  const difference = left - right;
  const sign = difference < 0n ? '-' : '';
  const absolute = difference < 0n ? -difference : difference;
  const base = absolute.toString().padStart(scale + 1, '0');
  if (scale === 0) return `${sign}${base}`;
  const integer = base.slice(0, -scale) || '0';
  const fraction = base.slice(-scale).replace(/0+$/, '');
  return fraction ? `${sign}${integer}.${fraction}` : `${sign}${integer}`;
}

function validatePositiveDecimal(value: string | null, label: string): string | null {
  try {
    const parsed = decimal(text(value || ''));
    if (parsed.integer <= 0n) return `${label} não positivo (${text(value) || 'vazio'})`;
    return null;
  } catch {
    return `${label} inválido (${text(value) || 'vazio'})`;
  }
}

function validateNonNegativeDecimal(value: string | null, label: string): string | null {
  if (value === null || text(value) === '') return null;
  try {
    if (decimal(text(value)).integer < 0n) return `${label} negativo (${text(value)})`;
    return null;
  } catch {
    return `${label} inválido (${text(value)})`;
  }
}

interface QuotationClientSnapshot {
  clienteNome: string;
  clienteDocumento: string | null;
  clienteEmail: string | null;
  clienteTelefone: string | null;
  clienteEndereco: string | null;
  clienteNumero: string | null;
  clienteBairro: string | null;
  clienteComplemento: string | null;
  clienteMunicipio: string | null;
  clienteUf: string | null;
  clienteCep: string | null;
  clienteNotas: string | null;
}

function clientSnapshotOf(
  client: ExistingClient | undefined,
  fallbackNome: string
): QuotationClientSnapshot {
  return {
    clienteNome: client?.nome || fallbackNome,
    clienteDocumento: client?.documento ?? null,
    clienteEmail: client?.email ?? null,
    clienteTelefone: client?.telefone ?? null,
    clienteEndereco: client?.address?.endereco ?? null,
    clienteNumero: client?.address?.numero ?? null,
    clienteBairro: client?.address?.bairro ?? null,
    clienteComplemento: client?.address?.complemento ?? null,
    clienteMunicipio: client?.address?.municipio ?? null,
    clienteUf: client?.address?.uf ?? null,
    clienteCep: client?.address?.cep ?? null,
    clienteNotas: client?.notes ?? null,
  };
}

function buildIssuedDocumentUnit(quotation: NormalizedQuotation): IssuedDocumentUnit {
  // The PDF bytes are intentionally not downloaded (issue #15). The checksum
  // identifies the source record so a later download can verify/refresh it.
  const checksumSha256 = createHash('sha256').update(canonicalJson(quotation.source)).digest('hex');
  return {
    id: stableId('document', quotation.sourceId),
    kind: 'historical_pdf_import',
    blobPathname: `historical/${quotation.sourceId}.pdf`,
    fileName: `${quotation.sourceId}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 0,
    checksumSha256,
    templateKey: HISTORICAL_TEMPLATE_KEY,
    templateHash: HISTORICAL_TEMPLATE_HASH,
  };
}

export interface QuotationBuildResult {
  quotationUnits: QuotationUnit[];
  itemUnits: QuotationItemUnit[];
  issues: ImportDetail[];
}

/**
 * Resolve every normalized quotation into a persistable unit.  Units that
 * cannot be imported (missing client, missing/unknown items, invalid prices)
 * are reported as blocking divergences and never reach the repository.
 */
export function buildQuotationUnits(
  normalized: NormalizedQuotation[],
  knownClients: Map<string, string>,
  context: QuotationBuildContext = { clients: [], products: [] },
  knownProducts?: Set<string>
): QuotationBuildResult {
  const clientsById = new Map(context.clients.map((client) => [client.id, client]));
  const productsBySku = new Map(context.products.map((product) => [product.sku, product]));
  const quotationUnits: QuotationUnit[] = [];
  const itemUnits: QuotationItemUnit[] = [];
  const issues: ImportDetail[] = [];
  const seenBusinessNumbers = new Map<string, string>();
  const seenSourceIds = new Set<string>();
  for (const quotation of normalized) {
    const reportIssue = (mensagem: string): void => {
      issues.push({
        status: 'divergentes',
        source_doctype: 'Quotation',
        source_id: quotation.sourceId,
        local_key: quotation.businessNumber,
        mensagem,
      });
    };
    if (seenSourceIds.has(quotation.sourceId)) {
      reportIssue('Documento Frappe repetido com dados diferentes.');
      continue;
    }
    seenSourceIds.add(quotation.sourceId);
    const prior = seenBusinessNumbers.get(quotation.businessNumber);
    if (prior && prior !== quotation.sourceId) {
      reportIssue(`Número comercial ${quotation.businessNumber} duplicado no dataset (${prior}).`);
      continue;
    }
    seenBusinessNumbers.set(quotation.businessNumber, quotation.sourceId);
    if (!quotation.clientId) {
      reportIssue(
        `Cliente não localizado na linhagem (${reportClientRef(quotation.clientRef || 'referência ausente')}).`
      );
      continue;
    }
    if (quotation.clientRef) {
      const resolved = knownClients.get(quotation.clientRef);
      if (resolved && resolved !== quotation.clientId) {
        reportIssue(
          `Vínculo de cliente ${reportClientRef(quotation.clientRef)} divergente entre normalização e linhagem.`
        );
        continue;
      }
    }
    const createdAt = parseDate(quotation.createdAt);
    if (!createdAt) {
      reportIssue(
        `Data de criação inválida (${quotation.createdAt ? `"${quotation.createdAt}"` : 'vazia'}).`
      );
      continue;
    }
    if (quotation.items.length === 0) {
      reportIssue('Itens ausentes no orçamento legado.');
      continue;
    }
    const problems: string[] = [];
    if (knownProducts) {
      for (const item of quotation.items) {
        if (!knownProducts.has(item.sku)) problems.push(`item ${item.sku} fora do catálogo local`);
      }
    }
    for (const item of quotation.items) {
      const quantityProblem = validatePositiveDecimal(
        item.quantidade,
        `quantidade do item ${item.sku}`
      );
      if (quantityProblem) problems.push(quantityProblem);
      const suggestedProblem = validatePositiveDecimal(
        item.precoSugerido,
        `preço sugerido do item ${item.sku}`
      );
      if (suggestedProblem) problems.push(suggestedProblem);
      const appliedProblem = validatePositiveDecimal(
        item.precoAplicado,
        `preço aplicado do item ${item.sku}`
      );
      if (appliedProblem) problems.push(appliedProblem);
      const totalProblem = validateNonNegativeDecimal(
        item.totalLinha,
        `total da linha do item ${item.sku}`
      );
      if (totalProblem) problems.push(totalProblem);
    }
    if (problems.length > 0) {
      reportIssue(problems.join(' '));
      continue;
    }
    const id = stableId('quotation', quotation.sourceId);
    const revisionId = stableId('revision', `${quotation.sourceId}:v1`);
    const client = clientsById.get(quotation.clientId);
    const items = quotation.items.map((item) => {
      const product = productsBySku.get(item.sku);
      return {
        id: stableId('item', `${quotation.sourceId}:item:${item.position}`),
        position: item.position,
        productSku: item.sku,
        produtoSku: item.sku,
        produtoNome: product?.nome || item.nome,
        produtoDescricao: product?.descricao || '',
        produtoUnidade: product?.unidade || item.unidade,
        produtoCategoria: product?.categoria ?? null,
        produtoMarca: product?.marca ?? null,
        quantidade: canonicalDecimal(item.quantidade),
        precoFonte: 'historico',
        precoMinimoFaixa: null,
        precoSugerido: canonicalDecimal(item.precoSugerido as string),
        precoAplicado: canonicalDecimal(item.precoAplicado as string),
        diferencaPreco: moneyDifference(item.precoSugerido as string, item.precoAplicado as string),
        totalLinha: canonicalDecimal(item.totalLinha || '0'),
        manualRate: false,
        notas: item.notas,
      };
    });
    const clientSnapshot = clientSnapshotOf(client, 'Cliente sem nome');
    const revision: QuotationRevisionUnit = {
      id: revisionId,
      version: 1,
      status: quotation.status,
      statusOriginal: quotation.statusSource,
      orderLinkage: quotation.orderLinkage,
      orderPending: quotation.orderPending,
      validadeDias: quotation.terms.validadeDias,
      pagamento: quotation.terms.pagamento || '',
      entrega: quotation.terms.entrega || '',
      fretePadrao: '0.00',
      frete: quotation.terms.frete || '0.00',
      observacoes: quotation.terms.observacoes || '',
      prazoProducao: '',
      templatePadrao: HISTORICAL_TEMPLATE_KEY,
      templateHash: HISTORICAL_TEMPLATE_HASH,
      ...clientSnapshot,
      subtotal: canonicalDecimal(quotation.subtotal || '0'),
      total: canonicalDecimal(quotation.total || '0'),
      createdAt,
    };
    const document =
      quotation.status === 'enviado' || quotation.status === 'aprovado'
        ? buildIssuedDocumentUnit(quotation)
        : null;
    const canonicalHashValue = canonicalHash({
      entity: 'orcamento',
      payload: {
        businessNumber: quotation.businessNumber,
        clientId: quotation.clientId,
        status: quotation.status,
        year: quotation.year,
        createdAt: quotation.createdAt,
        terms: quotation.terms,
        subtotal: quotation.subtotal,
        total: quotation.total,
        items: items.map((item) => ({
          position: item.position,
          productSku: item.productSku,
          quantidade: item.quantidade,
          precoSugerido: item.precoSugerido,
          precoAplicado: item.precoAplicado,
          totalLinha: item.totalLinha,
        })),
        document: document
          ? {
              kind: document.kind,
              fileName: document.fileName,
              sizeBytes: document.sizeBytes,
              checksumSha256: document.checksumSha256,
            }
          : null,
      },
    });
    const lineage: FrappeLineageEntry[] = [
      {
        provider: 'frappe',
        sourceDoctype: 'Quotation',
        sourceId: quotation.sourceId,
        entityType: 'orcamento',
        localId: id,
        localKey: id,
        canonicalHash: canonicalHashValue,
        sourceHash: sourceHashFor(quotation.source),
        businessNumber: quotation.businessNumber,
        migrationRunId: null,
        sourceUpdatedAt: quotation.sourceUpdatedAt,
        importedAt: null,
      },
    ];
    const unit: QuotationUnit = {
      id,
      revision,
      quotation,
      items,
      document,
      lineage,
      sourceHash: sourceHashFor(quotation.source),
    };
    quotationUnits.push(unit);
    itemUnits.push(...items);
  }
  return { quotationUnits, itemUnits, issues };
}

export function normalizeFrappeDataset(dataset: FrappeDataset): NormalizedDataset {
  const products = (dataset.items || []).map(normalizeFrappeItem);
  const knownSkus = products.map((product) => product.sku);
  const priceDocuments = [
    ...normalizeFrappePriceDocuments(dataset.pricingRules || [], 'Pricing Rule', knownSkus),
    ...normalizeFrappePriceDocuments(dataset.itemPrices || [], 'Item Price', knownSkus),
  ];
  const clients = [
    ...(dataset.customers || []).map((record) => normalizeFrappeClientRecord(record, 'Customer')),
    ...(dataset.leads || []).map((record) => normalizeFrappeClientRecord(record, 'Lead')),
  ];
  const productUnits = buildProductUnits(products, priceDocuments);
  const clientUnits = buildClientUnits(clients);
  return { products, priceDocuments, clients, productUnits, clientUnits };
}

function decimal(value: string): { integer: bigint; scale: number } {
  const normalized = text(value).replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(`Número decimal inválido: ${value}`);
  const [integer, fraction = ''] = normalized.split('.');
  return { integer: BigInt(`${integer}${fraction}`), scale: fraction.length };
}

export function canonicalDecimal(value: string): string {
  const parsed = decimal(value);
  const base = parsed.integer.toString().padStart(parsed.scale + 1, '0');
  if (parsed.scale === 0) return base;
  const integer = base.slice(0, -parsed.scale) || '0';
  const fraction = base.slice(-parsed.scale).replace(/0+$/, '');
  return fraction ? `${integer}.${fraction}` : integer;
}

function equalDecimal(left: string, right: string): boolean {
  const a = decimal(left);
  const b = decimal(right);
  if (a.scale === b.scale) return a.integer === b.integer;
  if (a.scale > b.scale) return a.integer === b.integer * 10n ** BigInt(a.scale - b.scale);
  return a.integer * 10n ** BigInt(b.scale - a.scale) === b.integer;
}

function normalizePriceList(
  values: NormalizedPriceDocument[],
  sku: string
): {
  base: string | null;
  tiers: PricingTierInput[];
  divergent: string[];
} {
  const relevant = values.filter((value) => value.sku === sku);
  const byMinimum = new Map<string, NormalizedPriceDocument[]>();
  for (const value of relevant) {
    let normalized: string;
    try {
      normalized = canonicalDecimal(text(value.minimumQuantity));
    } catch {
      normalized = text(value.minimumQuantity);
    }
    const rows = byMinimum.get(normalized) || [];
    rows.push(value);
    byMinimum.set(normalized, rows);
  }
  const divergent: string[] = [];
  const tiers: PricingTierInput[] = [];
  let base: string | null = null;
  for (const [minimum, rows] of byMinimum) {
    const itemPriceRows = rows.filter((row) => row.sourceDoctype === 'Item Price');
    const itemPricePrices = [...new Set(itemPriceRows.map((row) => row.unitPrice))];
    if (
      itemPricePrices.length > 1 &&
      !itemPricePrices.every((price) => equalDecimal(price, itemPricePrices[0]))
    ) {
      divergent.push(`SKU ${sku}: Item Prices Standard Selling têm rates ambíguos.`);
      continue;
    }
    // Pricing Rule is the contractually preferred source. Item Price only
    // fills the missing global fallback/base and must not override a rule at
    // the same minimum. A conflicting set of Item Prices was rejected above,
    // even when a Pricing Rule shadows the fallback, so no source is chosen
    // silently.
    const preferredRows = rows.some((row) => row.sourceDoctype === 'Pricing Rule')
      ? rows.filter((row) => row.sourceDoctype === 'Pricing Rule')
      : rows;
    const uniquePrices = [...new Set(preferredRows.map((row) => row.unitPrice))];
    if (
      uniquePrices.length > 1 &&
      !uniquePrices.every((price) => equalDecimal(price, uniquePrices[0]))
    ) {
      divergent.push(`SKU ${sku}: preços ambíguos para mínimo ${minimum}.`);
      continue;
    }
    const price = uniquePrices[0];
    if (minimum === '0' || minimum === '1') {
      if (base !== null && !equalDecimal(base, price)) {
        divergent.push(`SKU ${sku}: preço base ambíguo.`);
      } else base = price;
    } else tiers.push({ minimum_quantity: minimum, unit_price: price });
  }
  return { base, tiers, divergent };
}

export function buildProductUnits(
  products: NormalizedProduct[],
  priceDocuments: NormalizedPriceDocument[]
): ProductUnit[] {
  const all = [...products].sort((left, right) => left.sku.localeCompare(right.sku));
  return all.map((product) => {
    const pricing = normalizePriceList(priceDocuments, product.sku);
    const base = product.precoBase || pricing.base;
    // The shared resolver historically falls back to the first tier below its
    // first boundary. When a flat/base source coexists with higher brackets,
    // preserve the flat rate explicitly as the minimum-1 tier so quantities
    // below that first high bracket do not inherit the high-bracket rate.
    const pricingInput =
      base !== null && pricing.tiers.length > 0
        ? {
            preco_base: null,
            precos: [{ minimum_quantity: '1', unit_price: base }, ...pricing.tiers],
          }
        : { preco_base: base, precos: pricing.tiers };
    const normalized = normalizeProductPricing(pricingInput);
    const lineage: FrappeLineageEntry[] = [
      {
        provider: 'frappe',
        sourceDoctype: product.sourceDoctype,
        sourceId: product.sourceId,
        entityType: 'produto',
        localId: product.sku,
        localKey: product.sku,
        canonicalHash: hashFor('produto', {
          sku: product.sku,
          nome: product.nome,
          descricao: product.descricao,
          unidade: product.unidade,
          categoria: product.categoria,
          marca: product.marca,
          ativo: product.ativo,
          preco_base: normalized.preco_base,
        }),
        sourceHash: sourceHashFor(product.source),
        migrationRunId: null,
        sourceUpdatedAt: product.sourceUpdatedAt,
        importedAt: null,
        businessNumber: null,
      },
    ];
    // Keep each source price document in lineage, even when its values are
    // equivalent. This is what allows later reruns to prove all ERP records
    // were read without losing the original payload.
    const priceRows = priceDocuments.filter((candidate) => candidate.sku === product.sku);
    const rowsBySource = new Map<string, NormalizedPriceDocument[]>();
    for (const row of priceRows) {
      const rows = rowsBySource.get(`${row.sourceDoctype}:${row.sourceId}`) || [];
      rows.push(row);
      rowsBySource.set(`${row.sourceDoctype}:${row.sourceId}`, rows);
    }
    for (const rows of rowsBySource.values()) {
      const row = rows[0];
      lineage.push({
        provider: 'frappe',
        sourceDoctype: row.sourceDoctype,
        sourceId: row.sourceId,
        entityType: 'faixa',
        localId: product.sku,
        localKey: product.sku,
        canonicalHash: hashFor('faixa', {
          sku: product.sku,
          rows: rows.map((entry) => ({
            minimum_quantity: entry.minimumQuantity,
            unit_price: entry.unitPrice,
          })),
        }),
        sourceHash: sourceHashFor(row.source),
        migrationRunId: null,
        sourceUpdatedAt: row.sourceUpdatedAt,
        importedAt: null,
        businessNumber: null,
      });
    }
    const serializableTiers = normalized.precos.map((tier) => ({
      minimum_quantity: tier.minimum_quantity,
      unit_price: tier.unit_price,
    }));
    return {
      product: { ...product, precoBase: normalized.preco_base, precos: serializableTiers },
      pricing: { preco_base: normalized.preco_base, precos: serializableTiers },
      lineage,
      divergences: pricing.divergent,
    };
  });
}

function mergeText(values: Array<string | null | undefined>): string | null {
  const nonEmpty = [...new Set(values.map((value) => text(value)).filter(Boolean))];
  return nonEmpty.length <= 1 ? nonEmpty[0] || null : null;
}

function mergeAddress(values: Array<ClientAddress | null | undefined>): ClientAddress | null {
  const entries = values.filter((value): value is ClientAddress => Boolean(value));
  if (!entries.length) return null;
  const fields: Array<keyof ClientAddress> = [
    'endereco',
    'numero',
    'bairro',
    'complemento',
    'municipio',
    'uf',
    'cep',
  ];
  const merged = {} as ClientAddress;
  for (const field of fields) {
    const result = mergeText(entries.map((value) => value[field]));
    if (result === null && entries.some((value) => text(value[field]))) return null;
    merged[field] = result;
  }
  return merged;
}

function sameLocalClient(left: NormalizedClient, right: NormalizedClient): boolean {
  if (left.localKey === right.localKey) return true;
  return left.links.some((value) => right.links.includes(value));
}

export function buildClientUnits(clients: NormalizedClient[]): ClientUnit[] {
  // Two source records with the same normalized display name but neither a
  // document nor an explicit cross-reference cannot be safely identified as
  // one customer. Keep them in one blocked unit so the report is explicit and
  // the importer cannot silently create duplicate local clients.
  const nameCounts = new Map<string, number>();
  for (const client of clients) {
    if (client.documento || client.links.some((value) => value.startsWith('link:'))) continue;
    const key = client.nome.trim().toLocaleLowerCase('pt-BR');
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  const ambiguousNames = new Set(
    [...nameCounts].filter(([, count]) => count > 1).map(([name]) => name)
  );
  const ambiguousNameOf = (client: NormalizedClient): string | null => {
    if (client.documento || client.links.some((value) => value.startsWith('link:'))) return null;
    const key = client.nome.trim().toLocaleLowerCase('pt-BR');
    return ambiguousNames.has(key) ? key : null;
  };
  const groups: NormalizedClient[][] = [];
  for (const client of clients) {
    const ambiguousName = ambiguousNameOf(client);
    const group = groups.find((values) =>
      values.some(
        (candidate) =>
          sameLocalClient(candidate, client) ||
          (ambiguousName !== null && ambiguousNameOf(candidate) === ambiguousName)
      )
    );
    if (group) group.push(client);
    else groups.push([client]);
  }
  return groups
    .sort((left, right) => left[0].localKey.localeCompare(right[0].localKey))
    .map((members) => {
      const firstMember = members[0];
      const mergedName = mergeText(members.map((member) => member.nome));
      const mergedDocument = mergeText(members.map((member) => member.documento));
      const mergedEmail = mergeText(members.map((member) => member.email));
      const mergedPhone = mergeText(members.map((member) => member.telefone));
      const mergedNotes = mergeText(members.map((member) => member.notes));
      const mergedAddress = mergeAddress(members.map((member) => member.address));
      const conflicts: string[] = [];
      const checkConflict = (label: string, values: Array<string | null | undefined>) => {
        const present = [...new Set(values.map((value) => text(value)).filter(Boolean))];
        if (present.length > 1) conflicts.push(`${label} incompatível entre documentos.`);
      };
      checkConflict(
        'nome',
        members.map((member) => member.nome)
      );
      checkConflict(
        'documento',
        members.map((member) => member.documento)
      );
      checkConflict(
        'email',
        members.map((member) => member.email)
      );
      checkConflict(
        'telefone',
        members.map((member) => member.telefone)
      );
      checkConflict(
        'observações',
        members.map((member) => member.notes)
      );
      if (mergedAddress === null && members.some((member) => member.address))
        conflicts.push('endereço incompatível entre documentos.');
      if (members.length > 1 && members.every((member) => ambiguousNameOf(member) !== null)) {
        conflicts.push(
          'Identidade ambígua: nome sem documento ou vínculo explícito compartilhado.'
        );
      }
      const localKey = firstMember.documento
        ? `documento:${firstMember.documento}`
        : firstMember.localKey;
      const client: NormalizedClient = {
        ...firstMember,
        localKey,
        nome: mergedName || firstMember.nome,
        documento: mergedDocument,
        email: mergedEmail,
        telefone: mergedPhone,
        notes: mergedNotes,
        address: mergedAddress,
        links: [...new Set(members.flatMap((member) => member.links))].sort(),
      };
      const lineage = members.map((member) => {
        const canonicalHashValue = hashFor('cliente', {
          nome: member.nome,
          documento: member.documento,
          email: member.email,
          telefone: member.telefone,
          notes: member.notes,
          address: member.address,
          localKey,
        });
        return {
          provider: 'frappe' as const,
          sourceDoctype: member.sourceDoctype,
          sourceId: member.sourceId,
          entityType: 'cliente' as const,
          localId: localKey,
          localKey,
          canonicalHash: canonicalHashValue,
          sourceHash: sourceHashFor(member.source),
          migrationRunId: null,
          sourceUpdatedAt: member.sourceUpdatedAt,
          importedAt: null,
          businessNumber: null,
        };
      });
      return { client, members, lineage, conflicts };
    });
}

export function emptyEntityReport(): EntityReport {
  return {
    lidos: 0,
    criados: 0,
    atualizados: 0,
    ignorados: 0,
    aprovadas: 0,
    divergentes: 0,
    erros: 0,
    estimativa_volume: 0,
    detalhes: [],
  };
}

export function makeReport(modo: 'dry-run' | 'apply'): ImportReport {
  const produtos = emptyEntityReport();
  const faixas = emptyEntityReport();
  const clientes = emptyEntityReport();
  const orcamentos = emptyEntityReport();
  const documentos = emptyEntityReport();
  const total = emptyEntityReport();
  return {
    modo,
    dry_run: modo === 'dry-run',
    produtos,
    faixas,
    clientes,
    orcamentos,
    documentos,
    total,
    entities: { produtos, faixas, clientes, orcamentos, documentos },
  };
}

export function addDetail(report: EntityReport, detail: ImportDetail): void {
  // Keep every report path behind the same PII boundary, including callers
  // that build ImportDetail directly instead of using the migration helper.
  const sourceDoctype = String(detail.source_doctype || '');
  const reportClientToken = (value: string | undefined): string | undefined => {
    if (!value || (sourceDoctype !== 'Customer' && sourceDoctype !== 'Lead')) return value;
    const canonical = canonicalApprovalKey(sourceDoctype, value);
    return canonical ? canonical.slice(sourceDoctype.length + 1) : undefined;
  };
  report.detalhes.push({
    ...detail,
    source_id: reportClientToken(detail.source_id),
    local_key: reportClientToken(detail.local_key),
    mensagem: sanitizeReportMessage(detail.mensagem),
  });
  report[detail.status] += 1;
}

export function finalizeReport(report: ImportReport): ImportReport {
  const entities = [
    report.produtos,
    report.faixas,
    report.clientes,
    report.orcamentos,
    report.documentos,
  ];
  for (const entity of entities) {
    entity.detalhes.sort((left, right) =>
      `${left.source_doctype || ''}:${left.source_id || ''}:${left.local_key || ''}`.localeCompare(
        `${right.source_doctype || ''}:${right.source_id || ''}:${right.local_key || ''}`
      )
    );
    // This is the planned/read volume, not a commit count; apply failures do
    // not reduce it because the operator still needs to account for the
    // source document on the next resumable run.
    entity.estimativa_volume = entity.lidos;
  }
  for (const field of IMPORT_STATUSES) {
    if (field === 'estimativa_volume') continue;
    totalValue(
      report.total,
      field,
      entities.reduce((sum, entity) => sum + entity[field], 0)
    );
  }
  report.total.estimativa_volume = entities.reduce(
    (sum, entity) => sum + entity.estimativa_volume,
    0
  );
  report.total.detalhes = entities
    .flatMap((entity) => entity.detalhes)
    .sort((left, right) =>
      `${left.source_doctype || ''}:${left.source_id || ''}:${left.local_key || ''}`.localeCompare(
        `${right.source_doctype || ''}:${right.source_id || ''}:${right.local_key || ''}`
      )
    );
  return report;
}

function totalValue(
  report: EntityReport,
  field: Exclude<ImportStatus, 'lidos' | 'estimativa_volume'> | 'lidos',
  value: number
): void {
  report[field] = value;
}

export interface DatasetReadSummary {
  dataset: FrappeDataset;
  lidos: {
    items: number;
    pricingRules: number;
    itemPrices: number;
    customers: number;
    leads: number;
    quotations: number;
  };
}

/**
 * Source-independent paginator seam. A source may expose `list` (the
 * production ERP adapter) or `listPage` (fixtures/tests). Pagination stops on
 * an empty page and always uses a stable order key.
 */
export interface FrappeListSource {
  list(
    doctype: string,
    options: { limit: number; start: number; order_by: string; modified_before?: string }
  ): Promise<SourceRecord[]>;
}

export async function readFrappeDataset(
  source: FrappeListSource,
  pageSize = 200,
  sourceSnapshotAt = new Date()
): Promise<DatasetReadSummary> {
  const read = async (doctype: string): Promise<SourceRecord[]> => {
    const rows: SourceRecord[] = [];
    let start = 0;
    while (true) {
      const page = await source.list(doctype, {
        limit: pageSize,
        start,
        order_by: 'creation asc, name asc',
        modified_before: sourceSnapshotAt.toISOString(),
      });
      rows.push(...(page as SourceRecord[]));
      if (page.length < pageSize) break;
      start += page.length;
    }
    return rows;
  };
  const [items, pricingRules, itemPrices, customers, leads, quotations] = await Promise.all([
    read('Item'),
    read('Pricing Rule'),
    read('Item Price'),
    read('Customer'),
    read('Lead'),
    read('Quotation'),
  ]);
  return {
    dataset: { items, pricingRules, itemPrices, customers, leads, quotations },
    lidos: {
      items: items.length,
      pricingRules: pricingRules.length,
      itemPrices: itemPrices.length,
      customers: customers.length,
      leads: leads.length,
      quotations: quotations.length,
    },
  };
}

export interface MigrationReconciliationExpectations {
  keys: {
    products: string[];
    pricingDocuments: string[];
    pricingTiers: string[];
    clients: string[];
    quotations: string[];
  };
  counts: {
    products: number;
    pricingDocuments: number;
    pricingTiers: number;
    clients: number;
    quotations: number;
    revisions: number;
    items: number;
    templates: number;
    templateVersions: number;
  };
  hashes: {
    products: string;
    pricingDocuments: string;
    pricingTiers: string;
    clients: string;
    quotations: string;
    revisions: string;
    items: string;
    templates: string;
    templateVersions: string;
    lineage: string;
  };
  statusCounts: {
    quotations: Record<string, number>;
    revisions: Record<string, number>;
  };
  statusRows: {
    quotations: Array<{ sourceId: string; status: string }>;
    revisions: Array<{ sourceId: string; status: string }>;
  };
}

export interface MigrationManifest {
  runId: string;
  provider: string;
  mode: 'dry-run' | 'apply';
  sourceSnapshotAt: Date;
  manifestHash: string;
  status: 'completed' | 'failed';
  entityCounts: {
    products: number;
    pricingTiers: number;
    clients: number;
    quotations: number;
  };
  /** Source-derived expectations for executable target reconciliation. */
  reconciliation: MigrationReconciliationExpectations;
  divergenceCounts: {
    approved: number;
    blocking: number;
  };
}

/** Compute a deterministic content hash for the full source dataset.  Two
 * runs with identical input data produce the same manifest hash regardless
 * of execution time, enabling fast comparison of source snapshots. */
export function computeManifestHash(dataset: FrappeDataset): string {
  return canonicalHash(dataset);
}

export const normalizeDataset = normalizeFrappeDataset;
export const buildUnits = normalizeFrappeDataset;
