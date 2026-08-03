import { asc, eq, inArray } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from './client.js';
import { productPricingTiers, products } from './schema.js';
import {
  normalizeProductPricing,
  type NormalizedProductPricing,
  type PricingTierInput,
} from '../_functions/pricing-core.js';

export interface PricingTierRecord {
  minimum_quantity: string;
  unit_price: string;
  /** Compatibility fields used by the existing fixed-bracket UI. */
  faixa: string;
  qty: string;
  rate: string;
}

export interface ProductPricingRecord {
  sku: string;
  preco_base: string | null;
  precos: PricingTierRecord[];
  pricing_available: boolean;
  preco_minimo: string | null;
}

export interface PricingReplaceInput {
  preco_base: string | number | null;
  precos: PricingTierInput[];
}

export class PricingRepositoryError extends Error {
  readonly statusCode: number;
  readonly expose: boolean;

  constructor(statusCode: number, message: string, expose = true) {
    super(message);
    this.name = 'PricingRepositoryError';
    this.statusCode = statusCode;
    this.expose = expose;
  }
}

export interface PricingRepository {
  get(sku: string): Promise<ProductPricingRecord | null>;
  list?(skus: string[]): Promise<Map<string, ProductPricingRecord>>;
  replace(sku: string, input: PricingReplaceInput): Promise<ProductPricingRecord>;
  save?(sku: string, input: PricingReplaceInput): Promise<ProductPricingRecord>;
}

function minimumPrice(values: string[]): string | null {
  if (values.length === 0) return null;
  return values.reduce((minimum, value) => {
    const left = value.replace(/^\+/, '').split('.');
    const right = minimum.replace(/^\+/, '').split('.');
    const leftInt = BigInt(left[0] || '0');
    const rightInt = BigInt(right[0] || '0');
    if (leftInt !== rightInt) return leftInt < rightInt ? value : minimum;
    const leftFraction = BigInt((left[1] || '').padEnd(2, '0'));
    const rightFraction = BigInt((right[1] || '').padEnd(2, '0'));
    return leftFraction < rightFraction ? value : minimum;
  });
}

export function pricingRecordFromNormalized(
  sku: string,
  normalized: NormalizedProductPricing,
): ProductPricingRecord {
  const precos = normalized.precos.map((tier) => ({
    minimum_quantity: tier.minimum_quantity,
    unit_price: tier.unit_price,
    faixa: tier.minimum_quantity,
    qty: tier.minimum_quantity,
    rate: tier.unit_price,
  }));
  const prices = [normalized.preco_base, ...precos.map((tier) => tier.unit_price)]
    .filter((value): value is string => value !== null);
  return {
    sku,
    preco_base: normalized.preco_base,
    precos,
    pricing_available: prices.length > 0,
    preco_minimo: minimumPrice(prices),
  };
}

type DatabaseProvider = () => AppDatabase;

function normalizeSku(sku: string): string {
  return String(sku || '').trim();
}

function asString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function toTier(row: typeof productPricingTiers.$inferSelect): PricingTierRecord {
  const minimumQuantity = String(row.minimumQuantity);
  const unitPrice = String(row.unitPrice);
  return {
    minimum_quantity: minimumQuantity,
    unit_price: unitPrice,
    faixa: minimumQuantity,
    qty: minimumQuantity,
    rate: unitPrice,
  };
}

function toRecord(
  sku: string,
  base: string | number | null | undefined,
  tierRows: (typeof productPricingTiers.$inferSelect)[],
): ProductPricingRecord {
  const precos = tierRows.map(toTier);
  const prices = [base, ...precos.map((tier) => tier.unit_price)]
    .filter((value): value is string | number => value !== null && value !== undefined)
    .map((value) => String(value));
  const precoMinimo = minimumPrice(prices);
  return {
    sku,
    preco_base: asString(base),
    precos,
    pricing_available: prices.length > 0,
    preco_minimo: precoMinimo,
  };
}

function duplicatePricingError(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const value = current as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown };
    if (
      value.code === '23505' ||
      value.constraint === 'product_pricing_tiers_pkey' ||
      value.constraint_name === 'product_pricing_tiers_pkey'
    ) return true;
    if (value.cause && typeof value.cause === 'object') pending.push(value.cause);
  }
  return false;
}

