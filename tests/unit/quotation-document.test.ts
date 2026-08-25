import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { createQuotationPreviewHandler } from '../../api/_modules/quotation-preview.js';
import {
  renderQuotationDocument,
  type QuotationDocumentRenderer,
} from '../../api/_modules/quotation-document.js';
import { quotationTemplateFromVersion } from '../../api/_modules/quotation-template-catalog.js';

const source =
  '<!doctype html><html><head><title>Documento</title></head><body>{{quote_number}} {{client.name}} {{#each items}}{{name}}{{/each}} {{display.total}}<h1>{{secoes.pagamento.title}}</h1><div>{{secoes.pagamento.body_html}}</div><h2>{{terms.pagamento}}</h2><h3>{{secoes.condicoes_gerais.title}}</h3><div>{{secoes.condicoes_gerais.body_html}}</div></body></html>';
const sourceHash = createHash('sha256').update(source, 'utf8').digest('hex');
const template = quotationTemplateFromVersion({
  source,
  sourceHash,
  template: { key: 'historico', name: 'Histórico' },
});

const snapshot = {
  quotation: {
    id: '11111111-1111-4111-8111-111111111111',
    businessNumber: 'ORC-20260001',
    clientId: '22222222-2222-4222-8222-222222222222',
    status: 'rascunho',
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    updatedAt: new Date('2026-07-01T12:00:00.000Z'),
  },
  revision: {
    id: '33333333-3333-4333-8333-333333333333',
    quotationId: '11111111-1111-4111-8111-111111111111',
    version: 1,
    status: 'rascunho',
    validadeDias: 15,
    pagamento: 'legacy payment must be hidden',
    entrega: 'legacy delivery must be hidden',
    fretePadrao: '0.00',
    frete: '0.00',
    observacoes: 'legacy observation must be hidden',
    prazoProducao: '5 dias',
    templatePadrao: 'historico',
    templateHash: sourceHash,
    templateVersionId: '44444444-4444-4444-8444-444444444444',
    sectionsSnapshot: {
      schema_version: 1,
      prazo_producao: {
        base: { enabled: true, title: 'Prazo' },
        current: { enabled: true, title: 'Prazo' },
      },
      pagamento: {
        base: { enabled: true, title: 'Pagamento', body: 'Base' },
        current: {
          enabled: true,
          title: 'Pagamento customizado',
          body: '<script>alert(1)</script>\nSaldo',
        },
      },
      condicoes_gerais: {
        base: { enabled: true, title: 'Condições', body: 'Base' },
        current: { enabled: false, title: 'Não mostrar', body: 'segredo' },
      },
    },
    clienteNome: 'Cliente Documento',
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
  },
  templateVersion: {
    id: '44444444-4444-4444-8444-444444444444',
    version: 1,
    source,
    sourceHash,
    template: { key: 'historico', name: 'Histórico', archived: false },
  },
  sectionsSnapshot: null,
  items: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      revisionId: '33333333-3333-4333-8333-333333333333',
      position: 0,
      productSku: 'SKU-1',
      produtoSku: 'SKU-1',
      produtoNome: 'Produto',
      produtoDescricao: '',
      produtoUnidade: 'Und',
      produtoCategoria: null,
      produtoMarca: null,
      precoFonte: 'base',
      precoMinimoFaixa: null,
      precoSugerido: '10.00',
      precoAplicado: '10.00',
      diferencaPreco: '0.00',
      quantidade: '1.000',
      totalLinha: '10.00',
      manualRate: false,
    },
  ],
} as any;

test('canonical document seam formats, escapes and hides disabled section data', () => {
  const document = renderQuotationDocument(snapshot, template);

  assert.match(document.html, /Pagamento customizado/);
  assert.match(document.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>Saldo/);
  assert.doesNotMatch(document.html, /Não mostrar|segredo|legacy payment|legacy delivery/);
  assert.equal(document.viewModel.secoes.condicoes_gerais.title, '');
  assert.equal(document.viewModel.secoes.condicoes_gerais.body_html.toString(), '');
  assert.equal(document.viewModel.terms.pagamento, '<script>alert(1)</script>\nSaldo');
});

test('persisted preview routes through the canonical document seam', async () => {
  let calls = 0;
  const renderDocument: QuotationDocumentRenderer = (value, exactTemplate) => {
    calls += 1;
    return renderQuotationDocument(value, exactTemplate);
  };
  const response = await createQuotationPreviewHandler({
    repository: { get: async () => snapshot },
    renderDocument,
  }).call(null, {
    httpMethod: 'GET',
    queryStringParameters: { id: snapshot.quotation.businessNumber },
  } as any);

  assert.equal(response.statusCode, 200);
  assert.equal(calls, 1);
  assert.match(response.body || '', /Pagamento customizado/);
});
