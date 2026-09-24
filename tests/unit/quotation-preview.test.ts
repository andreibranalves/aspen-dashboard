import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createQuotationPreviewHandler } from '../../api/_modules/quotation-preview.js';
import {
  getQuotationTemplate,
  quotationTemplateFromVersion,
} from '../../api/_modules/quotation-template-catalog.js';
import { renderQuotationDocument } from '../../api/_modules/quotation-document.js';
import { toFunctionEvent } from '../../api/_http/function-adapter.js';

const template = getQuotationTemplate('padrao')!;
const v2Source = '<!doctype html><html><head><title>{{quote_number}}</title></head><body>{{quote_number}} {{client.name}} {{#each items}}{{name}}{{/each}} {{display.total}} {{#if secoes.pagamento.enabled}}<h2>{{secoes.pagamento.title}}</h2><div>{{secoes.pagamento.body_html}}</div>{{/if}}</body></html>';
const v2Template = quotationTemplateFromVersion({
  source: v2Source,
  sourceHash: createHash('sha256').update(v2Source, 'utf8').digest('hex'),
  contractVersion: 2,
  template: { key: 'v2-preview', name: 'Preview v2' },
});
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

test('passes the selected template version to unsaved draft resolution', async () => {
  let selectedVersion: string | undefined;
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async (key, versionId) => {
      selectedVersion = versionId;
      return key === template.key ? template : null;
    },
    renderPdf: pdfRender,
  });

  const response = await handler(post({
    extracted: { ...extracted, template_version_id: '55555555-5555-4555-8555-555555555555' },
  }, { format: 'html' }));

  assert.equal(response.statusCode, 200);
  assert.equal(selectedVersion, '55555555-5555-4555-8555-555555555555');
});

test('routes an unsaved draft through the canonical v2 section model', async () => {
  let renderCalls = 0;
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => v2Template,
    resolveSettings: async () => ({
      validade_dias: 15,
      pagamento: '',
      entrega: '',
      frete_padrao: '0.00',
      observacoes: '',
      template_padrao: v2Template.key,
      secoes: {
        schema_version: 1,
        prazo_producao: { enabled: true, title: 'Prazo customizado' },
        pagamento: {
          enabled: true,
          title: 'Pagamento personalizado',
          body: 'Linha 1\nLinha 2 <script>',
        },
        condicoes_gerais: { enabled: true, title: 'Condições customizadas', body: '' },
      },
    }),
    renderDocument: (value, exactTemplate) => {
      renderCalls += 1;
      return renderQuotationDocument(value, exactTemplate);
    },
    renderPdf: pdfRender,
  });

  const response = await handler(post({ extracted }, { format: 'html' }));

  assert.equal(response.statusCode, 200);
  assert.equal(renderCalls, 1);
  assert.match(response.body || '', /Pagamento personalizado/);
  assert.match(response.body || '', /Linha 1<br>Linha 2 &lt;script&gt;/);
  assert.doesNotMatch(response.body || '', /<script>/);
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

test('applies the manual surcharge only to automatic prices', async () => {
  const calls: Array<{ sku: string; surcharge: number | undefined }> = [];
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
    resolvePricing: async (item: any, _qty, surcharge) => {
      calls.push({ sku: item.item_code, surcharge });
      return { rate: item.item_code === 'SKU-AUTO' ? (surcharge === 30 ? '13.00' : '10.00') : '10.00' };
    },
    renderPdf: pdfRender,
  });
  const response = await handler(
    post({
      extracted: {
        ...extracted,
        acrescimo_percent: 30,
        items: [
          { ...extracted.items[0], item_code: 'SKU-AUTO', qty: 1, rate: 13 },
          { ...extracted.items[0], item_code: 'SKU-MANUAL', qty: 1, rate: 10, manual_rate: true },
        ],
      },
    })
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [
    { sku: 'SKU-AUTO', surcharge: 30 },
    { sku: 'SKU-MANUAL', surcharge: 0 },
  ]);
  assert.match(rendered(response), /Total<\/span><span>R\$ 23,00/);
});

test('generates the communicated deadline from the numeric production deadline', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
    resolveSettings: async () => ({
      validade_dias: 15,
      prazo_producao_dias: 20,
      prazo_producao_complemento: 'após aprovação.',
    }),
    renderPdf: pdfRender,
  });
  const custom = await handler(post({ extracted: { ...extracted, prazo_producao_dias: 7 } }, { format: 'html' }));
  const fallback = await handler(post({ extracted }, { format: 'html' }));

  assert.equal(custom.statusCode, 200);
  assert.match(custom.body || '', /até 7 dias úteis após aprovação\./);
  assert.doesNotMatch(custom.body || '', /15 dias úteis/);
  assert.match(fallback.body || '', /15 a 20 dias úteis após aprovação\./);
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

test('renders draft terms, freight and custom validity without persistence', async () => {
  const handler = createQuotationPreviewHandler({
    repository: { get: async () => null },
    resolveDraftTemplate: async () => template,
    renderPdf: pdfRender,
    now: () => new Date('2026-08-11T12:00:00.000Z'),
  });
  const response = await handler(post({ extracted: {
    ...extracted,
    pagamento: '50% na aprovação',
    entrega: 'Retirada no local',
    observacoes: 'Sem instalação',
    frete: '10.00',
    validade_dias: 30,
  } }, { format: 'html' }));
  assert.equal(response.statusCode, 200);
  assert.match(response.body || '', /50% na aprovação/);
  assert.match(response.body || '', /Retirada no local/);
  assert.match(response.body || '', /Sem instalação/);
  assert.match(response.body || '', /R\$ 10,00/);
  assert.match(response.body || '', /10\/09\/2026/);
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
