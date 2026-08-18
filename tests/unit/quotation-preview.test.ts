import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotationPreviewHandler } from '../../api/modules/quotation-preview.js';
import { getQuotationTemplate } from '../../api/modules/quotation-template-catalog.js';
import { toFunctionEvent } from '../../api/_http/function-adapter.js';

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

async function pdfRender(html: string) { return Buffer.from('%PDF-1.7\n' + html + '\n%%EOF'); }

function rendered(response: any) { return Buffer.from(response.body || '', 'base64').toString(); }

function post(value: unknown, queryStringParameters: Record<string, string> = {}) {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    queryStringParameters,
    body: new URLSearchParams({ payload: JSON.stringify(value) }).toString(),
  } as any;
}

test('formats draft client identity for display', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async (key) => key === template.key ? template : null,
    renderPdf: pdfRender,
  });

  const response = await handler(post({
    extracted: { ...extracted, nome: 'ANDREI ALVES', telefone: '21999999999' },
  }, { format: 'html' }));

  assert.equal(response.statusCode, 200);
  assert.match(response.body || '', /Andrei Alves/);
  assert.match(response.body || '', /\(21\) 99999-9999/);
});

test('renders an unsaved quotation draft as HTML when requested', async () => {
  let renderCalls = 0;
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async (key) => key === template.key ? template : null,
    renderPdf: async () => {
      renderCalls += 1;
      return Buffer.from('%PDF-1.7\\n%%EOF');
    },
  });

  const response = await handler(post({ extracted }, { format: 'html' }));

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(response.isBase64Encoded, undefined);
  assert.equal(response.headers?.['Content-Disposition'], undefined);
  assert.match(response.body || '', /Pré-visualização/);
  assert.match(response.body || '', /Cliente Preview/);
  assert.match(response.body || '', /Produto Preview/);
  assert.equal(renderCalls, 0);
});

test('renders an unsaved quotation draft as secured PDF by default', async () => {
  let snapshotReads = 0;
  let writes = 0;
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => { snapshotReads += 1; return null; } },
    resolveDraftTemplate: async (key) => key === template.key ? template : null,
    renderPdf: pdfRender,
    recordWrite: async () => { writes += 1; },
    now: () => new Date('2026-08-11T12:00:00.000Z'),
  });

  const response = await handler(post({ extracted }));

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['Content-Type'], 'application/pdf');
  assert.equal(response.isBase64Encoded, true);
  assert.equal(response.headers?.['X-Content-Type-Options'], 'nosniff');
  assert.equal(response.headers?.['Content-Disposition'], 'inline; filename="pre-visualizacao-orcamento.pdf"');
  assert.equal(response.headers?.['Cache-Control'], 'no-store');
  assert.match(rendered(response), /Pré-visualização/);
  assert.match(rendered(response), /Cliente Preview/);
  assert.match(rendered(response), /Produto Preview/);
  assert.match(rendered(response), /25,00/);
  assert.equal(snapshotReads, 0);
  assert.equal(writes, 0);
});

test('accepts a form body parsed by the Vercel adapter', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
    renderPdf: pdfRender,
  });
  const response = await handler(toFunctionEvent({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: { payload: JSON.stringify({ extracted }) },
    url: '/api/quotation-preview',
  } as any));

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers?.['Content-Type'], 'application/pdf');
});

test('applies urgent markup to non-manual item prices', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
    renderPdf: pdfRender,
  });
  const response = await handler(
    post({ extracted: { ...extracted, urgente: true, items: [{ ...extracted.items[0], qty: 1, rate: 10 }] } })
  );

  assert.equal(response.statusCode, 200);
  assert.match(rendered(response), /R\$ 13,00/);
  assert.match(rendered(response), /Total<\/span><span>R\$ 13,00/);
});

test('leaves urgent manual item prices unchanged', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
    renderPdf: pdfRender,
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
  assert.match(rendered(response), /Total<\/span><span>R\$ 10,00/);
  assert.doesNotMatch(rendered(response), /Total<\/span><span>R\$ 13,00/);
});

test('aggregates multi-line totals in exact cents', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
    renderPdf: pdfRender,
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
  assert.match(rendered(response), /Total<\/span><span>R\$ 0,30/);
});

test('rejects draft preview without a client name', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
    renderPdf: pdfRender,
  });
  const response = await handler(post({ extracted: { ...extracted, nome: '' } }));
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /nome do cliente/i);
});

test('rejects non-number quantity and rate values', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
    renderPdf: pdfRender,
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
    renderPdf: pdfRender,
  });
  const response = await handler(post({ extracted }));
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /template do orçamento inválido/i);
});

test('rejects draft preview without valid items', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
    renderPdf: pdfRender,
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
    renderPdf: pdfRender,
  });
  const response = await handler({
    httpMethod: 'GET',
    queryStringParameters: { id: 'ORC-1' },
  } as any);
  assert.equal(response.statusCode, 404);
  assert.equal(requestedId, 'ORC-1');
});
