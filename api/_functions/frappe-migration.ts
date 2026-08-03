import { list } from '@vercel/blob';

import {
  addDetail,
  buildClientUnits,
  buildProductUnits,
  buildQuotationUnits,
  canonicalHash,
  deriveHistoricalPdfBlobPath,
  finalizeReport,
  historicalPdfPrintviewUrl,
  makeReport,
  normalizeFrappeClientRecord,
  normalizeFrappeItem,
  normalizeFrappePriceDocuments,
  normalizeFrappeQuotation,
  normalizeHistoricalPdf,
  readFrappeDataset,
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
  type ImportReport,
  type NormalizedClient,
  type NormalizedPriceDocument,
  type NormalizedProduct,
  type NormalizedQuotation,
  type ProductUnit,
  type QuotationUnit,
  type SourceRecord,
} from './lib/frappe-migration-core.js';
import {
  createPostgresFrappeMigrationRepository,
  stableClientUuid,
  type FrappeMigrationRepository,
  type FrappeMigrationState,
  type IssuedDocumentPdfPlaceholder,
} from '../_db/frappe-migration-repository.js';
import { erpGetDoc, erpGetList, ERPNEXT_TOKEN } from './lib/erpnext.js';
import {
  createVercelQuotationDocumentStorage,
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
}

export interface MigrationResult {
  report: ImportReport;
}

/** Production source adapter. Stable ordering is enforced by the core reader. */
export function createFrappeSource(): FrappeListSource {
  return {
    async list(doctype, options) {
      const rows = await erpGetList(doctype, {
        fields: ['*'],
        limit: options.limit,
        start: options.start,
        order_by: options.order_by,
      });
      if (doctype !== 'Pricing Rule') return rows;
      // ERPNext list responses often omit `rate` and child rows even when
      // fields=["*"]. Enrich every rule through the document endpoint before
      // normalization; errors stay inside the shared safe ERP client.
      return Promise.all(
        rows.map(async (row) => {
          const name = String(row.name || '').trim();
          if (!name) return row;
          try {
            const full = await erpGetDoc('Pricing Rule', name, { fields: ['*'] });
            return full ? { ...row, ...full } : row;
          } catch {
            return { ...row, __migration_enrichment_error: true };
          }
        })
      );
    },
  };
}

function recordKey(doctype: string, id: string): string {
  return `${doctype}:${id}`;
}

