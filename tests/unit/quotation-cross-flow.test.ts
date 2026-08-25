import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { createPublicQuotationHandler } from '../../api/_modules/public-quotation.js';
import { createQuotationPreviewHandler } from '../../api/_modules/quotation-preview.js';
import { createQuotationPdfHandler } from '../../api/_modules/pdf.js';
import { renderQuotationDocument } from '../../api/_modules/quotation-document.js';

const source = `<!doctype html><html><head><title>{{quote_number}}</title></head><body>
{{quote_number}}|{{client.name}}|{{display.total}}|{{#each items}}{{name}}{{/each}}
{{#if secoes.prazo_producao.enabled}}<section>{{secoes.prazo_producao.title}}:{{secoes.prazo_producao.value}}</section>{{/if}}
{{#if secoes.pagamento.enabled}}<section>{{secoes.pagamento.title}}:{{secoes.pagamento.body_html}}</section>{{/if}}
{{#if secoes.condicoes_gerais.enabled}}<section>{{secoes.condicoes_gerais.title}}:{{secoes.condicoes_gerais.body_html}}</section>{{/if}}
</body></html>`;
const sourceHash = createHash('sha256').update(source, 'utf8').digest('hex');
const revisionId = '33333333-3333-4333-8333-333333333333';
const token = 'T'.repeat(32);
const snapshot = {
  quotation: {
    id: '11111111-1111-4111-8111-111111111111',
    businessNumber: 'ORC-20260001',
    clientId: '22222222-2222-4222-8222-222222222222',
    status: 'emitido',
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    updatedAt: new Date('2026-07-01T12:00:00.000Z'),
  },
  revision: {
    id: revisionId,
    quotationId: '11111111-1111-4111-8111-111111111111',
    version: 4,
    status: 'emitido',
    validadeDias: 15,
    pagamento: 'legacy payment must not win',
    entrega: 'legacy delivery must not win',
    fretePadrao: '0.00',
    frete: '0.00',
    observacoes: 'legacy observation must not win',
    prazoProducao: '5 dias',
    templatePadrao: 'arquivado',
    templateHash: sourceHash,
    templateVersionId: '44444444-4444-4444-8444-444444444444',
    sectionsSnapshot: {
      schema_version: 1,
      prazo_producao: {
        base: { enabled: true, title: 'Prazo base' },
        current: { enabled: true, title: 'Prazo customizado' },
      },
      pagamento: {
        base: { enabled: true, title: 'Pagamento base', body: 'Base' },
        current: {
          enabled: true,
          title: 'Pagamento customizado',
          body: '<script>alert(1)</script>\nPix em 2x',
        },
      },
      condicoes_gerais: {
        base: { enabled: true, title: 'Condições base', body: 'Base' },
        current: {
          enabled: false,
          title: 'Não mostrar',
          body: 'conteúdo oculto',
        },
      },
    },
    clienteNome: 'Cliente Fluxo',
    clienteDocumento: null,
    clienteEmail: null,
    clienteTelefone: null,
    clienteEndereco: null,
    clienteNumero: null,
    clienteBairro: null,
    clienteComplemento: null,
    clienteMunicipio: null,
    clienteUf: null,
    clienteCep: null,
    clienteNotas: null,
    subtotal: '10.00',
    total: '10.00',
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    issuedAt: new Date('2026-07-01T12:00:00.000Z'),
  },
  templateVersion: {
    id: '44444444-4444-4444-8444-444444444444',
    version: 7,
    source,
    sourceHash,
    contractVersion: 2,
    template: { key: 'arquivado', name: 'Template arquivado', archived: true },
  },
  sectionsSnapshot: null,
  items: [],
} as any;

function pdfRender(html: string): Promise<Buffer> {
  return Promise.resolve(Buffer.from(`%PDF-1.7\n${html}\n%%EOF`));
}

function event(httpMethod: string, queryStringParameters: Record<string, string> = {}, body = '') {
  return { httpMethod, headers: {}, queryStringParameters, body } as any;
}

function createStore() {
  const values = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return (values.get(key) as T | undefined) || null;
    },
    async set(key: string, value: unknown) {
      values.set(key, value);
      return 'OK';
    },
    async del(key: string) {
      values.delete(key);
      return 1;
    },
  };
}

test('preview, public page and PDF render the same immutable revision document', async () => {
  const repository = { get: async (id: string) => (id === revisionId ? snapshot : null) };
  let renderCalls = 0;
  const renderDocument = (value: typeof snapshot) => {
    renderCalls += 1;
    return renderQuotationDocument(value);
  };
  const preview = createQuotationPreviewHandler({
    repository: repository as any,
    renderDocument,
    renderPdf: pdfRender,
  });
  const previewResponse = await preview(event('GET', { id: revisionId, format: 'html' }));

  const store = createStore();
  const publicPage = createPublicQuotationHandler({
    repository: repository as any,
    store,
    token: () => token,
    now: () => Date.parse('2026-07-02T12:00:00.000Z'),
    renderDocument,
    renderPdf: pdfRender,
  });
  const issueResponse = await publicPage(event('POST', {}, JSON.stringify({ revisionId })));
  assert.equal(issueResponse.statusCode, 201);
  const publicResponse = await publicPage(event('GET', { token }));

  const pdfResponse = await createQuotationPdfHandler({
    repository: repository as any,
    renderDocument,
    renderPdf: pdfRender,
  })(event('GET', { q: revisionId }));

  assert.equal(previewResponse.statusCode, 200);
  assert.equal(publicResponse.statusCode, 200);
  assert.equal(pdfResponse.statusCode, 200);
  assert.equal(renderCalls, 3);
  assert.equal(previewResponse.body, publicResponse.body);
  const pdfBody = Buffer.from(pdfResponse.body || '', 'base64').toString();
  assert.equal(
    pdfBody.slice('%PDF-1.7\n'.length, -'\n%%EOF'.length),
    previewResponse.body
  );
  assert.equal(publicResponse.headers?.['X-Document-Revision'], revisionId);
  assert.equal(previewResponse.headers?.['X-Quotation-Template-Version'], '7');
  assert.match(previewResponse.body || '', /Prazo customizado:5 dias/);
  assert.match(
    previewResponse.body || '',
    /Pagamento customizado:&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>Pix em 2x/
  );
  assert.doesNotMatch(
    previewResponse.body || '',
    /Não mostrar|conteúdo oculto|legacy payment|legacy delivery/
  );
});
