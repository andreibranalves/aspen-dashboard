// ── Imports ─────────────────────────────────────────────────────────────────
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { erpGetList, erpGetDoc, erpPost, erpPut } from './lib/erpnext.js';
import { getUrgentRate } from './pricing.js';
import { isProductsCoreEnabled, responseMetadata } from './products-mode.js';
import {
  createPostgresPricingRepository,
  PricingRepositoryError,
  type PricingRepository,
} from '../_db/pricing-repository.js';
import { normalizeProductPricing, type PricingTierInput } from './pricing-core.js';

// ── Constants ───────────────────────────────────────────────────────────────
export const BRACKETS = [30, 100, 300, 500, 1000];
const STANDARD_SELLING = 'Standard Selling';

export interface ProductPricingCoreDependencies {
  pricingRepository: PricingRepository;
}

function coreJson(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, ...responseMetadata('core') }),
  };
}

function coreError(error: unknown): FunctionResult {
  console.error('[product-pricing-core]', error instanceof Error ? error.name : typeof error);
  if (error instanceof PricingRepositoryError && error.expose) {
    return coreJson(error.statusCode, { error: error.message });
  }
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (statusCode === 400 || statusCode === 404 || statusCode === 409) {
    return coreJson(statusCode, { error: (error as { message?: string }).message || 'Operação inválida.' });
  }
  return coreJson(503, { error: 'Não foi possível processar os preços. Tente novamente.' });
}

export function createCoreHandler(
  dependencies: ProductPricingCoreDependencies = { pricingRepository: createPostgresPricingRepository() },
): (event: FunctionEvent) => Promise<FunctionResult> {
  return async function productPricingCoreHandler(event: FunctionEvent): Promise<FunctionResult> {
    const sku = (event.queryStringParameters?.sku || '').trim();
    if (!sku) return coreJson(400, { error: 'SKU é obrigatório.' });
    try {
      if (event.httpMethod === 'GET') {
        const pricing = await dependencies.pricingRepository.get(sku);
        if (!pricing) return coreJson(404, { error: 'Produto não encontrado.' });
        return coreJson(200, {
          sku,
          brackets: pricing.precos.map((tier) => Number(tier.minimum_quantity)),
          preco_base: pricing.preco_base,
          precos: pricing.precos,
          pricing_available: pricing.pricing_available,
        });
      }
      if (event.httpMethod !== 'POST' && event.httpMethod !== 'PUT') {
        return coreJson(405, { error: 'Método não permitido.' });
      }
      let payload: unknown;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        return coreJson(400, { error: 'JSON inválido.' });
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return coreJson(400, { error: 'Envie preços válidos.' });
      }
      const body = payload as { preco_base?: string | number | null; precos?: unknown; base_price?: string | number | null; tiers?: unknown };
      const current = await dependencies.pricingRepository.get(sku);
      if (!current) return coreJson(404, { error: 'Produto não encontrado.' });
      const hasBase = Object.prototype.hasOwnProperty.call(body, 'preco_base') || Object.prototype.hasOwnProperty.call(body, 'base_price');
      const hasTiers = Object.prototype.hasOwnProperty.call(body, 'precos') || Object.prototype.hasOwnProperty.call(body, 'tiers');
      const rawTiers = hasTiers ? (body.precos ?? body.tiers) : current.precos;
      if (!Array.isArray(rawTiers)) return coreJson(400, { error: 'Preços deve ser um array.' });
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
      return coreJson(200, {
        success: true,
        sku,
        brackets: saved.precos.map((tier) => Number(tier.minimum_quantity)),
        preco_base: saved.preco_base,
        precos: saved.precos,
        pricing_available: saved.pricing_available,
      });
    } catch (error) {
      return coreError(error);
    }
  };
}

export const coreHandler = createCoreHandler();

// ── Helpers ─────────────────────────────────────────────────────────────────

function isErpNotFound(err: any): boolean {
  const msg = `${err?.statusCode || ''} ${err?.message || ''} ${err?.logMessage || ''}`;
  return msg.includes('404');
}

