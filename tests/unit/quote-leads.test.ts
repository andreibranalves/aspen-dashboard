import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../../api/_functions/quote-leads.js';
import type { QuoteLead } from '../../api/_functions/lib/quote-leads-store.js';
import { createQuoteLeadMemoryDeps, makeQuoteLead, parseJsonResult } from './pre-quote-fixtures.ts';

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
  try {
    return JSON.parse(result.body || '{}');
  } catch {
    return { error: 'Invalid JSON', raw: String(result.body || '') };
  }
}

const ORIGINAL_INGEST_TOKEN = process.env.QUOTE_LEADS_INGEST_TOKEN;
const ORIGINAL_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;

afterEach(() => {
  if (ORIGINAL_INGEST_TOKEN === undefined) delete process.env.QUOTE_LEADS_INGEST_TOKEN;
  else process.env.QUOTE_LEADS_INGEST_TOKEN = ORIGINAL_INGEST_TOKEN;
  if (ORIGINAL_OPERATIONAL_MODE === undefined) delete process.env.CRM_OPERATIONAL_MODE;
  else process.env.CRM_OPERATIONAL_MODE = ORIGINAL_OPERATIONAL_MODE;
});

describe('quote-leads handler', () => {
  it('stays available in operational mode because it uses the CRM lead store', async () => {
    process.env.CRM_OPERATIONAL_MODE = 'true';
    const result = await createHandler(
      createMemoryDeps([
        {
          id: 'quote_lead_1',
          nome: 'Cliente Operacional',
          email: 'cliente@example.com',
          telefone: '5511978086811',
          pedidoTexto: 'Produto: lenço',
          source: 'typebot',
          status: 'new',
          createdAt: '2026-06-29T11:00:00.000Z',
          updatedAt: '2026-06-29T11:00:00.000Z',
        },
      ])
    )({
      httpMethod: 'GET',
      queryStringParameters: { limit: '5' },
    } as any);
    const body = parse(result);

    assert.equal(result.statusCode, 200);
    assert.equal(body.data[0].nome, 'Cliente Operacional');
  });

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

  it('filtra GET por status, source e busca textual', async () => {
    const handler = createHandler(
      createQuoteLeadMemoryDeps([
        makeQuoteLead({
          id: 'typebot-ready',
          source: 'typebot',
          status: 'ready',
          nome: 'Ana Typebot',
        }),
        makeQuoteLead({
          id: 'site-ready',
          source: 'site_form',
          status: 'ready',
          nome: 'Bruna Site',
          telefone: '5521888887777',
        }),
      ])
    );

    const result = await handler({
      httpMethod: 'GET',
      queryStringParameters: { status: 'ready', source: 'site_form', q: 'bruna', limit: '20' },
    } as any);
    const body = parseJsonResult(result);

    assert.equal(result.statusCode, 200);
    assert.deepEqual(
      body.data.map((lead: any) => lead.id),
      ['site-ready']
    );
  });

  it('cria lead via POST externo autenticado', async () => {
    process.env.QUOTE_LEADS_INGEST_TOKEN = 'ingest-secret';
    const deps = createQuoteLeadMemoryDeps();
    const handler = createHandler(deps);

    const result = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer ingest-secret' },
      body: JSON.stringify({
        source: 'site_form',
        externalId: 'sanity-1',
        nome: 'Cliente Site',
        email: 'cliente@example.com',
        whatsapp: '21999990000',
        produto: 'Bolsas',
        quantidade: '80',
        gclid: 'gclid-site',
      }),
    } as any);
    const body = parseJsonResult(result);

    assert.equal(result.statusCode, 201);
    assert.equal(body.success, true);
    assert.equal(body.data.source, 'site_form');
    assert.equal(body.data.externalId, 'sanity-1');
    assert.equal(body.data.attribution.gclid, 'gclid-site');
  });

  it('bloqueia POST externo sem token', async () => {
    process.env.QUOTE_LEADS_INGEST_TOKEN = 'ingest-secret';
    const handler = createHandler(createQuoteLeadMemoryDeps());

    const result = await handler({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ nome: 'Cliente Site' }),
    } as any);
    const body = parseJsonResult(result);

    assert.equal(result.statusCode, 401);
    assert.equal(body.error, 'Não autorizado.');
  });

  it('edita campos do lead via PATCH', async () => {
    const handler = createHandler(
      createQuoteLeadMemoryDeps([makeQuoteLead({ id: 'quote_lead_1' })])
    );

    const result = await handler({
      httpMethod: 'PATCH',
      body: JSON.stringify({
        id: 'quote_lead_1',
        nome: 'Viviane Editada',
        produto: 'Lenços',
        quantidade: '200',
        status: 'ready',
      }),
    } as any);
    const body = parseJsonResult(result);

    assert.equal(result.statusCode, 200);
    assert.equal(body.data.nome, 'Viviane Editada');
    assert.equal(body.data.quantidade, '200');
    assert.equal(body.data.status, 'ready');
  });
});