function sameValue(left: unknown, right: unknown): boolean {
  return canonicalHash(left) === canonicalHash(right);
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

function pricingIdentity(unit: ProductUnit): Record<string, unknown> {
  return { preco_base: unit.pricing.preco_base, precos: unit.pricing.precos };
}

function currentPricingIdentity(product: ExistingProduct): Record<string, unknown> {
  return { preco_base: product.precoBase || null, precos: product.precos || [] };
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
  // Customer/Lead source IDs may themselves be CPF/CNPJ, e-mail, or a
  // person's name. Keep a stable one-way token in the report/CLI while the
  // complete source ID remains available to internal lineage/state writes.
  const reportSourceId =
    sourceDoctype === 'Customer' || sourceDoctype === 'Lead'
      ? `cliente:${canonicalHash(`${sourceDoctype}:${sourceId}`).slice(0, 12)}`
      : sourceId;
  // Client local keys can be document-derived (CPF/CNPJ). They are useful
  // only inside the migration state/lineage and must never cross the report
  // boundary, including dry-run, apply, and write-failure details.
  const reportLocalKey =
    sourceDoctype === 'Customer' || sourceDoctype === 'Lead' ? undefined : localKey;
  addDetail(report, {
    status,
    source_doctype: sourceDoctype,
    source_id: reportSourceId,
    local_key: reportLocalKey,
    mensagem,
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
  const itemSame = Boolean(
    previous && previous.canonicalHash === importedProductHash(unit.product)
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
    else if (old.canonicalHash === entry.canonicalHash && old.localKey === entry.localKey)
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
  const hasNewLineage = unit.lineage.some(
    (entry) => !lineageFor(state, entry.sourceDoctype, entry.sourceId)
  );
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
    unit.lineage.every(
      (entry) =>
        lineageFor(state, entry.sourceDoctype, entry.sourceId)?.canonicalHash ===
        entry.canonicalHash
    )
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
  if (!source.statusKnown) {
    add(
      report.orcamentos,
      'divergentes',
      'Quotation',
      source.sourceId,
      `Status legado desconhecido '${source.statusSource}' mapeado para rascunho.`,
      source.businessNumber
    );
  }
  if (previous && previous.canonicalHash === unit.sourceHash) {
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
        return createVercelQuotationDocumentStorage().archive(_pathname, buffer);
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
    console.error('[frappe-migration] falha ao listar PDFs históricos pendentes:', error);
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
    console.error(`[frappe-migration] falha ao baixar printview de ${sourceId}:`, error);
    detail('erros', 'Não foi possível baixar o HTML do PDF histórico.');
    return;
  }
  let pdf: Buffer;
  try {
    pdf = await pipeline.renderPdf(html);
  } catch (error) {
    console.error(`[frappe-migration] falha ao renderizar PDF de ${sourceId}:`, error);
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
    console.error(`[frappe-migration] falha ao consultar blobs de ${sourceId}:`, error);
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
    console.error(`[frappe-migration] falha ao arquivar PDF de ${sourceId}:`, error);
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
 * fetched and no blob is uploaded — reachability is decided purely at the
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

export async function runFrappeMigration(options: MigrationOptions): Promise<MigrationResult> {
  if (!options || (options.mode !== 'dry-run' && options.mode !== 'apply'))
    throw new Error('Informe exatamente --dry-run ou --apply.');
  const report = makeReport(options.mode);
  const source = options.source;
  let dataset: FrappeDataset;
  if (options.dataset != null) {
    const candidate: unknown = options.dataset;
    validateFrappeDataset(candidate);
    dataset = candidate;
  } else if (source) dataset = (await readFrappeDataset(source, options.pageSize || 200)).dataset;
  else throw new Error('Fonte Frappe não configurada.');
  validateFrappeDataset(dataset);
  const normalized = normalizeSafely(dataset, report);
  addReadCounts(report, dataset);
  const repository = options.repository || createPostgresFrappeMigrationRepository();
  const state = await repository.loadState();
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
  const writes: Array<{
    run: () => Promise<void>;
    checkpoints: ReportCheckpoint[];
    sourceDoctype: string;
    sourceId: string;
    localKey: string;
    pricingSources: Array<{ sourceDoctype: string; sourceId: string; localKey: string }>;
  }> = [];
  const plannedClientUnits: ClientUnit[] = [];
  for (const unit of normalized.productUnits) {
    const productCheckpoint = checkpoint(report.produtos);
    const pricingCheckpoint = checkpoint(report.faixas);
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
    if (action.write)
      writes.push({
        run: () => repository.applyProductUnit(unit),
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
  }
  for (const unit of normalized.clientUnits) {
    const clientCheckpoint = checkpoint(report.clientes);
    const clientAction = processClientUnit(unit, state, report);
    sealCheckpoint(clientCheckpoint);
    if (clientAction) {
      writes.push({
        run: () => repository.applyClientUnit(unit),
        checkpoints: [clientCheckpoint],
        sourceDoctype: unit.client.sourceDoctype,
        sourceId: unit.client.sourceId,
        localKey: unit.client.localKey,
        pricingSources: [],
      });
      plannedClientUnits.push(unit);
    }
  }
  if (options.mode === 'apply') {
    // Each callback is deliberately awaited independently. A failed product
    // or client unit is reported and does not roll back already confirmed
    // units, making a rerun safe after operator remediation.
    for (const write of writes) {
      try {
        await write.run();
      } catch {
        const message = 'Não foi possível salvar a unidade importada.';
        for (const saved of write.checkpoints) rollbackCheckpoint(saved);
        const productCheckpoint = write.checkpoints.find(
          (saved) => saved.report === report.produtos
        );
        const clientCheckpoint = write.checkpoints.find(
          (saved) => saved.report === report.clientes
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
        } else if (clientCheckpoint) {
          add(
            report.clientes,
            'erros',
            write.sourceDoctype,
            write.sourceId,
            message,
            write.localKey
          );
        }
      }
    }
  }

  // ── Quotations (after clients so newly imported clients can be resolved) ──
  const quotationState = options.mode === 'apply' ? await repository.loadState() : state;
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
  for (const issue of builtQuotations.issues) addDetail(report.orcamentos, issue);
  for (const unit of builtQuotations.quotationUnits) {
    const quotationCheckpoint = checkpoint(report.orcamentos);
    const quotationAction = processQuotationUnit(unit, quotationState, report);
    sealCheckpoint(quotationCheckpoint);
    if (quotationAction)
      writes.push({
        run: () => repository.applyQuotationUnit(unit),
        checkpoints: [quotationCheckpoint],
        sourceDoctype: 'Quotation',
        sourceId: unit.quotation.sourceId,
        localKey: unit.quotation.businessNumber,
        pricingSources: [],
      });
  }
  if (options.mode === 'apply') {
    for (const write of writes) {
      if (!write.checkpoints.some((saved) => saved.report === report.orcamentos)) continue;
      try {
        await write.run();
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
      }
    }
    // Advance the per-year numbering counter past the highest imported number.
    const afterState = await repository.loadState();
    const maxByYear = new Map<number, number>();
    for (const quotation of afterState.quotations) {
      const match = /^ORC-(\d{4})(\d{4})$/.exec(quotation.businessNumber);
      if (!match) continue;
      const year = Number(match[1]);
      const sequence = Number(match[2]);
      maxByYear.set(year, Math.max(maxByYear.get(year) || 0, sequence));
    }
    for (const [year, lastNumber] of maxByYear)
      await repository.advanceQuoteSequence(year, lastNumber);
    // Historical PDF archival: replace the size-0 placeholders created above
    // with real Vercel Blob uploads. Skipped when no pipeline is configured.
    if (options.pdfPipeline) {
      await archiveHistoricalPdfs({
        repository,
        report,
        pipeline: options.pdfPipeline,
      });
    }
  } else {
    // Dry-run archive analysis: counts + divergences only, no fetch/upload.
    analyzeHistoricalPdfArchive(dataset, builtQuotations.quotationUnits, report);
  }
  return { report: finalizeReport(report) };
}

export const migrateFrappeCrm = runFrappeMigration;
