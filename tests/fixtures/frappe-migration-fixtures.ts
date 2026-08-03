import type { FrappeDataset } from '../../api/_functions/frappe-migration.js';

/** Sanitized records covering normal import, source collisions and incomplete data. */
export function createFrappeMigrationFixture(): FrappeDataset {
  return {
    items: [
      { name: 'ITEM-001', item_code: 'LNC-SED-70-30', item_name: 'Lancheira', description: 'Aço', stock_uom: 'Und' },
      { name: 'ITEM-002', item_code: 'ECO-30', item_name: 'Ecobag', stock_uom: 'Und' },
    ],
    pricingRules: [
      { name: 'PR-LNC', item_code: 'LNC-SED-70-30', min_qty: 30, price_list_rate: '10.00' },
      { name: 'PR-ECO', item_code: 'ECO-30', min_qty: 30, price_list_rate: '4.00' },
    ],
    itemPrices: [
      // Item Price is the legacy global fallback; it is not a tier even when
      // an ERP payload happens to carry min_qty.
      { name: 'IP-LNC-100', item_code: 'LNC-SED-70-30', price_list_rate: '8.50' },
      { name: 'IP-ECO-100', item_code: 'ECO-30', price_list_rate: '3.50' },
    ],
    customers: [
      { name: 'CUST-001', customer_name: 'Cliente Exemplo', tax_id: '12.345.678/0001-90', email_id: 'cliente@example.com' },
    ],
    leads: [
      { name: 'LEAD-001', lead_name: 'Cliente Exemplo', tax_id: '12345678000190', mobile_no: '(11) 99999-9999' },
    ],
  };
}

export function createFrappeDuplicateFixture(): FrappeDataset {
  const base = createFrappeMigrationFixture();
  return {
    ...base,
    items: [
      ...(base.items || []),
      { name: 'ITEM-DUP-A', item_code: 'DUP-SKU', item_name: 'Duplicado A' },
      { name: 'ITEM-DUP-B', item_code: 'DUP-SKU', item_name: 'Duplicado B' },
    ],
  };
}

export function createFrappeIncompleteFixture(): FrappeDataset {
  return {
    items: [{ name: 'ITEM-INCOMPLETE', item_code: '', item_name: '' }],
    pricingRules: [{ name: 'PR-INCOMPLETE', item_code: 'MISSING-SKU', rate: '-1' }],
    itemPrices: [],
    customers: [{ name: 'CUSTOMER-INCOMPLETE', customer_name: '', email_id: 'not-an-email' }],
    leads: [],
  };
}

export function createFrappeResumeFixture(): FrappeDataset {
  const base = createFrappeMigrationFixture();
  return {
    ...base,
    items: [...(base.items || []), { name: 'ITEM-RESUME', item_code: 'RESUME-SKU', item_name: 'Retomada' }],
  };
}

/**
 * Sanitized historical Quotation records covering several years, statuses
 * and clients together with the products/customers they reference.
 */
