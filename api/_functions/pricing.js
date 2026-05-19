// Shared pricing — imported by orcamento.js and available for frontend use
// via a pricing-cache endpoint.

import { erpGetList, erpGetDoc } from './lib/erpnext.js';

/**
 * Map a quantity to the closest-lower pricing bracket.
 * Brackets: 30, 100, 300, 500, 1000.
 */
export function getBracket(qty) {
  if (qty >= 1000) return 1000;
  if (qty >= 500) return 500;
  if (qty >= 300) return 300;
  if (qty >= 100) return 100;
  return 30;
}

/**
 * Compute the urgent (30% markup) rate from a base rate.
 * The result is rounded to 2 decimal places.
 */
export function getUrgentRate(baseRate) {
  return Math.round(baseRate * 1.30 * 100) / 100;
}

/**
 * Resolve the unit rate for a given item_code and quantity using
 * ERPNext Pricing Rules (tiered + flat) with an Item Price fallback.
 *
 * Returns 0 when no pricing data is found.
 *
 * @param {string} itemCode
 * @param {number} qty
 * @param {string} _erpnextBase - unused; shared module uses global config
 * @param {string} _token - unused; shared module uses process.env.ERPNEXT_TOKEN
 */
export async function getRate(itemCode, qty, _erpnextBase, _token) {
  const bracket = getBracket(qty);

  // 1. Tiered rule (e.g. LNC-SED-70-30)
  const tiered = await erpGetList('Pricing Rule', {
    filters: [['title', '=', `${itemCode}-${bracket}`]],
    limit: 1,
  });
  if (tiered.length > 0) {
    const rate = await fetchPricingRuleRate(tiered[0].name);
    if (rate != null) return rate;
  }

  // 2. Flat SKU rule
  const flat = await erpGetList('Pricing Rule', {
    filters: [['title', '=', itemCode]],
    limit: 1,
  });
  if (flat.length > 0) {
    const rate = await fetchPricingRuleRate(flat[0].name);
    if (rate != null) return rate;
  }

  // 3. Item Price fallback (Standard Selling)
  const prices = await erpGetList('Item Price', {
    filters: [['item_code', '=', itemCode], ['price_list', '=', 'Standard Selling']],
    fields: ['price_list_rate'],
    limit: 1,
  });
  return prices[0]?.price_list_rate || 0;
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function fetchPricingRuleRate(ruleName) {
  const doc = await erpGetDoc('Pricing Rule', ruleName);
  return doc?.rate != null ? doc.rate : null;
}
