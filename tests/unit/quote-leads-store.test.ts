import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatQuoteLeadText,
  listQuoteLeads,
  normalizeQuoteLeadInput,
  updateQuoteLead,
  upsertQuoteLead,
  type QuoteLead,
} from '../../api/_functions/lib/quote-leads-store.js';

function createMemoryDeps(seed: QuoteLead[] = []) {
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
      return '2026-06-29T12:00:00.000Z';
    },
    id() {
      idCounter += 1;
      return `quote_lead_${idCounter}`;
    },
  };
}

describe('quote-leads-store', () => {
  it('normaliza payload do Typebot para QuoteLead', () => {
    const lead = normalizeQuoteLeadInput(
      {
        nome: '  Viviane Correa ',
        email: ' VIVIANE@EXAMPLE.COM ',
        telefone: '(11) 97808-6811',
        produto: 'lenço',
        quantidade: '100',
        mensagem_contexto: 'Cliente pediu orçamento pelo WhatsApp',
        source: 'typebot',
        erpLeadId: 'CRM-LEAD-0001',
      },
      { now: () => '2026-06-29T12:00:00.000Z', id: () => 'quote_lead_1' }
    );

    assert.equal(lead.id, 'quote_lead_1');
    assert.equal(lead.nome, 'Viviane Correa');
    assert.equal(lead.email, 'viviane@example.com');
    assert.equal(lead.telefone, '5511978086811');
    assert.equal(
      lead.pedidoTexto,
      'Produto: lenço\nQuantidade: 100\nContexto: Cliente pediu orçamento pelo WhatsApp'
    );
    assert.equal(lead.source, 'typebot');
    assert.equal(lead.status, 'new');
    assert.equal(lead.erpLeadId, 'CRM-LEAD-0001');
  });

  it('formata texto para preencher o textarea de extração', () => {
    const text = formatQuoteLeadText({
      id: 'quote_lead_1',
      nome: 'Viviane Correa',
      email: 'viviane@example.com',
      telefone: '5511978086811',
      pedidoTexto: 'Produto: lenço\nQuantidade: 100',
      source: 'typebot',
      status: 'new',
      createdAt: '2026-06-29T12:00:00.000Z',
      updatedAt: '2026-06-29T12:00:00.000Z',
    });

    assert.equal(
      text,
      [
        'Nome: Viviane Correa',
        'E-mail: viviane@example.com',
        'Telefone: 11978086811',
        'Pedido: Produto: lenço\nQuantidade: 100',
      ].join('\n')
    );
  });

  it('deduplica por telefone e mantém dados mais completos', async () => {
    const deps = createMemoryDeps();

    await upsertQuoteLead({ nome: 'Viviane', telefone: '5511978086811', source: 'typebot' }, deps);
    const merged = await upsertQuoteLead(
      {
        nome: 'Viviane Correa',
        email: 'viviane@example.com',
        telefone: '(11) 97808-6811',
        produto: 'lenço',
        source: 'typebot',
      },
      deps
    );

    const leads = await listQuoteLeads({ status: 'all' }, deps);
    assert.equal(leads.length, 1);
    assert.equal(merged.id, 'quote_lead_1');
    assert.equal(merged.nome, 'Viviane Correa');
    assert.equal(merged.email, 'viviane@example.com');
    assert.equal(merged.pedidoTexto, 'Produto: lenço');
  });

  it('lista apenas leads novos por padrão, mais recentes primeiro e respeita limit', async () => {
    const deps = createMemoryDeps([
      {
        id: 'old',
        nome: 'Antigo',
        email: 'old@example.com',
        telefone: '5511000000000',
        pedidoTexto: '',
        source: 'typebot',
        status: 'new',
        createdAt: '2026-06-29T10:00:00.000Z',
        updatedAt: '2026-06-29T10:00:00.000Z',
      },
      {
        id: 'converted',
        nome: 'Convertido',
        email: 'converted@example.com',
        telefone: '5511111111111',
        pedidoTexto: '',
        source: 'typebot',
        status: 'converted',
        createdAt: '2026-06-29T11:00:00.000Z',
        updatedAt: '2026-06-29T11:00:00.000Z',
      },
      {
        id: 'new',
        nome: 'Novo',
        email: 'new@example.com',
        telefone: '5511222222222',
        pedidoTexto: '',
        source: 'typebot',
        status: 'new',
        createdAt: '2026-06-29T12:00:00.000Z',
        updatedAt: '2026-06-29T12:00:00.000Z',
      },
    ]);

    const leads = await listQuoteLeads({ limit: 1 }, deps);
    assert.deepEqual(leads.map((lead) => lead.id), ['new']);
  });

  it('atualiza status e quotationId', async () => {
    const deps = createMemoryDeps([
      {
        id: 'quote_lead_1',
        nome: 'Viviane Correa',
        email: 'viviane@example.com',
        telefone: '5511978086811',
        pedidoTexto: '',
        source: 'typebot',
        status: 'new',
        createdAt: '2026-06-29T10:00:00.000Z',
        updatedAt: '2026-06-29T10:00:00.000Z',
      },
    ]);

    const updated = await updateQuoteLead(
      'quote_lead_1',
      { status: 'converted', quotationId: 'ORC-20261777' },
      deps
    );

    assert.equal(updated.status, 'converted');
    assert.equal(updated.quotationId, 'ORC-20261777');
    assert.equal(updated.updatedAt, '2026-06-29T12:00:00.000Z');
  });
});
