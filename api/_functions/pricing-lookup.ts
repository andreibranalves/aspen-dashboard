// ── Imports ─────────────────────────────────────────────────────────────────
import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { getBracket, getRate, getUrgentRate } from './pricing.js';
import { erpGetList } from './lib/erpnext.js';
import { isProductsCoreEnabled, responseMetadata } from './products-mode.js';
import {
  createPostgresPricingRepository,
  PricingRepositoryError,
  type PricingRepository,
} from '../_db/pricing-repository.js';
import {
  createPostgresProductsRepository,
  type ProductsRepository,
} from '../_db/products-repository.js';
import {
  PricingUnavailableError,
  PricingValidationError,
  parseQuantityScaled,
  resolveProductPrice,
} from './pricing-core.js';

// ── Constants ───────────────────────────────────────────────────────────────
const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';
const ERPNEXT_TOKEN = process.env.ERPNEXT_TOKEN;

export interface PricingLookupCoreDependencies {
  pricingRepository: PricingRepository;
  productsRepository?: ProductsRepository;
}

function coreJson(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ...responseMetadata('core') }),
  };
}

function coreError(error: unknown): FunctionResult {
  console.error('[pricing-lookup-core]', error instanceof Error ? error.name : typeof error);
  if (error instanceof PricingValidationError || error instanceof PricingUnavailableError) {
    return coreJson(error.statusCode, { error: error.message });
  }
  if (error instanceof PricingRepositoryError && error.expose) {
    return coreJson(error.statusCode, { error: error.message });
  }
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  if (status === 400 || status === 404 || status === 409) {
    return coreJson(status, { error: (error as { message?: string }).message || 'Operação inválida.' });
  }
  return coreJson(503, { error: 'Não foi possível consultar os preços. Tente novamente.' });
}

/** PostgreSQL-only pricing lookup used while CRM_CORE_PRODUCTS_ENABLED=true. */
export function createCoreHandler(
  dependencies: PricingLookupCoreDependencies = {
    pricingRepository: createPostgresPricingRepository(),
    productsRepository: createPostgresProductsRepository(),
  },
): (event: FunctionEvent) => Promise<FunctionResult> {
  return async function pricingLookupCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'POST') return coreJson(405, { error: 'Método não permitido.' });

    let payload: unknown;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return coreJson(400, { error: 'JSON inválido.' });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return coreJson(400, { error: 'Envie um payload válido.' });
    }
    const inputItems = (payload as { items?: unknown }).items;
    const urgent = (payload as { urgent?: unknown }).urgent === true;
    if (!Array.isArray(inputItems)) return coreJson(400, { error: 'Items deve ser um array.' });

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
        // Resolve once per exact decimal representation; the resolver still
        // performs scale/finite validation before comparing quantities.
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
      return coreJson(200, { success: true, items: results });
    } catch (error) {
      return coreError(error);
    }
  };
}

export const coreHandler = createCoreHandler();

// ── Helpers ─────────────────────────────────────────────────────────────────
async function fetchItemNames(itemCodes: (string | null | undefined)[]) {
  const uniqueCodes = [...new Set(itemCodes.filter(Boolean))];
  if (uniqueCodes.length === 0) return new Map();

  try {
    const items = await erpGetList('Item', {
      filters: [['name', 'in', uniqueCodes]] as Array<Array<string | number>>,
      fields: ['name', 'item_name'],
      limit: uniqueCodes.length,
      order_by: 'name asc',
    });
    return new Map(items.map(item => [item.name, item.item_name || item.name]));
  } catch (err: any) {
    console.warn('[pricing-lookup] Falha ao buscar nomes dos itens:', err?.logMessage || err?.message || err);
    return new Map();
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
export async function legacyHandler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  try {
    const { items: inputItems, urgent } = payload;

    if (!Array.isArray(inputItems)) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Items deve ser um array.' }),
      };
    }

    // ── Build dedup map: one entry per unique (item_code, bracket) pair ──
    // key → { item_code, qty, indices[] (into output) }
    const dedupMap = new Map();
    const results = new Array(inputItems.length);

    for (let i = 0; i < inputItems.length; i++) {
      const item = inputItems[i];
      const { item_code, qty } = item;

      // Skip invalid items — store null rate immediately
      if (!item_code || qty <= 0) {
        results[i] = { item_code: item_code || '', qty: qty || 0, rate: null };
        continue;
      }

      const key = `${item_code}::${getBracket(qty)}`;
      if (!dedupMap.has(key)) {
        dedupMap.set(key, { item_code, qty, indices: [] });
      }
      dedupMap.get(key).indices.push(i);
    }

    // ── Parallel resolution ──────────────────────────────────────────────
    const uniqueKeys = [...dedupMap.keys()];
    const uniqueItemCodes = [...new Set([...dedupMap.values()].map(entry => entry.item_code))];
    const [settled, itemNames] = await Promise.all([
      Promise.allSettled(uniqueKeys.map((key) => {
        const { item_code, qty } = dedupMap.get(key) as { item_code: string; qty: number; indices: number[] };
        return getRate(item_code, qty, ERPNEXT_BASE, ERPNEXT_TOKEN);
      })),
      fetchItemNames(uniqueItemCodes),
    ]);

    // Map resolved rates back to each dedup entry
    for (let k = 0; k < uniqueKeys.length; k++) {
      const key = uniqueKeys[k];
      const entry = dedupMap.get(key) as { item_code: string; qty: number; indices: number[] };
      let rate: number;

      if ((settled[k] as PromiseFulfilledResult<number>).status === 'fulfilled') {
        rate = (settled[k] as PromiseFulfilledResult<number>).value;
      } else {
        console.error('[pricing-lookup]', `Falha ao resolver ${key}:`, (settled[k] as PromiseRejectedResult).reason?.message || (settled[k] as PromiseRejectedResult).reason);
        rate = 0;
      }

      // Apply urgent markup (skip null/0)
      if (urgent === true && rate > 0) {
        rate = getUrgentRate(rate);
      }

      // Write to all output indices sharing this dedup key
      for (const idx of entry.indices) {
        results[idx] = {
          item_code: entry.item_code,
          item_name: itemNames.get(entry.item_code) || entry.item_code,
          qty: entry.qty,
          rate,
        };
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, items: results }),
    };
  } catch (err: any) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[pricing-lookup]', err?.logMessage || err?.message || err);
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Erro interno.' }),
    };
  }
}

export interface PricingLookupHandlerDependencies {
  core?: LegacyHandler;
  legacy?: LegacyHandler;
}

/** Stable rollout seam: exact true selects core and never falls back. */
export function createHandler(dependencies: PricingLookupHandlerDependencies = {}): LegacyHandler {
  const selectedCore = dependencies.core || coreHandler;
  const selectedLegacy = dependencies.legacy || legacyHandler;
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (isProductsCoreEnabled()) return selectedCore(event);
    return selectedLegacy(event);
  };
}

export const handler = createHandler();