async function readOne(db: AppDatabase, sku: string): Promise<ProductPricingRecord | null> {
  const [product] = await db
    .select({ sku: products.sku, precoBase: products.precoBase })
    .from(products)
    .where(eq(products.sku, sku))
    .limit(1);
  if (!product) return null;
  const tiers = await db
    .select()
    .from(productPricingTiers)
    .where(eq(productPricingTiers.productSku, sku))
    .orderBy(asc(productPricingTiers.minimumQuantity));
  return toRecord(product.sku, product.precoBase, tiers);
}

/** PostgreSQL implementation. It exposes only domain records to handlers. */
export function createPostgresPricingRepository(
  getDb: DatabaseProvider = getDatabase,
): PricingRepository {
  const repository: PricingRepository = {
    async get(sku: string): Promise<ProductPricingRecord | null> {
      const normalizedSku = normalizeSku(sku);
      if (!normalizedSku) return null;
      try {
        return await readOne(getDb(), normalizedSku);
      } catch {
        throw new PricingRepositoryError(503, 'Não foi possível consultar os preços. Tente novamente.', false);
      }
    },

    async list(skus: string[]): Promise<Map<string, ProductPricingRecord>> {
      const normalized = [...new Set(skus.map(normalizeSku).filter(Boolean))];
      const result = new Map<string, ProductPricingRecord>();
      if (normalized.length === 0) return result;
      try {
        const db = getDb();
        const productRows = await db
          .select({ sku: products.sku, precoBase: products.precoBase })
          .from(products)
          .where(inArray(products.sku, normalized));
        const tierRows = await db
          .select()
          .from(productPricingTiers)
          .where(inArray(productPricingTiers.productSku, normalized))
          .orderBy(asc(productPricingTiers.productSku), asc(productPricingTiers.minimumQuantity));
        const bySku = new Map<string, (typeof productPricingTiers.$inferSelect)[]>();
        for (const tier of tierRows) {
          const rows = bySku.get(tier.productSku) || [];
          rows.push(tier);
          bySku.set(tier.productSku, rows);
        }
        for (const product of productRows) {
          result.set(product.sku, toRecord(product.sku, product.precoBase, bySku.get(product.sku) || []));
        }
        return result;
      } catch {
        throw new PricingRepositoryError(503, 'Não foi possível consultar os preços. Tente novamente.', false);
      }
    },

    async replace(sku: string, input: PricingReplaceInput): Promise<ProductPricingRecord> {
      const normalizedSku = normalizeSku(sku);
      if (!normalizedSku) throw new PricingRepositoryError(400, 'SKU é obrigatório.');

      let normalized: NormalizedProductPricing;
      try {
        normalized = normalizeProductPricing({ preco_base: input.preco_base, precos: input.precos });
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new PricingRepositoryError(400, 'Preços inválidos.');
      }

      const db = getDb();
      try {
        const result = await db.transaction(async (tx) => {
          const [existing] = await tx
            .select({ sku: products.sku })
            .from(products)
            .where(eq(products.sku, normalizedSku))
            .limit(1);
          if (!existing) return null;

          await tx
            .update(products)
            .set({ precoBase: normalized.preco_base, atualizadoEm: new Date() })
            .where(eq(products.sku, normalizedSku));
          // Delete + insert inside one transaction is the complete-set write;
          // readers observe either the old set or the new set, never a partial set.
          await tx.delete(productPricingTiers).where(eq(productPricingTiers.productSku, normalizedSku));
          if (normalized.precos.length > 0) {
            await tx.insert(productPricingTiers).values(normalized.precos.map((tier) => ({
              productSku: normalizedSku,
              minimumQuantity: tier.minimum_quantity,
              unitPrice: tier.unit_price,
              atualizadoEm: new Date(),
            })));
          }
          return true;
        });
        if (!result) throw new PricingRepositoryError(404, 'Produto não encontrado.');
        const updated = await readOne(db, normalizedSku);
        if (!updated) throw new PricingRepositoryError(404, 'Produto não encontrado.');
        return updated;
      } catch (error) {
        if (error instanceof PricingRepositoryError) throw error;
        if (duplicatePricingError(error)) {
          throw new PricingRepositoryError(409, 'Não é permitido repetir a quantidade mínima de uma faixa.');
        }
        throw new PricingRepositoryError(503, 'Não foi possível salvar os preços. Tente novamente.', false);
      }
    },
  };
  repository.save = repository.replace;
  return repository;
}
