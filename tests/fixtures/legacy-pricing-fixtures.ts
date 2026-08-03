/** Sanitized representative tiers used for deterministic core pricing tests. */
export const LEGACY_PRICING_FIXTURES = [
  {
    sku: 'LNC-SED-70-30',
    base: '12.00',
    tiers: [
      { minimum_quantity: '30', unit_price: '10.00' },
      { minimum_quantity: '100', unit_price: '8.50' },
      { minimum_quantity: '300', unit_price: '7.25' },
      { minimum_quantity: '500', unit_price: '6.90' },
      { minimum_quantity: '1000', unit_price: '6.50' },
    ],
  },
  {
    sku: 'ECO-30',
    base: null,
    tiers: [
      { minimum_quantity: '30', unit_price: '4.00' },
      { minimum_quantity: '100', unit_price: '3.50' },
    ],
  },
] as const;
