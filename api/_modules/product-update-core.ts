import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresProductsRepository,
  ProductRepositoryError,
  type ProductUpdateInput,
  type ProductsRepository,
} from '../_infrastructure/db/repositories/products-repository.js';
import {
  createPostgresPricingRepository,
  type PricingRepository,
} from '../_infrastructure/db/repositories/pricing-repository.js';
import {
  createPostgresProductCatalogRepository,
  type ProductCatalogRepository,
} from '../_infrastructure/db/repositories/product-catalog-repository.js';
import {
  normalizeProductPricing,
  type PricingTierInput,
} from './pricing-core.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface ProductUpdateCoreDependencies {
  repository: ProductsRepository;
  pricingRepository?: PricingRepository;
  catalogRepository?: ProductCatalogRepository;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function logError(error: unknown): void {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[product-update-core] failed (${kind})`);
}

export function createCoreHandler(
  dependencies: ProductUpdateCoreDependencies = {
    repository: createPostgresProductsRepository(),
    pricingRepository: createPostgresPricingRepository(),
    catalogRepository: createPostgresProductCatalogRepository(),
  }
): Handler {
  return async function productUpdateCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'PATCH' && event.httpMethod !== 'PUT') {
      return json(405, { error: 'Método não permitido.' });
    }

    const sku = (event.queryStringParameters?.sku || '').trim();
    if (!sku) return json(400, { error: 'SKU é obrigatório.' });

    let payload: unknown;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }
    if (!isRecord(payload)) return json(400, { error: 'Envie campos válidos para atualização.' });

    if (Object.prototype.hasOwnProperty.call(payload, 'sku')) {
      return json(400, { error: 'SKU não pode ser alterado.' });
    }

    const allowed = ['nome', 'descricao', 'categoria', 'unidade', 'marca', 'ativo', 'custo_unitario'] as const;
    const patch: ProductUpdateInput = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        (patch as Record<string, unknown>)[key] = payload[key];
      }
    }
    const hasBase = Object.prototype.hasOwnProperty.call(payload, 'preco_base');
    const hasTiers = Object.prototype.hasOwnProperty.call(payload, 'precos');
    const hasPricing = hasBase || hasTiers;
    let pricingInput: { preco_base: string | number | null; precos: PricingTierInput[] } | null = null;

    try {
      if (hasPricing) {
      if (!dependencies.pricingRepository) {
        // Keep the pre-cutover test seam explicit, while production core mode
        // always supplies the PostgreSQL repository.
        return json(409, { error: 'Preços não estão disponíveis para este produto.' });
      }
      if (hasTiers && !Array.isArray(payload.precos)) {
        return json(400, { error: 'Preços deve ser um array.' });
      }

      // Omitted pricing fields preserve their current value; an explicitly
      // empty tier array is a valid request that removes every tier.
      let existingPricing = null;
      if ((!hasBase || !hasTiers) && dependencies.pricingRepository) {
        existingPricing = await dependencies.pricingRepository.get(sku);
      }
      const rawBase = hasBase
        ? payload.preco_base as string | number | null
        : existingPricing?.preco_base ?? null;
      const rawTiers = hasTiers
        ? payload.precos as PricingTierInput[]
        : (existingPricing?.precos || []).map((tier) => ({
          minimum_quantity: tier.minimum_quantity,
          unit_price: tier.unit_price,
        }));

      // Validate the complete payload before mutating product metadata or
      // replacing prices. The repository repeats this validation at its own
      // boundary for non-HTTP callers.
      const normalized = normalizeProductPricing({ preco_base: rawBase, precos: rawTiers });
      pricingInput = {
        preco_base: normalized.preco_base,
        precos: normalized.precos.map((tier) => ({
          minimum_quantity: tier.minimum_quantity,
          unit_price: tier.unit_price,
        })),
      };
      }
    } catch (error) {
      logError(error);
      const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
      if (statusCode === 400 || statusCode === 404 || statusCode === 409 || statusCode === 503) {
        return json(statusCode, { error: (error as { message?: string }).message || 'Operação inválida.' });
      }
      return json(500, { error: 'Não foi possível validar os preços. Tente novamente.' });
    }

    if (Object.keys(patch).length === 0 && !hasPricing) {
      return json(400, { error: 'Nenhum campo para atualizar.' });
    }

    try {
      let updated = null;
      let pricing = null;
      if (Object.keys(patch).length > 0 && pricingInput) {
        if (!dependencies.catalogRepository) {
          return json(503, { error: 'O serviço de catálogo não está disponível. Tente novamente.' });
        }
        const combined = await dependencies.catalogRepository.update(sku, patch, pricingInput);
        if (!combined) return json(404, { error: 'Produto não encontrado.' });
        updated = combined.product;
        pricing = combined.pricing;
      } else if (Object.keys(patch).length > 0) {
        if (dependencies.catalogRepository) {
          const combined = await dependencies.catalogRepository.update(sku, patch);
          if (!combined) return json(404, { error: 'Produto não encontrado.' });
          updated = combined.product;
        } else {
          updated = await dependencies.repository.update(sku, patch);
          if (!updated) return json(404, { error: 'Produto não encontrado.' });
        }
      } else {
        updated = await dependencies.repository.get(sku);
        if (!updated) return json(404, { error: 'Produto não encontrado.' });
        if (pricingInput && dependencies.pricingRepository) {
          pricing = await dependencies.pricingRepository.replace(sku, pricingInput);
        }
      }
      return json(200, {
        success: true,
        sku: updated.sku,
        produto: {
          sku: updated.sku,
          nome: updated.nome,
          descricao: updated.descricao,
          categoria: updated.categoria,
          unidade: updated.unidade,
          marca: updated.marca,
          ativo: updated.ativo,
          criado_em: updated.criado_em,
          atualizado_em: updated.atualizado_em,
          arquivado_em: updated.arquivado_em,
          custo_unitario: updated.custo_unitario ?? null,
          ...(pricing ? { preco_base: pricing.preco_base } : {}),
        },
        ...(pricing ? { preco_base: pricing.preco_base, precos: pricing.precos, pricing_available: pricing.pricing_available } : {}),
      });
    } catch (error) {
      logError(error);
      if (error instanceof ProductRepositoryError && error.expose) {
        return json(error.statusCode, { error: error.message });
      }
      const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
      if (statusCode === 400 || statusCode === 404 || statusCode === 409 || statusCode === 503) {
        return json(statusCode, {
          error: (error as { message?: string }).message || 'Operação inválida.',
        });
      }
      return json(500, { error: 'Não foi possível atualizar o produto. Tente novamente.' });
    }
  };
}

export const handler = createCoreHandler();
