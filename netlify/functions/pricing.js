// Shared pricing — imported by orcamento.js and available for frontend use
// via a pricing-cache endpoint. All functions accept erpnextBase + token.

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
 */
export async function getRate(itemCode, qty, erpnextBase, token) {
  const headers = {
    'Authorization': `token ${token}`,
    'Content-Type': 'application/json',
  };

  const bracket = getBracket(qty);

  // 1. Tiered rule (e.g. LNC-SED-70-30)
  const tiered = await erpGet(
    `${erpnextBase}/api/resource/Pricing%20Rule`,
    [['title', '=', `${itemCode}-${bracket}`]],
    headers
  );
  if (tiered.length > 0) {
    const rate = await fetchPricingRuleRate(erpnextBase, headers, tiered[0].name);
    if (rate != null) return rate;
  }

  // 2. Flat SKU rule
  const flat = await erpGet(
    `${erpnextBase}/api/resource/Pricing%20Rule`,
    [['title', '=', itemCode]],
    headers
  );
  if (flat.length > 0) {
    const rate = await fetchPricingRuleRate(erpnextBase, headers, flat[0].name);
    if (rate != null) return rate;
  }

  // 3. Item Price fallback (Standard Selling)
  const params = new URLSearchParams({
    filters: JSON.stringify([['item_code', '=', itemCode], ['price_list', '=', 'Standard Selling']]),
    fields: JSON.stringify(['price_list_rate']),
  });
  const res = await fetch(
    `${erpnextBase}/api/resource/Item%20Price?${params}`,
    { headers }
  );
  const body = await res.json();
  return body.data?.[0]?.price_list_rate || 0;
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function erpGet(baseUrl, filters, headers) {
  const params = new URLSearchParams({ filters: JSON.stringify(filters) });
  const res = await fetch(`${baseUrl}?${params}`, { headers });
  const body = await res.json();
  return body.data || [];
}

async function fetchPricingRuleRate(erpnextBase, headers, ruleName) {
  const res = await fetch(
    `${erpnextBase}/api/resource/Pricing%20Rule/${encodeURIComponent(ruleName)}`,
    { headers }
  );
  const body = await res.json();
  const rate = body.data?.rate;
  return rate != null ? rate : null;
}
