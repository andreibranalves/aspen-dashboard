import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotationPreviewHandler } from '../../api/_functions/quotation-preview.js';
import { getQuotationTemplate } from '../../api/_functions/lib/quotation-templates.js';

const template = getQuotationTemplate('padrao')!;
const extracted = {
  nome: 'Cliente Preview',
  email: 'preview@example.com',
  telefone: '11999999999',
  cnpj: '12.345.678/0001-90',
  endereco: { endereco: 'Rua A', numero: '10', municipio: 'São Paulo', uf: 'SP' },
  template_key: 'padrao',
  prazo_producao: '15 dias úteis',
  items: [
    {
      item_code: 'SKU-001',
      item_name: 'Produto Preview',
      qty: 2,
      rate: 12.5,
      manual_rate: false,
    },
  ],
};

function post(value: unknown) {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    queryStringParameters: {},
    body: new URLSearchParams({ payload: JSON.stringify(value) }).toString(),
  } as any;
}

test('renders an unsaved quotation draft as secured HTML without loading a snapshot', async () => {
  let snapshotReads = 0;
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => { snapshotReads += 1; return null; } },
    resolveDraftTemplate: async (key) => key === template.key ? template : null,
    now: () => new Date('2026-08-11T12:00:00.000Z'),
  });

  const response = await handler(post({ extracted }));

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['Content-Type'], 'text/html; charset=utf-8');
  assert.match(response.headers?.['Content-Security-Policy'] || '', /script-src 'none'/);
  assert.match(response.body || '', /Cliente Preview/);
  assert.match(response.body || '', /Produto Preview/);
  assert.match(response.body || '', /25,00/);
  assert.equal(snapshotReads, 0);
});

test('applies urgent markup to non-manual item prices', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
  });
  const response = await handler(
    post({ extracted: { ...extracted, urgente: true, items: [{ ...extracted.items[0], qty: 1, rate: 10 }] } })
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body || '', /R\$ 13,00/);
  assert.match(response.body || '', /Total<\/span><span>R\$ 13,00/);
});

test('leaves urgent manual item prices unchanged', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
  });
  const response = await handler(
    post({
      extracted: {
        ...extracted,
        urgente: true,
        items: [{ ...extracted.items[0], qty: 1, rate: 10, manual_rate: true }],
      },
    })
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body || '', /Total<\/span><span>R\$ 10,00/);
  assert.doesNotMatch(response.body || '', /Total<\/span><span>R\$ 13,00/);
});

test('aggregates multi-line totals in exact cents', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
  });
  const response = await handler(
    post({
      extracted: {
        ...extracted,
        items: [
          { ...extracted.items[0], qty: 1, rate: 0.1 },
          { ...extracted.items[0], item_code: 'SKU-002', qty: 1, rate: 0.2 },
        ],
      },
    })
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body || '', /Total<\/span><span>R\$ 0,30/);
});

test('rejects draft preview without a client name', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
  });
  const response = await handler(post({ extracted: { ...extracted, nome: '' } }));
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /nome do cliente/i);
});

test('rejects non-number quantity and rate values', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
  });
  const malformedValues: unknown[] = ['', false, [], null, {}];
  for (const field of ['qty', 'rate'] as const) {
    for (const malformed of malformedValues) {
      const response = await handler(
        post({
          extracted: {
            ...extracted,
            items: [{ ...extracted.items[0], [field]: malformed }],
          },
        })
      );
      assert.equal(response.statusCode, 400, `${field}=${String(malformed)}`);
      assert.match(response.body || '', /item válido/i);
    }
  }
});

test('rejects draft preview with an invalid template', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => null,
  });
  const response = await handler(post({ extracted }));
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /template do orçamento inválido/i);
});

test('rejects draft preview without valid items', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
  });
  const response = await handler(post({ extracted: { ...extracted, items: [] } }));
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /item válido/i);
});

test('preserves GET preview snapshot loading', async () => {
  let requestedId = '';
  const handler = createQuotationPreviewHandler({
    repository: {
      get: async (id: string) => {
        requestedId = id;
        return null;
      },
    },
    resolveDraftTemplate: async () => template,
  });
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { id: 'ORC-1' },
  } as any);
  assert.equal(response.statusCode, 404);
  assert.equal(requestedId, 'ORC-1');
});
