import assert from 'node:assert/strict';
import test from 'node:test';

import { projectDashboardView } from '../../src/features/dashboard/dashboardViewModel.ts';

test('dashboard view model keeps nullable deltas and omits untrusted rows', () => {
  const view = projectDashboardView({
    success: true,
    period: { label: 'Últimos 30 dias', from: '2098-07-11', to: '2098-08-10' },
    summary: {
      total_revenue: 123456789.99,
      orders_count: 12,
      avg_ticket: 10288065.83,
      open_orders: 9,
      conversion_rate: 0.25,
      revenue_delta: null,
      orders_delta: null,
      avg_ticket_delta: null,
      conversion_delta: null,
    },
    top_products: [
      { sku: 'SKU-1', product: 'Produto 1', quantity: 3, revenue: 100, orders: 2 },
      { sku: 'SKU-2', product: '', quantity: 1, revenue: 50, orders: 1 },
    ],
    sales_by_day: [],
  });

  assert.ok(view);
  assert.equal(view.summary?.revenue_delta, null);
  assert.equal(view.summary?.conversion_delta, null);
  assert.equal(view.summary?.faturamento, 123456789.99);
  assert.equal(view.summary?.custo, 0);
  assert.equal(view.summary?.lucro, 0);
  assert.equal(view.summary?.meta_editable, false);
  assert.deepEqual(view.topProducts?.items, [
    { sku: 'SKU-1', product: 'Produto 1', quantity: 3, revenue: 100, custo: 0, margem: 1, orders: 2 },
  ]);
  assert.equal(view.topProducts?.omitted, 1);
  assert.equal(view.topCustomers, null);
});

test('dashboard view model keeps available lists when the summary is partial', () => {
  const view = projectDashboardView({
    success: true,
    top_products: [],
    top_customers: [],
    sales_by_day: [],
    summary: { total_revenue: -1 },
  });

  assert.ok(view);
  assert.equal(view.summary, null);
  assert.deepEqual(view.topProducts?.items, []);
});
