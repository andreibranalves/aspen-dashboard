import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatQuoteLeadText,
  listQuoteLeads,
  normalizeQuoteLeadInput,
  updateQuoteLead,
  upsertQuoteLead,
  type QuoteLead,
} from '../../api/modules/quote-leads-store.js';
import { createQuoteLeadMemoryDeps, makeQuoteLead } from './pre-quote-fixtures.ts';

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
    assert.equal(lead.status, 'ready');
  });

  it('resolve códigos numéricos de produto (1-7) para nomes', () => {
    const lead = normalizeQuoteLeadInput(
      { nome: 'Teste', produto: '3', quantidade: '200', source: 'typebot' },
      { now: () => '2026-06-29T12:00:00.000Z', id: () => 'ql_1' }
    );
    assert.equal(lead.pedidoTexto, 'Produto: Bolsas\nQuantidade: 200');
  });

  it('mantém produto textual sem traduzir', () => {
    const lead = normalizeQuoteLeadInput(
      { nome: 'Teste', produto: 'lenço personalizado', quantidade: '50', source: 'typebot' },
      { now: () => '2026-06-29T12:00:00.000Z', id: () => 'ql_2' }
    );
    assert.equal(lead.pedidoTexto, 'Produto: lenço personalizado\nQuantidade: 50');
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
    assert.deepEqual(
      leads.map((lead) => lead.id),
      ['new']
    );
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

  it('normaliza formulário do site com attribution e status ready', () => {
    const lead = normalizeQuoteLeadInput(
      {
        source: 'site_form',
        externalId: 'sanity-quote-1',
        nome: '  Ana Empresa ',
        email: ' ANA@EXAMPLE.COM ',
        whatsapp: '(21) 99999-0000',
        produto: 'Cangas',
        quantidade: '150',
        prazo: '20 dias',
        mensagem: 'Quero orçamento para evento corporativo',
        page_url: 'https://aspenestamparia.com/contato?gclid=abc',
        utm_source: 'google',
        utm_medium: 'cpc',
        utm_campaign: 'verao',
        gclid: 'abc',
        source_cta: 'quote-form',
      },
      { now: () => '2026-07-01T12:00:00.000Z', id: () => 'quote_lead_site_1' }
    );

    assert.equal(lead.id, 'quote_lead_site_1');
    assert.equal(lead.source, 'site_form');
    assert.equal(lead.externalId, 'sanity-quote-1');
    assert.equal(lead.nome, 'Ana Empresa');
    assert.equal(lead.email, 'ana@example.com');
    assert.equal(lead.telefone, '5521999990000');
    assert.equal(lead.produto, 'Cangas');
    assert.equal(lead.quantidade, '150');
    assert.equal(lead.prazo, '20 dias');
    assert.equal(lead.status, 'ready');
    assert.deepEqual(lead.attribution, {
      page_url: 'https://aspenestamparia.com/contato?gclid=abc',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'verao',
      utm_content: null,
      utm_term: null,
      gclid: 'abc',
      gbraid: null,
      wbraid: null,
      fbclid: null,
      source_cta: 'quote-form',
      result_id: null,
    });
    assert.equal(
      lead.pedidoTexto,
      'Produto: Cangas\nQuantidade: 150\nPrazo: 20 dias\nContexto: Quero orçamento para evento corporativo'
    );
  });

  it('classifica como incomplete quando faltam dados de contato ou pedido', () => {
    const lead = normalizeQuoteLeadInput(
      { source: 'whatsapp', telefone: '21999990000' },
      { now: () => '2026-07-01T12:00:00.000Z', id: () => 'quote_lead_incomplete' }
    );

    assert.equal(lead.status, 'incomplete');
    assert.deepEqual(lead.missingFields, ['nome', 'pedido']);
  });

  it('deduplica formulário e Typebot por telefone preservando attribution first-touch', async () => {
    const deps = createQuoteLeadMemoryDeps();

    await upsertQuoteLead(
      {
        source: 'site_form',
        nome: 'Ana',
        email: 'ana@example.com',
        whatsapp: '21999990000',
        produto: 'Cangas',
        gclid: 'first-gclid',
        utm_source: 'google',
      },
      deps
    );

    const merged = await upsertQuoteLead(
      {
        source: 'typebot',
        nome: 'Ana Empresa',
        telefone: '5521999990000',
        quantidade: '150',
        gclid: 'second-gclid',
        utm_source: 'meta',
      },
      deps
    );

    assert.equal(merged.id, 'quote_lead_1');
    assert.equal(merged.nome, 'Ana Empresa');
    assert.equal(merged.quantidade, '150');
    assert.equal(merged.attribution?.gclid, 'first-gclid');
    assert.equal(merged.attribution?.utm_source, 'google');
    assert.equal((await listQuoteLeads({ status: 'all' }, deps)).length, 1);
  });

  it('filtra listagem por source e status', async () => {
    const deps = createQuoteLeadMemoryDeps([
      makeQuoteLead({ id: 'typebot-ready', source: 'typebot', status: 'ready' }),
      makeQuoteLead({
        id: 'site-ready',
        source: 'site_form',
        status: 'ready',
        telefone: '5521888887777',
      }),
      makeQuoteLead({
        id: 'site-converted',
        source: 'site_form',
        status: 'converted',
        telefone: '5521777776666',
      }),
    ]);

    const leads = await listQuoteLeads({ status: 'ready', source: 'site_form', limit: 10 }, deps);

    assert.deepEqual(
      leads.map((lead) => lead.id),
      ['site-ready']
    );
  });

  it('mantém converted e discarded em novas entregas da mesma identidade', async () => {
    const convertedDeps = createQuoteLeadMemoryDeps([
      makeQuoteLead({ status: 'converted', quotationId: 'ORC-20260001' }),
    ]);
    const converted = await upsertQuoteLead(
      { nome: 'Viviane Atualizada', telefone: '5511978086811', source: 'typebot' },
      convertedDeps
    );
    assert.equal(converted.status, 'converted');
    assert.equal(converted.quotationId, 'ORC-20260001');

    const discardedDeps = createQuoteLeadMemoryDeps([makeQuoteLead({ status: 'ready' })]);
    const discarded = await upsertQuoteLead(
      { nome: 'Viviane', telefone: '5511978086811', source: 'typebot', status: 'discarded' },
      discardedDeps
    );
    assert.equal(discarded.status, 'discarded');
  });
});
