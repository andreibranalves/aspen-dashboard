import { and, asc, eq } from 'drizzle-orm';
import { getDatabase, type AppDatabase } from '../client.js';
import { productPricingTiers, products } from '../schema.js';
import { normalizeProductPricing, resolveProductPrice, PricingUnavailableError, PricingValidationError } from '../../../_modules/pricing-core.js';
import type { PricingResolver } from '../../../_modules/quotation-draft-snapshot.js';

export function createPostgresQuotationPricingResolver(
  getDb: () => AppDatabase = getDatabase,
): PricingResolver {
  return async (rawItem, quantity, surchargePercent = 0) => {
    const item = rawItem && typeof rawItem === 'object' ? rawItem as Record<string, unknown> : {};
    const sku = String(item.item_code || item.sku || '').trim();
    if (!sku) throw new PricingUnavailableError('SKU do item é obrigatório.');
    const db = getDb();
    const [product] = await db
      .select({ sku: products.sku, precoBase: products.precoBase })
      .from(products)
      .where(and(eq(products.sku, sku), eq(products.ativo, true)))
      .limit(1);
    if (!product) throw new PricingUnavailableError(`Produto "${sku}" não encontrado ou inativo.`);
    const tiers = await db
      .select()
      .from(productPricingTiers)
      .where(eq(productPricingTiers.productSku, sku))
      .orderBy(asc(productPricingTiers.minimumQuantity));
    try {
      const pricing = normalizeProductPricing({
        preco_base: product.precoBase,
        precos: tiers.map((tier) => ({ minimum_quantity: String(tier.minimumQuantity), unit_price: String(tier.unitPrice) })),
      });
      return { rate: resolveProductPrice(pricing, quantity, surchargePercent).rate };
    } catch (error) {
      if (error instanceof PricingUnavailableError || error instanceof PricingValidationError) {
        throw new PricingUnavailableError(`Preço indisponível para o produto "${sku}".`);
      }
      throw error;
    }
  };
}
