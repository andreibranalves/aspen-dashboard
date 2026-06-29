import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../../api/_functions/quote-leads.js';
import type { QuoteLead } from '../../api/_functions/lib/quote-leads-store.js';

function createMemoryDeps(seed: QuoteLead[] = []) {
  let records = [...seed];
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
      return 'quote_lead_new';
    },
  };
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}');
}

describe('quote-leads handler', () => {
  it('retorna leads novos com texto pronto para textarea', async () => {
    const handler = createHandler(
      createMemoryDeps([
        {
          id: 'quote_lead_1',
          nome: 'Viviane Correa',
          email: 'viviane@example.com',
          telefone: '5511978086811',
          pedidoTexto: 'Produto: lenço',
          source: 'typebot',
          status: 'new',
          createdAt: '2026-06-29T11:00:00.000Z',
          updatedAt: '2026-06-29T11:00:00.000Z',
        },
      ])
    );

    const result = await handler({
      httpMethod: 'GET',
      queryStringParameters: { limit: '5' },
    } as any);
    const body = parse(result);

    assert.equal(result.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, 'quote_lead_1');
    assert.equal(body.data[0].texto.includes('Nome: Viviane Correa'), true);
  });

  it('marca lead como convertido', async () => {
    const handler = createHandler(
      createMemoryDeps([
        {
          id: 'quote_lead_1',
          nome: 'Viviane Correa',
          email: 'viviane@example.com',
          telefone: '5511978086811',
          pedidoTexto: 'Produto: lenço',
          source: 'typebot',
          status: 'new',
          createdAt: '2026-06-29T11:00:00.000Z',
          updatedAt: '2026-06-29T11:00:00.000Z',
        },
      ])
    );

    const result = await handler({
      httpMethod: 'PATCH',
      body: JSON.stringify({
        id: 'quote_lead_1',
        status: 'converted',
        quotationId: 'ORC-20261777',
      }),
    } as any);
    const body = parse(result);

    assert.equal(result.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'converted');
    assert.equal(body.data.quotationId, 'ORC-20261777');
  });

  it('retorna 400 para PATCH sem id', async () => {
    const handler = createHandler(createMemoryDeps());
    const result = await handler({
      httpMethod: 'PATCH',
      body: JSON.stringify({ status: 'converted' }),
    } as any);
    const body = parse(result);

    assert.equal(result.statusCode, 400);
    assert.equal(body.error, 'ID do lead é obrigatório.');
  });
});
