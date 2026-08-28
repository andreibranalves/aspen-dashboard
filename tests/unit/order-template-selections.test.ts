import assert from 'node:assert/strict';
import { test } from 'node:test';

import { inlineTemplateSelections } from '../../src/features/quotations/orderTemplateSelections.ts';

const templates = [
  {
    id: 'cangas-id',
    name: 'Cangas',
    archived: false,
    items: [],
    created_at: '',
    updated_at: '',
  },
];

test('expands comma-and-e quantity lists before one template mention', () => {
  assert.deepEqual(inlineTemplateSelections('Cliente 30, 100 e 300 @cangas', templates), {
    selections: [
      { id: 'cangas-id', quantity: 30 },
      { id: 'cangas-id', quantity: 100 },
      { id: 'cangas-id', quantity: 300 },
    ],
    unknown: [],
  });
});

test('keeps separate quantity-template mentions working', () => {
  assert.deepEqual(inlineTemplateSelections('30 @cangas 100 @cangas e 300@cangas', templates), {
    selections: [
      { id: 'cangas-id', quantity: 30 },
      { id: 'cangas-id', quantity: 100 },
      { id: 'cangas-id', quantity: 300 },
    ],
    unknown: [],
  });
});

test('keeps decimal quantities with a comma as one quantity', () => {
  assert.deepEqual(inlineTemplateSelections('30,5 @cangas', templates), {
    selections: [{ id: 'cangas-id', quantity: 30.5 }],
    unknown: [],
  });
});
