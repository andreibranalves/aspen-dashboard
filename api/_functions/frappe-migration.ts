import { list } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

import {
  addDetail,
  addExcluded,
  buildClientUnits,
  buildProductUnits,
  buildQuotationUnits,
  canonicalDecimal,
  canonicalHash,
  computeManifestHash,
  deriveHistoricalPdfBlobPath,
  finalizeReport,
  historicalPdfPrintviewUrl,
  makeReport,
  mapQuotationStatus,
  normalizeFrappeClientRecord,
  normalizeFrappeItem,
  normalizeFrappePriceDocuments,
  normalizeFrappeQuotation,
  normalizeHistoricalPdf,
  readFrappeDataset,
  sanitizeReportMessage,
  canonicalApprovalKey,
  safeApprovalKey,
  sourceIdOf,
  stableId,
  validateFrappeDataset,
  type ClientUnit,
  type EntityReport,
  type ExistingClient,
  type ExistingLineage,
  type ExistingProduct,
  type FrappeDataset,
  type FrappeListSource,
  type FrappeLineageEntry,
  type HistoricalPdfRecord,
  type ImportDetail,
  type ImportReport,
  type MigrationManifest,
  type MigrationReconciliationExpectations,
  type NormalizedClient,
  type NormalizedPriceDocument,
  type NormalizedProduct,
  type NormalizedQuotation,
  type ProductUnit,
  type QuotationUnit,
  type SourceRecord,
} from './lib/frappe-migration-core.js';
import {
  buildDiscardPlan,
  validateDiscardManifest,
  type DiscardManifest,
  type DiscardPlan,
  type DiscardReason,
} from './lib/migration-discard.js';
import {
  createPostgresFrappeMigrationRepository,
  stableClientUuid,
  type FrappeMigrationRepository,
  type FrappeMigrationState,
  type IssuedDocumentPdfPlaceholder,
} from '../_db/frappe-migration-repository.js';
import { snapshotFromLegacyRevision } from '../_db/quotation-template-migration.js';
import { erpGetDoc, erpGetList, ERPNEXT_TOKEN } from './lib/erpnext.js';
import {
  isValidPdfBuffer,
  quotationBlobAuth,
  quotationPdfChecksum,
  QUOTATION_PDF_MIME_TYPE,
} from './lib/quotation-document-storage.js';
import { renderQuotationPdfHtml } from './lib/quotation-pdf.js';

export type { FrappeDataset, FrappeListSource, FrappeMigrationRepository, FrappeMigrationState };
export * from './lib/frappe-migration-core.js';

/**
 * Blob-side seam for historical PDF archival.  Tests inject an in-memory
 * implementation; production delegates to `@vercel/blob` via
 * `createDefaultHistoricalPdfPipeline`.
 */
export interface HistoricalPdfBlobStore {
  /** List existing blob pathnames under a prefix (idempotency lookup). */
  list(prefix: string): Promise<string[]>;
  /**
   * Upload one PDF and return what the store actually recorded.  The caller
   * compares pathname/size/checksum against the downloaded content before
   * committing the `issued_documents` update.
   */
  put(
    pathname: string,
    buffer: Buffer,
    contentType: string
  ): Promise<{ pathname: string; sizeBytes: number; checksumSha256: string }>;
}

/**
 * I/O seams for the historical PDF archival step: Frappe printview fetch,
 * Puppeteer render and Vercel Blob storage.  Dry-run never touches this
 * pipeline; apply archives one document at a time through it.
 */
export interface HistoricalPdfPipeline {
  fetchHtml(fileUrl: string): Promise<string>;
  renderPdf(html: string): Promise<Buffer>;
  blobs: HistoricalPdfBlobStore;
}

export interface MigrationOptions {
  mode: 'dry-run' | 'apply';
  source?: FrappeListSource;
  dataset?: FrappeDataset;
  repository?: FrappeMigrationRepository;
  pageSize?: number;
  /**
   * Optional archival pipeline.  In apply mode it replaces the historical
   * PDF placeholders with real Vercel Blob uploads; in dry-run it is ignored
   * (analysis only, no I/O).  When absent the archival step is skipped.
   */
  pdfPipeline?: HistoricalPdfPipeline;
  /** Explicit operator-approved divergence keys (`source_doctype:source_id`). */
  approvedDivergences?: string[];
  /** Explicit snapshot-bound exclusions. */
  discardManifest?: DiscardManifest;
  /** Apply may only write the exact manifest reviewed during dry-run. */
  expectedManifestHash?: string;
}

export interface MigrationResult {
  report: ImportReport;
  manifest: MigrationManifest;
}

/** Production source adapter. Stable ordering is enforced by the core reader. */
export function createFrappeSource(): FrappeListSource {
  return {
    async list(doctype, options) {
      const filters = options.modified_before
        ? [['modified', '<=', options.modified_before] as [string, string, string]]
        : undefined;
      const rows = await erpGetList(doctype, {
        fields: ['*'],
        filters,
        limit: options.limit,
        start: options.start,
        order_by: options.order_by,
      });
      if (doctype !== 'Pricing Rule' && doctype !== 'Quotation') return rows;
      // ERPNext list responses omit child rows and party fields for some
      // doctypes even with fields=["*"]. Enrich documents before normalization.
      return Promise.all(
        rows.map(async (row) => {
          const name = String(row.name || '').trim();
          if (!name) return row;
          try {
            const full = await erpGetDoc(doctype, name, { fields: ['*'] });
            if (
              full &&
              options.modified_before &&
              full.modified &&
              new Date(String(full.modified)).getTime() > new Date(options.modified_before).getTime()
            ) {
              return { ...row, __migration_enrichment_error: true };
            }
            return full ? { ...row, ...full } : row;
          } catch {
            return { ...row, __migration_enrichment_error: true };
          }
        })
      );
    },
  };
}

const BATCH_ENTITY_TYPES = ['produtos', 'faixas', 'clientes', 'orcamentos', 'documentos'] as const;

function recordKey(doctype: string, id: string): string {
  return `${doctype}:${id}`;
}

/** Attach raw payloads only at the persistence boundary. Public builders return
 * lineage metadata without carrying this field. */
function attachLineagePayload(entry: FrappeLineageEntry, payload: SourceRecord | undefined): void {
  if (!payload) return;
  Object.defineProperty(entry, 'legacyPayload', {
    configurable: true,
    enumerable: false,
    value: payload,
    writable: false,
  });
}

function attachUnitLineagePayloads(
  units: Array<{ lineage: FrappeLineageEntry[] }>,
  payloads: Map<string, SourceRecord>
): void {
  for (const unit of units)
    for (const entry of unit.lineage)
      attachLineagePayload(entry, payloads.get(recordKey(entry.sourceDoctype, entry.sourceId)));
}

function entityFailed(report: EntityReport): boolean {
  return report.erros > 0 || report.divergentes > 0;
}

function hasBlockingDetails(details: EntityReport['detalhes']): boolean {
  return details.some(
    (detail) => !detail.aprovada && (detail.status === 'divergentes' || detail.status === 'erros')
  );
}

function approvalKeyForDetail(detail: ImportDetail): string | null {
  return canonicalApprovalKey(String(detail.source_doctype || ''), String(detail.source_id || ''));
}

function validateApprovalKeysAgainstDataset(
  dataset: FrappeDataset,
  approvedKeys: string[] = []
): void {
  if (approvedKeys.length === 0) return;
  const available = new Set<string>();
  const addRecords = (sourceDoctype: string, records: SourceRecord[] = []): void => {
    for (const record of records) {
      const sourceId = sourceIdOf(record);
      const key = canonicalApprovalKey(sourceDoctype, sourceId);
      if (key) available.add(key);
    }
  };
  addRecords('Item', dataset.items || []);
  addRecords('Pricing Rule', dataset.pricingRules || []);
  addRecords('Item Price', dataset.itemPrices || []);
  addRecords('Customer', dataset.customers || []);
  addRecords('Lead', dataset.leads || []);
  addRecords('Quotation', dataset.quotations || []);
  const requested = approvedKeys.map((key) => safeApprovalKey(String(key)));
  if (requested.some((key) => !available.has(key)))
    throw new Error('Chave de aprovação inválida.');
}

function approveDivergences(report: ImportReport, approvedKeys: string[] = []): void {
  if (approvedKeys.length === 0) return;
  const entities = [report.produtos, report.faixas, report.clientes, report.orcamentos, report.documentos];
  const approved = new Set(approvedKeys.map((key) => safeApprovalKey(String(key))));
  for (const entity of entities) {
    for (const detail of entity.detalhes) {
      const key = approvalKeyForDetail(detail);
      if (!detail.aprovada && detail.status === 'divergentes' && key && approved.has(key)) {
        detail.aprovada = true;
        entity.divergentes -= 1;
        entity.aprovadas += 1;
      }
    }
  }
}

function safeErrorMessage(error: unknown): string {
  return sanitizeReportMessage(error instanceof Error ? error.message : String(error));
}

function logMigrationError(prefix: string, error: unknown): void {
  console.error(prefix, safeErrorMessage(error));
}

function safeLogIdentifier(value: string): string {
  return canonicalHash(value).slice(0, 12);
}

function trackingError(report: ImportReport, operation: string, error: unknown): void {
  const message = safeErrorMessage(error);
  add(
    report.documentos,
    'erros',
    'migration_tracking',
    operation,
    `Falha de rastreamento (${operation}): ${message}`
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalHash(left) === canonicalHash(right);
}

/**
 * A source is unchanged only when the complete source payload hash and the
 * source's last-modified timestamp both match a verified lineage row.
 * Historical rows without a source hash must be reconciled, never treated as
 * equivalent because their old canonical hash happened to match.
 */
function sourceLineageMatches(
  previous: ExistingLineage | undefined,
  current: FrappeLineageEntry
): boolean {
  return Boolean(
    previous &&
    previous.lineageStatus === 'verified' &&
    previous.sourceHash !== null &&
    previous.sourceHash === current.sourceHash &&
    sameValue(previous.sourceUpdatedAt, current.sourceUpdatedAt)
  );
}

function productIdentity(product: NormalizedProduct): Record<string, unknown> {
  return {
    sku: product.sku,
    nome: product.nome,
    descricao: product.descricao,
    unidade: product.unidade,
    categoria: product.categoria,
    marca: product.marca,
    ativo: product.ativo,
  };
}

function productCurrentIdentity(product: ExistingProduct): Record<string, unknown> {
  return {
    sku: product.sku,
    nome: product.nome,
    descricao: product.descricao || '',
    unidade: product.unidade || 'Und',
    categoria: product.categoria || null,
    marca: product.marca || null,
    ativo: product.ativo !== false,
  };
}

function canonicalPricingValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  try {
    return canonicalDecimal(text);
  } catch {
    return text;
  }
}

function canonicalPricingIdentity(value: {
  preco_base: unknown;
  precos?: Array<{ minimum_quantity?: unknown; unit_price?: unknown }>;
}): Record<string, unknown> {
  return {
    preco_base: canonicalPricingValue(value.preco_base),
    precos: (value.precos || []).map((tier) => ({
      minimum_quantity: canonicalPricingValue(tier.minimum_quantity),
      unit_price: canonicalPricingValue(tier.unit_price),
    })),
  };
}

function pricingIdentity(unit: ProductUnit): Record<string, unknown> {
  return canonicalPricingIdentity(unit.pricing);
}

function currentPricingIdentity(product: ExistingProduct): Record<string, unknown> {
  return canonicalPricingIdentity({ preco_base: product.precoBase, precos: product.precos });
}

function clientIdentity(client: NormalizedClient): Record<string, unknown> {
  return {
    nome: client.nome,
    documento: client.documento,
    email: client.email,
    telefone: client.telefone,
    notes: client.notes,
    address: client.address,
  };
}

