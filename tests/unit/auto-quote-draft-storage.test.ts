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

test('discards drafts missing customer or items and strips non-UUID issue keys', () => {
  const storage = createStorage();
  const missingCustomer = { ...validDraft, edited: { ...validDraft.edited, nome: '' } };
  const missingItems = { ...validDraft, edited: { ...validDraft.edited, items: [] } };
  const invalidKey = { ...validDraft, issueIdempotencyKey: 'not-a-uuid' };
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [missingCustomer, missingItems, invalidKey] }));
  const [restored] = loadAutoQuoteDrafts(storage);
  assert.equal(restored.edited.nome, 'Cliente');
  assert.equal(restored.issueIdempotencyKey, undefined);
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

test('preserves the issue origin used to recover manual navigation after reload', () => {
  const storage = createStorage();
  const pendingManualIssue = {
    ...validDraft,
    status: 'processing' as const,
    issueIdempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    issueDispatchStarted: true,
    issueOrigin: 'manual' as const,
  };
  saveAutoQuoteDrafts(storage, [pendingManualIssue]);
  assert.equal(loadAutoQuoteDrafts(storage)[0]?.issueOrigin, 'manual');
});

test('sanitizes optional identity fields and malformed editable values field by field', () => {
  const storage = createStorage();
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [{
    ...validDraft,
    edited: {
      ...validDraft.edited,
      client_id: { bad: true },
      quote_lead_id: 'lead-1',
      crm_deal_id: 'deal-1',
      observacoes: 42,
      endereco: { ...validDraft.edited.endereco, cidade: { bad: true } },
    },
    saved: { quotationId: 'q-1', businessNumber: 'ORC-1', revisionId: 'r-1', concurrencyToken: '' },
  }] }));

  const [draft] = loadAutoQuoteDrafts(storage);
  assert.equal(draft.edited.client_id, undefined);
  assert.equal(draft.edited.quote_lead_id, 'lead-1');
  assert.equal(draft.edited.crm_deal_id, 'deal-1');
  assert.equal(draft.edited.observacoes, undefined);
  assert.equal(draft.edited.endereco.cidade, '');
  assert.equal(draft.saved, undefined);
});

test('malformed or missing issue keys clear impossible recovery state atomically', () => {
  const storage = createStorage();
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [
    {
      ...validDraft,
      issueIdempotencyKey: 'old-key',
      status: 'processing',
      result: { success: false, error: 'recovery' },
      issueDispatchStarted: true,
      issueRecoveryRequired: true,
    },
    {
      ...validDraft,
      status: 'processing',
      result: { success: false, error: 'recovery' },
      issueDispatchStarted: true,
      issueRecoveryRequired: true,
    },
  ] }));
  const drafts = loadAutoQuoteDrafts(storage);
  assert.equal(drafts.length, 2);
  for (const draft of drafts) {
    assert.equal(draft.issueIdempotencyKey, undefined);
    assert.equal(draft.status, undefined);
    assert.equal(draft.issueDispatchStarted, undefined);
    assert.equal(draft.issueRecoveryRequired, undefined);
  }
});

test('preserves the authoritative saved snapshot', () => {
  const storage = createStorage();
  const withSnapshot = {
    ...validDraft,
    saved: {
      quotationId: 'q-1', businessNumber: 'ORC-1', revisionId: 'r-1', concurrencyToken: 'token-1',
      snapshot: { items: [{ item_code: 'SKU-1', qty: 3, rate: 7.5 }], frete: '4.00', total: '26.50' },
    },
  };
  saveAutoQuoteDrafts(storage, [withSnapshot]);
  assert.deepEqual(loadAutoQuoteDrafts(storage), [withSnapshot]);
});

test('keeps legacy saved drafts but rejects incomplete authoritative snapshots', () => {
  const storage = createStorage();
  const legacySaved = {
    ...validDraft,
    saved: { quotationId: 'q-legacy', businessNumber: 'ORC-LEGACY', revisionId: 'r-legacy', concurrencyToken: 'token-legacy' },
  };
  const invalidSnapshot = {
    ...validDraft,
    saved: {
      ...legacySaved.saved,
      snapshot: { items: [{ item_code: '', qty: 0, rate: null }], frete: '', total: '0.00' },
    },
  };
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [legacySaved, invalidSnapshot] }));
  assert.deepEqual(loadAutoQuoteDrafts(storage), [legacySaved]);
});

test('reports storage write failures', () => {
  const storage = { setItem: () => { throw new Error('quota'); } };
  assert.equal(saveAutoQuoteDrafts(storage, [validDraft]), false);
});

test('round-trips the durable creation key and strips malformed ones', () => {
  const storage = createStorage();
  const key = '550e8400-e29b-41d4-a716-446655440000';
  const withKey = { ...validDraft, creationRequestId: key };
  const malformed = { ...validDraft, creationRequestId: 'not-a-uuid' };
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [withKey, malformed] }));
  const drafts = loadAutoQuoteDrafts(storage);
  assert.equal(drafts[0]?.creationRequestId, key);
  assert.equal(drafts[1]?.creationRequestId, undefined);
});

test('round-trips the automatic demand decision and sanitizes its contract', () => {
  const storage = createStorage();
  const opportunityId = '11111111-1111-4111-8111-111111111111';
  const selected = {
    ...validDraft,
    edited: {
      ...validDraft.edited,
      client_id: '22222222-2222-4222-8222-222222222222',
      opportunity_id: opportunityId,
      new_demand: false,
    },
  };
  const invalid = {
    ...validDraft,
    index: 2,
    edited: {
      ...validDraft.edited,
      opportunity_id: 'not-a-uuid',
      new_demand: 'true',
      demand_summary: 'x'.repeat(4001),
    },
  };
  const newDemand = {
    ...validDraft,
    index: 1,
    edited: {
      ...validDraft.edited,
      new_demand: true,
      demand_summary: '  Cangas 100 unidades  ',
    },
  };
  storage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [selected, newDemand, invalid] }));

  const [restored, restoredNewDemand, sanitized] = loadAutoQuoteDrafts(storage);
  assert.equal(restored.edited.opportunity_id, opportunityId);
  assert.equal(restored.edited.new_demand, false);
  assert.equal(restored.edited.demand_summary, undefined);
  assert.equal(restoredNewDemand.edited.new_demand, true);
  assert.equal(restoredNewDemand.edited.demand_summary, 'Cangas 100 unidades');
  assert.equal(sanitized.edited.opportunity_id, undefined);
  assert.equal(sanitized.edited.new_demand, undefined);
  assert.equal(sanitized.edited.demand_summary, undefined);
});
