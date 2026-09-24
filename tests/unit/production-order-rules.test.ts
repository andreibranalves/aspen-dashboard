import assert from 'node:assert/strict';
import { it } from 'node:test';
import { productionAlert, productionDueDate } from '../../api/_modules/production-order-rules.ts';

it('starts risk at 75%, becomes late only after due date, and stops at ready', () => {
  const due = productionDueDate('2026-11-10', 20, null);
  assert.equal(due, '2026-12-09');
  assert.equal(productionAlert('em produção', '2026-11-10', due, '2026-12-01'), null);
  assert.equal(productionAlert('em produção', '2026-11-10', due, '2026-12-02'), 'em risco');
  assert.equal(productionAlert('em produção', '2026-11-10', due, '2026-12-10'), 'atrasado');
  assert.equal(productionAlert('pronto', '2026-11-10', due, '2026-12-10'), null);
  assert.equal(productionAlert('aguardando arte', null, null, '2026-12-10'), null);
});
