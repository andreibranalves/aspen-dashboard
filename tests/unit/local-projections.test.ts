import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectQuotationDetail,
  projectQuotationListRow,
  projectQuotationItem,
  projectQuotationTemplate,
} from '../../src/lib/localProjections.ts';

const sections = {
  schema_version: 1,
  prazo_producao: { base: { enabled: true, title: 'Prazo' }, current: { enabled: true, title: 'Prazo' } },
  pagamento: { base: { enabled: true, title: 'Pagamento', body: '' }, current: { enabled: true, title: 'Pagamento', body: '' } },
  condicoes_gerais: { base: { enabled: true, title: 'Condições', body: '' }, current: { enabled: true, title: 'Condições', body: '' } },
};

const canonicalHistoryEntry = {
  revisionId: 'rev-1',
  revision: 1,
  createdAt: '2026-08-10T00:00:00.000Z',
  validadeDias: 15,
  subtotal: '9.00',
  total: '9.00',
  status: 'emitido',
  expired: false,
};

/** Payload raiz ainda emissor de aliases; projeções só podem ler o campo `canonical` (#124/#125). */
function payloadWithCanonical(overrides = {}) {
  return {
    id: 'ORC-20260001', status: 'Enviado', status_canonical: 'enviado', cliente: 'Cliente', data: '2026-08-10', validade: '2026-08-25', validade_dias: 15,
    revision: 1, revision_number: 1, revision_id: 'rev-1', client_id: 'client-1', cliente_snapshot: { id: 'client-1', nome: 'Cliente', email: 'cliente@example.com', telefone: '5511999999999' }, pagamento: '', entrega: '', observacoes: '', prazo_producao: '',
    frete_padrao: '0.00', frete: '0.00', subtotal: '9.00', total: '9.00', valor: '999.00', template_key: 'padrao', template_hash: 'a'.repeat(64), template_version_id: null, template_version: null,
    secoes: sections, items: [{ item_code: 'SKU-1', item_name: 'Produto', qty: '1.000', rate: '9.00', suggested_unit_price: '9.00', applied_unit_price: '9.00', price_difference: '0.00', line_total: '9.00', manual_rate: false }],
    revision_history: [{ ...historyLegacy }], derived_expired: false, expiration_derived: false, is_expired: false, expirada: false, concurrency_token: '2026-08-10T00:00:00.000Z',
    canonical: {
      id: '11111111-1111-4111-8111-111111111111',
      businessNumber: 'ORC-20260001',
      name: 'Cliente',
      revisionId: 'rev-1',
      revision: 1,
      status: 'emitido',
      clienteId: 'client-1',
      cliente: 'Cliente',
      data: '2026-08-10',
      validade: '2026-08-25',
      validadeDias: 15,
      subtotal: '9.00',
      total: '9.00',
      frete: '0.00',
      expired: false,
      concurrencyToken: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      emailSent: false,
      emailSentAt: null,
      pagamento: '',
      entrega: '',
      observacoes: '',
      prazoProducao: '',
      templateKey: 'padrao',
      templateHash: 'a'.repeat(64),
      items: [],
      revisionHistory: [canonicalHistoryEntry],
      ...overrides,
    },
  };
}

const historyLegacy = {
  id: 'rev-1', revision_id: 'rev-1', revision: 1, revision_number: 1,
  created_at: '2026-08-10T00:00:00.000Z', validity_date: '2026-08-25', validade_dias: 15,
  subtotal: '9.00', total: '9.00', valor: '9.00', status: 'Enviado', status_canonical: 'enviado',
  derived_expired: false, expiration_derived: false, is_expired: false, expirada: false,
  template_key: 'padrao', template_version: null, template_hash: null,
};

test('quotation projection rejects invented or malformed item domain values', () => {
  for (const patch of [
    { qty: 0 }, { qty: -1 }, { qty: 'NaN' }, { rate: -1 }, { rate: 'NaN' },
  ]) assert.equal(projectQuotationItem({ ...payloadWithCanonical().items[0], ...patch }), null);
});

test('quotation projections consume only the canonical field and reject responses without it', () => {
  assert.equal(projectQuotationDetail(payloadWithCanonical())?.data.status, 'emitido');
  // valor divergente no payload raiz deve ser ignorado: só o canônico conta
  const projected = projectQuotationDetail(payloadWithCanonical());
  assert.equal(projected?.data.total, '9.00');
  assert.equal(Object.prototype.hasOwnProperty.call(projected?.data ?? {}, 'valor'), false);

  const withoutCanonical = payloadWithCanonical();
  delete (withoutCanonical as { canonical?: unknown }).canonical;
  assert.equal(projectQuotationDetail(withoutCanonical), null);
  assert.equal(projectQuotationListRow(withoutCanonical), null);
});

test('quotation detail projection fails closed on malformed canonical fields', () => {
  for (const patch of [
    { revision: 0 },
    { status: 'enviado' },           // sinônimo legado não é mais aceito pela projeção
    { status: 'Unknown' },
    { expired: 'false' },
    { concurrencyToken: '' },
    { templateHash: 'xyz' },
    { updatedAt: null },
  ]) assert.equal(projectQuotationDetail(payloadWithCanonical(patch)), null);
  assert.equal(
    projectQuotationDetail({ ...payloadWithCanonical(), items: [{ ...payloadWithCanonical().items[0], qty: 0 }] }),
    null,
  );
});

test('revision history entries come from canonical shape with root extras merged by index', () => {
  const projected = projectQuotationDetail(payloadWithCanonical());
  const entry = projected?.data.revisionHistory[0];
  assert.equal(entry?.revisionId, 'rev-1');
  assert.equal(entry?.createdAt, '2026-08-10T00:00:00.000Z');
  assert.equal(entry?.status, 'emitido');
  assert.equal(entry?.validade, '2026-08-25');
  assert.equal(entry?.templateKey, 'padrao');

  const malformed = payloadWithCanonical({
    revisionHistory: [{ ...canonicalHistoryEntry, revision: 0 }],
  });
  assert.equal(projectQuotationDetail(malformed), null);
});

test('template projection rejects malformed versions instead of inventing metadata', () => {
  assert.equal(projectQuotationTemplate({ key: 'padrao', name: 'Padrão', current_version: '1' }), null);
  assert.equal(projectQuotationTemplate({ key: 'padrao', name: 'Padrão', current_version: 0 }), null);
  assert.deepEqual(projectQuotationTemplate({ key: 'padrao', name: 'Padrão' }), { key: 'padrao', name: 'Padrão' });
});
