import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../../api/modules/quote-leads.js';
import {
  formatQuoteLeadText,
  mergeQuoteLead,
  normalizeQuoteLeadInput,
  type QuoteLead,
} from '../../api/modules/quote-leads-store.js';
import {
  quoteLeadIdentityKey,
  type QuoteLeadRecord,
  type QuoteLeadRepository,
} from '../../api/_db/quote-leads-repository.js';
import { makeQuoteLead, parseJsonResult } from './pre-quote-fixtures.ts';

const UUID_1 = '00000000-0000-4000-8000-000000000001';
const UUID_2 = '00000000-0000-4000-8000-000000000002';

function asRecord(lead: QuoteLead, created = false): QuoteLeadRecord {
  return {
    ...lead,
    identityKey: quoteLeadIdentityKey(lead),
    crmDealId: '00000000-0000-4000-8000-000000000099',
    created,
  };
}

function memoryRepository(seed: QuoteLead[] = []): QuoteLeadRepository {
  const rows = seed.map((lead) => asRecord(lead));
  let idCounter = 10;
  const now = () => '2026-06-29T12:00:00.000Z';
  const nextId = () => {
    idCounter += 1;
    return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`;
  };

  return {
    async upsert(input) {
      const incoming = normalizeQuoteLeadInput(input, { now, id: nextId });
      const identityKey = quoteLeadIdentityKey(incoming);
      const index = rows.findIndex((row) => row.identityKey === identityKey);
      if (index < 0) {
        const created = asRecord({ ...incoming, id: incoming.id }, true);
        rows.unshift(created);
        return created;
      }
      const merged = asRecord(mergeQuoteLead(rows[index], incoming, now()), false);
      merged.id = rows[index].id;
      merged.identityKey = identityKey;
      merged.crmDealId = rows[index].crmDealId;
      rows[index] = merged;
      return merged;
    },
    async findByExternalId(externalId, source) {
      return rows.find((row) => row.externalId === externalId && (!source || row.source === source)) || null;
    },
    async list(options = {}) {
      const status = options.status || 'new';
      const source = options.source || 'all';
      const query = String(options.q || '')
        .trim()
        .toLowerCase();
      const limit = Math.max(1, Math.min(Number(options.limit || 20), 100));
      return rows
        .filter((row) => status === 'all' || row.status === status)
        .filter((row) => source === 'all' || row.source === source)
        .filter(
          (row) =>
            !query ||
            [row.nome, row.email, row.telefone, row.pedidoTexto]
              .join(' ')
              .toLowerCase()
              .includes(query)
        )
        .slice(0, limit)
        .map((row) => ({ ...row, texto: formatQuoteLeadText(row) }));
    },
    async update(id, patch) {
      const row = rows.find((candidate) => candidate.id === id);
      if (!row) return null;
      const normalized = normalizeQuoteLeadInput({ ...row, ...patch, id }, { now, id: () => id });
      const merged = asRecord(mergeQuoteLead(row, normalized, now()), false);
      merged.id = id;
      merged.crmDealId = row.crmDealId;
      Object.assign(row, merged);
      return { ...row, texto: formatQuoteLeadText(row) };
    },
  };
}

const ORIGINAL_INGEST_TOKEN = process.env.QUOTE_LEADS_INGEST_TOKEN;

afterEach(() => {
  if (ORIGINAL_INGEST_TOKEN === undefined) delete process.env.QUOTE_LEADS_INGEST_TOKEN;
  else process.env.QUOTE_LEADS_INGEST_TOKEN = ORIGINAL_INGEST_TOKEN;
});

describe('quote-leads handler', () => {
  it('retorna erro JSON em português para método não suportado', async () => {
    const result = await createHandler(memoryRepository())({ httpMethod: 'DELETE' } as any);

    assert.equal(result.statusCode, 405);
    assert.equal(parseJsonResult(result).error, 'Método não permitido.');
  });

  it('permanece disponível com armazenamento local configurado', async () => {
    const result = await createHandler(
      memoryRepository([
        {
          id: UUID_1,
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
    const body = parseJsonResult(result);

    assert.equal(result.statusCode, 200);
    assert.equal(body.data[0].nome, 'Cliente Operacional');
  });

  it('retorna leads novos com texto pronto para textarea', async () => {
    const result = await createHandler(
      memoryRepository([
        {
          id: UUID_1,
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
    )({
      httpMethod: 'GET',
      queryStringParameters: { limit: '5' },
    } as any);
    const body = parseJsonResult(result);

    assert.equal(result.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, UUID_1);
    assert.equal(body.data[0].texto.includes('Nome: Viviane Correa'), true);
  });

  it('marca lead como convertido', async () => {
    const result = await createHandler(
      memoryRepository([
        {
          id: UUID_1,
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
    )({
      httpMethod: 'PATCH',
      body: JSON.stringify({ id: UUID_1, status: 'converted', quotationId: UUID_2 }),
    } as any);
    const body = parseJsonResult(result);

    assert.equal(result.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'converted');
    assert.equal(body.data.quotationId, UUID_2);
  });

  it('retorna 400 para PATCH sem id', async () => {
    const result = await createHandler(memoryRepository())({
      httpMethod: 'PATCH',
      body: JSON.stringify({ status: 'converted' }),
    } as any);
    const body = parseJsonResult(result);

    assert.equal(result.statusCode, 400);
    assert.equal(body.error, 'ID do lead é obrigatório.');
  });

  it('filtra GET por status, source e busca textual', async () => {
    const result = await createHandler(
      memoryRepository([
        makeQuoteLead({ id: UUID_1, source: 'typebot', status: 'ready', nome: 'Ana Typebot' }),
        makeQuoteLead({
          id: UUID_2,
          source: 'site_form',
          status: 'ready',
          nome: 'Bruna Site',
          telefone: '5521888887777',
        }),
      ])
    )({
      httpMethod: 'GET',
      queryStringParameters: { status: 'ready', source: 'site_form', q: 'bruna', limit: '20' },
    } as any);
    const body = parseJsonResult(result);

    assert.equal(result.statusCode, 200);
    assert.deepEqual(
      body.data.map((lead: QuoteLeadRecord) => lead.id),
      [UUID_2]
    );
  });

  it('cria lead local via POST autenticado', async () => {
    process.env.QUOTE_LEADS_INGEST_TOKEN = 'ingest-secret';
    const repository = memoryRepository();
    const result = await createHandler(repository)({
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
    assert.equal(body.data.crmDealId, '00000000-0000-4000-8000-000000000099');
  });

  it('bloqueia POST sem token', async () => {
    process.env.QUOTE_LEADS_INGEST_TOKEN = 'ingest-secret';
    const result = await createHandler(memoryRepository())({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ nome: 'Cliente Site' }),
    } as any);
    const body = parseJsonResult(result);

    assert.equal(result.statusCode, 401);
    assert.equal(body.error, 'Não autorizado.');
  });

  it('edita campos do lead via PATCH', async () => {
    const result = await createHandler(memoryRepository([makeQuoteLead({ id: UUID_1 })]))({
      httpMethod: 'PATCH',
      body: JSON.stringify({
        id: UUID_1,
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
