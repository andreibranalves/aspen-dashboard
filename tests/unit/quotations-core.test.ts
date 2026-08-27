import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { createHandler as createBoundary } from '../../api/_modules/quotations.js';
import { createCoreHandler } from '../../api/_modules/quotations-core.js';
import { createPostgresQuotationLifecycleRepository } from '../../api/_infrastructure/db/repositories/quotation-lifecycle-repository.ts';
import {
  QuoteManagementConflictError,
  QuoteManagementInputError,
} from '../../api/_infrastructure/db/repositories/quote-draft-management-repository.js';
import {
  projectQuotationDetail,
  projectQuotationListRow,
} from '../../src/lib/localProjections.ts';

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
  revision_id: '22222222-2222-4222-8222-222222222222',
  revision: 1,
  status: 'Draft' as const,
  status_canonical: 'rascunho' as const,
  cliente: 'Cliente teste',
  client_id: '33333333-3333-4333-8333-333333333333',
  validade_dias: 15,
  pagamento: 'À vista',
  entrega: '10 dias',
  frete_padrao: '0.00',
  frete: '0.00',
  observacoes: '',
  prazo_producao: '',
  template_padrao: 'padrao',
  subtotal: '90.00',
  total: '90.00',
  items: [],
  concurrency_token: '2026-07-01T12:00:00.000Z',
  updated_at: '2026-07-01T12:00:00.000Z',
};

const projectionSections = {
  schema_version: 1,
  prazo_producao: { base: { enabled: true, title: 'Prazo' }, current: { enabled: true, title: 'Prazo' } },
  pagamento: { base: { enabled: true, title: 'Pagamento', body: '' }, current: { enabled: true, title: 'Pagamento', body: '' } },
  condicoes_gerais: { base: { enabled: true, title: 'Condições', body: '' }, current: { enabled: true, title: 'Condições', body: '' } },
};

const quotationProjectionPayload = {
  id: 'ORC-20260001',
  quotation_id: 'ORC-20260001',
  quotation_uuid: '11111111-1111-4111-8111-111111111111',
  revision_id: '22222222-2222-4222-8222-222222222222',
  revision: 1,
  revision_number: 1,
  status: 'Enviado',
  status_canonical: 'enviado',
  cliente: 'Cliente Teste',
  client_id: 'client-1',
  cliente_snapshot: {
    id: 'client-1',
    nome: 'Cliente Teste',
    email: 'cliente@example.com',
    telefone: '5511999999999',
  },
  data: '2026-08-17',
  validade: '2026-09-01',
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  frete: '0.00',
  observacoes: '',
  prazo_producao: '',
  template_key: 'padrao',
  template_hash: 'a'.repeat(64),
  template_version_id: null,
  template_version: null,
  secoes: projectionSections,
  subtotal: '9.00',
  total: '9.00',
  valor: '9.00',
  items: [{ item_code: 'SKU-1', item_name: 'Produto', qty: '1.000', rate: '9.00', suggested_unit_price: '9.00', applied_unit_price: '9.00', price_difference: '0.00', line_total: '9.00', manual_rate: false }],
  revision_history: [],
  derived_expired: false,
  expiration_derived: false,
  is_expired: false,
  expirada: false,
  concurrency_token: '2026-08-17T12:00:00.000Z',
};

/** Espelho do mapeamento que o backend faz em api/_modules/quotation-contract.ts (#124). */
const quotationCanonicalPayload = {
  ...quotationProjectionPayload,
  canonical: {
    id: '11111111-1111-4111-8111-111111111111',
    businessNumber: 'ORC-20260001',
    name: 'Cliente Teste',
    revisionId: '22222222-2222-4222-8222-222222222222',
    revision: 1,
    status: 'emitido',
    clienteId: 'client-1',
    cliente: 'Cliente Teste',
    data: '2026-08-17',
    validade: '2026-09-01',
    validadeDias: 15,
    subtotal: '9.00',
    total: '9.00',
    frete: '0.00',
    expired: false,
    concurrencyToken: '2026-08-17T12:00:00.000Z',
    updatedAt: '2026-08-17T12:00:00.000Z',
    emailSent: false,
    emailSentAt: null,
    pagamento: '',
    entrega: '',
    observacoes: '',
    prazoProducao: '',
    templateKey: 'padrao',
    templateHash: 'a'.repeat(64),
    items: [{ code: 'SKU-1', sku: 'SKU-1', quantity: '1.000', name: 'Produto', description: '', unit: '', category: null, brand: null, unitPrice: '9.00', lineTotal: '9.00', manualRate: false }],
    revisionHistory: [],
  },
};

test('quotation projections preserve accepted email markers and client snapshot contact', () => {
  const source = {
    ...quotationCanonicalPayload,
    email_sent: true,
    email_sent_at: '2026-08-17T12:00:00.000Z',
    canonical: { ...quotationCanonicalPayload.canonical, emailSent: true, emailSentAt: '2026-08-17T12:00:00.000Z' },
  };
  const list = projectQuotationListRow(source);
  assert.equal(list?.emailSent, true);
  assert.equal(list?.emailSentAt, '2026-08-17T12:00:00.000Z');
  const projected = projectQuotationDetail(source);
  assert.equal(projected?.data.email, 'cliente@example.com');
  assert.equal(projected?.data.telefone, '5511999999999');
  assert.equal(projected?.data.emailSent, true);
  assert.equal(projected?.data.emailSentAt, '2026-08-17T12:00:00.000Z');
});

test('quotation projections fall back for responses without email markers', () => {
  const list = projectQuotationListRow(quotationCanonicalPayload);
  assert.equal(list?.emailSent, false);
  assert.equal(list?.emailSentAt, null);
  const projected = projectQuotationDetail(quotationCanonicalPayload);
  assert.equal(projected?.data.emailSent, false);
  assert.equal(projected?.data.emailSentAt, null);
  const invalidDate = projectQuotationDetail({
    ...quotationCanonicalPayload,
    email_sent: true,
    canonical: { ...quotationCanonicalPayload.canonical, emailSent: true, emailSentAt: 'invalid-date' },
  });
  assert.equal(invalidDate?.data.emailSent, true);
  assert.equal(invalidDate?.data.emailSentAt, null);
});
