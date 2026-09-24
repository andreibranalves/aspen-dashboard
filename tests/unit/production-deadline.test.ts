import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PRODUCTION_DEADLINE_COMPLEMENT,
  parseProductionDays,
  ProductionDeadlineValidationError,
  productionDeadlineText,
} from '../../api/_modules/production-deadline.js';
import { productionDeadlineText as clientProductionDeadlineText } from '../../src/lib/productionDeadline.ts';

describe('production deadline text', () => {
  it('derives the communicated deadline from the number of working days', () => {
    const complement = DEFAULT_PRODUCTION_DEADLINE_COMPLEMENT;
    assert.equal(
      productionDeadlineText(20, complement),
      '15 a 20 dias úteis após confirmação do pagamento e aprovação da arte.'
    );
    assert.equal(productionDeadlineText(10, complement).startsWith('5 a 10 dias úteis após'), true);
    assert.equal(productionDeadlineText(7, complement).startsWith('até 7 dias úteis após'), true);
    assert.equal(productionDeadlineText(7, '  '), 'até 7 dias úteis');
  });

  it('keeps the frontend preview identical to the server text', () => {
    for (const days of [1, 7, 9, 10, 20, 365]) {
      assert.equal(clientProductionDeadlineText(days, 'x'), productionDeadlineText(days, 'x'));
    }
  });

  it('falls back when absent and rejects invalid day counts', () => {
    assert.equal(parseProductionDays(undefined, 20), 20);
    assert.equal(parseProductionDays('12', 20), 12);
    assert.throws(() => parseProductionDays(0, 20), ProductionDeadlineValidationError);
    assert.throws(() => parseProductionDays(366, 20), ProductionDeadlineValidationError);
    assert.throws(() => parseProductionDays(2.5, 20), ProductionDeadlineValidationError);
  });
});
