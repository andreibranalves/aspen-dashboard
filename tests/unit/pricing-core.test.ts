import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PricingUnavailableError,
  PricingValidationError,
  parseMoneyCents,
  parseSurchargePercent,
  normalizeProductPricing,
  resolveProductPrice,
} from '../../api/_modules/pricing-core.js';
import { LEGACY_PRICING_FIXTURES } from '../fixtures/legacy-pricing-fixtures.ts';

describe('core pricing exact resolver', () => {
  for (const fixture of LEGACY_PRICING_FIXTURES) {
    it(`${fixture.sku}: resolves immediately below, at and above every tier boundary`, () => {
      const pricing = normalizeProductPricing({ preco_base: fixture.base, precos: [...fixture.tiers] });
      for (let index = 0; index < fixture.tiers.length; index += 1) {
        const boundary = Number(fixture.tiers[index].minimum_quantity);
        const expectedBelow = index === 0 ? fixture.tiers[0].unit_price : fixture.tiers[index - 1].unit_price;
        const expected = fixture.tiers[index].unit_price;
        assert.equal(resolveProductPrice(pricing, boundary - 0.001).rate, expectedBelow);
        assert.equal(resolveProductPrice(pricing, boundary).rate, expected);
        assert.equal(resolveProductPrice(pricing, boundary + 0.001).rate, expected);
      }
    });
  }

  it('uses base price when there are no tiers and rejects an unpriced product', () => {
    assert.equal(resolveProductPrice({ preco_base: '9.99', precos: [] }, '0.5').rate, '9.99');
    assert.throws(() => resolveProductPrice({ preco_base: null, precos: [] }, 30), PricingUnavailableError);
  });

  it('allows zero only when explicitly requested for non-price money fields', () => {
    assert.equal(parseMoneyCents('0.00', 'Frete', true), 0n);
    assert.throws(() => parseMoneyCents('0.00', 'Preço'), PricingValidationError);
  });

  it('applies the manual surcharge with half-up integer-cents rounding', () => {
    assert.equal(resolveProductPrice({ preco_base: '10.00', precos: [] }, 30, 30).rate, '13.00');
    assert.equal(resolveProductPrice({ preco_base: '10.01', precos: [] }, 30, 30).rate, '13.01');
    assert.equal(resolveProductPrice({ preco_base: '0.01', precos: [] }, 30, 30).rate, '0.01');
    assert.equal(resolveProductPrice({ preco_base: '10.00', precos: [] }, 30).rate, '10.00');
  });

  it('accepts only integer surcharge percentages within bounds', () => {
    assert.equal(parseSurchargePercent(undefined), 0);
    assert.equal(parseSurchargePercent('15'), 15);
    assert.throws(() => parseSurchargePercent(true), PricingValidationError);
    assert.throws(() => parseSurchargePercent(-1), PricingValidationError);
    assert.throws(() => parseSurchargePercent(12.5), PricingValidationError);
    assert.throws(() => parseSurchargePercent(201), PricingValidationError);
  });

  it('rejects invalid, non-finite, over-scale and duplicate quantities', () => {
    assert.throws(() => resolveProductPrice({ preco_base: '10.00', precos: [] }, 'NaN'), PricingValidationError);
    assert.throws(() => resolveProductPrice({ preco_base: '10.00', precos: [] }, '1.0001'), PricingValidationError);
    assert.throws(() => normalizeProductPricing({ preco_base: '10.00', precos: [
      { minimum_quantity: '30', unit_price: '9.00' },
      { minimum_quantity: '30.000', unit_price: '8.00' },
    ] }), PricingValidationError);
  });
});
