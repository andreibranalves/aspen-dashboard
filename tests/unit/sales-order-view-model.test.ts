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

test('sales order detail model projects production and drops malformed notes', () => {
  const view = projectSalesOrderDetail({
    id: 'PED-2098-0003',
    order_number: 'PED-2098-0003',
    status: 'To Deliver and Bill',
    grand_total: 100,
    production_stage: 'em_producao',
    production: { state: 'em_risco', deadline: '2098-09-09', total_days: 20, elapsed_days: 16, stalled_days: null },
    production_days: 20,
    deposit_received_on: '2098-08-05',
    deposit_amount: 50,
    art_approved_on: '2098-08-10',
    received_amount: 50,
    notes: [
      { id: 'n1', kind: 'stage', body: 'Arte aprovada', created_at: '2098-08-10T12:00:00.000Z', undoable: true },
      { id: 'n2', kind: 'other', body: 'x', created_at: '2098-08-10T12:00:00.000Z' },
      { id: 'n3', kind: 'note', body: '', created_at: '2098-08-10T12:00:00.000Z' },
    ],
  });

  assert.ok(view?.production);
  assert.equal(view.production.production_stage, 'em_producao');
  assert.equal(view.production.production.state, 'em_risco');
  assert.equal(view.production.deposit_amount, 50);
  assert.equal(view.production.ready_on, null);
  assert.deepEqual(view.notes.map((note) => note.id), ['n1']);
  assert.equal(view.notes[0]?.updated_at, '2098-08-10T12:00:00.000Z');

  const legacy = projectSalesOrderDetail({ id: 'PED-2098-0004', status: 'Draft', grand_total: 10 });
  assert.equal(legacy?.production, undefined);
  assert.deepEqual(legacy?.notes, []);
});
