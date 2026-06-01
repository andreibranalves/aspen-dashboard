// tests/unit/pricing.test.js
// Testes unitários para o motor de precificação: brackets, urgência, fallback.
// getBracket / getUrgentRate são funções puras, testadas diretamente.
// getRate depende do ERPNext — mockamos o fetch global para interceptar as
// chamadas via ERPNext REST API (/api/resource/...).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { getBracket, getUrgentRate, getRate } from '../../api/_functions/pricing.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _originalFetch;

/**
 * Mock globalThis.fetch with an ordered list of responses.
 * Each entry: { match: (urlStr) => boolean, body, status? }
 * First match wins; falls through to 404 if none match.
 */
function mockFetch(responses) {
  _originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, _opts) => {
    const urlStr = typeof url === 'string' ? url : url.href;
    for (const entry of responses) {
      if (entry.match(urlStr)) {
        return {
          status: entry.status || 200,
          ok: entry.status ? entry.status < 400 : true,
          json: async () => entry.body,
        };
      }
    }
    return { status: 404, ok: false, json: async () => ({}) };
  };
}

function restoreFetch() {
  if (_originalFetch) globalThis.fetch = _originalFetch;
}

/** Helper: match a Pricing Rule list call URL by the SKU-bracket title in the filters */
function matchPricingRuleList(skuBracket) {
  return (url) => url.includes('/api/resource/Pricing%20Rule') && url.includes(skuBracket);
}

/** Helper: match a Pricing Rule doc fetch URL by rule name */
function matchPricingRuleDoc(ruleName) {
  return (url) => url.includes(`/api/resource/Pricing%20Rule/${ruleName}`);
}

/** Helper: match an Item Price list call URL by the item_code in the filters */
function matchItemPriceList(itemCode) {
  return (url) => url.includes('/api/resource/Item%20Price') && url.includes(itemCode);
}

/** Helper: empty Pricing Rule list response */
function emptyPR() {
  return { match: (url) => url.includes('/api/resource/Pricing%20Rule'), body: { data: [] } };
}

// ── getBracket ───────────────────────────────────────────────────────────────

describe('getBracket()', () => {
  it('retorna 30 para qtd < 100', () => {
    assert.equal(getBracket(1), 30);
    assert.equal(getBracket(29), 30);
    assert.equal(getBracket(30), 30);
    assert.equal(getBracket(99), 30);
  });

  it('retorna 100 para 100 ≤ qtd < 300', () => {
    assert.equal(getBracket(100), 100);
    assert.equal(getBracket(150), 100);
    assert.equal(getBracket(299), 100);
  });

  it('retorna 300 para 300 ≤ qtd < 500', () => {
    assert.equal(getBracket(300), 300);
    assert.equal(getBracket(499), 300);
  });

  it('retorna 500 para 500 ≤ qtd < 1000', () => {
    assert.equal(getBracket(500), 500);
    assert.equal(getBracket(999), 500);
  });

  it('retorna 1000 para qtd ≥ 1000', () => {
    assert.equal(getBracket(1000), 1000);
    assert.equal(getBracket(5000), 1000);
  });
});

// ── getUrgentRate ────────────────────────────────────────────────────────────

describe('getUrgentRate()', () => {
  it('aplica markup de 30% com arredondamento para 2 casas', () => {
    assert.equal(getUrgentRate(10), 13.00);
    assert.equal(getUrgentRate(8.5), 11.05);
    assert.equal(getUrgentRate(3.33), 4.33); // 3.33*1.30 = 4.329 → 4.33
  });

  it('retorna 0 quando base é 0', () => {
    assert.equal(getUrgentRate(0), 0);
  });
});

// ── getRate (com mock de fetch ERPNext) ──────────────────────────────────────

describe('getRate()', () => {
  beforeEach(() => {
    process.env.ERPNEXT_BASE_URL = 'https://test.example.com';
    process.env.ERPNEXT_TOKEN = 'test-token';
    // Override the hardcoded base in erpnext module — the fetch mock intercepts
    // regardless of base URL, but we need ERPNEXT_TOKEN to be set so erpnext
    // doesn't throw at import time (erpnext.js reads process.env at module load).
  });

  afterEach(() => {
    restoreFetch();
    delete process.env.ERPNEXT_BASE_URL;
    delete process.env.ERPNEXT_TOKEN;
  });

  it('usa Pricing Rule com bracket (ex: LNC-SED-70 para 150 → bracket 100)', async () => {
    mockFetch([
      { match: matchPricingRuleList('LNC-SED-70-100'), body: { data: [{ name: 'PR-001' }] } },
      { match: matchPricingRuleDoc('PR-001'), body: { data: { rate: 12.50 } } },
    ]);

    const rate = await getRate('LNC-SED-70', 150);
    assert.equal(rate, 12.50);
  });

  it('fallback para Pricing Rule flat quando tiered não encontra', async () => {
    mockFetch([
      // tiered não encontra
      { match: matchPricingRuleList('LNC-SED-70-100'), body: { data: [] } },
      // flat encontra
      { match: matchPricingRuleList('LNC-SED-70'), body: { data: [{ name: 'PR-002' }] } },
      { match: matchPricingRuleDoc('PR-002'), body: { data: { rate: 10.00 } } },
    ]);

    const rate = await getRate('LNC-SED-70', 150);
    assert.equal(rate, 10.00);
  });

  it('fallback para Item Price (Standard Selling) quando não há Pricing Rule', async () => {
    mockFetch([
      // tiered não encontra
      { match: matchPricingRuleList('LNC-SED-70-30'), body: { data: [] } },
      // flat não encontra
      { match: matchPricingRuleList('LNC-SED-70'), body: { data: [] } },
      // Item Price encontra
      { match: matchItemPriceList('LNC-SED-70'), body: { data: [{ price_list_rate: 8.75 }] } },
    ]);

    const rate = await getRate('LNC-SED-70', 50);
    assert.equal(rate, 8.75);
  });

  it('lança erro quando SKU não tem preço em nenhuma fonte', async () => {
    mockFetch([
      emptyPR(),
      { match: (url) => url.includes('/api/resource/Item%20Price'), body: { data: [] } },
    ]);

    await assert.rejects(
      () => getRate('SKU-INEXISTENTE', 30),
      { statusCode: 400, message: /não encontrado/ },
    );
  });

  it('usa bracket 1000 para qtd ≥ 1000', async () => {
    mockFetch([
      { match: matchPricingRuleList('TWL-280-1000'), body: { data: [{ name: 'PR-1000' }] } },
      { match: matchPricingRuleDoc('PR-1000'), body: { data: { rate: 7.00 } } },
    ]);

    const rate = await getRate('TWL-280', 1000);
    assert.equal(rate, 7.00);
  });

  it('usa bracket 30 para qtd padrão', async () => {
    mockFetch([
      { match: matchPricingRuleList('LNC-CSD-70-30'), body: { data: [{ name: 'PR-30' }] } },
      { match: matchPricingRuleDoc('PR-30'), body: { data: { rate: 5.50 } } },
    ]);

    const rate = await getRate('LNC-CSD-70', 30);
    assert.equal(rate, 5.50);
  });
});
