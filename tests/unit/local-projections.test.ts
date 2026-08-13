import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectDashboardData,
  projectQuotationDetail,
  projectQuotationItem,
  projectQuotationTemplate,
} from '../../src/lib/localProjections.ts';

const sections = {
  schema_version: 1,
  prazo_producao: { base: { enabled: true, title: 'Prazo' }, current: { enabled: true, title: 'Prazo' } },
  pagamento: { base: { enabled: true, title: 'Pagamento', body: '' }, current: { enabled: true, title: 'Pagamento', body: '' } },
  condicoes_gerais: { base: { enabled: true, title: 'Condições', body: '' }, current: { enabled: true, title: 'Condições', body: '' } },
};

const history = {
  id: 'rev-1', revision_id: 'rev-1', revision: 1, revision_number: 1,
  created_at: '2026-08-10T00:00:00.000Z', validity_date: '2026-08-25', validade_dias: 15,
  subtotal: '9.00', total: '9.00', valor: '9.00', status: 'Enviado', status_canonical: 'enviado',
  derived_expired: false, expiration_derived: false, is_expired: false, expirada: false,
  template_key: 'padrao', template_version: null, template_hash: null,
};

function detail() {
  return {
    id: 'ORC-20260001', status: 'Enviado', status_canonical: 'enviado', cliente: 'Cliente', data: '2026-08-10', validade: '2026-08-25', validade_dias: 15,
    revision: 1, revision_number: 1, revision_id: 'rev-1', client_id: 'client-1', pagamento: '', entrega: '', observacoes: '', prazo_producao: '',
    frete_padrao: '0.00', frete: '0.00', subtotal: '9.00', total: '9.00', valor: '9.00', template_key: 'padrao', template_hash: 'a'.repeat(64), template_version_id: null, template_version: null,
    secoes: sections, items: [{ item_code: 'SKU-1', item_name: 'Produto', qty: '1.000', rate: '9.00', suggested_unit_price: '9.00', applied_unit_price: '9.00', price_difference: '0.00', line_total: '9.00', manual_rate: false }],
    revision_history: [history], derived_expired: false, expiration_derived: false, is_expired: false, expirada: false, concurrency_token: '2026-08-10T00:00:00.000Z',
  };
}

test('quotation projection rejects invented or malformed item domain values', () => {
  for (const patch of [
    { qty: 0 }, { qty: -1 }, { qty: 'NaN' }, { rate: -1 }, { rate: 'NaN' },
  ]) assert.equal(projectQuotationItem({ ...detail().items[0], ...patch }), null);
});

test('quotation projection fails closed for revision, status, expiration, and sections', () => {
  for (const patch of [
    { revision: 0 }, { revision_number: 1.5 }, { status: 'Unknown' }, { status_canonical: 'unknown' },
    { expirada: 'false' }, { secoes: { ...sections, pagamento: null } }, { items: [{ ...detail().items[0], qty: 0 }] },
  ]) assert.equal(projectQuotationDetail({ ...detail(), ...patch }), null);
});

test('template projection rejects malformed versions instead of inventing metadata', () => {
  assert.equal(projectQuotationTemplate({ key: 'padrao', name: 'Padrão', current_version: '1' }), null);
  assert.equal(projectQuotationTemplate({ key: 'padrao', name: 'Padrão', current_version: 0 }), null);
  assert.deepEqual(projectQuotationTemplate({ key: 'padrao', name: 'Padrão' }), { key: 'padrao', name: 'Padrão' });
});

test('historical optional fields may be omitted or null but malformed present values fail', () => {
  const withoutHistory = detail();
  delete (withoutHistory as { revision_history?: unknown }).revision_history;
  const projectedWithoutHistory = projectQuotationDetail(withoutHistory);
  assert.deepEqual(projectedWithoutHistory?.data.revision_history, []);

  const omitted = { ...history };
  delete (omitted as { template_key?: unknown }).template_key;
  delete (omitted as { template_version?: unknown }).template_version;
  delete (omitted as { template_hash?: unknown }).template_hash;
  const projectedOmitted = projectQuotationDetail({ ...detail(), revision_history: [omitted] });
  assert.ok(projectedOmitted);
  assert.equal(Object.prototype.hasOwnProperty.call(projectedOmitted.data.revision_history![0], 'template_key'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(projectedOmitted.data.revision_history![0], 'template_version'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(projectedOmitted.data.revision_history![0], 'template_hash'), false);

  const nullable = projectQuotationDetail({
    ...detail(),
    revision_history: [{ ...omitted, template_key: null, template_version: null, template_hash: null }],
  });
  assert.equal(nullable?.data.revision_history?.[0]?.template_key, null);
  assert.equal(nullable?.data.revision_history?.[0]?.template_version, null);
  assert.equal(nullable?.data.revision_history?.[0]?.template_hash, null);
  for (const field of ['template_key', 'template_version', 'template_hash']) {
    assert.equal(projectQuotationDetail({ ...detail(), revision_history: [{ ...history, [field]: 0 }] }), null);
  }
});

test('dashboard projection rejects malformed metrics and whitelists metadata', () => {
  const response = {
    success: true,
    period: { label: '30 dias', from: '2026-08-01', to: '2026-08-30' },
    summary: {
      total_revenue: 123.45, revenue_delta: -2, orders_count: 2, orders_delta: 1,
      avg_ticket: 61.72, avg_ticket_delta: 0, open_orders: 1, conversion_rate: 0.5, conversion_delta: -1,
    },
    top_products: [{ sku: 'SKU-1', product: 'Produto', quantity: 2, revenue: 123.45, orders: 1, provider_marker: 'drop' }],
    top_customers: [{ name: 'Cliente', revenue: 123.45, orders: 1 }],
    sales_by_day: [{ date: '2026-08-10', revenue: 123.45, orders: 1 }],
    stale_quotations: [{ id: 'ORC-1', customer: 'Cliente', age: 4, value: 123.45, status: 'enviado' }],
    provider_marker: 'drop',
  };
  const projected = projectDashboardData(response);
  assert.equal(projected?.summary.total_revenue, 123.45);
  assert.equal(Object.prototype.hasOwnProperty.call(projected!, 'provider_marker'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(projected!.top_products[0], 'provider_marker'), false);
  for (const patch of [
    { total_revenue: Number.NaN },
    { orders_count: '2' },
    { orders_count: -1 },
    { orders_count: 1.5 },
    { avg_ticket: -1 },
    { revenue_delta: Number.NaN },
  ]) {
    assert.equal(projectDashboardData({ ...response, summary: { ...response.summary, ...patch } }), null);
  }
  assert.equal(projectDashboardData({ ...response, summary: {
    total_revenue: 0, revenue_delta: 0, orders_count: 0, orders_delta: 0,
    avg_ticket: 0, avg_ticket_delta: 0, open_orders: 0, conversion_rate: 0, conversion_delta: 0,
  } })?.summary.total_revenue, 0);
});
