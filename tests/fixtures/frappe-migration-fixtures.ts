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
