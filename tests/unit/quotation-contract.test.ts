import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  toCanonicalQuotationDetail,
  toCanonicalQuotationListRow,
} from '../../api/_modules/quotation-contract.js';
import { createCoreHandler } from '../../api/_modules/quotations-core.js';

function event(method: string, query: Record<string, string> = {}, body = '') {
  return {
    httpMethod: method,
    headers: {},
    queryStringParameters: query,
    body,
  } as const;
}

function parse(result: { body?: string }) {
  return JSON.parse(result.body || '{}') as Record<string, unknown>;
}

const detail = {
  id: 'ORC-20260001',
  quotation_id: 'ORC-20260001',
  quotation_uuid: '11111111-1111-4111-8111-111111111111',
  quote_id: 'legacy-quote-id',
  revision_id: '22222222-2222-4222-8222-222222222222',
  quote_revision_id: 'legacy-revision-id',
  revision: 1,
  revision_number: 2,
  status: 'Draft' as const,
  status_legacy: 'Draft',
  status_canonical: 'rascunho' as const,
  cliente: 'Cliente teste',
  client_id: '33333333-3333-4333-8333-333333333333',
  cliente_id: 'cliente-id-duplicado',
  email_sent: false,
  email_sent_at: null,
  data: '2026-08-17',
  validade: '2026-09-01',
  validity_date: '2026-09-15',
  validade_dias: 15,
  pagamento: 'À vista',
  entrega: '10 dias',
  frete_padrao: '0.00',
  frete: '0.00',
  observacoes: '',
  prazo_producao: '',
  template_padrao: 'padrao',
  template_key: 'padrao',
  template_hash: 'hash-1',
  derived_expired: false,
  expiration_derived: false,
  is_expired: false,
  expirada: false,
  subtotal: '90.00',
  total: '100.00',
  valor: '999.00',
  items: [
    {
      position: 0,
      item_code: 'ITEM-1',
      sku: 'SKU-1',
      qty: '2',
      quantidade: 'doze',
      nome: 'Item Um',
      descricao: '',
      unidade: 'un',
      categoria: null,
      marca: null,
      price_source: 'base',
      preco_fonte: 'base',
      tier_minimum: null,
      preco_minimo_faixa: null,
      suggested_unit_price: '50.00',
      preco_sugerido: 'cinquenta',
      applied_unit_price: '50.00',
      preco_aplicado: '50.00-aplicado',
      price_difference: '0.00',
      diferenca_preco: '0.00-dup',
      line_total: '100.00',
      total_linha: 'cem-linha',
      manual_rate: false,
    } as never,
  ],
  revision_history: [],
  concurrency_token: '2026-07-01T12:00:00.000Z',
  version_token: 'version-token-duplicado',
  optimistic_concurrency_token: 'optimistic-token-duplicado',
  concurrencyToken: 'camel-token-duplicado',
  updated_at: '2026-07-01T12:00:00.000Z',
  updatedAt: 'updatedAt-duplicado',
};

const listRow = {
  id: 'row-internal',
  quotation_id: 'ORC-20260001',
  quotation_uuid: '11111111-1111-4111-8111-111111111111',
  revision_id: '22222222-2222-4222-8222-222222222222',
  revision: 1,
  revision_number: 2,
  client_id: '33333333-3333-4333-8333-333333333333',
  cliente: 'Cliente teste',
  cliente_snapshot: {},
  data: '2026-08-17',
  validade: '2026-09-01',
  validade_dias: 15,
  subtotal: '90.00',
  total: '100.00',
  valor: '999.00',
  frete: '0.00',
  status: 'Emitido',
  status_canonical: 'emitido',
  email_sent: true,
  email_sent_at: '2026-08-18T00:00:00.000Z',
  updated_at: '2026-07-01T12:00:00.000Z',
  updatedAt: 'updatedAt-duplicado',
  concurrency_token: '2026-07-01T12:00:00.000Z',
  optimistic_concurrency_token: 'optimistic-token-duplicado',
} as never;

