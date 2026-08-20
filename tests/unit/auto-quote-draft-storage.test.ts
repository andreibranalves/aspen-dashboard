import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadAutoQuoteDrafts,
  saveAutoQuoteDrafts,
} from '../../src/lib/storage/autoQuoteDraftStorage.ts';
import type { StoredAutoQuoteDraft } from '../../src/types/domain.ts';

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values,
  };
}

const validDraft: StoredAutoQuoteDraft = {
  index: 0,
  original: { nome: 'Cliente' },
  edited: {
    nome: 'Cliente', email: 'cliente@example.com', telefone: '5511999999999', urgente: false,
    origem: 'Google Ads', cnpj: '', prazo_producao: '',
    endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
    items: [{ item_code: 'SKU-1', qty: 2, rate: 10 }],
  },
  approved: false,
  discarded: false,
};

const validIssueDraft = {
  ...validDraft,
  issueIdempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
  issue: {
    quotationId: 'q-1', businessNumber: 'ORC-1', revisionId: 'r-1', revisionNumber: 1,
    status: 'emitido' as const, issuedAt: '2026-08-13T00:00:00.000Z',
    validUntil: '2026-08-28', pdfUrl: '/api/quotation-preview?id=q-1&format=pdf',
  },
};

test('restores valid versioned drafts and completed issue projection', () => {
  const storage = createStorage();
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [validIssueDraft] }));
  assert.deepEqual(loadAutoQuoteDrafts(storage), [validIssueDraft]);
});

test('discards malformed storage safely', () => {
  const storage = createStorage();
  storage.setItem('aspen_drafts', '{broken');
  assert.deepEqual(loadAutoQuoteDrafts(storage), []);
});

test('does not restore unknown versions', () => {
  const storage = createStorage();
  storage.setItem('aspen_drafts', JSON.stringify({ version: 99, drafts: [validDraft] }));
  assert.deepEqual(loadAutoQuoteDrafts(storage), []);
});

test('discards drafts missing customer or items and non-UUID issue keys', () => {
  const storage = createStorage();
  const missingCustomer = { ...validDraft, edited: { ...validDraft.edited, nome: '' } };
  const missingItems = { ...validDraft, edited: { ...validDraft.edited, items: [] } };
  const invalidKey = { ...validDraft, issueIdempotencyKey: 'not-a-uuid' };
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [missingCustomer, missingItems, invalidKey] }));
  assert.deepEqual(loadAutoQuoteDrafts(storage), []);
});

test('validates optional item fields while preserving valid legacy values', () => {
  const storage = createStorage();
  const valid = {
    ...validDraft,
    edited: {
      ...validDraft.edited,
      items: [{ ...validDraft.edited.items[0], item_name: 'Produto', _rateManual: true }],
    },
  };
  const invalidName = {
    ...validDraft,
    edited: { ...validDraft.edited, items: [{ ...validDraft.edited.items[0], item_name: { label: 'Produto' } }] },
  };
  const invalidManualRate = {
    ...validDraft,
    edited: { ...validDraft.edited, items: [{ ...validDraft.edited.items[0], _rateManual: 'true' }] },
  };
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [valid, invalidName, invalidManualRate] }));
  assert.deepEqual(loadAutoQuoteDrafts(storage), [valid]);
});

test('loads the pre-versioned localStorage array for legacy compatibility', () => {
  const storage = createStorage();
  storage.setItem('aspen_drafts', JSON.stringify([validDraft]));
  assert.deepEqual(loadAutoQuoteDrafts(storage), [validDraft]);
});

test('rehydration is read-only and never auto-issues', () => {
  const storage = createStorage();
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [validIssueDraft] }));
  const before = storage.values.get('aspen_drafts');
  assert.deepEqual(loadAutoQuoteDrafts(storage), [validIssueDraft]);
  assert.equal(storage.values.get('aspen_drafts'), before);
});

test('saves drafts in a versioned shape without server synchronization', () => {
  const storage = createStorage();
  saveAutoQuoteDrafts(storage, [validIssueDraft]);
  assert.deepEqual(JSON.parse(storage.values.get('aspen_drafts')!), { version: 1, drafts: [validIssueDraft] });
});
