import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { composeProfit, productMargin } from '../../api/_modules/profit.ts';

describe('composeProfit', () => {
  it('computes Lucro as Faturamento − Custo − Ads − Imposto', () => {
    const profit = composeProfit({
      faturamento: 10000,
      custo: 4000,
      google: { amount: 700, available: true },
      metaAmount: 300,
      includeMeta: true,
      aliquotaPercent: 4,
    });

    assert.deepEqual(profit, {
      faturamento: 10000,
      custo: 4000,
      ads: 1000,
      ads_google: 700,
      ads_meta: 300,
      imposto: 400,
      lucro: 4600,
      ads_google_unavailable: false,
    });
  });

  it('applies Imposto on Faturamento before cost and ads', () => {
    const profit = composeProfit({
      faturamento: 1000,
      custo: 900,
      google: { amount: 50, available: true },
      metaAmount: 0,
      includeMeta: false,
      aliquotaPercent: 4,
    });

    assert.equal(profit.imposto, 40);
    assert.equal(profit.lucro, 10);
  });

  it('omits Meta outside calendar months and still shows Lucro when Google is down', () => {
    const profit = composeProfit({
      faturamento: 2000,
      custo: 500,
      google: { amount: 999, available: false },
      metaAmount: 800,
      includeMeta: false,
      aliquotaPercent: 4,
    });

    assert.equal(profit.ads_google, 0);
    assert.equal(profit.ads_meta, 0);
    assert.equal(profit.ads, 0);
    assert.equal(profit.imposto, 80);
    assert.equal(profit.lucro, 1420);
    assert.equal(profit.ads_google_unavailable, true);
  });

  it('keeps Meta when Google is down in a calendar month', () => {
    const profit = composeProfit({
      faturamento: 2000,
      custo: 0,
      google: { amount: 0, available: false },
      metaAmount: 250,
      includeMeta: true,
      aliquotaPercent: 0,
    });

    assert.equal(profit.ads, 250);
    assert.equal(profit.imposto, 0);
    assert.equal(profit.lucro, 1750);
    assert.equal(profit.ads_google_unavailable, true);
  });

  it('allows negative Lucro', () => {
    const profit = composeProfit({
      faturamento: 100,
      custo: 80,
      google: { amount: 40, available: true },
      metaAmount: 0,
      includeMeta: false,
      aliquotaPercent: 4,
    });

    assert.equal(profit.lucro, -24);
  });
});

describe('productMargin', () => {
  it('is (Faturamento − Custo) / Faturamento', () => {
    assert.equal(productMargin(100, 40), 0.6);
    assert.equal(productMargin(0, 10), 0);
  });
});
