import type { QuoteLead } from '../../api/_modules/quote-leads-pure.js';

export function makeQuoteLead(overrides: Partial<QuoteLead> = {}): QuoteLead {
  return {
    id: 'quote_lead_1',
    nome: 'Viviane Correa',
    email: 'viviane@example.com',
    telefone: '5511978086811',
    pedidoTexto: 'Produto: Lenços\nQuantidade: 100',
    source: 'typebot',
    status: 'new',
    quotationId: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  } as QuoteLead;
}

