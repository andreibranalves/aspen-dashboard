import type { QuoteLead } from '../../api/_modules/quote-leads-store.js';

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

export function createQuoteLeadMemoryDeps(seed: QuoteLead[] = []) {
  let records = [...seed];
  let idCounter = 0;

  return {
    async readAll() {
      return [...records];
    },
    async writeAll(next: QuoteLead[]) {
      records = [...next];
    },
    now() {
      return '2026-07-01T12:00:00.000Z';
    },
    id() {
      idCounter += 1;
      return `quote_lead_${idCounter}`;
    },
    snapshot() {
      return [...records];
    },
  };
}

export function parseJsonResult(result: { body?: string }) {
  try {
    return JSON.parse(result.body || '{}');
  } catch {
    return { error: 'Invalid JSON in response body', raw: String(result.body || '') };
  }
}
