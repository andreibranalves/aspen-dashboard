import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { getDatabase, type AppDatabase } from '../client.js';
import {
  appendProductActivityEvents,
  type ProductActivityEventInput,
} from './product-activity-repository.js';
import {
  normalizeProductCreateInput,
  normalizeProductUpdateInput,
  toProductRecord,
  type ProductCreateInput,
  type ProductRecord,
  type ProductUpdateInput,
} from './products-repository.js';
import { productPricingTiers, products } from '../schema.js';
import {
  normalizeProductPricing,
  type PricingTierInput,
} from '../../../modules/pricing-core.js';
import {
  pricingRecordFromNormalized,
  type PricingReplaceInput,
  type ProductPricingRecord,
} from './pricing-repository.js';

export interface ProductCatalogWriteResult {
  product: ProductRecord;
  pricing: ProductPricingRecord | null;
}

export class ProductCatalogRepositoryError extends Error {
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(statusCode: number, message: string, expose = true) {
    super(message);
    this.name = 'ProductCatalogRepositoryError';
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export interface ProductCatalogRepository {
  create(input: ProductCreateInput, pricing?: PricingReplaceInput): Promise<ProductCatalogWriteResult>;
  update(sku: string, patch: ProductUpdateInput, pricing?: PricingReplaceInput): Promise<ProductCatalogWriteResult | null>;
}

type DatabaseProvider = () => AppDatabase;

function isDuplicate(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const value = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown };
    if (
      value.code === '23505' ||
      value.constraint === 'products_pkey' ||
      value.constraint_name === 'products_pkey' ||
      value.constraint === 'product_pricing_tiers_pkey' ||
      value.constraint_name === 'product_pricing_tiers_pkey'
    ) return true;
    if (value.cause && typeof value.cause === 'object') pending.push(value.cause);
  }
  return false;
}

function normalizePricing(input: PricingReplaceInput | undefined) {
  if (!input) return null;
  return normalizeProductPricing({ preco_base: input.preco_base, precos: input.precos });
}