test('canonical quotation contract maps every duplicated name to exactly one canonical field', () => {
  const canonical = toCanonicalQuotationDetail(detail);

  // Single name per concept (AC 3)
  assert.equal(canonical.revisionId, '22222222-2222-4222-8222-222222222222');
  assert.equal(canonical.revision, 2); // revision_number é a fonte canônica do número
  assert.equal(canonical.status, 'rascunho'); // status_canonical vence o legado
  assert.equal(canonical.validade, '2026-09-01');
  assert.equal(canonical.total, '100.00'); // duplicatas (valor/grand_total) não entram
  assert.equal(canonical.concurrencyToken, '2026-07-01T12:00:00.000Z');
  assert.equal(canonical.clienteId, '33333333-3333-4333-8333-333333333333');
  assert.equal(canonical.updatedAt, '2026-07-01T12:00:00.000Z');

  const serializedKeys = Object.keys(JSON.parse(JSON.stringify(canonical)));
  for (const forbidden of [
    'revision_number',
    'quote_revision_id',
    'status_legacy',
    'validity_date',
    'valor',
    'grand_total',
    'optimistic_concurrency_token',
    'version_token',
    'derived_expired',
    'expiration_derived',
    'is_expired',
    'expirada',
    'cliente_id',
  ]) {
    assert.equal(serializedKeys.includes(forbidden), false, `alias ${forbidden} não pode existir na shape canônica`);
  }

  assert.deepEqual(serializedKeys.filter((key) => /token/i.test(key)), ['concurrencyToken']);
});

test('canonical items and history use one spelling per field', () => {
  const canonical = toCanonicalQuotationDetail({
    ...detail,
    items: detail.items,
    revision_history: [
      {
        id: 'h1',
        revision_id: 'rev-1',
        revision: 1,
        revision_number: 1,
        created_at: '2026-06-01T00:00:00.000Z',
        createdAt: 'dup',
        validade_dias: 30,
        validity_date: 'dup-date',
        validade: 'dup-validade',
        subtotal: '10.00',
        total: '12.00',
        valor: 'dup-total',
        status: 'enviado',
        status_legacy: 'Enviado',
        status_canonical: 'emitido',
        derived_expired: true,
        expiration_derived: false,
        is_expired: false,
        expirada: false,
        template_key: 'padrao',
        template_version: 1,
        template_hash: 'hash',
      } as never,
    ],
  });

  const [item] = canonical.items;
  assert.equal(item.code, 'ITEM-1');
  assert.equal(item.quantity, '2');
  assert.equal(item.unitPrice, '50.00');
  assert.equal(item.lineTotal, '100.00');

  const [entry] = canonical.revisionHistory;
  assert.equal(entry.status, 'emitido'); // legado 'enviado' nunca aparece como estado canônico
  assert.equal(entry.expired, true); // derived_expired é a flag canônica
  assert.equal(entry.total, '12.00');
});

test('canonical list row keeps public identity in id/businessNumber', () => {
  const canonical = toCanonicalQuotationListRow(listRow);

  assert.equal(canonical.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(canonical.businessNumber, 'ORC-20260001');
  assert.equal(canonical.emailSent, true);
  assert.equal(canonical.expired, false);
  assert.equal('expirada' in canonical, false);
});

test('contradictory status fails closed instead of guessing', () => {
  assert.throws(
    () =>
      toCanonicalQuotationListRow({ ...(listRow as object), status_canonical: 'estado-invalido' } as never),
    /Estado comercial inválido/,
  );
});

test('HTTP responses expose the canonical contract additively alongside legacy aliases', async () => {
  const handler = createCoreHandler({
    repository: {
      list: async () => ({ rows: [listRow], total: 1, page: 1, limit: 50, statusSummary: {} }),
      get: async () => detail,
      update: async () => detail,
    } as never,
  });

  const opened = await handler(event('GET', { id: detail.quotation_id }));
  const openedPayload = parse(opened);
  assert.equal(openedPayload.concurrency_token, '2026-07-01T12:00:00.000Z'); // consumidor atual segue funcionando
  const openedCanonical = openedPayload.canonical as Record<string, unknown>;
  assert.equal(openedCanonical.concurrencyToken, '2026-07-01T12:00:00.000Z');
  assert.equal(openedCanonical.total, '100.00');

  const listed = await handler(event('GET'));
  const listPayload = parse(listed);
  const row = (listPayload.data as Array<Record<string, unknown>>)[0];
  assert.equal(row.status_canonical, 'emitido'); // aliases preservados
  assert.equal((row.canonical as Record<string, unknown>).businessNumber, 'ORC-20260001');
  assert.equal((row.canonical as Record<string, unknown>).status, 'emitido');

  const updated = await handler(event('PUT', { id: detail.quotation_id }, '{}'));
  const updatedPayload = parse(updated);
  assert.equal(updatedPayload.valor, '999.00'); // aliases do repositório permanecem na resposta
  assert.equal((updatedPayload.canonical as Record<string, unknown>).total, '100.00');
  assert.equal((updatedPayload.canonical as Record<string, unknown>).revision, 2);
});
