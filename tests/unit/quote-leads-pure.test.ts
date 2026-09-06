import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatQuoteLeadText,
  mergeQuoteLead,
  normalizeQuoteLeadInput,
  type QuoteLead,
} from '../../api/_modules/quote-leads-pure.js';
import { makeQuoteLead } from './pre-quote-fixtures.ts';

describe('quote-leads-pure', () => {
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

  it('mantém canal operacional separado de UTM ausente', () => {
    const lead = normalizeQuoteLeadInput(
      {
        nome: 'Cliente Sintético',
        email: 'synthetic@example.invalid',
        whatsapp: '21999990000',
        produto: 'Canga',
        quantidade: '100',
        source: 'site_form',
      },
      { now: () => '2026-09-05T12:00:00.000Z', id: () => 'quote_lead_site_2' }
    );
    assert.equal(lead.source, 'site_form');
    assert.equal(lead.attribution?.utm_source, null);
  });

  it('classifica como incomplete quando faltam dados de contato ou pedido', () => {
    const lead = normalizeQuoteLeadInput(
      { source: 'whatsapp', telefone: '21999990000' },
      { now: () => '2026-07-01T12:00:00.000Z', id: () => 'quote_lead_incomplete' }
    );

    assert.equal(lead.status, 'incomplete');
    assert.deepEqual(lead.missingFields, ['nome', 'pedido']);
  });

  it('preserva status terminal e attribution first-touch no merge puro', () => {
    const current: QuoteLead = makeQuoteLead({
      nome: 'Ana',
      status: 'converted',
      quotationId: 'ORC-20260001',
      attribution: { gclid: 'first-gclid', utm_source: 'google' },
    });
    const incoming = normalizeQuoteLeadInput(
      {
        nome: 'Ana Atualizada',
        telefone: '5511978086811',
        source: 'typebot',
        gclid: 'second-gclid',
        utm_source: 'meta',
      },
      { now: () => '2026-07-01T12:00:00.000Z', id: () => current.id }
    );

    const merged = mergeQuoteLead(current, incoming, '2026-07-01T12:00:00.000Z');

    assert.equal(merged.status, 'converted');
    assert.equal(merged.quotationId, 'ORC-20260001');
    assert.equal(merged.attribution?.gclid, 'first-gclid');
    assert.equal(merged.attribution?.utm_source, 'google');
    assert.equal(merged.nome, 'Ana Atualizada');
  });
});