export function createFrappeQuotationFixture(): FrappeDataset {
  return {
    items: [
      { name: 'ITEM-HIST-1', item_code: 'SKU-HIST-1', item_name: 'Produto Histórico 1', description: 'Aço', stock_uom: 'Und' },
      { name: 'ITEM-HIST-2', item_code: 'SKU-HIST-2', item_name: 'Produto Histórico 2', stock_uom: 'Und' },
    ],
    pricingRules: [],
    itemPrices: [],
    customers: [
      { name: 'CUST-HIST', customer_name: 'Cliente Histórico', tax_id: '12345678000190', email_id: 'historico@example.com' },
    ],
    leads: [],
    quotations: [
      {
        name: 'QTN-2024-00042',
        creation: '2024-03-15 10:30:00',
        modified: '2024-03-16 08:00:00',
        quotation_to: 'Customer',
        customer: 'CUST-HIST',
        status: 'Submitted',
        valid_till: '2024-04-14',
        payment_terms_template: 'PIX à vista',
        terms: 'Condições históricas',
        net_total: '120.00',
        grand_total: '120.00',
        items: [
          { idx: 1, item_code: 'SKU-HIST-1', item_name: 'Produto Histórico 1', qty: '10', uom: 'Und', rate: '6.00', price_list_rate: '6.00', amount: '60.00' },
          { idx: 2, item_code: 'SKU-HIST-2', item_name: 'Produto Histórico 2', qty: '5', uom: 'Und', rate: '12.00', price_list_rate: '12.00', amount: '60.00' },
        ],
      },
      {
        name: 'QTN-2024-00043',
        creation: '2024-03-16 14:00:00',
        quotation_to: 'Customer',
        customer: 'CUST-HIST',
        status: 'Draft',
        items: [
          { idx: 1, item_code: 'SKU-HIST-1', item_name: 'Produto Histórico 1', qty: '2', uom: 'Und', rate: '6.00', price_list_rate: '6.00', amount: '12.00' },
        ],
      },
      {
        name: 'QTN-2025-00007',
        creation: '2025-01-20 09:00:00',
        quotation_to: 'Customer',
        customer: 'CUST-HIST',
        status: 'Ordered',
        items: [
          { idx: 1, item_code: 'SKU-HIST-2', item_name: 'Produto Histórico 2', qty: '3', uom: 'Und', rate: '12.00', price_list_rate: '12.00', amount: '36.00' },
        ],
      },
    ],
  };
}

/** Quotations covering data gaps: unknown status, missing client, no items, unknown SKU, invalid prices. */
export function createFrappeQuotationEdgeFixture(): FrappeDataset {
  const base = createFrappeQuotationFixture();
  return {
    ...base,
    items: [...(base.items || []), { name: 'ITEM-EDGE', item_code: 'SKU-EDGE', item_name: 'Produto Borda' }],
    customers: [...(base.customers || []), { name: 'CUST-EDGE', customer_name: 'Cliente Borda', tax_id: '11122233344' }],
    quotations: [
      {
        name: 'QTN-2024-00010',
        creation: '2024-02-01 10:00:00',
        quotation_to: 'Customer',
        customer: 'CUST-EDGE',
        status: 'Whatever',
        items: [{ idx: 1, item_code: 'SKU-EDGE', item_name: 'Produto Borda', qty: '1', uom: 'Und', rate: '5.00', price_list_rate: '5.00', amount: '5.00' }],
      },
      {
        name: 'QTN-2024-00011',
        creation: '2024-02-02 10:00:00',
        status: 'Draft',
        items: [{ idx: 1, item_code: 'SKU-EDGE', item_name: 'Produto Borda', qty: '1', uom: 'Und', rate: '5.00', price_list_rate: '5.00', amount: '5.00' }],
      },
      {
        name: 'QTN-2024-00012',
        creation: '2024-02-03 10:00:00',
        quotation_to: 'Customer',
        customer: 'CUST-EDGE',
        status: 'Submitted',
        items: [],
      },
      {
        name: 'QTN-2024-00013',
        creation: '2024-02-04 10:00:00',
        quotation_to: 'Customer',
        customer: 'CUST-EDGE',
        status: 'Submitted',
        items: [{ idx: 1, item_code: 'SKU-FANTASMA', item_name: 'Fantasma', qty: '1', uom: 'Und', rate: '5.00', price_list_rate: '5.00', amount: '5.00' }],
      },
      {
        name: 'QTN-2024-00014',
        creation: '2024-02-05 10:00:00',
        quotation_to: 'Customer',
        customer: 'CUST-EDGE',
        status: 'Submitted',
        items: [{ idx: 1, item_code: 'SKU-EDGE', item_name: 'Produto Borda', qty: '1', uom: 'Und', rate: '', price_list_rate: '5.00', amount: '0' }],
      },
      {
        name: 'QTN-2024-00015',
        creation: '2024-02-06 10:00:00',
        quotation_to: 'Customer',
        customer: 'CUST-EDGE',
        status: 'Lost',
        items: [{ idx: 1, item_code: 'SKU-EDGE', item_name: 'Produto Borda', qty: '1', uom: 'Und', rate: '5.00', price_list_rate: '5.00', amount: '5.00' }],
      },
    ],
  };
}
