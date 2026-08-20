import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import {
  createPostgresPricingRepository,
  PricingRepositoryError,
  type PricingRepository,
} from '../_infrastructure/db/repositories/pricing-repository.js';
import {
  createPostgresProductsRepository,
  type ProductsRepository,
} from '../_infrastructure/db/repositories/products-repository.js';
import {
  PricingUnavailableError,
  PricingValidationError,
  parseQuantityScaled,
  resolveProductPrice,
} from './pricing-core.js';

type Handler = (event: FunctionEvent) => Promise<FunctionResult>;

export interface PricingLookupCoreDependencies {
  pricingRepository: PricingRepository;
  productsRepository?: ProductsRepository;
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

function errorResponse(error: unknown): FunctionResult {
  console.error('[pricing-lookup]', error instanceof Error ? error.name : typeof error);
  if (error instanceof PricingValidationError || error instanceof PricingUnavailableError) {
    return json(error.statusCode, { error: error.message });
  }
  if (error instanceof PricingRepositoryError && error.expose) {
    return json(error.statusCode, { error: error.message });
  }
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (statusCode === 400 || statusCode === 404 || statusCode === 409) {
    return json(statusCode, { error: (error as { message?: string }).message || 'Operação inválida.' });
  }
  return json(503, { error: 'Não foi possível consultar os preços. Tente novamente.' });
}

export function createCoreHandler(
  dependencies: PricingLookupCoreDependencies = {
    pricingRepository: createPostgresPricingRepository(),
    productsRepository: createPostgresProductsRepository(),
  },
): Handler {
  return async function pricingLookupHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });

    let payload: unknown;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return json(400, { error: 'JSON inválido.' });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json(400, { error: 'Envie um payload válido.' });
    }
    const inputItems = (payload as { items?: unknown }).items;
    const urgent = (payload as { urgent?: unknown }).urgent === true;
    if (!Array.isArray(inputItems)) return json(400, { error: 'Items deve ser um array.' });

    try {
      const results = new Array<Record<string, unknown>>(inputItems.length);
      const unique = new Map<string, { sku: string; qty: string | number; indices: number[] }>();
      for (let index = 0; index < inputItems.length; index += 1) {
        const item = inputItems[index];
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new PricingValidationError(`Item ${index + 1} é inválido.`);
        }
        const rawSku = (item as { item_code?: unknown }).item_code;
        const qty = (item as { qty?: unknown }).qty;
        if (typeof rawSku !== 'string' || !rawSku.trim()) {
          throw new PricingValidationError(`SKU do item ${index + 1} é obrigatório.`);
        }
        if (typeof qty !== 'string' && typeof qty !== 'number') {
          throw new PricingValidationError(`Quantidade do item ${index + 1} é inválida.`);
        }
        const quantityScaled = parseQuantityScaled(qty, `Quantidade do item ${index + 1}`);
        const key = `${rawSku.trim()}::${quantityScaled.toString()}`;
        const existing = unique.get(key);
        if (existing) existing.indices.push(index);
        else unique.set(key, { sku: rawSku.trim(), qty, indices: [index] });
      }

      const uniqueSkus = [...new Set([...unique.values()].map((entry) => entry.sku))];
      const pricingRows = dependencies.pricingRepository.list
        ? await dependencies.pricingRepository.list(uniqueSkus)
        : new Map((await Promise.all(uniqueSkus.map(async (sku) => [sku, await dependencies.pricingRepository.get(sku)] as const)))
          .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1])));
      const nameRows = dependencies.productsRepository
        ? await dependencies.productsRepository.list({ status: 'all', page: 1, limit: 200 })
        : null;
      const names = new Map((nameRows?.rows || []).map((row) => [row.sku, row.nome]));

      for (const entry of unique.values()) {
        const pricing = pricingRows.get(entry.sku);
        if (!pricing) throw new PricingUnavailableError(`Preço não disponível para "${entry.sku}".`);
        const resolved = resolveProductPrice({
          preco_base: pricing.preco_base,
          precos: pricing.precos.map((tier) => ({
            minimum_quantity: tier.minimum_quantity,
            unit_price: tier.unit_price,
          })),
        }, entry.qty, urgent);
        for (const index of entry.indices) {
          results[index] = {
            item_code: entry.sku,
            item_name: names.get(entry.sku) || entry.sku,
            qty: entry.qty,
            rate: resolved.rate,
          };
        }
      }
      return json(200, { success: true, items: results });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export const coreHandler = createCoreHandler();

export interface PricingLookupHandlerDependencies {
  core?: Handler;
}

export function createHandler(dependencies: PricingLookupHandlerDependencies = {}): Handler {
  return dependencies.core || coreHandler;
}

export const handler = createHandler();
