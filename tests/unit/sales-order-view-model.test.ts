import assert from 'node:assert/strict';
import test from 'node:test';

import { projectSalesOrderDetail } from '../../src/features/sales-orders/salesOrderViewModel.ts';

test('sales order detail model keeps confirmed fields and clamps high progress only in the UI', () => {
  const view = projectSalesOrderDetail({
    id: 'PED-2098-0001',
    status: 'To Deliver and Bill',
    customer_name: 'Cliente local',
    date: '2098-08-10',
    delivery_date: '2098-09-09',
    source_quotation: 'ORC-20980001',
    grand_total: 999999999.99,
    per_delivered: 125,
    per_billed: 50,
    items: [
      { item_code: 'SKU-1', item_name: 'Produto', qty: 2, rate: 10, amount: 20, uom: 'und' },
      { item_code: '', qty: 1, rate: 10 },
    ],
  });

  assert.ok(view);
  assert.equal(view.per_delivered, 125);
  assert.equal(view.grand_total, 999999999.99);
  assert.equal(view.source_quotation, 'ORC-20980001');
  assert.equal(view.items?.length, 1);
  assert.equal(view.omitted_items, 1);
});

test('sales order detail model preserves missing optional data instead of inventing it', () => {
  const view = projectSalesOrderDetail({ id: 'PED-2098-0002', status: 'Draft' });

  assert.ok(view);
  assert.equal(view.customer_name, undefined);
  assert.equal(view.items, undefined);
  assert.equal(view.grand_total, undefined);
  assert.equal(view.per_delivered, undefined);
  assert.equal(view.per_billed, undefined);
  assert.equal(projectSalesOrderDetail(null), null);
});