function numericKey(value: unknown): string {
  const [integer, fraction = ''] = String(value ?? '').trim().split('.');
  const normalizedInteger = (integer || '0').replace(/^(-?)0+(?=\d)/, '$1');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${normalizedInteger}.${normalizedFraction}` : normalizedInteger;
}

function metadataValues(patch: ProductUpdateInput): Partial<typeof products.$inferInsert> {
  const values: Partial<typeof products.$inferInsert> = { atualizadoEm: new Date() };
  if (patch.nome !== undefined) values.nome = patch.nome;
  if (patch.descricao !== undefined) values.descricao = patch.descricao;
  if (patch.unidade !== undefined) values.unidade = patch.unidade;
  if (patch.categoria !== undefined) values.categoria = patch.categoria;
  if (patch.marca !== undefined) values.marca = patch.marca;
  if (patch.ativo !== undefined) {
    values.ativo = patch.ativo;
    values.arquivadoEm = patch.ativo === false ? new Date() : null;
  }
  return values;
}

async function insertTiers(tx: Parameters<Parameters<AppDatabase['transaction']>[0]>[0], sku: string, normalized: ReturnType<typeof normalizeProductPricing>) {
  if (normalized.precos.length === 0) return;
  await tx.insert(productPricingTiers).values(normalized.precos.map((tier) => ({
    productSku: sku,
    minimumQuantity: tier.minimum_quantity,
    unitPrice: tier.unit_price,
    atualizadoEm: new Date(),
  })));
}

/**
 * PostgreSQL catalog writer. Product metadata and its complete pricing set are
 * deliberately written in the same Drizzle transaction so an injected tier
 * failure rolls back every preceding product mutation.
 */
export function createPostgresProductCatalogRepository(
  getDb: DatabaseProvider = getDatabase,
): ProductCatalogRepository {
  return {
    async create(input, pricingInput): Promise<ProductCatalogWriteResult> {
      const normalizedProduct = normalizeProductCreateInput(input);
      const normalizedPricing = normalizePricing(pricingInput);
      const db = getDb();
      try {
        const row = await db.transaction(async (tx) => {
          const [created] = await tx.insert(products).values({
            sku: normalizedProduct.sku,
            nome: normalizedProduct.nome,
            descricao: normalizedProduct.descricao,
            unidade: normalizedProduct.unidade,
            categoria: normalizedProduct.categoria,
            marca: normalizedProduct.marca,
            precoBase: normalizedPricing?.preco_base ?? null,
            ativo: true,
            arquivadoEm: null,
          }).returning();
          if (!created) throw new Error('empty insert result');
          if (normalizedPricing) await insertTiers(tx, normalizedProduct.sku, normalizedPricing);
          const activityCreatedAt = created.criadoEm instanceof Date
            ? created.criadoEm
            : new Date(created.criadoEm);
          const activity: ProductActivityEventInput[] = [{
            sku: normalizedProduct.sku,
            tipo: 'produto',
            texto: 'Produto criado',
            reference_id: `produto:${normalizedProduct.sku}:criado`,
            created_at: activityCreatedAt,
          }];
          if (normalizedPricing && (normalizedPricing.preco_base !== null || normalizedPricing.precos.length > 0)) {
            activity.push({
              sku: normalizedProduct.sku,
              tipo: 'preco',
              texto: 'Preço cadastrado',
              reference_id: `preco:${normalizedProduct.sku}:criado`,
              created_at: new Date(activityCreatedAt.getTime() + 1),
            });
          }
          await appendProductActivityEvents(tx, activity);
          return created;
        });
        return {
          product: toProductRecord(row),
          pricing: normalizedPricing ? pricingRecordFromNormalized(normalizedProduct.sku, normalizedPricing) : null,
        };
      } catch (error) {
        if (isDuplicate(error)) throw new ProductCatalogRepositoryError(409, 'SKU ou quantidade mínima já cadastrada.');
        throw new ProductCatalogRepositoryError(503, 'Não foi possível salvar o produto. Tente novamente.', false);
      }
    },

    async update(sku, patch, pricingInput): Promise<ProductCatalogWriteResult | null> {
      const normalizedSku = String(sku || '').trim();
      if (!normalizedSku) throw new ProductCatalogRepositoryError(400, 'SKU é obrigatório.');
      const normalizedPatch = normalizeProductUpdateInput(patch);
      const normalizedPricing = normalizePricing(pricingInput);
      const db = getDb();
      try {
        const row = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select()
            .from(products)
            .where(eq(products.sku, normalizedSku))
            .for('update')
            .limit(1);
          if (!existing) return null;

          const metadata = metadataValues(normalizedPatch);
          const metadataChanged = Object.entries(normalizedPatch).some(([key, value]) => {
            if (key === 'ativo') return existing.ativo !== value;
            if (key === 'categoria' || key === 'marca') return (existing[key] ?? null) !== (value ?? null);
            return existing[key as keyof typeof existing] !== value;
          });
          let pricingChanged = false;
          const currentTiers = normalizedPricing
            ? await tx
              .select()
              .from(productPricingTiers)
              .where(eq(productPricingTiers.productSku, normalizedSku))
              .orderBy(asc(productPricingTiers.minimumQuantity), asc(productPricingTiers.unitPrice))
            : [];
          if (normalizedPricing) {
            pricingChanged = numericKey(existing.precoBase) !== numericKey(normalizedPricing.preco_base)
              || currentTiers.length !== normalizedPricing.precos.length
              || currentTiers.some((tier, index) => {
                const next = normalizedPricing!.precos[index];
                return !next
                  || numericKey(tier.minimumQuantity) !== numericKey(next.minimum_quantity)
                  || numericKey(tier.unitPrice) !== numericKey(next.unit_price);
              });
          }
          if (!metadataChanged && !pricingChanged) {
            return existing;
          }

          if (normalizedPricing && pricingChanged) metadata.precoBase = normalizedPricing.preco_base;
          if (!metadataChanged && !pricingChanged) {
            delete metadata.atualizadoEm;
          }
          const [updated] = Object.keys(metadata).length > 0
            ? await tx.update(products).set(metadata).where(eq(products.sku, normalizedSku)).returning()
            : [existing];
          if (!updated) throw new Error('empty update result');
          if (normalizedPricing && pricingChanged) {
            await tx.delete(productPricingTiers).where(eq(productPricingTiers.productSku, normalizedSku));
            await insertTiers(tx, normalizedSku, normalizedPricing);
          }

          const operationAt = updated.atualizadoEm;
          const mutationId = randomUUID();
          const activity: ProductActivityEventInput[] = [];
          if (metadataChanged) {
            const archived = normalizedPatch.ativo === false && existing.ativo;
            activity.push({
              sku: normalizedSku,
              tipo: 'produto',
              texto: archived ? 'Produto arquivado' : 'Produto atualizado',
              reference_id: `produto:${normalizedSku}:${mutationId}`,
              created_at: operationAt,
            });
          }
          if (pricingChanged) {
            activity.push({
              sku: normalizedSku,
              tipo: 'preco',
              texto: 'Preço atualizado',
              reference_id: `preco:${normalizedSku}:${mutationId}`,
              created_at: operationAt instanceof Date
                ? new Date(operationAt.getTime() + 1)
                : new Date(new Date(operationAt).getTime() + 1),
            });
          }
          await appendProductActivityEvents(tx, activity);
          return updated;
        });
        if (!row) return null;
        return {
          product: toProductRecord(row),
          pricing: normalizedPricing ? pricingRecordFromNormalized(normalizedSku, normalizedPricing) : null,
        };
      } catch (error) {
        if (isDuplicate(error)) throw new ProductCatalogRepositoryError(409, 'SKU ou quantidade mínima já cadastrada.');
        throw new ProductCatalogRepositoryError(503, 'Não foi possível atualizar o produto. Tente novamente.', false);
      }
    },
  };
}

export type ProductCatalogPricingInput = {
  preco_base: string | number | null;
  precos: PricingTierInput[];
};