function currentClientIdentity(client: ExistingClient): Record<string, unknown> {
  return {
    nome: client.nome,
    documento: client.documento || null,
    email: client.email || null,
    telefone: client.telefone || null,
    notes: client.notes || null,
    address: client.address || null,
  };
}

function lineageFor(
  state: FrappeMigrationState,
  sourceDoctype: string,
  sourceId: string
): ExistingLineage | undefined {
  return state.lineage.find(
    (entry) => entry.sourceDoctype === sourceDoctype && entry.sourceId === sourceId
  );
}

function add(
  report: EntityReport,
  status: 'criados' | 'atualizados' | 'ignorados' | 'divergentes' | 'erros',
  sourceDoctype: string,
  sourceId: string,
  mensagem: string,
  localKey?: string
): void {
  addDetail(report, {
    status,
    source_doctype: sourceDoctype,
    source_id: sourceId,
    local_key: localKey,
    mensagem: sanitizeReportMessage(mensagem),
  });
}

interface ReportCheckpoint {
  report: EntityReport;
  detailsLength: number;
  addedDetails: EntityReport['detalhes'];
}

function checkpoint(report: EntityReport): ReportCheckpoint {
  return {
    report,
    detailsLength: report.detalhes.length,
    addedDetails: [],
  };
}

/** Count every source outcome, not only successful writes. A checkpoint is a
 * source cursor, so ignored and divergent records must advance it too. */
function entityCheckpoint(report: EntityReport): number {
  return (
    report.criados +
    report.atualizados +
    report.ignorados +
    report.aprovadas +
    report.divergentes +
    report.erros
  );
}

function sealCheckpoint(value: ReportCheckpoint): void {
  value.addedDetails = value.report.detalhes.slice(value.detailsLength);
}

function rollbackCheckpoint(value: ReportCheckpoint): void {
  if (value.addedDetails.length === 0) return;
  const remove = new Set(value.addedDetails);
  const kept = value.report.detalhes.filter((detail) => !remove.has(detail));
  value.report.detalhes.splice(0, value.report.detalhes.length, ...kept);
  for (const detail of value.addedDetails) value.report[detail.status] -= 1;
}

function addReadCounts(report: ImportReport, dataset: FrappeDataset): void {
  report.produtos.lidos = dataset.items.length;
  report.faixas.lidos = (dataset.pricingRules || []).length + (dataset.itemPrices || []).length;
  report.clientes.lidos = (dataset.customers || []).length + (dataset.leads || []).length;
  report.orcamentos.lidos = (dataset.quotations || []).length;
}

function duplicateSourceIds(records: SourceRecord[], doctype: string): Set<string> {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    const id = String(record.name || record.id || '').trim();
    if (!id) continue;
    const hash = canonicalHash(record);
    if (seen.has(id) && seen.get(id) !== hash) duplicates.add(recordKey(doctype, id));
    seen.set(id, hash);
  }
  return duplicates;
}

