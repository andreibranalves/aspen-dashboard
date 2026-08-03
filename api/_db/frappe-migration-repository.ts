import { createHash } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from './client.js';
import { frappeImportLineage, clients, productPricingTiers, products } from './schema.js';
import type {
  ClientUnit,
  ExistingClient,
  ExistingLineage,
  ExistingProduct,
  FrappeLineageEntry,
  ProductUnit,
  PricingTierInput,
  SourceRecord,
} from '../_functions/lib/frappe-migration-core.js';

export interface FrappeMigrationState {
  products: ExistingProduct[];
  clients: ExistingClient[];
  lineage: ExistingLineage[];
}

export interface FrappeMigrationRepository {
  loadState(): Promise<FrappeMigrationState>;
  applyProductUnit(unit: ProductUnit): Promise<void>;
  applyClientUnit(unit: ClientUnit): Promise<void>;
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

function addressFromRow(row: typeof clients.$inferSelect) {
  const values = [row.endereco, row.numero, row.bairro, row.complemento, row.municipio, row.uf, row.cep];
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
  getDb: DatabaseProvider = getDatabase,
): FrappeMigrationRepository {
  return {
    async loadState(): Promise<FrappeMigrationState> {
      const db = getDb();
      const [productRows, tierRows, clientRows, lineageRows] = await Promise.all([
        db.select().from(products).orderBy(asc(products.sku)),
        db.select().from(productPricingTiers).orderBy(asc(productPricingTiers.productSku), asc(productPricingTiers.minimumQuantity)),
        db.select().from(clients).orderBy(asc(clients.id)),
        db.select().from(frappeImportLineage).orderBy(asc(frappeImportLineage.sourceDoctype), asc(frappeImportLineage.sourceId)),
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
      };
    },

    async applyProductUnit(unit: ProductUnit): Promise<void> {
      const db = getDb();
      await db.transaction(async (tx) => {
        const [existing] = await tx.select({ sku: products.sku }).from(products).where(eq(products.sku, unit.product.sku)).limit(1);
        if (existing) {
          await tx.update(products).set({
            nome: unit.product.nome,
            descricao: unit.product.descricao,
            unidade: unit.product.unidade,
            categoria: unit.product.categoria,
            marca: unit.product.marca,
            ativo: unit.product.ativo,
            precoBase: unit.pricing.preco_base,
            arquivadoEm: unit.product.ativo ? null : new Date(),
            atualizadoEm: new Date(),
          }).where(eq(products.sku, unit.product.sku));
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
        await tx.delete(productPricingTiers).where(eq(productPricingTiers.productSku, unit.product.sku));
        if (unit.pricing.precos.length) {
          await tx.insert(productPricingTiers).values(unit.pricing.precos.map((tier) => ({
            productSku: unit.product.sku,
            minimumQuantity: String(tier.minimum_quantity),
            unitPrice: String(tier.unit_price),
            atualizadoEm: new Date(),
          })));
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
          const [row] = await tx.select().from(frappeImportLineage).where(and(
            eq(frappeImportLineage.sourceDoctype, sourceLineage.sourceDoctype),
            eq(frappeImportLineage.sourceId, sourceLineage.sourceId),
          )).limit(1);
          if (row) linkedRows.push(row);
        }
        const linkedKeys = [...new Set(linkedRows.map((row) => row.localKey))];
        if (linkedKeys.length > 1) throw new Error('Vínculos de cliente apontam para entidades locais diferentes.');
        const linked = linkedRows[0];
        const id = linked?.localKey && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(linked.localKey)
          ? linked.localKey
          : stableUuid(localKey);
        const [byId] = await tx.select().from(clients).where(eq(clients.id, id)).limit(1);
        const [byDocument] = unit.client.documento
          ? await tx.select().from(clients).where(eq(clients.documento, unit.client.documento)).limit(1)
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
          await upsertLineage(tx, unit.lineage.map((entry) => ({ ...entry, localKey: existing.id })));
        } else {
          await tx.insert(clients).values({ id, ...values, arquivado: false, archivedAt: null });
          await upsertLineage(tx, unit.lineage.map((entry) => ({ ...entry, localKey: id })));
        }
      });
    },
  };
}

type Transaction = Parameters<Parameters<AppDatabase['transaction']>[0]>[0];

async function upsertLineage(tx: Transaction, entries: FrappeLineageEntry[]): Promise<void> {
  for (const entry of entries) {
    await tx.insert(frappeImportLineage).values({
      sourceDoctype: entry.sourceDoctype,
      sourceId: entry.sourceId,
      entityType: entry.entityType,
      localKey: entry.localKey,
      canonicalHash: entry.canonicalHash,
      legacyPayload: entry.legacyPayload,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [frappeImportLineage.sourceDoctype, frappeImportLineage.sourceId],
      set: {
        entityType: entry.entityType,
        localKey: entry.localKey,
        canonicalHash: entry.canonicalHash,
        legacyPayload: entry.legacyPayload,
        updatedAt: new Date(),
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
}

export class MemoryFrappeMigrationRepository implements FrappeMigrationRepository {
  private state: FrappeMigrationState;
  readonly writes = { products: 0, clients: 0, lineage: 0 };
  readonly transactions = { products: 0, clients: 0 };
  failProductSku?: string;
  failClientKey?: string;

  constructor(options: MemoryFrappeMigrationRepositoryOptions = {}) {
    this.state = {
      products: [...(options.state?.products || [])].map((value) => ({ ...value, precos: [...(value.precos || [])] })),
      clients: [...(options.state?.clients || [])].map((value) => ({ ...value, address: value.address ? { ...value.address } : null })),
      lineage: [...(options.state?.lineage || [])].map((value) => ({ ...value, legacyPayload: value.legacyPayload ? { ...value.legacyPayload } : {} })),
    };
    this.failProductSku = options.failProductSku;
    this.failClientKey = options.failClientKey;
  }

  async loadState(): Promise<FrappeMigrationState> {
    return {
      products: this.state.products.map((value) => ({ ...value, precos: [...(value.precos || [])] })),
      clients: this.state.clients.map((value) => ({ ...value, address: value.address ? { ...value.address } : null })),
      lineage: this.state.lineage.map((value) => ({ ...value, legacyPayload: value.legacyPayload ? { ...value.legacyPayload } : {} })),
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
    next.lineage = next.lineage.filter((entry) => !unit.lineage.some((line) => entry.sourceDoctype === line.sourceDoctype && entry.sourceId === line.sourceId));
    next.lineage.push(...unit.lineage);
    this.state = next;
    this.writes.products += 1;
    this.writes.lineage += unit.lineage.length;
  }

  async applyClientUnit(unit: ClientUnit): Promise<void> {
    this.transactions.clients += 1;
    if (this.failClientKey === unit.client.localKey) throw new Error('Falha transacional de cliente.');
    const next = await this.loadState();
    const linkedKeys = [...new Set(unit.lineage
      .map((line) => next.lineage.find((entry) => entry.sourceDoctype === line.sourceDoctype && entry.sourceId === line.sourceId)?.localKey)
      .filter((value): value is string => Boolean(value)))];
    if (linkedKeys.length > 1) throw new Error('Vínculos de cliente apontam para entidades locais diferentes.');
    const lineage = next.lineage.find((entry) => unit.lineage.some((line) => entry.sourceDoctype === line.sourceDoctype && entry.sourceId === line.sourceId));
    const existing = next.clients.find((value) => value.id === lineage?.localKey || (unit.client.documento && value.documento === unit.client.documento));
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
    next.lineage = next.lineage.filter((entry) => !unit.lineage.some((line) => entry.sourceDoctype === line.sourceDoctype && entry.sourceId === line.sourceId));
    next.lineage.push(...unit.lineage.map((line) => ({ ...line, localKey: id })));
    this.state = next;
    this.writes.clients += 1;
    this.writes.lineage += unit.lineage.length;
  }

  snapshot(): FrappeMigrationState {
    return this.state;
  }
}

export const createFrappeMigrationRepository = createPostgresFrappeMigrationRepository;
