import test from 'node:test';
import assert from 'node:assert/strict';
import { planClientConsolidation, consolidationPhone } from '../../api/_infrastructure/db/repositories/client-consolidation-repository.js';

const candidate = (id: string, phone: string | null, quote: string | null, document: string | null = null) => ({
  id, telefone: phone, documento: document, createdAt: new Date('2026-01-01'), latestQuotation: quote ? new Date(quote) : null,
});

test('keeps newest quotation regardless of row order, groups local and international phones', () => {
  const rows = [candidate('old', '21999998888', '2026-01-01'), candidate('new', '5521999998888', '2026-02-01'), candidate('none', '21999998888', null)];
  assert.deepEqual(planClientConsolidation(rows).groups, [{ survivor: 'new', removed: ['none', 'old'] }]);
  assert.deepEqual(planClientConsolidation(rows.reverse()).groups, [{ survivor: 'new', removed: ['none', 'old'] }]);
});

test('conflicting nonempty documents require review and empty phones never merge', () => {
  const result = planClientConsolidation([candidate('a', '21999998888', null, '11111111111'), candidate('b', '21999998888', null, '22222222222'), candidate('c', null, null), candidate('d', null, null)]);
  assert.deepEqual(result.groups, []);
  assert.deepEqual(result.conflicts, [['a', 'b']]);
});

test('no quotations chooses newest registration then stable id for ties', () => {
  const older = candidate('a', '21999998888', null);
  const newer = { ...candidate('z', '21999998888', null), createdAt: new Date('2026-03-01') };
  assert.equal(planClientConsolidation([older, newer]).groups[0].survivor, 'z');
  assert.equal(planClientConsolidation([candidate('b', '21999998888', null), older]).groups[0].survivor, 'a');
});

test('normalization does not invent ninth digits or collapse international numbers', () => {
  assert.equal(consolidationPhone('(21) 99999-8888'), '5521999998888');
  assert.equal(consolidationPhone('552199998888'), '552199998888');
  assert.equal(consolidationPhone('442079460958'), '442079460958');
  assert.equal(consolidationPhone('12025550123'), '12025550123');
});
