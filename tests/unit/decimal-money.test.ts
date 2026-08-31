import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canonicalizeNonNegativeDecimal } from '../../api/_shared/decimal-money.ts';

describe('canonicalizeNonNegativeDecimal', () => {
  it('accepts Brazilian comma and canonicalizes to two decimal places', () => {
    assert.equal(canonicalizeNonNegativeDecimal('12,5', { maxIntegerDigits: 12 }), '12.50');
    assert.equal(canonicalizeNonNegativeDecimal('12,50', { maxIntegerDigits: 12 }), '12.50');
    assert.equal(canonicalizeNonNegativeDecimal('12.50', { maxIntegerDigits: 12 }), '12.50');
    assert.equal(canonicalizeNonNegativeDecimal('0', { maxIntegerDigits: 12 }), '0.00');
  });

  it('rejects mixed separators, negatives, and extra decimals', () => {
    assert.equal(canonicalizeNonNegativeDecimal('1.234,56', { maxIntegerDigits: 12 }), null);
    assert.equal(canonicalizeNonNegativeDecimal('-1', { maxIntegerDigits: 12 }), null);
    assert.equal(canonicalizeNonNegativeDecimal('12.555', { maxIntegerDigits: 12 }), null);
    assert.equal(canonicalizeNonNegativeDecimal('abc', { maxIntegerDigits: 12 }), null);
  });
});