async function fetchPricingRuleByTitle(title: string): Promise<any> {
  const rules = await erpGetList('Pricing Rule', {
    fields: ['name', 'title'],
    filters: [['title', '=', title]],
    limit: 1,
  });

  if (!rules.length) return null;

  const doc = await erpGetDoc('Pricing Rule', rules[0].name);
  const rate = doc?.rate != null ? Number(doc.rate) : null;
  if (rate == null || Number.isNaN(rate)) return null;

  return {
    rate,
    rule_name: doc?.name || rules[0].name,
    title: doc?.title || title,
  };
}

async function fetchItemPrice(sku: string): Promise<any> {
  const prices = await erpGetList('Item Price', {
    fields: ['name', 'item_code', 'price_list', 'price_list_rate'],
    filters: [
      ['item_code', '=', sku],
      ['price_list', '=', STANDARD_SELLING],
    ],
    order_by: 'modified desc',
    limit: 1,
  });

  const price = prices[0];
  const rate = price?.price_list_rate != null ? Number(price.price_list_rate) : null;
  if (rate == null || Number.isNaN(rate)) return null;

  return {
    rate,
    item_price_name: price.name,
    price_list: price.price_list || STANDARD_SELLING,
  };
}

function formatPriceRow(
  faixa: number,
  rate: number | null,
  origem: string,
  detalhes: Record<string, any> = {}
): Record<string, any> {
  const hasPrice = rate != null && !Number.isNaN(Number(rate));
  const numericRate = hasPrice ? Number(rate) : null;

  return {
    faixa,
    qty: faixa,
    rate: numericRate as number,
    urgent_rate: hasPrice ? getUrgentRate(numericRate as number) : null,
    origem,
    origem_label:
      origem === 'pricing_rule_bracket'
        ? 'Pricing Rule por faixa'
        : origem === 'pricing_rule_sku'
          ? 'Pricing Rule do SKU'
          : origem === 'item_price'
            ? 'Item Price'
            : 'Não encontrado',
    status: hasPrice ? 'found' : 'missing',
    urgent_markup: 0.3,
    ...detalhes,
  };
}

export async function resolveProductPricing(sku: string): Promise<Record<string, any>[]> {
  const skuRule = await fetchPricingRuleByTitle(sku);
  const itemPrice = skuRule ? null : await fetchItemPrice(sku);

  const rows = [];

  for (const faixa of BRACKETS) {
    const bracketRule = await fetchPricingRuleByTitle(`${sku}-${faixa}`);

    if (bracketRule) {
      rows.push(
        formatPriceRow(faixa, bracketRule.rate, 'pricing_rule_bracket', {
          rule_name: bracketRule.rule_name,
          rule_title: bracketRule.title,
        })
      );
      continue;
    }

    if (skuRule) {
      rows.push(
        formatPriceRow(faixa, skuRule.rate, 'pricing_rule_sku', {
          rule_name: skuRule.rule_name,
          rule_title: skuRule.title,
        })
      );
      continue;
    }

    if (itemPrice) {
      rows.push(
        formatPriceRow(faixa, itemPrice.rate, 'item_price', {
          item_price_name: itemPrice.item_price_name,
          price_list: itemPrice.price_list,
        })
      );
      continue;
    }

    rows.push(formatPriceRow(faixa, null, 'missing'));
  }

  return rows;
}

async function upsertBracketPricingRule(
  sku: string,
  faixa: number,
  rate: number
): Promise<Record<string, any>> {
  const title = `${sku}-${faixa}`;
  const existing = await erpGetList('Pricing Rule', {
    fields: ['name', 'title'],
    filters: [['title', '=', title]],
    limit: 1,
  });

  if (existing.length > 0) {
    const ruleName = existing[0].name;
    await erpPut('Pricing Rule', ruleName, { rate });
    return {
      faixa,
      rate,
      status: 'atualizado',
      origem: 'pricing_rule_bracket',
      rule_name: ruleName,
      rule_title: title,
    };
  }

  const created = await erpPost('Pricing Rule', {
    title,
    apply_on: 'Item Code',
    rate,
    selling: 1,
    price_or_product_discount: 'Price',
    rate_or_discount: 'Rate',
    items: [{ item_code: sku }],
  });

  return {
    faixa,
    rate,
    status: 'criado',
    origem: 'pricing_rule_bracket',
    rule_name: created?.name || title,
    rule_title: title,
  };
}