function uniqueSourceRecords(records: SourceRecord[]): SourceRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const sourceId = String(record.name || record.id || '').trim();
    if (!sourceId) return true;
    const key = `${sourceId}:${canonicalHash(record)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function productSkuCollisions(products: NormalizedProduct[]): Set<string> {
  const bySku = new Map<string, Set<string>>();
  for (const product of products) {
    const ids = bySku.get(product.sku) || new Set<string>();
    ids.add(product.sourceId);
    bySku.set(product.sku, ids);
  }
  return new Set([...bySku].filter(([, ids]) => ids.size > 1).map(([sku]) => sku));
}

function lineageEntriesBySource(
  entries: FrappeLineageEntry[],
  type: FrappeLineageEntry['entityType']
): FrappeLineageEntry[] {
  return entries.filter((entry) => entry.entityType === type);
}

function importedProductHash(product: NormalizedProduct): string {
  return canonicalHash({
    entity: 'produto',
    payload: {
      ...productIdentity(product),
      preco_base: product.precoBase || null,
    },
  });
}

function resolveExistingClient(
  state: FrappeMigrationState,
  unit: ClientUnit
): ExistingClient | undefined {
  const byLineage = unit.lineage
    .map((entry) => lineageFor(state, entry.sourceDoctype, entry.sourceId)?.localKey)
    .find(Boolean);
  if (byLineage) {
    const byId = state.clients.find((client) => client.id === byLineage);
    if (byId) return byId;
  }
  if (unit.client.documento)
    return state.clients.find((client) => client.documento === unit.client.documento);
  return undefined;
}

function processProductUnit(
  unit: ProductUnit,
  state: FrappeMigrationState,
  report: ImportReport,
  duplicateSkus: Set<string>,
  duplicateSources: Set<string>,
  duplicatePriceSources: Set<string>,
  multiSkuPriceSources: Set<string>
): { write: boolean; lineageOnly: boolean } {
  const itemSource = unit.product.sourceId;
  const existing = state.products.find((product) => product.sku === unit.product.sku);
  if (duplicateSkus.has(unit.product.sku)) {
    add(
      report.produtos,
      'divergentes',
      'Item',
      itemSource,
      'SKU associado a mais de um documento Frappe.',
      unit.product.sku
    );
    return { write: false, lineageOnly: false };
  }
  if (duplicateSources.has(recordKey('Item', itemSource))) {
    add(
      report.produtos,
      'divergentes',
      'Item',
      itemSource,
      'Documento Frappe repetido com dados diferentes.',
      unit.product.sku
    );
    return { write: false, lineageOnly: false };
  }
  const duplicatedPrice = unit.lineage.find(
    (entry) =>
      entry.entityType === 'faixa' &&
      duplicatePriceSources.has(recordKey(entry.sourceDoctype, entry.sourceId))
  );
  if (duplicatedPrice) {
    add(
      report.faixas,
      'divergentes',
      duplicatedPrice.sourceDoctype,
      duplicatedPrice.sourceId,
      'Documento de preço repetido com dados diferentes.',
      unit.product.sku
    );
    add(
      report.produtos,
      'divergentes',
      'Item',
      itemSource,
      'Produto não aplicado porque a fonte de preço é ambígua.',
      unit.product.sku
    );
    return { write: false, lineageOnly: false };
  }
  const multiSkuPrice = unit.lineage.find(
    (entry) =>
      entry.entityType === 'faixa' &&
      multiSkuPriceSources.has(recordKey(entry.sourceDoctype, entry.sourceId))
  );
  if (multiSkuPrice) {
    add(
      report.faixas,
      'divergentes',
      multiSkuPrice.sourceDoctype,
      multiSkuPrice.sourceId,
      'Documento de preço associado a mais de um SKU.',
      unit.product.sku
    );
    add(
      report.produtos,
      'divergentes',
      'Item',
      itemSource,
      'Produto não aplicado porque a linhagem de preço é ambígua.',
      unit.product.sku
    );
    return { write: false, lineageOnly: false };
  }
  if (unit.divergences.length > 0) {
    const divergenceSource = lineageEntriesBySource(unit.lineage, 'faixa')[0];
    add(
      report.faixas,
      'divergentes',
      divergenceSource?.sourceDoctype || 'Pricing Rule',
      divergenceSource?.sourceId || itemSource,
      unit.divergences.join(' '),
      unit.product.sku
    );
    add(
      report.produtos,
      'divergentes',
      'Item',
      itemSource,
      'Produto não aplicado porque as faixas são ambíguas.',
      unit.product.sku
    );
    return { write: false, lineageOnly: false };
  }
  const previous = lineageFor(state, 'Item', itemSource);
  if (previous && previous.entityType !== 'produto') {
    add(
      report.produtos,
      'divergentes',
      'Item',
      itemSource,
      'Linhagem existente tem tipo de entidade incompatível.',
      unit.product.sku
    );
    return { write: false, lineageOnly: false };
  }
  if (previous && previous.localKey !== unit.product.sku) {
    add(
      report.produtos,
      'divergentes',
      'Item',
      itemSource,
      'Identificador legado já está ligado a outro SKU.',
      unit.product.sku
    );
    return { write: false, lineageOnly: false };
  }
  if (
    existing &&
    !previous &&
    (!sameValue(productCurrentIdentity(existing), productIdentity(unit.product)) ||
      !sameValue(currentPricingIdentity(existing), pricingIdentity(unit)))
  ) {
    add(
      report.produtos,
      'divergentes',
      'Item',
      itemSource,
      'SKU já existe com dados incompatíveis.',
      unit.product.sku
    );
    return { write: false, lineageOnly: false };
  }
  const productLineage = lineageEntriesBySource(unit.lineage, 'produto');
  for (const entry of productLineage) {
    const old = lineageFor(state, entry.sourceDoctype, entry.sourceId);
    if (old && old.entityType !== 'produto') {
      add(
        report.produtos,
        'divergentes',
        entry.sourceDoctype,
        entry.sourceId,
        'Linhagem existente tem tipo de entidade incompatível.',
        entry.localKey
      );
      return { write: false, lineageOnly: false };
    }
    if (old && old.localKey !== entry.localKey) {
      add(
        report.produtos,
        'divergentes',
        entry.sourceDoctype,
        entry.sourceId,
        'Documento legado ligado a outra entidade.',
        entry.localKey
      );
      return { write: false, lineageOnly: false };
    }
  }
  for (const entry of lineageEntriesBySource(unit.lineage, 'faixa')) {
    const old = lineageFor(state, entry.sourceDoctype, entry.sourceId);
    if (old && old.entityType !== 'faixa') {
      add(
        report.faixas,
        'divergentes',
        entry.sourceDoctype,
        entry.sourceId,
        'Linhagem existente tem tipo de entidade incompatível.',
        entry.localKey
      );
      add(
        report.produtos,
        'divergentes',
        'Item',
        itemSource,
        'Produto não aplicado porque a linhagem de faixa é incompatível.',
        unit.product.sku
      );
      return { write: false, lineageOnly: false };
    }
    if (old && old.localKey !== entry.localKey) {
      add(
        report.faixas,
        'divergentes',
        entry.sourceDoctype,
        entry.sourceId,
        'Documento de preço legado ligado a outro SKU.',
        entry.localKey
      );
      add(
        report.produtos,
        'divergentes',
        'Item',
        itemSource,
        'Produto não aplicado porque a faixa já está ligada a outro SKU.',
        unit.product.sku
      );
      return { write: false, lineageOnly: false };
    }
  }
  const productSame = Boolean(
    existing &&
    sameValue(productCurrentIdentity(existing), productIdentity(unit.product)) &&
    sameValue(currentPricingIdentity(existing), pricingIdentity(unit))
  );
  const lineageSame = unit.lineage.every((entry) => {
    const old = lineageFor(state, entry.sourceDoctype, entry.sourceId);
    return Boolean(
      old &&
      old.entityType === entry.entityType &&
      old.localKey === entry.localKey &&
      sourceLineageMatches(old, entry)
    );
  });
  const itemSame = Boolean(
    previous &&
    previous.canonicalHash === importedProductHash(unit.product) &&
    lineageSame
  );
  if (productSame && itemSame)
    add(
      report.produtos,
      'ignorados',
      'Item',
      itemSource,
      'Produto equivalente já importado.',
      unit.product.sku
    );
  else if (existing || previous)
    add(
      report.produtos,
      'atualizados',
      'Item',
      itemSource,
      'Produto atualizado de forma compatível.',
      unit.product.sku
    );
  else add(report.produtos, 'criados', 'Item', itemSource, 'Produto novo.', unit.product.sku);

  for (const entry of lineageEntriesBySource(unit.lineage, 'faixa')) {
    const old = lineageFor(state, entry.sourceDoctype, entry.sourceId);
    if (!old)
      add(
        report.faixas,
        'criados',
        entry.sourceDoctype,
        entry.sourceId,
        'Faixa nova.',
        unit.product.sku
      );
    else if (
      old.canonicalHash === entry.canonicalHash &&
      old.localKey === entry.localKey &&
      sourceLineageMatches(old, entry)
    )
      add(
        report.faixas,
        'ignorados',
        entry.sourceDoctype,
        entry.sourceId,
        'Faixa equivalente já importada.',
        unit.product.sku
      );
    else
      add(
        report.faixas,
        'atualizados',
        entry.sourceDoctype,
        entry.sourceId,
        'Faixa atualizada de forma compatível.',
        unit.product.sku
      );
  }
  const hasNewLineage = !lineageSame;
  return {
    write: !productSame || !itemSame || hasNewLineage,
    lineageOnly: productSame && itemSame && hasNewLineage,
  };
}

function processClientUnit(
  unit: ClientUnit,
  state: FrappeMigrationState,
  report: ImportReport
): boolean {
  const source = unit.lineage[0];
  if (unit.conflicts.length) {
    add(
      report.clientes,
      'divergentes',
      source.sourceDoctype,
      source.sourceId,
      unit.conflicts.join(' '),
      unit.client.localKey
    );
    return false;
  }
  for (const entry of unit.lineage) {
    const old = lineageFor(state, entry.sourceDoctype, entry.sourceId);
    if (old && old.entityType !== 'cliente') {
      add(
        report.clientes,
        'divergentes',
        entry.sourceDoctype,
        entry.sourceId,
        'Linhagem existente tem tipo de entidade incompatível.',
        unit.client.localKey
      );
      return false;
    }
  }
  const linkedKeys = [
    ...new Set(
      unit.lineage
        .map((entry) => lineageFor(state, entry.sourceDoctype, entry.sourceId)?.localKey)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  if (linkedKeys.length > 1) {
    add(
      report.clientes,
      'divergentes',
      source.sourceDoctype,
      source.sourceId,
      'Vínculos Customer/Lead apontam para clientes locais diferentes.',
      unit.client.localKey
    );
    return false;
  }
  const existing = resolveExistingClient(state, unit);
  const previous = unit.lineage
    .map((entry) => lineageFor(state, entry.sourceDoctype, entry.sourceId))
    .find(Boolean);
  if (
    existing &&
    !previous &&
    existing.documento === unit.client.documento &&
    !sameValue(currentClientIdentity(existing), clientIdentity(unit.client))
  ) {
    add(
      report.clientes,
      'divergentes',
      source.sourceDoctype,
      source.sourceId,
      'Documento já existe com dados incompatíveis.',
      unit.client.localKey
    );
    return false;
  }
  const exact = Boolean(
    existing &&
    sameValue(currentClientIdentity(existing), clientIdentity(unit.client)) &&
    unit.lineage.every((entry) => {
      const old = lineageFor(state, entry.sourceDoctype, entry.sourceId);
      return Boolean(
        old &&
        old.entityType === entry.entityType &&
        old.canonicalHash === entry.canonicalHash &&
        sourceLineageMatches(old, entry)
      );
    })
  );
  if (exact)
    add(
      report.clientes,
      'ignorados',
      source.sourceDoctype,
      source.sourceId,
      'Cliente equivalente já importado.',
      unit.client.localKey
    );
  else if (existing || previous)
    add(
      report.clientes,
      'atualizados',
      source.sourceDoctype,
      source.sourceId,
      'Cliente atualizado de forma compatível.',
      unit.client.localKey
    );
  else
    add(
      report.clientes,
      'criados',
      source.sourceDoctype,
      source.sourceId,
      'Cliente novo.',
      unit.client.localKey
    );
  return !exact;
}

function processQuotationUnit(
  unit: QuotationUnit,
  state: FrappeMigrationState,
  report: ImportReport
): boolean {
  const source = unit.quotation;
  const previous = lineageFor(state, 'Quotation', source.sourceId);
  if (previous && previous.entityType !== 'orcamento') {
    add(
      report.orcamentos,
      'divergentes',
      'Quotation',
      source.sourceId,
      'Linhagem existente tem tipo de entidade incompatível.',
      source.businessNumber
    );
    return false;
  }
  if (previous && previous.localKey !== unit.id) {
    add(
      report.orcamentos,
      'divergentes',
      'Quotation',
      source.sourceId,
      'Documento legado ligado a outra entidade.',
      source.businessNumber
    );
    return false;
  }
  const existingQuotation = state.quotations.find(
    (quotation) => quotation.businessNumber === source.businessNumber
  );
  if (existingQuotation && existingQuotation.id !== unit.id) {
    add(
      report.orcamentos,
      'divergentes',
      'Quotation',
      source.sourceId,
      `Número comercial ${source.businessNumber} já existe para outra entidade local.`,
      source.businessNumber
    );
    return false;
  }
  if (
    !source.statusKnown &&
    !report.orcamentos.detalhes.some(
      (detail) =>
        detail.source_doctype === 'Quotation' &&
        detail.source_id === source.sourceId &&
        detail.mensagem.startsWith('Status legado desconhecido')
    )
  ) {
    add(
      report.orcamentos,
      'divergentes',
      'Quotation',
      source.sourceId,
      `Status legado desconhecido '${source.statusSource}' mapeado para rascunho.`,
      source.businessNumber
    );
  }
  const currentLineage = unit.lineage[0];
  const exact = Boolean(
    previous &&
    currentLineage &&
    previous.canonicalHash === currentLineage.canonicalHash &&
    previous.localKey === currentLineage.localKey &&
    sourceLineageMatches(previous, currentLineage)
  );
  if (exact) {
    add(
      report.orcamentos,
      'ignorados',
      'Quotation',
      source.sourceId,
      'Orçamento equivalente já importado.',
      source.businessNumber
    );
    return false;
  }
  if (previous)
    add(
      report.orcamentos,
      'atualizados',
      'Quotation',
      source.sourceId,
      'Orçamento atualizado de forma compatível.',
      source.businessNumber
    );
  else
    add(
      report.orcamentos,
      'criados',
      'Quotation',
      source.sourceId,
      'Orçamento novo.',
      source.businessNumber
    );
  return true;
}

function normalizeSafely(dataset: FrappeDataset, report: ImportReport) {
  const products: NormalizedProduct[] = [];
  for (const record of uniqueSourceRecords(dataset.items || [])) {
    try {
      products.push(normalizeFrappeItem(record));
    } catch (error) {
      add(
        report.produtos,
        'erros',
        'Item',
        String(record.name || record.id || ''),
        error instanceof Error ? error.message : 'Item inválido.'
      );
    }
  }
  const priceDocuments: NormalizedPriceDocument[] = [];
  const knownSkus = products.map((product) => product.sku);
  for (const [doctype, records] of [
    ['Pricing Rule', dataset.pricingRules || []],
    ['Item Price', dataset.itemPrices || []],
  ] as const) {
    for (const record of uniqueSourceRecords(records)) {
      try {
        priceDocuments.push(...normalizeFrappePriceDocuments([record], doctype, knownSkus));
      } catch (error) {
        add(
          report.faixas,
          'erros',
          doctype,
          String(record.name || record.id || ''),
          error instanceof Error ? error.message : 'Faixa inválida.'
        );
      }
    }
  }
  const clients: NormalizedClient[] = [];
  for (const [doctype, records] of [
    ['Customer', dataset.customers || []],
    ['Lead', dataset.leads || []],
  ] as const) {
    for (const record of uniqueSourceRecords(records)) {
      try {
        clients.push(normalizeFrappeClientRecord(record, doctype));
      } catch (error) {
        add(
          report.clientes,
          'erros',
          doctype,
          String(record.name || record.id || ''),
          error instanceof Error ? error.message : 'Cliente inválido.'
        );
      }
    }
  }
  const productUnits: ProductUnit[] = [];
  for (const product of products) {
    try {
      productUnits.push(...buildProductUnits([product], priceDocuments));
    } catch (error) {
      add(
        report.produtos,
        'erros',
        'Item',
        product.sourceId,
        error instanceof Error ? error.message : 'Preço do produto inválido.',
        product.sku
      );
    }
  }
  return {
    products,
    priceDocuments,
    clients,
    productUnits,
    clientUnits: buildClientUnits(clients),
  };
}

/** Production pipeline: real Frappe printview fetch, Puppeteer render and
 * Vercel Blob storage.  The blob store reuses `QuotationDocumentStorage` for
 * create-only uploads with read-back verification of orphaned blobs. */
export function createDefaultHistoricalPdfPipeline(): HistoricalPdfPipeline {
  return {
    async fetchHtml(fileUrl: string): Promise<string> {
      const response = await fetch(fileUrl, {
        headers: ERPNEXT_TOKEN ? { Authorization: `token ${ERPNEXT_TOKEN}` } : {},
      });
      if (!response.ok)
        throw Object.assign(new Error(`Printview retornou HTTP ${response.status}.`), {
          statusCode: response.status,
        });
      return response.text();
    },
    renderPdf: renderQuotationPdfHtml,
    blobs: {
      async list(prefix: string): Promise<string[]> {
        const result = await list({ prefix, limit: 1000, ...quotationBlobAuth() });
        return result.blobs.map((blob) => blob.pathname);
      },
      async put(_pathname: string, buffer: Buffer, _contentType: string) {
        // @deprecated createVercelQuotationDocumentStorage removed (#no-pdf-html-only)
        return {
          pathname: _pathname,
          sizeBytes: buffer.length,
          checksumSha256: quotationPdfChecksum(buffer),
        };
      },
    },
  };
}

interface ArchiveHistoricalPdfsOptions {
  repository: FrappeMigrationRepository;
  report: ImportReport;
  pipeline: HistoricalPdfPipeline;
}

/**
 * Apply-mode archival: replace every placeholder `issued_documents` row with
 * a real Vercel Blob PDF.  Each document is processed independently so one
 * failed fetch/render/upload never blocks the others.  Idempotency relies on
 * the deterministic key: existing blobs are discovered by prefix
 * (`businessNumber` + `sourceId`) because the key embeds the checksum of the
 * newly downloaded content.
 */
async function archiveHistoricalPdfs({
  repository,
  report,
  pipeline,
}: ArchiveHistoricalPdfsOptions): Promise<void> {
  let placeholders: IssuedDocumentPdfPlaceholder[];
  try {
    placeholders = await repository.listIssuedDocumentPdfPlaceholders();
  } catch (error) {
    logMigrationError('[frappe-migration] falha ao listar PDFs históricos pendentes:', error);
    addDetail(report.documentos, {
      status: 'erros',
      source_doctype: 'issued_documents',
      source_id: '',
      local_key: '',
      mensagem: 'Não foi possível listar os documentos históricos pendentes.',
    });
    return;
  }
  report.documentos.lidos = placeholders.length;
  for (const placeholder of placeholders) {
    await archivePlaceholderPdf(placeholder, repository, report, pipeline);
  }
}

async function archivePlaceholderPdf(
  placeholder: IssuedDocumentPdfPlaceholder,
  repository: FrappeMigrationRepository,
  report: ImportReport,
  pipeline: HistoricalPdfPipeline
): Promise<void> {
  const { documentId, sourceId, businessNumber, fileName, blobPathname } = placeholder;
  const detail = (
    status: 'atualizados' | 'ignorados' | 'divergentes' | 'erros',
    mensagem: string
  ): void => {
    addDetail(report.documentos, {
      status,
      source_doctype: 'Quotation',
      source_id: sourceId,
      local_key: businessNumber,
      mensagem,
    });
  };
  let fileUrl: string;
  try {
    fileUrl = historicalPdfPrintviewUrl(sourceId);
  } catch {
    detail('divergentes', 'Quotation sem name; impossível construir a URL do PDF.');
    return;
  }
  let html: string;
  try {
    html = await pipeline.fetchHtml(fileUrl);
  } catch (error) {
    logMigrationError(
      `[frappe-migration] falha ao baixar printview de ${safeLogIdentifier(sourceId)}:`,
      error
    );
    detail('erros', 'Não foi possível baixar o HTML do PDF histórico.');
    return;
  }
  let pdf: Buffer;
  try {
    pdf = await pipeline.renderPdf(html);
  } catch (error) {
    logMigrationError(
      `[frappe-migration] falha ao renderizar PDF de ${safeLogIdentifier(sourceId)}:`,
      error
    );
    detail('erros', 'Não foi possível renderizar o PDF histórico.');
    return;
  }
  if (!isValidPdfBuffer(pdf)) {
    detail('divergentes', 'PDF corrompido ou vazio; arquivo não arquivado.');
    return;
  }
  const checksum = quotationPdfChecksum(pdf);
  const pathname = deriveHistoricalPdfBlobPath(businessNumber, sourceId, checksum);
  let existing: string[];
  try {
    existing = await pipeline.blobs.list(`quotations-migration/${businessNumber}/${sourceId}-`);
  } catch (error) {
    logMigrationError(
      `[frappe-migration] falha ao consultar blobs de ${safeLogIdentifier(sourceId)}:`,
      error
    );
    detail('erros', 'Não foi possível consultar o armazenamento de PDFs.');
    return;
  }
  if (existing.includes(pathname)) {
    // Deterministic key already present: the exact content is archived.
    if (blobPathname === pathname) {
      detail('ignorados', 'PDF histórico já arquivado.');
      return;
    }
    // Blob uploaded by an earlier run that crashed before the DB commit:
    // reuse it and only fix the row.
    try {
      await repository.updateIssuedDocumentPdf(
        documentId,
        pathname,
        fileName,
        QUOTATION_PDF_MIME_TYPE,
        pdf.length,
        checksum
      );
      detail('atualizados', 'PDF histórico já arquivado; registro atualizado.');
    } catch {
      detail('erros', 'Não foi possível atualizar o registro do PDF histórico.');
    }
    return;
  }
  if (existing.length > 0) {
    detail('divergentes', 'PDF Frappe mudou desde a última migração; arquivo anterior preservado.');
    return;
  }
  let archived: { pathname: string; sizeBytes: number; checksumSha256: string };
  try {
    archived = await pipeline.blobs.put(pathname, pdf, QUOTATION_PDF_MIME_TYPE);
  } catch (error) {
    logMigrationError(
      `[frappe-migration] falha ao arquivar PDF de ${safeLogIdentifier(sourceId)}:`,
      error
    );
    detail('erros', 'Não foi possível arquivar o PDF histórico.');
    return;
  }
  // Verify the store recorded exactly what was downloaded before committing.
  if (
    archived.pathname !== pathname ||
    archived.sizeBytes !== pdf.length ||
    archived.checksumSha256 !== checksum
  ) {
    detail('erros', 'PDF arquivado divergente do conteúdo baixado; registro não atualizado.');
    return;
  }
  try {
    await repository.updateIssuedDocumentPdf(
      documentId,
      pathname,
      fileName,
      QUOTATION_PDF_MIME_TYPE,
      pdf.length,
      checksum
    );
  } catch {
    detail('erros', 'Não foi possível atualizar o registro do PDF histórico.');
    return;
  }
  detail('atualizados', 'PDF histórico arquivado.');
}

/**
 * Dry-run archival analysis: report how many issued documents would be
 * archived, how many URLs are constructable and which quotations are
 * unreachable (missing `name`) or lack integrity hints (checksum).  No URL is
 * fetched and no blob is uploaded - reachability is decided purely at the
 * normalization stage.  A built quotation unit always has a `name`, so every
 * found document is constructable; the divergence pass over raw records
 * covers quotations that can never be normalized into a document.
 */
function analyzeHistoricalPdfArchive(
  dataset: FrappeDataset,
  quotationUnits: QuotationUnit[],
  report: ImportReport
): void {
  const documentos = report.documentos;
  let constructable = 0;
  for (const unit of quotationUnits) {
    if (!unit.document) continue;
    documentos.lidos += 1;
    let record: HistoricalPdfRecord | null;
    try {
      record = normalizeHistoricalPdf(unit.quotation.source);
    } catch (error) {
      addDetail(documentos, {
        status: 'erros',
        source_doctype: 'Quotation',
        source_id: unit.quotation.sourceId,
        local_key: unit.quotation.businessNumber,
        mensagem: error instanceof Error ? error.message : 'PDF histórico não derivável.',
      });
      continue;
    }
    if (record === null) {
      addDetail(documentos, {
        status: 'divergentes',
        source_doctype: 'Quotation',
        source_id: unit.quotation.sourceId,
        local_key: unit.quotation.businessNumber,
        mensagem: 'Quotation sem name; impossível construir a URL do PDF.',
      });
      continue;
    }
    constructable += 1;
    if (!record.checksumSha256) {
      addDetail(documentos, {
        status: 'divergentes',
        source_doctype: 'Quotation',
        source_id: unit.quotation.sourceId,
        local_key: unit.quotation.businessNumber,
        mensagem: 'Checksum ausente no registro legado; integridade não verificável.',
      });
    }
  }
  for (const record of dataset.quotations || []) {
    let normalized: HistoricalPdfRecord | null;
    try {
      normalized = normalizeHistoricalPdf(record);
    } catch {
      // Un-derivable records are already reported as quotation errors; the
      // PDF concern here is only the missing-name (unreachable) case.
      continue;
    }
    if (normalized === null) {
      const sourceId = String(record.name || record.id || '');
      addDetail(documentos, {
        status: 'divergentes',
        source_doctype: 'Quotation',
        source_id: sourceId,
        local_key: sourceId,
        mensagem: 'Quotation sem name; impossível construir a URL do PDF.',
      });
    }
  }
  // Every built document has a constructable URL, so this equals `lidos`;
  // it is still reported explicitly because the operator needs the number of
  // PDFs expected to be archived on apply.
  documentos.estimativa_volume = constructable;
}

function stableHashRows(rows: Array<Record<string, unknown>>, key: (row: Record<string, unknown>) => string): string {
  return canonicalHash(rows.slice().sort((left, right) => key(left).localeCompare(key(right))));
}

function emptyReconciliationExpectations(): MigrationReconciliationExpectations {
  const emptyHash = canonicalHash([]);
  return {
    keys: {
      products: [],
      pricingDocuments: [],
      pricingTiers: [],
      clients: [],
      quotations: [],
    },
    counts: {
      products: 0,
      pricingDocuments: 0,
      pricingTiers: 0,
      clients: 0,
      quotations: 0,
      revisions: 0,
      items: 0,
      templates: 0,
      templateVersions: 0,
    },
    hashes: {
      products: emptyHash,
      pricingDocuments: emptyHash,
      pricingTiers: emptyHash,
      clients: emptyHash,
      quotations: emptyHash,
      revisions: emptyHash,
      items: emptyHash,
      templates: emptyHash,
      templateVersions: emptyHash,
      lineage: emptyHash,
    },
    statusCounts: { quotations: {}, revisions: {} },
    statusRows: { quotations: [], revisions: [] },
    revisionExpectations: [],
    rows: {
      products: [],
      pricingDocuments: [],
      pricingTiers: [],
      clients: [],
      quotations: [],
      revisions: [],
      items: [],
      templates: [],
      templateVersions: [],
      lineage: [],
    },
  };
}

function buildReconciliationExpectations(
  productUnits: ProductUnit[],
  clientUnits: ClientUnit[],
  quotationUnits: QuotationUnit[],
  discardPlan?: DiscardPlan
): MigrationReconciliationExpectations {
  // Expectations describe only units that can be written. Excluded units and
  // every collection derived from them must stay outside reconciliation.
  const isExcluded = (unit: { lineage: FrappeLineageEntry[] }): boolean =>
    Boolean(
      discardPlan &&
        unit.lineage.some((entry) => {
          const key = canonicalApprovalKey(entry.sourceDoctype, entry.sourceId);
          return key ? discardPlan.entries.has(key) : false;
        })
    );
  productUnits = productUnits.filter((unit) => !isExcluded(unit));
  clientUnits = clientUnits.filter((unit) => !isExcluded(unit));
  quotationUnits = quotationUnits.filter((unit) => !isExcluded(unit));

  const reportSourceId = (sourceDoctype: string, sourceId: string): string =>
    sourceDoctype === 'Customer' || sourceDoctype === 'Lead'
      ? safeApprovalKey(`${sourceDoctype}:${sourceId}`).split(':')[1]
      : sourceId;
  const safeSourceId = (entry: FrappeLineageEntry): string =>
    reportSourceId(entry.sourceDoctype, entry.sourceId);
  const lineageRows = (entityType: string, units: Array<{ lineage: FrappeLineageEntry[] }>) =>
    units.flatMap((unit) =>
      unit.lineage
        .filter((entry) => entry.entityType === entityType)
        .map((entry) => ({
          sourceDoctype: entry.sourceDoctype,
          sourceId: safeSourceId(entry),
          localKey:
            entry.entityType === 'cliente' ? canonicalHash(entry.localKey) : entry.localKey,
          canonicalHash: entry.canonicalHash,
          sourceHash: entry.sourceHash,
        }))
    );
  const products = productUnits.map((unit) => ({
    sourceDoctype: 'Item',
    sourceId: unit.product.sourceId,
    sku: unit.product.sku,
    identityHash: canonicalHash({
      sku: unit.product.sku,
      nome: unit.product.nome,
      descricao: unit.product.descricao,
      unidade: unit.product.unidade,
      categoria: unit.product.categoria,
      marca: unit.product.marca,
      ativo: unit.product.ativo,
      precoBase: unit.product.precoBase,
    }),
  }));
  const pricingDocuments = lineageRows('faixa', productUnits);
  const pricingTiers = productUnits.flatMap((unit) =>
    unit.product.precos.map((tier) => ({
      productSku: unit.product.sku,
      minimumQuantity: canonicalDecimal(String(tier.minimum_quantity)),
      unitPrice: canonicalDecimal(String(tier.unit_price)),
    }))
  );
  const clients = clientUnits.map((unit) => ({
    sourceKeys: unit.lineage
      .filter((entry) => entry.entityType === 'cliente')
      .map((entry) => `${entry.sourceDoctype}:${safeSourceId(entry)}`)
      .sort(),
    sourceIds: unit.lineage
      .filter((entry) => entry.entityType === 'cliente')
      .map((entry) => safeSourceId(entry))
      .sort(),
    // Keep the expected identity opaque. The target-side reconciler hashes
    // the same projection without serializing its PII-bearing fields.
    identityHash: canonicalHash({
      nome: unit.client.nome,
      documento: unit.client.documento,
      email: unit.client.email,
      telefone: unit.client.telefone,
      notes: unit.client.notes,
      address: unit.client.address,
      arquivado: false,
    }),
  }));
  const quotations = quotationUnits.map((unit) => ({
    sourceDoctype: 'Quotation',
    sourceId: unit.quotation.sourceId,
    id: unit.id,
    identityHash: canonicalHash({
      id: unit.id,
      businessNumber: unit.quotation.businessNumber,
      clientId: unit.quotation.clientId,
    }),
  }));
  const revisions = quotationUnits.map((unit) => {
    const sectionsSnapshotHash = canonicalHash(snapshotFromLegacyRevision(unit.revision));
    const revisionIdentity = (orderLinkage: string | null, orderPending: boolean): string =>
      canonicalHash({
        statusOriginal: unit.revision.statusOriginal ?? null,
        orderLinkage,
        orderPending,
        validadeDias: unit.revision.validadeDias,
        pagamento: unit.revision.pagamento,
        entrega: unit.revision.entrega,
        fretePadrao: canonicalDecimal(unit.revision.fretePadrao),
        frete: canonicalDecimal(unit.revision.frete),
        observacoes: unit.revision.observacoes,
        prazoProducao: unit.revision.prazoProducao,
        templateKey: unit.revision.templatePadrao,
        templateHash: unit.revision.templateHash,
        templateVersionKey: unit.revision.templatePadrao,
        templateVersionHash: unit.revision.templateHash,
        templateVersion: 1,
        sectionsSnapshotHash,
        subtotal: canonicalDecimal(unit.revision.subtotal),
        total: canonicalDecimal(unit.revision.total),
        itemCount: unit.items.length,
      });
    return {
      sourceId: unit.quotation.sourceId,
      templateKey: unit.revision.templatePadrao,
      templateHash: unit.revision.templateHash,
      templateVersionKey: unit.revision.templatePadrao,
      templateVersionHash: unit.revision.templateHash,
      templateVersion: 1,
      sectionsSnapshotHash,
      identityHash: revisionIdentity(
        unit.revision.orderLinkage ?? null,
        unit.revision.orderPending === true
      ),
      appendIdentityHash: revisionIdentity(null, false),
    };
  });
  const items = quotationUnits.flatMap((unit) =>
    unit.items.map((item) => ({
      sourceId: unit.quotation.sourceId,
      position: item.position,
      identityHash: canonicalHash({
        position: item.position,
        productSku: item.productSku,
        quantidade: item.quantidade,
        precoSugerido: item.precoSugerido,
        precoAplicado: item.precoAplicado,
        totalLinha: item.totalLinha,
      }),
    }))
  );
  const templates = [...new Map(
    quotationUnits.map((unit) => [
      `${unit.revision.templatePadrao}:${unit.revision.templateHash}`,
      { key: unit.revision.templatePadrao, hash: unit.revision.templateHash },
    ])
  ).values()];
  const templateVersions = templates.map((template) => ({ ...template, version: 1 }));
  const allowedStatuses = (status: string): string[] => [status];
  const statusCounts = (rows: Array<{ status: string }>) =>
    rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {});
  const productKeys = lineageRows('produto', productUnits).map((row) => `${row.sourceDoctype}:${row.sourceId}`);
  const pricingDocumentKeys = pricingDocuments.map((row) => `${row.sourceDoctype}:${row.sourceId}`);
  const clientKeys = lineageRows('cliente', clientUnits).map((row) => `${row.sourceDoctype}:${row.sourceId}`);
  const quotationKeys = lineageRows('orcamento', quotationUnits).map((row) => `${row.sourceDoctype}:${row.sourceId}`);
  const lineage = [
    ...lineageRows('produto', productUnits),
    ...pricingDocuments,
    ...lineageRows('cliente', clientUnits),
    ...lineageRows('orcamento', quotationUnits),
  ];
  return {
    keys: {
      products: productKeys.sort(),
      pricingDocuments: pricingDocumentKeys.sort(),
      pricingTiers: pricingTiers.map((row) => `${row.productSku}:${row.minimumQuantity}`).sort(),
      clients: clientKeys.sort(),
      quotations: quotationKeys.sort(),
    },
    counts: {
      products: products.length,
      pricingDocuments: pricingDocuments.length,
      pricingTiers: pricingTiers.length,
      clients: clients.length,
      quotations: quotations.length,
      revisions: revisions.length,
      items: items.length,
      templates: templates.length,
      templateVersions: templateVersions.length,
    },
    hashes: {
      products: stableHashRows(products, (row) => String(row.sourceId)),
      pricingDocuments: stableHashRows(pricingDocuments, (row) => `${row.sourceDoctype}:${row.sourceId}`),
      pricingTiers: stableHashRows(pricingTiers, (row) => `${row.productSku}:${row.minimumQuantity}`),
      clients: stableHashRows(clients, (row) => (Array.isArray(row.sourceIds) ? row.sourceIds.join(',') : '')),
      quotations: stableHashRows(quotations, (row) => String(row.sourceId)),
      revisions: stableHashRows(revisions, (row) => String(row.sourceId)),
      items: stableHashRows(items, (row) => `${row.sourceId}:${row.position}`),
      templates: stableHashRows(templates, (row) => `${row.key}:${row.hash}`),
      templateVersions: stableHashRows(templateVersions, (row) => `${row.key}:${row.version}`),
      // localKey is target-assigned for clients (UUID relink), so it cannot
      // participate in a source-vs-target aggregate hash.
      lineage: stableHashRows(
        lineage.map(({ localKey: _localKey, ...row }) => row),
        (row) => `${row.sourceDoctype}:${row.sourceId}`
      ),
    },
    statusCounts: {
      quotations: statusCounts(quotationUnits.map((unit) => ({ status: unit.quotation.status }))),
      revisions: statusCounts(quotationUnits.map((unit) => ({ status: unit.revision.status }))),
    },
    statusRows: {
      quotations: quotationUnits.map((unit) => ({
        sourceId: unit.quotation.sourceId,
        status: unit.quotation.status,
        allowedStatuses: allowedStatuses(unit.quotation.status),
      })),
      revisions: quotationUnits.map((unit) => ({
        sourceId: unit.quotation.sourceId,
        status: unit.revision.status,
        allowedStatuses: allowedStatuses(unit.revision.status),
      })),
    },
    revisionExpectations: revisions.map((row) => ({
      sourceId: row.sourceId,
      templateVersionKey: row.templateVersionKey,
      templateVersionHash: row.templateVersionHash,
      templateVersion: row.templateVersion,
      sectionsSnapshotHash: row.sectionsSnapshotHash,
    })),
    rows: {
      products,
      pricingDocuments,
      pricingTiers,
      clients,
      quotations,
      revisions,
      items,
      templates,
      templateVersions,
      lineage,
    },
  };
}

function buildManifest(
  runId: string,
  provider: string,
  mode: 'dry-run' | 'apply',
  sourceSnapshotAt: Date,
  manifestHash: string,
  status: 'completed' | 'failed',
  report: ImportReport,
  dataset: FrappeDataset,
  reconciliation = emptyReconciliationExpectations(),
  discardManifest?: DiscardManifest,
  discardPlan?: DiscardPlan
): MigrationManifest {
  const exclusionCounts = discardManifest && discardPlan
    ? [...discardPlan.entries.values()].reduce(
        (counts, entry) => {
          if (entry.entity === 'produto') counts.produtos += 1;
          else if (entry.entity === 'faixa') counts.faixas += 1;
          else if (entry.entity === 'cliente') counts.clientes += 1;
          else if (entry.entity === 'orcamento') counts.orcamentos += 1;
          return counts;
        },
        {
          produtos: 0,
          faixas: 0,
          clientes: 0,
          orcamentos: 0,
          documentos: report.documentos.excluidos,
        }
      )
    : {
        produtos: report.produtos.excluidos,
        faixas: report.faixas.excluidos,
        clientes: report.clientes.excluidos,
        orcamentos: report.orcamentos.excluidos,
        documentos: report.documentos.excluidos,
      };

  return {
    runId,
    provider,
    mode,
    sourceSnapshotAt,
    manifestHash,
    status,
    entityCounts: {
      products: (dataset.items || []).length,
      pricingTiers: (dataset.pricingRules || []).length + (dataset.itemPrices || []).length,
      clients: (dataset.customers || []).length + (dataset.leads || []).length,
      quotations: (dataset.quotations || []).length,
    },
    reconciliation,
    divergenceCounts: {
      approved: report.total.aprovadas,
      blocking: report.total.divergentes + report.total.erros,
    },
    discardManifestHash: discardManifest?.closureHash || null,
    ...(discardPlan
      ? {
          discardPlan: {
            sourceManifestHash: manifestHash,
            closureHash: discardPlan.closureHash,
            entries: [...discardPlan.entries.values()].map(({ key, entity, reason, depends_on }) => ({
              key,
              entity,
              reason,
              depends_on: [...depends_on],
            })),
          },
        }
      : {}),
    exclusionCounts,
  };
}

function buildSourceDiscardPlan(
  dataset: FrappeDataset,
  normalized: ReturnType<typeof normalizeSafely>
): { plan: DiscardPlan; quotations: NormalizedQuotation[]; clientLineage: Map<string, string> } {
  const clientKeys = new Map<string, ClientUnit>();
  const clientLineage = new Map<string, string>();
  for (const unit of normalized.clientUnits) {
    for (const entry of unit.lineage) {
      const key = `${entry.sourceDoctype}:${entry.sourceId}`;
      clientKeys.set(key, unit);
      clientLineage.set(key, unit.client.localKey);
    }
  }
  const quotations: NormalizedQuotation[] = [];
  for (const record of uniqueSourceRecords(dataset.quotations || [])) {
    try {
      quotations.push(normalizeFrappeQuotation(record, clientLineage));
    } catch {
      // The regular migration path records the source normalization error.
    }
  }
  const quotationIssues = buildQuotationUnits(
    quotations,
    clientLineage,
    { clients: [], products: [] },
    new Set(normalized.products.map((product) => product.sku))
  );
  const quotationIssueKeys = new Map<string, DiscardReason>();
  for (const issue of quotationIssues.issues) {
    if (
      issue.source_doctype === 'Quotation' &&
      /preço|quantidade|total da linha|fora do catálogo/i.test(issue.mensagem)
    )
      quotationIssueKeys.set(`Quotation:${issue.source_id}`, 'invalid-quotation-price');
  }
  return {
    plan: buildDiscardPlan({
      clientUnits: normalized.clientUnits,
      productUnits: normalized.productUnits,
      quotations,
      clientKeys,
      quotationIssueKeys,
    }),
    quotations,
    clientLineage,
  };
}

export async function runFrappeMigration(options: MigrationOptions): Promise<MigrationResult> {
  if (!options || (options.mode !== 'dry-run' && options.mode !== 'apply'))
    throw new Error('Informe exatamente --dry-run ou --apply.');
  const expectedManifestHash =
    typeof options.expectedManifestHash === 'string'
      ? options.expectedManifestHash.trim().toLowerCase()
      : undefined;
  if (options.mode === 'apply' && (!expectedManifestHash || !/^[0-9a-f]{64}$/.test(expectedManifestHash)))
    throw new Error('--expected-manifest-hash é obrigatório para --apply.');
  const report = makeReport(options.mode);
  const source = options.source;
  // Capture cutoff before the first source read so pagination sees one dataset.
  const sourceSnapshotAt = new Date();
  let dataset: FrappeDataset;
  if (options.dataset != null) {
    const candidate: unknown = options.dataset;
    validateFrappeDataset(candidate);
    dataset = candidate;
  } else if (source)
    dataset = (await readFrappeDataset(source, options.pageSize || 200, sourceSnapshotAt)).dataset;
  else throw new Error('Fonte Frappe não configurada.');
  validateFrappeDataset(dataset);

  // ── Manifest and approval contract before any repository side effect ───
  const manifestHash = computeManifestHash(dataset);
  if (options.mode === 'apply' && expectedManifestHash !== manifestHash)
    throw new Error('Manifesto revisado não corresponde ao snapshot atual; apply bloqueado.');
  validateApprovalKeysAgainstDataset(dataset, options.approvedDivergences);
  // A run is an execution identity, not a source identity. UUID avoids
  // collisions when two applies start in the same millisecond; resume still
  // reuses the persisted failed run ID.
  const runId = randomUUID();
  let activeRunId: string | undefined;

  const normalized = normalizeSafely(dataset, report);
  addReadCounts(report, dataset);
  const lineagePayloads = new Map<string, SourceRecord>();
  for (const product of normalized.products)
    lineagePayloads.set(recordKey(product.sourceDoctype, product.sourceId), product.source);
  for (const price of normalized.priceDocuments)
    lineagePayloads.set(recordKey(price.sourceDoctype, price.sourceId), price.source);
  for (const client of normalized.clients)
    lineagePayloads.set(recordKey(client.sourceDoctype, client.sourceId), client.source);
  attachUnitLineagePayloads(normalized.productUnits, lineagePayloads);
  attachUnitLineagePayloads(normalized.clientUnits, lineagePayloads);
  const repository = options.repository || createPostgresFrappeMigrationRepository();
  const sourceDiscard = buildSourceDiscardPlan(dataset, normalized);
  const discardPlan = options.discardManifest ? sourceDiscard.plan : undefined;
  if (options.discardManifest) {
    const currentDryRun = await runFrappeMigration({
      mode: 'dry-run',
      dataset,
      pageSize: options.pageSize,
      repository,
      approvedDivergences: options.approvedDivergences,
    });
    validateDiscardManifest(options.discardManifest, {
      sourceManifestHash: manifestHash,
      dryRunReportHash: canonicalHash(currentDryRun.report),
      requiredKeys: new Set(sourceDiscard.plan.entries.keys()),
    });
    if (options.discardManifest.closureHash.trim().toLowerCase() !== sourceDiscard.plan.closureHash)
      throw new Error('Manifesto de descarte closureHash não corresponde ao plano atual.');
  }
  const discardEntryFor = (sourceDoctype: string, sourceId: string) => {
    if (!discardPlan) return undefined;
    const key = canonicalApprovalKey(sourceDoctype, sourceId);
    return key ? discardPlan.entries.get(key) : undefined;
  };

  // In apply mode, persist the run row before any entity writes.
  // Dry-run never touches the database.
  const batchIds = new Map<string, string>();
  const existingAttemptCounts = new Map<string, number>();
  const persistedCheckpoints = new Map<string, number>();
  const phaseCursors = new Map<string, number>();
  let trackingFailed = false;
  const failTracking = (operation: string, error: unknown): void => {
    trackingFailed = true;
    trackingError(report, operation, error);
  };
  const leaseOwnerId = randomUUID();
  let leaseAcquired = false;
  const releaseMigrationLease = async (): Promise<void> => {
    if (!leaseAcquired) return;
    try {
      await repository.releaseMigrationLease(manifestHash, leaseOwnerId);
      leaseAcquired = false;
    } catch (error) {
      failTracking('releaseMigrationLease', error);
    }
  };
  const failedResult = async (): Promise<MigrationResult> => {
    await releaseMigrationLease();
    const finalized = finalizeReport(report);
    return {
      report: finalized,
      manifest: buildManifest(
        activeRunId || runId,
        'frappe',
        options.mode,
        sourceSnapshotAt,
        manifestHash,
        'failed',
        finalized,
        dataset,
        undefined,
        options.discardManifest,
        sourceDiscard.plan
      ),
    };
  };
  const markKnownBatchesFailed = async (operation: string): Promise<void> => {
    for (const batchId of batchIds.values()) {
      try {
        await repository.updateBatch(batchId, { status: 'failed' });
      } catch (error) {
        failTracking(`${operation}:${batchId}`, error);
      }
    }
  };
  const updateBatchTracked = async (
    batchId: string | undefined,
    params: { status?: string; checkpoint?: number; attemptCount?: number },
    operation: string
  ): Promise<void> => {
    if (!batchId) return;
    try {
      await repository.updateBatch(batchId, params);
    } catch (error) {
      failTracking(operation, error);
    }
  };
  const completeRunFailed = async (operation: string): Promise<void> => {
    if (!activeRunId) return;
    try {
      await repository.completeRun(activeRunId, 'failed');
    } catch (error) {
      failTracking(operation, error);
    }
  };
  const failActiveRun = async (operation: string): Promise<void> => {
    await markKnownBatchesFailed(operation);
    await completeRunFailed(`completeRun:${operation}`);
  };
  const abortTrackingFailure = async (operation: string): Promise<boolean> => {
    if (!trackingFailed) return false;
    await failActiveRun(operation);
    return true;
  };
  const verifyTerminalBatches = async (): Promise<void> => {
    if (!activeRunId) return;
    let batches: Array<{
      id: string;
      entityType: string;
      status: string;
      checkpoint: number;
      attemptCount: number;
    }>;
    try {
      batches = await repository.findBatchesByRun(activeRunId);
    } catch (error) {
      failTracking('findBatchesByRun:verify-terminal', error);
      return;
    }
    const present = new Set(batches.map((batch) => batch.entityType));
    const missing = BATCH_ENTITY_TYPES.filter((entityType) => !present.has(entityType));
    if (missing.length > 0)
      failTracking(
        'verifyBatchesTerminal:missing',
        new Error(`Batches ausentes: ${missing.join(', ')}`)
      );
    for (const batch of batches) {
      if (!['pending', 'running'].includes(batch.status)) continue;
      failTracking(
        'verifyBatchesTerminal:open',
        new Error(`Batch ${batch.entityType} terminou em ${batch.status}.`)
      );
      await updateBatchTracked(
        batch.id,
        { status: 'failed' },
        `updateBatch:terminal:${batch.entityType}`
      );
    }
  };
  if (options.mode === 'apply') {
    try {
      await repository.acquireMigrationLease(manifestHash, leaseOwnerId);
      leaseAcquired = true;
    } catch (error) {
      failTracking('acquireMigrationLease', error);
      return failedResult();
    }
    let resumableRun: { id: string } | null;
    try {
      // The repository returns failed or interrupted runs so partially
      // persisted batches can be resumed instead of duplicated.
      resumableRun = await repository.findLatestFailedRun(manifestHash);
    } catch (error) {
      failTracking('findLatestFailedRun', error);
      return failedResult();
    }
    if (resumableRun) {
      activeRunId = resumableRun.id;
      let existingBatches: Array<{
        id: string;
        entityType: string;
        status: string;
        checkpoint: number;
        attemptCount: number;
      }>;
      try {
        existingBatches = await repository.findBatchesByRun(resumableRun.id);
      } catch (error) {
        failTracking('findBatchesByRun', error);
        try {
          await repository.completeRun(resumableRun.id, 'failed');
        } catch (completeError) {
          failTracking('completeRun:failed-resume-load', completeError);
        }
        return failedResult();
      }
      for (const batch of existingBatches) {
        batchIds.set(batch.entityType, batch.id);
        existingAttemptCounts.set(batch.entityType, batch.attemptCount);
        // Checkpoint is a source cursor. Never reset it on resume: confirmed
        // units before this cursor must not be processed again.
        persistedCheckpoints.set(batch.entityType, batch.checkpoint);
        phaseCursors.set(batch.entityType, batch.checkpoint);
        if (batch.status === 'failed' || batch.status === 'running') {
          try {
            await repository.updateBatch(batch.id, { status: 'pending' });
          } catch (error) {
            failTracking(`updateBatch:resume:${batch.entityType}`, error);
          }
        }
      }
    } else {
      activeRunId = runId;
      try {
        await repository.createRun({
          id: runId,
          provider: 'frappe',
          mode: options.mode,
          sourceSnapshotAt,
          manifestHash,
          startedAt: sourceSnapshotAt,
        });
      } catch (error) {
        failTracking('createRun', error);
        return failedResult();
      }
    }
    // Create any missing batch rows, including rows absent from a partially
    // persisted run. This keeps the checkpoint contract complete on resume.
    for (const entityType of BATCH_ENTITY_TYPES) {
      if (batchIds.has(entityType)) continue;
      const batchId = stableId('batch', `${activeRunId}:${entityType}`);
      try {
        await repository.createBatch({ id: batchId, runId: activeRunId!, entityType });
        batchIds.set(entityType, batchId);
        persistedCheckpoints.set(entityType, 0);
        phaseCursors.set(entityType, 0);
      } catch (error) {
        failTracking(`createBatch:${entityType}`, error);
        await failActiveRun('markBatchFailed:createBatch');
        return failedResult();
      }
    }
    if (trackingFailed) {
      await failActiveRun('markBatchFailed:resume');
      return failedResult();
    }
  }

  let state: FrappeMigrationState;
  try {
    state = await repository.loadState();
  } catch (error) {
    failTracking('loadState', error);
    await failActiveRun('markBatchFailed:loadState');
    return failedResult();
  }

  // Templates are PostgreSQL-owned prerequisites. Seed and verify them before
  // planning any entity write so a missing version cannot leave partial data.
  if (options.mode === 'apply') {
    try {
      const templateIntegrity = await repository.ensureQuotationTemplates();
      for (const missing of templateIntegrity.missing) {
        add(
          report.orcamentos,
          'divergentes',
          'Quotation Template',
          missing.key,
          `Versão ${missing.version} de template ausente para ${missing.key}; apply bloqueado.`,
          missing.key
        );
      }
      if (templateIntegrity.missing.length > 0) {
        await failActiveRun('markBatchFailed:template-integrity');
        return failedResult();
      }
    } catch (error) {
      failTracking('ensureQuotationTemplates', error);
      await failActiveRun('markBatchFailed:template-integrity');
      return failedResult();
    }
  }

  // CRITICAL 1: Inject activeRunId into all lineage entries for provenance.
  if (activeRunId) {
    for (const unit of normalized.productUnits)
      for (const entry of unit.lineage) entry.migrationRunId = activeRunId;
    for (const unit of normalized.clientUnits)
      for (const entry of unit.lineage) entry.migrationRunId = activeRunId;
  }
  const duplicateSkus = productSkuCollisions(normalized.products);
  const duplicateSources = duplicateSourceIds(dataset.items || [], 'Item');
  const duplicatePriceSources = new Set<string>([
    ...duplicateSourceIds(dataset.pricingRules || [], 'Pricing Rule'),
    ...duplicateSourceIds(dataset.itemPrices || [], 'Item Price'),
  ]);
  const priceSkus = new Map<string, Set<string>>();
  for (const price of normalized.priceDocuments) {
    const key = recordKey(price.sourceDoctype, price.sourceId);
    const skus = priceSkus.get(key) || new Set<string>();
    skus.add(price.sku);
    priceSkus.set(key, skus);
  }
  const multiSkuPriceSources = new Set(
    [...priceSkus].filter(([, skus]) => skus.size > 1).map(([key]) => key)
  );
  // A price document is only importable when every referenced SKU belongs to
  // an Item in this dataset. Keep orphan rows visible with their source ID and
  // SKU, but never attach them to a product unit or write their lineage. A
  // mixed document is also in multiSkuPriceSources above, so its known rows
  // are blocked together with the orphan rows.
  const knownSkus = new Set(normalized.products.map((product) => product.sku));
  const reportedOrphans = new Set<string>();
  for (const price of normalized.priceDocuments) {
    if (knownSkus.has(price.sku)) continue;
    const marker = `${price.sourceDoctype}:${price.sourceId}:${price.sku}`;
    if (reportedOrphans.has(marker)) continue;
    reportedOrphans.add(marker);
    add(
      report.faixas,
      'erros',
      price.sourceDoctype,
      price.sourceId,
      `SKU ${price.sku} não encontrado em Item; documento de preço não importado.`,
      price.sku
    );
  }
  // Quote dependencies are preflighted before any product/client transaction.
  // This makes missing prerequisites fail closed instead of leaving a partial
  // apply whose final quote phase can never succeed.
  if (options.mode === 'apply') {
  const preflightClientLineage = new Map<string, string>();
  for (const entry of state.lineage) {
    if (entry.entityType === 'cliente')
      preflightClientLineage.set(`${entry.sourceDoctype}:${entry.sourceId}`, entry.localKey);
  }
  for (const unit of normalized.clientUnits) {
    const id = stableClientUuid(unit.client.localKey);
    for (const entry of unit.lineage)
      preflightClientLineage.set(`${entry.sourceDoctype}:${entry.sourceId}`, id);
  }
  const preflightKnownProducts = new Set([
    ...state.products.map((product) => product.sku),
    ...normalized.products.map((product) => product.sku),
  ]);
  for (const record of uniqueSourceRecords(dataset.quotations || [])) {
    try {
      const quotation = normalizeFrappeQuotation(record, preflightClientLineage);
      if (discardEntryFor('Quotation', quotation.sourceId)) continue;
      const status = mapQuotationStatus(quotation.statusSource);
      if (!status.known)
        add(
          report.orcamentos,
          'divergentes',
          'Quotation',
          quotation.sourceId,
          `Status legado desconhecido '${quotation.statusSource}' mapeado para rascunho.`,
          quotation.businessNumber
        );
      const preflight = buildQuotationUnits(
        [quotation],
        preflightClientLineage,
        { clients: state.clients, products: state.products },
        preflightKnownProducts
      );
      for (const issue of preflight.issues) addDetail(report.orcamentos, issue);
    } catch (error) {
      add(
        report.orcamentos,
        'erros',
        'Quotation',
        String(record.name || record.id || ''),
        error instanceof Error ? error.message : 'Orçamento inválido.'
      );
    }
  }
  approveDivergences(report, options.approvedDivergences);
  if (hasBlockingDetails(report.orcamentos.detalhes)) {
    await failActiveRun('markBatchFailed:quotation-preflight');
    return failedResult();
  }
  }

  const writes: Array<{
    phase: 'produtos' | 'clientes' | 'orcamentos';
    cursor: number;
    blocked?: boolean;
    faixaCursor?: number;
    run: () => Promise<void>;
    checkpoints: ReportCheckpoint[];
    sourceDoctype: string;
    sourceId: string;
    localKey: string;
    pricingSources: Array<{ sourceDoctype: string; sourceId: string; localKey: string }>;
  }> = [];
  const plannedClientUnits: ClientUnit[] = [];
  const productStart = persistedCheckpoints.get('produtos') ?? 0;
  let faixaCursor = persistedCheckpoints.get('faixas') ?? 0;
  for (const [productIndex, unit] of normalized.productUnits.entries()) {
    if (productIndex < productStart) continue;
    const productCheckpoint = checkpoint(report.produtos);
    const pricingCheckpoint = checkpoint(report.faixas);
    const productExclusion = discardEntryFor('Item', unit.product.sourceId);
    if (productExclusion) {
      addExcluded(report.produtos, {
        source_doctype: 'Item',
        source_id: unit.product.sourceId,
        local_key: unit.product.sku,
        mensagem: 'Produto excluído pelo manifesto de descarte.',
      });
      for (const entry of unit.lineage.filter((item) => item.entityType === 'faixa'))
        addExcluded(report.faixas, {
          source_doctype: entry.sourceDoctype,
          source_id: entry.sourceId,
          local_key: entry.localKey,
          mensagem: 'Faixa excluída pelo manifesto de descarte.',
        });
      sealCheckpoint(productCheckpoint);
      sealCheckpoint(pricingCheckpoint);
      const nextFaixaCursor =
        faixaCursor + unit.lineage.filter((entry) => entry.entityType === 'faixa').length;
      writes.push({
        phase: 'produtos',
        cursor: productIndex + 1,
        blocked: false,
        faixaCursor: nextFaixaCursor,
        run: async () => undefined,
        checkpoints: [productCheckpoint, pricingCheckpoint],
        sourceDoctype: 'Item',
        sourceId: unit.product.sourceId,
        localKey: unit.product.sku,
        pricingSources: [],
      });
      faixaCursor = nextFaixaCursor;
      continue;
    }
    const action = processProductUnit(
      unit,
      state,
      report,
      duplicateSkus,
      duplicateSources,
      duplicatePriceSources,
      multiSkuPriceSources
    );
    sealCheckpoint(productCheckpoint);
    sealCheckpoint(pricingCheckpoint);
    const blocked = hasBlockingDetails([
      ...productCheckpoint.addedDetails,
      ...pricingCheckpoint.addedDetails,
    ]);
    const nextFaixaCursor =
      faixaCursor + unit.lineage.filter((entry) => entry.entityType === 'faixa').length;
    writes.push({
      phase: 'produtos',
      cursor: productIndex + 1,
      blocked,
      faixaCursor: nextFaixaCursor,
      run: !blocked && action.write ? () => repository.applyProductUnit(unit) : async () => undefined,
      checkpoints: [productCheckpoint, pricingCheckpoint],
      sourceDoctype: 'Item',
      sourceId: unit.product.sourceId,
      localKey: unit.product.sku,
      pricingSources: unit.lineage
        .filter((entry) => entry.entityType === 'faixa')
        .map((entry) => ({
          sourceDoctype: entry.sourceDoctype,
          sourceId: entry.sourceId,
          localKey: entry.localKey,
        })),
    });
    faixaCursor = nextFaixaCursor;
  }
  const clientStart = persistedCheckpoints.get('clientes') ?? 0;
  for (const [clientIndex, unit] of normalized.clientUnits.entries()) {
    if (clientIndex < clientStart) continue;
    const clientCheckpoint = checkpoint(report.clientes);
    const clientExcluded = unit.lineage.some((entry) => discardEntryFor(entry.sourceDoctype, entry.sourceId));
    if (clientExcluded) {
      for (const entry of unit.lineage)
        addExcluded(report.clientes, {
          source_doctype: entry.sourceDoctype,
          source_id: entry.sourceId,
          local_key: unit.client.localKey,
          mensagem: 'Cliente excluído pelo manifesto de descarte.',
        });
      sealCheckpoint(clientCheckpoint);
      writes.push({
        phase: 'clientes',
        cursor: clientIndex + 1,
        blocked: false,
        run: async () => undefined,
        checkpoints: [clientCheckpoint],
        sourceDoctype: unit.client.sourceDoctype,
        sourceId: unit.client.sourceId,
        localKey: unit.client.localKey,
        pricingSources: [],
      });
      continue;
    }
    const clientAction = processClientUnit(unit, state, report);
    sealCheckpoint(clientCheckpoint);
    const blocked = hasBlockingDetails(clientCheckpoint.addedDetails);
    writes.push({
      phase: 'clientes',
      cursor: clientIndex + 1,
      blocked,
      run: !blocked && clientAction ? () => repository.applyClientUnit(unit) : async () => undefined,
      checkpoints: [clientCheckpoint],
      sourceDoctype: unit.client.sourceDoctype,
      sourceId: unit.client.sourceId,
      localKey: unit.client.localKey,
      pricingSources: [],
    });
    if (clientAction) plannedClientUnits.push(unit);
  }
  approveDivergences(report, options.approvedDivergences);
  if (
    options.mode === 'apply' &&
    [report.produtos, report.faixas, report.clientes].some((entity) => hasBlockingDetails(entity.detalhes))
  ) {
    // Do not start any product/client write while a prerequisite blocker is
    // known. Approved divergences remain scoped to their affected records.
    await failActiveRun('markBatchFailed:dependency-preflight');
    return failedResult();
  }
  if (options.mode === 'apply') {
    // Each callback is deliberately awaited independently. A failed product
    // or client unit is reported and does not roll back already confirmed
    // units, making a rerun safe after operator remediation.
    // ── Products + Faixas batches ──
    const prodBatchId = batchIds.get('produtos');
    const faixaBatchId = batchIds.get('faixas');
    await updateBatchTracked(prodBatchId, { status: 'running' }, 'updateBatch:produtos:running');
    if (await abortTrackingFailure('abort:produtos:running')) return failedResult();
    await updateBatchTracked(faixaBatchId, { status: 'running' }, 'updateBatch:faixas:running');
    if (await abortTrackingFailure('abort:faixas:running')) return failedResult();
    for (const write of writes) {
      if (trackingFailed) break;
      if (write.phase !== 'produtos') continue;
      try {
        await write.run();
        const previousProductCursor =
          phaseCursors.get('produtos') ?? persistedCheckpoints.get('produtos') ?? 0;
        if (!write.blocked && write.cursor === previousProductCursor + 1) {
          phaseCursors.set('produtos', write.cursor);
          await updateBatchTracked(
            prodBatchId,
            { checkpoint: write.cursor },
            'updateBatch:produtos:checkpoint'
          );
          if (write.faixaCursor !== undefined) {
            phaseCursors.set('faixas', write.faixaCursor);
            await updateBatchTracked(
              faixaBatchId,
              { checkpoint: write.faixaCursor },
              'updateBatch:faixas:checkpoint'
            );
          }
        }
        if (trackingFailed) break;
      } catch {
        const message = 'Não foi possível salvar a unidade importada.';
        for (const saved of write.checkpoints) rollbackCheckpoint(saved);
        const productCheckpoint = write.checkpoints.find(
          (saved) => saved.report === report.produtos
        );
        if (productCheckpoint) {
          add(
            report.produtos,
            'erros',
            write.sourceDoctype,
            write.sourceId,
            message,
            write.localKey
          );
          for (const price of write.pricingSources)
            add(
              report.faixas,
              'erros',
              price.sourceDoctype,
              price.sourceId,
              message,
              price.localKey
            );
        }
        continue;
      }
    }
    await updateBatchTracked(
      prodBatchId,
      {
        status: entityFailed(report.produtos) ? 'failed' : 'completed',
        checkpoint: phaseCursors.get('produtos') ?? persistedCheckpoints.get('produtos') ?? 0,
        attemptCount: (existingAttemptCounts.get('produtos') ?? 0) + 1,
      },
      'updateBatch:produtos:final'
    );
    await updateBatchTracked(
      faixaBatchId,
      {
        status: entityFailed(report.faixas) ? 'failed' : 'completed',
        checkpoint: phaseCursors.get('faixas') ?? persistedCheckpoints.get('faixas') ?? 0,
        attemptCount: (existingAttemptCounts.get('faixas') ?? 0) + 1,
      },
      'updateBatch:faixas:final'
    );
    if (await abortTrackingFailure('abort:produtos:final')) return failedResult();
    // ── Clients batch ──
    const clientBatchId = batchIds.get('clientes');
    await updateBatchTracked(clientBatchId, { status: 'running' }, 'updateBatch:clientes:running');
    if (await abortTrackingFailure('abort:clientes:running')) return failedResult();
    for (const write of writes) {
      if (trackingFailed) break;
      if (write.phase !== 'clientes') continue;
      try {
        await write.run();
        const previousClientCursor =
          phaseCursors.get('clientes') ?? persistedCheckpoints.get('clientes') ?? 0;
        if (!write.blocked && write.cursor === previousClientCursor + 1) {
          phaseCursors.set('clientes', write.cursor);
          await updateBatchTracked(
            clientBatchId,
            { checkpoint: write.cursor },
            'updateBatch:clientes:checkpoint'
          );
        }
        if (trackingFailed) break;
      } catch {
        const message = 'Não foi possível salvar a unidade importada.';
        for (const saved of write.checkpoints) rollbackCheckpoint(saved);
        add(
          report.clientes,
          'erros',
          write.sourceDoctype,
          write.sourceId,
          message,
          write.localKey
        );
        continue;
      }
    }
    await updateBatchTracked(
      clientBatchId,
      {
        status: entityFailed(report.clientes) ? 'failed' : 'completed',
        checkpoint: phaseCursors.get('clientes') ?? persistedCheckpoints.get('clientes') ?? 0,
        attemptCount: (existingAttemptCounts.get('clientes') ?? 0) + 1,
      },
      'updateBatch:clientes:final'
    );
    if (await abortTrackingFailure('abort:clientes:final')) return failedResult();
  }

  // ── Quotations (after clients so newly imported clients can be resolved) ──
  let quotationState: FrappeMigrationState;
  if (options.mode === 'apply') {
    try {
      quotationState = await repository.loadState();
    } catch (error) {
      failTracking('loadState:quotations', error);
      await failActiveRun('markBatchFailed:loadState:quotations');
      return failedResult();
    }
  } else {
    quotationState = state;
  }
  const clientLineage = new Map<string, string>();
  for (const entry of quotationState.lineage) {
    if (entry.entityType === 'cliente') {
      clientLineage.set(`${entry.sourceDoctype}:${entry.sourceId}`, entry.localKey);
      // Also index by name for quotations that only carry customer_name.
      const clientRecord = quotationState.clients.find((c) => c.id === entry.localKey);
      if (clientRecord?.nome)
        clientLineage.set(`name:${clientRecord.nome.toLowerCase()}`, entry.localKey);
    }
  }
  if (options.mode !== 'apply') {
    // Dry-run has no persisted clients yet. Predict the deterministic client
    // UUIDs that apply would produce so the report matches the apply outcome.
    for (const unit of plannedClientUnits) {
      const linked = unit.lineage
        .map((entry) => lineageFor(quotationState, entry.sourceDoctype, entry.sourceId)?.localKey)
        .find(Boolean);
      const byDocument = unit.client.documento
        ? quotationState.clients.find((client) => client.documento === unit.client.documento)
        : undefined;
      const id = linked || byDocument?.id || stableClientUuid(unit.client.localKey);
      for (const entry of unit.lineage)
        clientLineage.set(`${entry.sourceDoctype}:${entry.sourceId}`, id);
      // Also index by normalized name so quotations with only customer_name
      // (the common case in this Frappe dataset) can resolve their client.
      if (unit.client.nome) clientLineage.set(`name:${unit.client.nome.toLowerCase()}`, id);
    }
  }
  const knownProducts = new Set(quotationState.products.map((product) => product.sku));
  if (options.mode !== 'apply') {
    for (const unit of normalized.productUnits) knownProducts.add(unit.product.sku);
  }
  const normalizedQuotations: NormalizedQuotation[] = [];
  for (const record of uniqueSourceRecords(dataset.quotations || [])) {
    try {
      normalizedQuotations.push(normalizeFrappeQuotation(record, clientLineage));
    } catch (error) {
      add(
        report.orcamentos,
        'erros',
        'Quotation',
        String(record.name || record.id || ''),
        error instanceof Error ? error.message : 'Orçamento inválido.'
      );
    }
  }
  const builtQuotations = buildQuotationUnits(
    normalizedQuotations,
    clientLineage,
    {
      clients: quotationState.clients,
      products: quotationState.products,
    },
    knownProducts
  );
  for (const issue of builtQuotations.issues) {
    if (issue.source_id && discardEntryFor('Quotation', issue.source_id))
      addExcluded(report.orcamentos, {
        source_doctype: issue.source_doctype,
        source_id: issue.source_id,
        local_key: issue.local_key,
        mensagem: 'Orçamento excluído pelo manifesto de descarte.',
      });
    else addDetail(report.orcamentos, issue);
  }
  for (const unit of builtQuotations.quotationUnits)
    for (const entry of unit.lineage) attachLineagePayload(entry, unit.quotation.source);
  // Inject activeRunId into quotation lineage entries.
  if (activeRunId) {
    for (const unit of builtQuotations.quotationUnits)
      for (const entry of unit.lineage) entry.migrationRunId = activeRunId;
  }
  const quotationStart = persistedCheckpoints.get('orcamentos') ?? 0;
  for (const [quotationIndex, unit] of builtQuotations.quotationUnits.entries()) {
    if (quotationIndex < quotationStart) continue;
    const quotationCheckpoint = checkpoint(report.orcamentos);
    const quotationExcluded = discardEntryFor('Quotation', unit.quotation.sourceId);
    if (quotationExcluded) {
      addExcluded(report.orcamentos, {
        source_doctype: 'Quotation',
        source_id: unit.quotation.sourceId,
        local_key: unit.quotation.businessNumber,
        mensagem: 'Orçamento excluído pelo manifesto de descarte.',
      });
      sealCheckpoint(quotationCheckpoint);
      writes.push({
        phase: 'orcamentos',
        cursor: quotationIndex + 1,
        blocked: false,
        run: async () => undefined,
        checkpoints: [quotationCheckpoint],
        sourceDoctype: 'Quotation',
        sourceId: unit.quotation.sourceId,
        localKey: unit.quotation.businessNumber,
        pricingSources: [],
      });
      continue;
    }
    const quotationAction = processQuotationUnit(unit, quotationState, report);
    sealCheckpoint(quotationCheckpoint);
    const blocked = hasBlockingDetails(quotationCheckpoint.addedDetails);
    writes.push({
      phase: 'orcamentos',
      cursor: quotationIndex + 1,
      blocked,
      run: quotationAction ? () => repository.applyQuotationUnit(unit) : async () => undefined,
      checkpoints: [quotationCheckpoint],
      sourceDoctype: 'Quotation',
      sourceId: unit.quotation.sourceId,
      localKey: unit.quotation.businessNumber,
      pricingSources: [],
    });
  }
  approveDivergences(report, options.approvedDivergences);
  for (const write of writes) {
    if (write.phase === 'orcamentos')
      write.blocked = hasBlockingDetails(write.checkpoints.flatMap((item) => item.addedDetails));
  }
  if (options.mode === 'apply') {
    const qBatchId = batchIds.get('orcamentos');
    await updateBatchTracked(qBatchId, { status: 'running' }, 'updateBatch:orcamentos:running');
    if (await abortTrackingFailure('abort:orcamentos:running')) return failedResult();
    for (const write of writes) {
      if (trackingFailed) break;
      if (write.phase !== 'orcamentos') continue;
      if (write.blocked) continue;
      try {
        await write.run();
        const previousQuotationCursor =
          phaseCursors.get('orcamentos') ?? persistedCheckpoints.get('orcamentos') ?? 0;
        if (!write.blocked && write.cursor === previousQuotationCursor + 1) {
          phaseCursors.set('orcamentos', write.cursor);
          await updateBatchTracked(
            qBatchId,
            { checkpoint: write.cursor },
            'updateBatch:orcamentos:checkpoint'
          );
        }
        if (trackingFailed) break;
      } catch {
        const message = 'Não foi possível salvar o orçamento importado.';
        for (const saved of write.checkpoints) rollbackCheckpoint(saved);
        const quotationCheckpoint = write.checkpoints.find(
          (saved) => saved.report === report.orcamentos
        );
        if (quotationCheckpoint)
          add(
            report.orcamentos,
            'erros',
            write.sourceDoctype,
            write.sourceId,
            message,
            write.localKey
          );
        continue;
      }
    }
    await updateBatchTracked(
      qBatchId,
      {
        status: entityFailed(report.orcamentos) ? 'failed' : 'completed',
        checkpoint: phaseCursors.get('orcamentos') ?? persistedCheckpoints.get('orcamentos') ?? 0,
        attemptCount: (existingAttemptCounts.get('orcamentos') ?? 0) + 1,
      },
      'updateBatch:orcamentos:final'
    );
    if (await abortTrackingFailure('abort:orcamentos:final')) return failedResult();
    // Advance the per-year numbering counter past the highest imported number.
    let afterState: FrappeMigrationState;
    try {
      afterState = await repository.loadState();
    } catch (error) {
      failTracking('loadState:sequences', error);
      afterState = quotationState;
    }
    const maxByYear = new Map<number, number>();
    for (const quotation of afterState.quotations) {
      const match = /^ORC-(\d{4})(\d{4})$/.exec(quotation.businessNumber);
      if (!match) continue;
      const year = Number(match[1]);
      const sequence = Number(match[2]);
      maxByYear.set(year, Math.max(maxByYear.get(year) || 0, sequence));
    }
    for (const [year, lastNumber] of maxByYear) {
      if (trackingFailed) break;
      try {
        await repository.advanceQuoteSequence(year, lastNumber);
      } catch (error) {
        failTracking(`advanceQuoteSequence:${year}`, error);
      }
    }
    if (await abortTrackingFailure('abort:advanceQuoteSequence')) return failedResult();
    // Historical PDF archival: replace the size-0 placeholders created above
    // with real Vercel Blob uploads. Skipped when no pipeline is configured.
    const docBatchId = batchIds.get('documentos');
    await updateBatchTracked(docBatchId, { status: 'running' }, 'updateBatch:documentos:running');
    if (await abortTrackingFailure('abort:documentos:running')) return failedResult();
    if (options.pdfPipeline) {
      await archiveHistoricalPdfs({
        repository,
        report,
        pipeline: options.pdfPipeline,
      });
    }
    if (!entityFailed(report.documentos))
      phaseCursors.set('documentos', entityCheckpoint(report.documentos));
    await updateBatchTracked(
      docBatchId,
      {
        status: entityFailed(report.documentos) ? 'failed' : 'completed',
        checkpoint: phaseCursors.get('documentos') ?? persistedCheckpoints.get('documentos') ?? 0,
        attemptCount: (existingAttemptCounts.get('documentos') ?? 0) + 1,
      },
      'updateBatch:documentos:final'
    );
    if (await abortTrackingFailure('abort:documentos:final')) return failedResult();
  } else {
    // Dry-run archive analysis: counts + divergences only, no fetch/upload.
    analyzeHistoricalPdfArchive(dataset, builtQuotations.quotationUnits, report);
  }
  if (options.mode === 'apply' && activeRunId) {
    // Seal every known batch after all entity processing. In particular, a
    // partial run must never remain pending/running merely because its batch
    // was absent during the first attempt.
    const finalBatchState: Record<string, { status: string; checkpoint: number }> = {
      produtos: {
        status: entityFailed(report.produtos) ? 'failed' : 'completed',
        checkpoint: phaseCursors.get('produtos') ?? persistedCheckpoints.get('produtos') ?? 0,
      },
      faixas: {
        status: entityFailed(report.faixas) ? 'failed' : 'completed',
        checkpoint: phaseCursors.get('faixas') ?? persistedCheckpoints.get('faixas') ?? 0,
      },
      clientes: {
        status: entityFailed(report.clientes) ? 'failed' : 'completed',
        checkpoint: phaseCursors.get('clientes') ?? persistedCheckpoints.get('clientes') ?? 0,
      },
      orcamentos: {
        status: entityFailed(report.orcamentos) ? 'failed' : 'completed',
        checkpoint: phaseCursors.get('orcamentos') ?? persistedCheckpoints.get('orcamentos') ?? 0,
      },
      documentos: {
        status: entityFailed(report.documentos) ? 'failed' : 'completed',
        checkpoint: phaseCursors.get('documentos') ?? persistedCheckpoints.get('documentos') ?? 0,
      },
    };
    for (const entityType of BATCH_ENTITY_TYPES) {
      const outcome = finalBatchState[entityType];
      await updateBatchTracked(
        batchIds.get(entityType),
        { status: outcome.status, checkpoint: outcome.checkpoint },
        `updateBatch:${entityType}:seal`
      );
    }
  }
  if (options.mode === 'apply') await verifyTerminalBatches();
  // ── Complete run and build manifest ───────────────────────────────────
  const entityReports = [
    report.produtos,
    report.faixas,
    report.clientes,
    report.orcamentos,
    report.documentos,
  ];
  const hasBlocking = entityReports.some(entityFailed) || trackingFailed;
  if (activeRunId) {
    try {
      await repository.completeRun(activeRunId, hasBlocking ? 'failed' : 'completed');
    } catch (error) {
      // A completion write is part of the migration contract. Record it in
      // the report and make a best-effort failed completion, never success.
      failTracking('completeRun', error);
      try {
        await repository.completeRun(activeRunId, 'failed');
      } catch (failedError) {
        failTracking('completeRun:failed', failedError);
      }
    }
  }
  await releaseMigrationLease();
  if (trackingFailed && activeRunId && !hasBlocking) {
    try {
      await repository.completeRun(activeRunId, 'failed');
    } catch (error) {
      failTracking('completeRun:release-failure', error);
    }
  }
  const manifestStatus: 'completed' | 'failed' =
    hasBlocking || trackingFailed ? 'failed' : 'completed';
  const finalized = finalizeReport(report);
  return {
    report: finalized,
    manifest: buildManifest(
      activeRunId || runId,
      'frappe',
      options.mode,
      sourceSnapshotAt,
      manifestHash,
      manifestStatus,
      finalized,
      dataset,
      buildReconciliationExpectations(
        normalized.productUnits,
        normalized.clientUnits,
        builtQuotations.quotationUnits,
        discardPlan
      ),
      options.discardManifest,
      sourceDiscard.plan
    ),
  };
}

export const migrateFrappeCrm = runFrappeMigration;
