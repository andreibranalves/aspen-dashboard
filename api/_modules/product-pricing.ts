import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresPricingRepository,
  PricingRepositoryError,
  type PricingRepository,
} from '../_infrastructure/db/repositories/pricing-repository.js';
import { normalizeProductPricing, type PricingTierInput } from './pricing-core.js';
import { safeErrorSummary } from '../_shared/safe-error.js';

export const BRACKETS = [30, 100, 300, 500, 1000];

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface ProductPricingCoreDependencies {
  pricingRepository: PricingRepository;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function errorResponse(error: unknown): FunctionResult {
  console.error('[product-pricing]', safeErrorSummary(error));
  if (error instanceof PricingRepositoryError && error.expose) {
    return json(error.statusCode, { error: error.message });
  }
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (statusCode === 400 || statusCode === 404 || statusCode === 409) {
    return json(statusCode, { error: (error as { message?: string }).message || 'Operação inválida.' });
  }
  return json(503, { error: 'Não foi possível processar os preços. Tente novamente.' });
}

export function createCoreHandler(
  dependencies: ProductPricingCoreDependencies = { pricingRepository: createPostgresPricingRepository() },
): Handler {
  return async function productPricingHandler(event: FunctionEvent): Promise<FunctionResult> {
    const sku = (event.queryStringParameters?.sku || '').trim();
    if (!sku) return json(400, { error: 'SKU é obrigatório.' });

    try {
      if (event.httpMethod === 'GET') {
        const pricing = await dependencies.pricingRepository.get(sku);
        if (!pricing) return json(404, { error: 'Produto não encontrado.' });
        return json(200, {
          sku,
          brackets: pricing.precos.map((tier) => Number(tier.minimum_quantity)),
          preco_base: pricing.preco_base,
          precos: pricing.precos,
          pricing_available: pricing.pricing_available,
        });
      }
      if (event.httpMethod !== 'POST' && event.httpMethod !== 'PUT') {
        return json(405, { error: 'Método não permitido.' });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        return json(400, { error: 'JSON inválido.' });
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return json(400, { error: 'Envie preços válidos.' });
      }

      const body = payload as {
        preco_base?: string | number | null;
        precos?: unknown;
        base_price?: string | number | null;
        tiers?: unknown;
      };
      const current = await dependencies.pricingRepository.get(sku);
      if (!current) return json(404, { error: 'Produto não encontrado.' });
      const hasBase = Object.prototype.hasOwnProperty.call(body, 'preco_base')
        || Object.prototype.hasOwnProperty.call(body, 'base_price');
      const hasTiers = Object.prototype.hasOwnProperty.call(body, 'precos')
        || Object.prototype.hasOwnProperty.call(body, 'tiers');
      const rawTiers = hasTiers ? (body.precos ?? body.tiers) : current.precos;
      if (!Array.isArray(rawTiers)) return json(400, { error: 'Preços deve ser um array.' });

      const normalized = normalizeProductPricing({
        preco_base: hasBase ? (body.preco_base ?? body.base_price ?? null) : current.preco_base,
        precos: rawTiers.map((tier) => {
          const row = tier as Record<string, unknown>;
          return {
            minimum_quantity: row.minimum_quantity ?? row.minimumQuantity ?? row.faixa ?? row.qty,
            unit_price: row.unit_price ?? row.unitPrice ?? row.rate,
          };
        }) as PricingTierInput[],
      });
      const saved = await dependencies.pricingRepository.replace(sku, {
        preco_base: normalized.preco_base,
        precos: normalized.precos,
      });
      return json(200, {
        success: true,
        sku,
        brackets: saved.precos.map((tier) => Number(tier.minimum_quantity)),
        preco_base: saved.preco_base,
        precos: saved.precos,
        pricing_available: saved.pricing_available,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const coreHandler = createCoreHandler();

/** Compatibility reads for modules not yet removed from the build graph. */
export async function resolveProductPricing(sku: string): Promise<Record<string, unknown>[]> {
  const pricing = await createPostgresPricingRepository().get(sku);
  if (!pricing) return [];
  return pricing.precos.map((tier) => ({
    faixa: Number(tier.minimum_quantity),
    qty: Number(tier.minimum_quantity),
    rate: Number(tier.unit_price),
    status: 'found',
    origem: 'postgres',
  }));
}

/** Compatibility writes for modules not yet removed from the build graph. */
export async function saveProductPricing(
  sku: string,
  precos: Record<string, unknown>[],
): Promise<Record<string, unknown>> {
  const repository = createPostgresPricingRepository();
  const current = await repository.get(sku);
  if (!current) {
    const error = Object.assign(new Error('Produto não encontrado.'), { statusCode: 404 });
    throw error;
  }
  const input = precos.map((tier) => ({
    minimum_quantity: tier.minimum_quantity ?? tier.minimumQuantity ?? tier.faixa ?? tier.qty,
    unit_price: tier.unit_price ?? tier.unitPrice ?? tier.rate,
  })) as PricingTierInput[];
  const saved = await repository.replace(sku, {
    preco_base: current.preco_base,
    precos: input,
  });
  return {
    success: true,
    sku,
    atualizados: saved.precos.length,
    erros: 0,
    resultados: saved.precos.map((tier) => ({
      faixa: Number(tier.minimum_quantity),
      rate: Number(tier.unit_price),
      status: 'atualizado',
      origem: 'postgres',
    })),
  };
}

export interface ProductPricingHandlerDependencies {
  core?: Handler;
}

export function createHandler(dependencies: ProductPricingHandlerDependencies = {}): Handler {
  return dependencies.core || coreHandler;
}

export const handler = createHandler();