export async function saveProductPricing(
  sku: string,
  precos: Record<string, any>[]
): Promise<Record<string, any>> {
  let item;
  try {
    item = await erpGetDoc('Item', sku);
  } catch (err: any) {
    if (isErpNotFound(err)) {
      const notFound = new Error('Produto não encontrado.') as Error & { statusCode: number };
      notFound.statusCode = 404;
      throw notFound;
    }
    throw err;
  }
  if (!item) {
    const err = new Error('Produto não encontrado.') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }

  const resultados = [];
  for (const p of precos) {
    const faixa = Number(p.faixa ?? p.qty);
    const rate = Number(p.rate);

    if (!BRACKETS.includes(faixa) || Number.isNaN(rate) || rate < 0) {
      resultados.push({
        faixa: p.faixa,
        rate: p.rate,
        status: 'erro',
        error: 'Faixa ou preço inválido.',
      });
      continue;
    }

    try {
      resultados.push(await upsertBracketPricingRule(sku, faixa, rate));
    } catch (err: any) {
      console.error(
        '[product-pricing]',
        `Erro ao salvar ${sku}-${faixa}:`,
        err?.logMessage || err?.message || err
      );
      resultados.push({ faixa, rate, status: 'erro', error: 'Erro ao salvar no ERPNext.' });
    }
  }

  const erros = resultados.filter((r) => r.status === 'erro');
  return {
    success: erros.length === 0,
    sku,
    atualizados: resultados.length - erros.length,
    erros: erros.length,
    resultados,
  };
}

function json(statusCode: number, payload: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

// ── Handler ─────────────────────────────────────────────────────────────────

export async function legacyHandler(event: FunctionEvent): Promise<FunctionResult> {
  const params = event.queryStringParameters || {};
  const sku = (params.sku || '').trim();

  if (!sku) return json(400, { error: 'SKU é obrigatório.' });

  try {
    if (event.httpMethod === 'GET') {
      const precos = await resolveProductPricing(sku);
      return json(200, { sku, brackets: BRACKETS, precos });
    }

    if (event.httpMethod === 'POST' || event.httpMethod === 'PUT') {
      let payload;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        return json(400, { error: 'JSON inválido.' });
      }

      const { precos } = payload;
      if (!Array.isArray(precos) || precos.length === 0) {
        return json(400, { error: 'Preços deve ser um array com ao menos uma faixa.' });
      }

      const result = await saveProductPricing(sku, precos);
      return json(200, result);
    }

    return { statusCode: 405, body: 'Method Not Allowed' };
  } catch (err: any) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[product-pricing]', err?.logMessage || err?.message || err);
    return json(code, {
      error: code === 404 ? 'Produto não encontrado.' : 'Erro ao processar preços do produto.',
    });
  }
}

export interface ProductPricingHandlerDependencies {
  core?: (event: FunctionEvent) => Promise<FunctionResult>;
  legacy?: (event: FunctionEvent) => Promise<FunctionResult>;
}

/** Stable rollout seam: exact true selects core and never falls back. */
export function createHandler(dependencies: ProductPricingHandlerDependencies = {}): (event: FunctionEvent) => Promise<FunctionResult> {
  const selectedCore = dependencies.core || coreHandler;
  const selectedLegacy = dependencies.legacy || legacyHandler;
  return async (event: FunctionEvent): Promise<FunctionResult> => {
    if (isProductsCoreEnabled()) return selectedCore(event);
    return selectedLegacy(event);
  };
}

export const handler = createHandler();
