import assert from 'node:assert/strict';
import test from 'node:test';
import { loadManualQuoteDraft, sanitizeManualQuoteDraft } from '../../src/lib/storage/manualQuoteDraftStorage.ts';

const storage = (value: unknown) => ({
  getItem: () => JSON.stringify(value),
});

const valid = {
  version: 1,
  clientType: 'new',
  clientSearch: '',
  selectedClient: null,
  newClient: { nome: 'Cliente', email: 'cliente@example.test', telefone: '5511999999999' },
  leadSource: 'Google Ads',
  cnpj: '',
  address: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
  showAddress: false,
  items: [{ _key: 'item-1', sku: 'SKU-1', nome: 'Produto', qty: 2, rate: 10, _rateManual: false }],
  prazo: '',
  observacoes: 'ok',
  urgente: false,
  templateKey: '',
};

test('restores manual storage with sanitized scalar fields', () => {
  const draft = loadManualQuoteDraft(storage({
    ...valid,
    observacoes: 42,
    address: { ...valid.address, cidade: { malformed: true } },
  }));
  assert.equal(draft?.observacoes, '');
  assert.equal(draft?.address.cidade, '');
  assert.doesNotThrow(() => JSON.stringify(draft));
});

test('rejects malformed required manual storage without throwing', () => {
  assert.equal(sanitizeManualQuoteDraft({ ...valid, newClient: { nome: 42, email: '', telefone: '' } }), null);
  assert.equal(loadManualQuoteDraft(storage('{broken')), null);
});

test('preserves a valid creation key and strips malformed ones', () => {
  const key = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(loadManualQuoteDraft(storage({ ...valid, creationRequestId: key }))?.creationRequestId, key);
  assert.equal(
    loadManualQuoteDraft(storage({ ...valid, creationRequestId: 'not-a-uuid' }))?.creationRequestId,
    undefined
  );
});
