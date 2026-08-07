import { createHash } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from './client.js';
import { acquireQuotationWriteLock } from './quotation-write-lock.js';
import { resolveQuotationRevisionMetadata } from './quotation-revision-invariants.js';
import {
  clients,
  frappeImportLineage,
  frappeMigrationBatches,
  frappeMigrationRuns,
  productPricingTiers,
  products,
  quoteRevisionItems,
  quoteRevisions,
  quoteSequences,
  quotations,
} from './schema.js';
import type {
  ClientUnit,
  ExistingClient,
  ExistingLineage,
  ExistingProduct,
  FrappeLineageEntry,
  ProductUnit,
  PricingTierInput,
  QuotationStatus,
  QuotationUnit,
  SourceRecord,
} from '../_functions/lib/frappe-migration-core.js';

export interface ExistingQuotationRevisionItem {
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

export interface ExistingQuotationRevision {
  id: string;
  version: number;
  status: QuotationStatus;
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

export interface ExistingIssuedDocument {
  id: string;
  kind: string;
  blobPathname: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  templateKey: string;
  templateHash: string;
  createdAt: Date;
}

export interface ExistingQuotation {
  id: string;
  businessNumber: string;
  clientId: string;
  status: QuotationStatus;
  createdAt?: Date;
  revision?: ExistingQuotationRevision;
  items?: ExistingQuotationRevisionItem[];
  document?: ExistingIssuedDocument | null;
}

export interface FrappeMigrationState {
  products: ExistingProduct[];
  clients: ExistingClient[];
  quotations: ExistingQuotation[];
  lineage: ExistingLineage[];
  /** Per-year numbering counters (year → last reserved number). */
  sequences: Record<number, number>;
}

/**
 * One `issued_documents` placeholder (kind `historical_pdf_import`, size 0)
 * waiting to be replaced by a real Vercel Blob archival.  `sourceId` is the
 * Frappe Quotation `name` recovered from the import lineage; it drives the
 * printview URL and the deterministic blob key.
 */
export interface IssuedDocumentPdfPlaceholder {
  documentId: string;
  sourceId: string;
  businessNumber: string;
  fileName: string;
  blobPathname: string;
}

export interface FrappeMigrationRepository {
  loadState(): Promise<FrappeMigrationState>;
  applyProductUnit(unit: ProductUnit): Promise<void>;
  applyClientUnit(unit: ClientUnit): Promise<void>;
  applyQuotationUnit(unit: QuotationUnit): Promise<void>;
  advanceQuoteSequence(year: number, lastNumber: number): Promise<void>;
  /** List placeholder issued documents awaiting historical PDF archival. */
  listIssuedDocumentPdfPlaceholders(): Promise<IssuedDocumentPdfPlaceholder[]>;
  /** Fill the placeholder row with the archived PDF metadata (idempotent). */
  updateIssuedDocumentPdf(
    documentId: string,
    blobPathname: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    checksumSha256: string
  ): Promise<void>;
  // ── Run / batch tracking ──────────────────────────────────────────────
  /** Persist a new migration run row (apply mode only). */
  createRun(params: {
    id: string;
    provider: string;
    mode: string;
    sourceSnapshotAt: Date;
    manifestHash: string;
    startedAt: Date;
  }): Promise<void>;
  /** Mark a run as completed or failed. */
  completeRun(runId: string, status: 'completed' | 'failed'): Promise<void>;
  /** Create a batch checkpoint row within a run. */
  createBatch(params: { id: string; runId: string; entityType: string }): Promise<void>;
  /** Update batch status/checkpoint/attempt count. */
  updateBatch(
    batchId: string,
    params: { status?: string; checkpoint?: number; attemptCount?: number }
  ): Promise<void>;
}

type DatabaseProvider = () => AppDatabase;

function valueText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === '' ? null : text;
}

function asPricingTier(row: typeof productPricingTiers.$inferSelect): PricingTierInput {
  return { minimum_quantity: String(row.minimumQuantity), unit_price: String(row.unitPrice) };
}

function stableUuid(key: string): string {
  const digest = createHash('sha256').update(`aspen-frappe-client:${key}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  // RFC 4122 version 5 layout, with a deterministic SHA-256-derived value.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Deterministic client UUID (stable across reruns).  Exported so the handler
 * can predict dry-run client identifiers before any client unit is applied.
 */
export const stableClientUuid = stableUuid;

function addressFromRow(row: typeof clients.$inferSelect) {
  const values = [
    row.endereco,
    row.numero,
    row.bairro,
    row.complemento,
    row.municipio,
    row.uf,
    row.cep,
  ];
  if (!values.some((value) => value)) return null;
  return {
    endereco: row.endereco || null,
    numero: row.numero || null,
    bairro: row.bairro || null,
    complemento: row.complemento || null,
    municipio: row.municipio || null,
    uf: row.uf || null,
    cep: row.cep || null,
  };
}

function sourcePayload(value: unknown): SourceRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as SourceRecord;
  return {};
}

export function createPostgresFrappeMigrationRepository(
  getDb: DatabaseProvider = getDatabase
): FrappeMigrationRepository {
  return {
    async loadState(): Promise<FrappeMigrationState> {
      const db = getDb();
      const [productRows, tierRows, clientRows, lineageRows, quotationRows, sequenceRows] =
        await Promise.all([
          db.select().from(products).orderBy(asc(products.sku)),
          db
            .select()
            .from(productPricingTiers)
            .orderBy(asc(productPricingTiers.productSku), asc(productPricingTiers.minimumQuantity)),
          db.select().from(clients).orderBy(asc(clients.id)),
          db
            .select()
            .from(frappeImportLineage)
            .orderBy(asc(frappeImportLineage.sourceDoctype), asc(frappeImportLineage.sourceId)),
          db.select().from(quotations).orderBy(asc(quotations.businessNumber)),
          db.select().from(quoteSequences),
        ]);
      const tiersBySku = new Map<string, PricingTierInput[]>();
      for (const tier of tierRows) {
        const rows = tiersBySku.get(tier.productSku) || [];
        rows.push(asPricingTier(tier));
        tiersBySku.set(tier.productSku, rows);
      }
      return {
        products: productRows.map((row) => ({
          sku: row.sku,
          nome: row.nome,
          descricao: row.descricao,
          unidade: row.unidade,
          categoria: row.categoria,
          marca: row.marca,
          ativo: row.ativo,
          precoBase: valueText(row.precoBase),
          precos: tiersBySku.get(row.sku) || [],
        })),
        clients: clientRows.map((row) => ({
          id: row.id,
          nome: row.nome,
          documento: row.documento,
          email: row.email,
          telefone: row.telefone,
          notes: row.notes,
          address: addressFromRow(row),
        })),
        lineage: lineageRows.map((row) => ({
          sourceDoctype: row.sourceDoctype,
          sourceId: row.sourceId,
          entityType: row.entityType,
          localKey: row.localKey,
          canonicalHash: row.canonicalHash,
          legacyPayload: sourcePayload(row.legacyPayload),
        })),
        quotations: quotationRows.map((row) => ({
          id: row.id,
          businessNumber: row.businessNumber,
          clientId: row.clientId,
          status: row.status as QuotationStatus,
          createdAt: row.createdAt,
        })),
        sequences: Object.fromEntries(sequenceRows.map((row) => [row.year, row.lastNumber])),
      };
    },

    async applyProductUnit(unit: ProductUnit): Promise<void> {
      const db = getDb();
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ sku: products.sku })
          .from(products)
          .where(eq(products.sku, unit.product.sku))
          .limit(1);
        if (existing) {
          await tx
            .update(products)
            .set({
              nome: unit.product.nome,
              descricao: unit.product.descricao,
              unidade: unit.product.unidade,
              categoria: unit.product.categoria,
              marca: unit.product.marca,
              ativo: unit.product.ativo,
              precoBase: unit.pricing.preco_base,
              arquivadoEm: unit.product.ativo ? null : new Date(),
              atualizadoEm: new Date(),
            })
            .where(eq(products.sku, unit.product.sku));
        } else {
          await tx.insert(products).values({
            sku: unit.product.sku,
            nome: unit.product.nome,
            descricao: unit.product.descricao,
            unidade: unit.product.unidade,
            categoria: unit.product.categoria,
            marca: unit.product.marca,
            ativo: unit.product.ativo,
            precoBase: unit.pricing.preco_base,
            arquivadoEm: unit.product.ativo ? null : new Date(),
          });
        }
        await tx
          .delete(productPricingTiers)
          .where(eq(productPricingTiers.productSku, unit.product.sku));
        if (unit.pricing.precos.length) {
          await tx.insert(productPricingTiers).values(
            unit.pricing.precos.map((tier) => ({
              productSku: unit.product.sku,
              minimumQuantity: String(tier.minimum_quantity),
              unitPrice: String(tier.unit_price),
              atualizadoEm: new Date(),
            }))
          );
        }
        await upsertLineage(tx, unit.lineage);
      });
    },

    async applyClientUnit(unit: ClientUnit): Promise<void> {
      const db = getDb();
      await db.transaction(async (tx) => {
        const localKey = unit.client.localKey;
        const linkedRows: (typeof frappeImportLineage.$inferSelect)[] = [];
        for (const sourceLineage of unit.lineage) {
          const [row] = await tx
            .select()
            .from(frappeImportLineage)
            .where(
              and(
                eq(frappeImportLineage.sourceDoctype, sourceLineage.sourceDoctype),
                eq(frappeImportLineage.sourceId, sourceLineage.sourceId)
              )
            )
            .limit(1);
          if (row) linkedRows.push(row);
        }
        const linkedKeys = [...new Set(linkedRows.map((row) => row.localKey))];
        if (linkedKeys.length > 1)
          throw new Error('Vínculos de cliente apontam para entidades locais diferentes.');
        const linked = linkedRows[0];
        const id =
          linked?.localKey &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            linked.localKey
          )
            ? linked.localKey
            : stableUuid(localKey);
        const [byId] = await tx.select().from(clients).where(eq(clients.id, id)).limit(1);
        const [byDocument] = unit.client.documento
          ? await tx
              .select()
              .from(clients)
              .where(eq(clients.documento, unit.client.documento))
              .limit(1)
          : [];
        const existing = byId || byDocument;
        const values = {
          nome: unit.client.nome || existing?.nome || 'Cliente sem nome',
          documento: unit.client.documento || existing?.documento || null,
          email: unit.client.email,
          telefone: unit.client.telefone,
          notes: unit.client.notes,
          endereco: unit.client.address?.endereco ?? null,
          numero: unit.client.address?.numero ?? null,
          bairro: unit.client.address?.bairro ?? null,
          complemento: unit.client.address?.complemento ?? null,
          municipio: unit.client.address?.municipio ?? null,
          uf: unit.client.address?.uf ?? null,
          cep: unit.client.address?.cep ?? null,
          updatedAt: new Date(),
        };
        if (existing) {
          await tx.update(clients).set(values).where(eq(clients.id, existing.id));
          // A document match may have a different UUID than the deterministic
          // local key; retain its actual ID in lineage for future reruns.
          await upsertLineage(
            tx,
            unit.lineage.map((entry) => ({ ...entry, localKey: existing.id }))
          );
        } else {
          await tx.insert(clients).values({ id, ...values, arquivado: false, archivedAt: null });
          await upsertLineage(
            tx,
            unit.lineage.map((entry) => ({ ...entry, localKey: id }))
          );
        }
      });
    },

    async applyQuotationUnit(unit: QuotationUnit): Promise<void> {
      const db = getDb();
      await db.transaction(async (tx) => {
        await acquireQuotationWriteLock(tx);
        const clientId = unit.quotation.clientId;
        if (!clientId) throw new Error('Cliente do orçamento não importado.');
        const [clientRow] = await tx
          .select({ id: clients.id })
          .from(clients)
          .where(eq(clients.id, clientId))
          .limit(1);
        if (!clientRow) throw new Error('Cliente do orçamento não importado.');
        const createdAt = unit.revision.createdAt;
        await tx
          .insert(quotations)
          .values({
            id: unit.id,
            businessNumber: unit.quotation.businessNumber,
            clientId,
            status: unit.quotation.status,
            createdAt,
            updatedAt: createdAt,
          })
          .onConflictDoUpdate({
            target: quotations.id,
            set: {
              businessNumber: unit.quotation.businessNumber,
              clientId,
              status: unit.quotation.status,
              updatedAt: new Date(),
            },
          });
        const revision = unit.revision;
        const revisionMetadata = await resolveQuotationRevisionMetadata(tx, revision);
        const revisionValues = {
          quotationId: unit.id,
          version: revision.version,
          status: revision.status,
          validadeDias: revision.validadeDias,
          pagamento: revision.pagamento,
          entrega: revision.entrega,
          fretePadrao: revision.fretePadrao,
          frete: revision.frete,
          observacoes: revision.observacoes,
          prazoProducao: revision.prazoProducao,
          templatePadrao: revision.templatePadrao,
          templateHash: revision.templateHash,
          templateVersionId: revisionMetadata.templateVersionId,
          sectionsSnapshot: revisionMetadata.sectionsSnapshot,
          clienteNome: revision.clienteNome,
          clienteDocumento: revision.clienteDocumento,
          clienteEmail: revision.clienteEmail,
          clienteTelefone: revision.clienteTelefone,
          clienteEndereco: revision.clienteEndereco,
          clienteNumero: revision.clienteNumero,
          clienteBairro: revision.clienteBairro,
          clienteComplemento: revision.clienteComplemento,
          clienteMunicipio: revision.clienteMunicipio,
          clienteUf: revision.clienteUf,
          clienteCep: revision.clienteCep,
          clienteNotas: revision.clienteNotas,
          subtotal: revision.subtotal,
          total: revision.total,
          createdAt: revision.createdAt,
        };
        await tx
          .insert(quoteRevisions)
          .values({ id: revision.id, ...revisionValues })
          .onConflictDoUpdate({
            target: quoteRevisions.id,
            set: { ...revisionValues },
          });
        await tx.delete(quoteRevisionItems).where(eq(quoteRevisionItems.revisionId, revision.id));
        if (unit.items.length > 0) {
          await tx.insert(quoteRevisionItems).values(
            unit.items.map((item) => ({
              id: item.id,
              revisionId: revision.id,
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
        }
        if (unit.document) {
          // @deprecated issuedDocuments table removed (#no-pdf-html-only)
        }
        await upsertLineage(tx, unit.lineage);
      });
    },

    async advanceQuoteSequence(year: number, lastNumber: number): Promise<void> {
      const db = getDb();
      await db
        .insert(quoteSequences)
        .values({ year, lastNumber })
        .onConflictDoUpdate({
          target: quoteSequences.year,
          set: { lastNumber: sql`GREATEST(${quoteSequences.lastNumber}, ${lastNumber})` },
        });
    },

    async listIssuedDocumentPdfPlaceholders(): Promise<IssuedDocumentPdfPlaceholder[]> {
      // @deprecated issuedDocuments table removed (#no-pdf-html-only)
      return [];
    },

    async updateIssuedDocumentPdf(
      _documentId: string,
      _blobPathname: string,
      _fileName: string,
      _mimeType: string,
      _sizeBytes: number,
      _checksumSha256: string
    ): Promise<void> {
      // @deprecated issuedDocuments table removed (#no-pdf-html-only)
      console.warn('updateIssuedDocumentPdf is deprecated (#no-pdf-html-only)');
    },

    async createRun(params: {
      id: string;
      provider: string;
      mode: string;
      sourceSnapshotAt: Date;
      manifestHash: string;
      startedAt: Date;
    }): Promise<void> {
      const db = getDb();
      await db.insert(frappeMigrationRuns).values({
        id: params.id,
        provider: params.provider,
        mode: params.mode,
        sourceSnapshotAt: params.sourceSnapshotAt,
        manifestHash: params.manifestHash,
        status: 'running',
        startedAt: params.startedAt,
      });
    },

    async completeRun(
      runId: string,
      status: 'completed' | 'failed'
    ): Promise<void> {
      const db = getDb();
      await db
        .update(frappeMigrationRuns)
        .set({ status, completedAt: new Date() })
        .where(eq(frappeMigrationRuns.id, runId));
    },

    async createBatch(params: {
      id: string;
      runId: string;
      entityType: string;
    }): Promise<void> {
      const db = getDb();
      await db.insert(frappeMigrationBatches).values({
        id: params.id,
        runId: params.runId,
        entityType: params.entityType,
        status: 'pending',
      });
    },

    async updateBatch(
      batchId: string,
      params: { status?: string; checkpoint?: number; attemptCount?: number }
    ): Promise<void> {
      const db = getDb();
      const set: Record<string, unknown> = {};
      if (params.status !== undefined) set.status = params.status;
      if (params.checkpoint !== undefined) set.checkpoint = params.checkpoint;
      if (params.attemptCount !== undefined) set.attemptCount = params.attemptCount;
      if (Object.keys(set).length === 0) return;
      await db
        .update(frappeMigrationBatches)
        .set(set)
        .where(eq(frappeMigrationBatches.id, batchId));
    },
  };
}

type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

async function upsertLineage(
  tx: Transaction,
  entries: FrappeLineageEntry[]
): Promise<void> {
  for (const entry of entries) {
    const now = new Date();
    await tx
      .insert(frappeImportLineage)
      .values({
        sourceDoctype: entry.sourceDoctype,
        sourceId: entry.sourceId,
        entityType: entry.entityType,
        localKey: entry.localKey,
        canonicalHash: entry.canonicalHash,
        legacyPayload: entry.legacyPayload,
        migrationRunId: entry.migrationRunId ?? null,
        sourceUpdatedAt: entry.sourceUpdatedAt ?? null,
        importedAt: entry.importedAt ?? now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [frappeImportLineage.sourceDoctype, frappeImportLineage.sourceId],
        set: {
          entityType: entry.entityType,
          localKey: entry.localKey,
          canonicalHash: entry.canonicalHash,
          legacyPayload: entry.legacyPayload,
          migrationRunId: entry.migrationRunId ?? null,
          sourceUpdatedAt: entry.sourceUpdatedAt ?? null,
          importedAt: entry.importedAt ?? now,
          updatedAt: now,
        },
      });
  }
}

/**
 * A transaction-aware in-memory adapter used by the import tests and by
 * callers that need to inspect planned writes without PostgreSQL. Each unit
 * clones state before applying so an injected failure cannot leak half a
 * product/pricing or client/lineage update.
 */
export interface MemoryFrappeMigrationRepositoryOptions {
  state?: Partial<FrappeMigrationState>;
  failProductSku?: string;
  failClientKey?: string;
  failQuotationKey?: string;
}

function cloneQuotation(value: ExistingQuotation): ExistingQuotation {
  return {
    ...value,
    createdAt: value.createdAt ? new Date(value.createdAt) : undefined,
    revision: value.revision
      ? { ...value.revision, createdAt: new Date(value.revision.createdAt) }
      : undefined,
    items: value.items?.map((item) => ({ ...item })),
    document: value.document
      ? { ...value.document, createdAt: new Date(value.document.createdAt) }
      : null,
  };
}

export class MemoryFrappeMigrationRepository implements FrappeMigrationRepository {
  private state: FrappeMigrationState;
  readonly writes = { products: 0, clients: 0, quotations: 0, lineage: 0, documents: 0 };
  readonly transactions = { products: 0, clients: 0, quotations: 0 };
  readonly runs: Array<{
    id: string;
    provider: string;
    mode: string;
    sourceSnapshotAt: Date;
    manifestHash: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
  }> = [];
  readonly batches: Array<{
    id: string;
    runId: string;
    entityType: string;
    status: string;
    checkpoint: number;
    attemptCount: number;
  }> = [];
  failProductSku?: string;
  failClientKey?: string;
  failQuotationKey?: string;

  constructor(options: MemoryFrappeMigrationRepositoryOptions = {}) {
    this.state = {
      products: [...(options.state?.products || [])].map((value) => ({
        ...value,
        precos: [...(value.precos || [])],
      })),
      clients: [...(options.state?.clients || [])].map((value) => ({
        ...value,
        address: value.address ? { ...value.address } : null,
      })),
      quotations: (options.state?.quotations || []).map(cloneQuotation),
      lineage: [...(options.state?.lineage || [])].map((value) => ({
        ...value,
        legacyPayload: value.legacyPayload ? { ...value.legacyPayload } : {},
      })),
      sequences: { ...(options.state?.sequences || {}) },
    };
    this.failProductSku = options.failProductSku;
    this.failClientKey = options.failClientKey;
    this.failQuotationKey = options.failQuotationKey;
  }

  async loadState(): Promise<FrappeMigrationState> {
    return {
      products: this.state.products.map((value) => ({
        ...value,
        precos: [...(value.precos || [])],
      })),
      clients: this.state.clients.map((value) => ({
        ...value,
        address: value.address ? { ...value.address } : null,
      })),
      quotations: this.state.quotations.map(cloneQuotation),
      lineage: this.state.lineage.map((value) => ({
        ...value,
        legacyPayload: value.legacyPayload ? { ...value.legacyPayload } : {},
      })),
      sequences: { ...this.state.sequences },
    };
  }

  async applyProductUnit(unit: ProductUnit): Promise<void> {
    this.transactions.products += 1;
    if (this.failProductSku === unit.product.sku) throw new Error('Falha transacional de produto.');
    const next = await this.loadState();
    const index = next.products.findIndex((value) => value.sku === unit.product.sku);
    const row: ExistingProduct = {
      sku: unit.product.sku,
      nome: unit.product.nome,
      descricao: unit.product.descricao,
      unidade: unit.product.unidade,
      categoria: unit.product.categoria,
      marca: unit.product.marca,
      ativo: unit.product.ativo,
      precoBase: unit.pricing.preco_base,
      precos: unit.pricing.precos,
    };
    if (index >= 0) next.products[index] = row;
    else next.products.push(row);
    next.lineage = next.lineage.filter(
      (entry) =>
        !unit.lineage.some(
          (line) => entry.sourceDoctype === line.sourceDoctype && entry.sourceId === line.sourceId
        )
    );
    next.lineage.push(...unit.lineage);
    this.state = next;
    this.writes.products += 1;
    this.writes.lineage += unit.lineage.length;
  }

  async applyClientUnit(unit: ClientUnit): Promise<void> {
    this.transactions.clients += 1;
    if (this.failClientKey === unit.client.localKey)
      throw new Error('Falha transacional de cliente.');
    const next = await this.loadState();
    const linkedKeys = [
      ...new Set(
        unit.lineage
          .map(
            (line) =>
              next.lineage.find(
                (entry) =>
                  entry.sourceDoctype === line.sourceDoctype && entry.sourceId === line.sourceId
              )?.localKey
          )
          .filter((value): value is string => Boolean(value))
      ),
    ];
    if (linkedKeys.length > 1)
      throw new Error('Vínculos de cliente apontam para entidades locais diferentes.');
    const lineage = next.lineage.find((entry) =>
      unit.lineage.some(
        (line) => entry.sourceDoctype === line.sourceDoctype && entry.sourceId === line.sourceId
      )
    );
    const existing = next.clients.find(
      (value) =>
        value.id === lineage?.localKey ||
        (unit.client.documento && value.documento === unit.client.documento)
    );
    const id = existing?.id || lineage?.localKey || stableUuid(unit.client.localKey);
    const row: ExistingClient = {
      id,
      nome: unit.client.nome,
      documento: unit.client.documento,
      email: unit.client.email,
      telefone: unit.client.telefone,
      notes: unit.client.notes,
      address: unit.client.address,
    };
    const index = next.clients.findIndex((value) => value.id === id);
    if (index >= 0) next.clients[index] = row;
    else next.clients.push(row);
    next.lineage = next.lineage.filter(
      (entry) =>
        !unit.lineage.some(
          (line) => entry.sourceDoctype === line.sourceDoctype && entry.sourceId === line.sourceId
        )
    );
    next.lineage.push(...unit.lineage.map((line) => ({ ...line, localKey: id })));
    this.state = next;
    this.writes.clients += 1;
    this.writes.lineage += unit.lineage.length;
  }

  async applyQuotationUnit(unit: QuotationUnit): Promise<void> {
    this.transactions.quotations += 1;
    if (this.failQuotationKey === unit.quotation.sourceId)
      throw new Error('Falha transacional de orçamento.');
    const next = await this.loadState();
    const clientId = unit.quotation.clientId;
    if (!clientId || !next.clients.some((value) => value.id === clientId))
      throw new Error('Cliente do orçamento não importado.');
    const quotation: ExistingQuotation = {
      id: unit.id,
      businessNumber: unit.quotation.businessNumber,
      clientId,
      status: unit.quotation.status,
      createdAt: unit.revision.createdAt,
      revision: {
        ...unit.revision,
        id: unit.revision.id,
        createdAt: new Date(unit.revision.createdAt),
      },
      items: unit.items.map((item) => ({ ...item })),
      document: unit.document
        ? { ...unit.document, createdAt: new Date(unit.revision.createdAt) }
        : null,
    };
    const index = next.quotations.findIndex((value) => value.id === unit.id);
    if (index >= 0) next.quotations[index] = quotation;
    else next.quotations.push(quotation);
    next.lineage = next.lineage.filter(
      (entry) =>
        !unit.lineage.some(
          (line) => entry.sourceDoctype === line.sourceDoctype && entry.sourceId === line.sourceId
        )
    );
    next.lineage.push(...unit.lineage);
    this.state = next;
    this.writes.quotations += 1;
    this.writes.lineage += unit.lineage.length;
  }

  async advanceQuoteSequence(year: number, lastNumber: number): Promise<void> {
    const next = await this.loadState();
    next.sequences[year] = Math.max(next.sequences[year] || 0, lastNumber);
    this.state = next;
  }

  async listIssuedDocumentPdfPlaceholders(): Promise<IssuedDocumentPdfPlaceholder[]> {
    const placeholders: IssuedDocumentPdfPlaceholder[] = [];
    for (const quotation of this.state.quotations) {
      const document = quotation.document;
      if (!document || document.kind !== 'historical_pdf_import') continue;
      const lineage = this.state.lineage.find(
        (entry) => entry.sourceDoctype === 'Quotation' && entry.localKey === quotation.id
      );
      // Lineage is the ground truth for the source id; the placeholder file
      // name (`{name}.pdf`) is only a fallback for pre-lineage snapshots.
      const sourceId =
        lineage?.sourceId ||
        (document.fileName.endsWith('.pdf') ? document.fileName.slice(0, -4) : '');
      placeholders.push({
        documentId: document.id,
        sourceId,
        businessNumber: quotation.businessNumber,
        fileName: document.fileName,
        blobPathname: document.blobPathname,
      });
    }
    placeholders.sort((left, right) => left.businessNumber.localeCompare(right.businessNumber));
    return placeholders;
  }

  async updateIssuedDocumentPdf(
    documentId: string,
    blobPathname: string,
    fileName: string,
    mimeType: string,
    sizeBytes: number,
    checksumSha256: string
  ): Promise<void> {
    const next = await this.loadState();
    let found = false;
    for (const quotation of next.quotations) {
      if (quotation.document?.id !== documentId) continue;
      quotation.document = {
        ...quotation.document,
        blobPathname,
        fileName,
        mimeType,
        sizeBytes,
        checksumSha256,
      };
      found = true;
      break;
    }
    if (!found) throw new Error('Documento emitido não encontrado para atualização.');
    this.state = next;
    this.writes.documents += 1;
  }

  snapshot(): FrappeMigrationState {
    return this.state;
  }

  async createRun(params: {
    id: string;
    provider: string;
    mode: string;
    sourceSnapshotAt: Date;
    manifestHash: string;
    startedAt: Date;
  }): Promise<void> {
    this.runs.push({
      ...params,
      status: 'running',
      completedAt: null,
    });
  }

  async completeRun(
    runId: string,
    status: 'completed' | 'failed'
  ): Promise<void> {
    const run = this.runs.find((r) => r.id === runId);
    if (run) {
      run.status = status;
      run.completedAt = new Date();
    }
  }

  async createBatch(params: {
    id: string;
    runId: string;
    entityType: string;
  }): Promise<void> {
    this.batches.push({
      ...params,
      status: 'pending',
      checkpoint: 0,
      attemptCount: 0,
    });
  }

  async updateBatch(
    batchId: string,
    params: { status?: string; checkpoint?: number; attemptCount?: number }
  ): Promise<void> {
    const batch = this.batches.find((b) => b.id === batchId);
    if (!batch) return;
    if (params.status !== undefined) batch.status = params.status;
    if (params.checkpoint !== undefined) batch.checkpoint = params.checkpoint;
    if (params.attemptCount !== undefined) batch.attemptCount = params.attemptCount;
  }
}

export const createFrappeMigrationRepository = createPostgresFrappeMigrationRepository;
