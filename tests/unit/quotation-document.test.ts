import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { createQuotationPreviewHandler } from '../../api/_modules/quotation-preview.js';
import {
  renderQuotationDocument,
  type QuotationDocumentRenderer,
} from '../../api/_modules/quotation-document.js';
import {
  getQuotationTemplate,
  quotationTemplateFromVersion,
} from '../../api/_modules/quotation-template-catalog.js';

const source =
  '<!doctype html><html><head><title>Documento</title></head><body>{{quote_number}} {{client.name}} {{#each items}}{{name}}{{/each}} {{display.total}}<h1>{{secoes.prazo_producao.title}}</h1><div>{{secoes.prazo_producao.value}}</div><h2>{{secoes.pagamento.title}}</h2><div>{{secoes.pagamento.body_html}}</div><h3>{{secoes.condicoes_gerais.title}}</h3><div>{{secoes.condicoes_gerais.body_html}}</div><p>{{terms.pagamento}}|{{terms.entrega}}|{{terms.production_deadline}}|{{terms.observations}}</p></body></html>';
const sourceHash = createHash('sha256').update(source, 'utf8').digest('hex');
const template = quotationTemplateFromVersion({
  source,
  sourceHash,
  contractVersion: 2,
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
        base: { enabled: true, title: 'Prazo', value: '5 dias' },
        current: { enabled: true, title: 'Prazo', value: '5 dias' },
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
    contractVersion: 2,
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

test('canonical production deadline feeds section and legacy mirrors', () => {
  const canonicalSnapshot = {
    ...snapshot,
    revision: {
      ...snapshot.revision,
      sectionsSnapshot: {
        ...snapshot.revision.sectionsSnapshot,
        prazo_producao: {
          ...snapshot.revision.sectionsSnapshot.prazo_producao,
          current: {
            ...snapshot.revision.sectionsSnapshot.prazo_producao.current,
            value: '10 dias úteis',
          },
        },
      },
    },
  } as any;
  const document = renderQuotationDocument(canonicalSnapshot, template);

  assert.equal(document.viewModel.secoes.prazo_producao.value, '10 dias úteis');
  assert.equal(document.viewModel.terms.production_deadline, '10 dias úteis');
  assert.equal(document.viewModel.terms_snapshot.production_deadline, '10 dias úteis');
});

test('legacy production deadline controls section visibility without altering canonical snapshots', () => {
  for (const deadline of ['', '5 dias']) {
    const legacySnapshot = {
      ...snapshot,
      revision: {
        ...snapshot.revision,
        prazoProducao: deadline,
        sectionsSnapshot: null,
      },
      sectionsSnapshot: null,
    } as any;
    const document = renderQuotationDocument(legacySnapshot, template);
    const visible = Boolean(deadline);

    assert.equal(document.viewModel.secoes.prazo_producao.enabled, visible);
    assert.equal(document.viewModel.secoes.prazo_producao.title, visible ? 'Prazo de produção' : '');
    assert.equal(document.viewModel.secoes.prazo_producao.value, visible ? deadline : '');
    assert.equal(document.viewModel.terms.production_deadline, deadline);
  }

  const canonicalSnapshot = {
    ...snapshot,
    revision: { ...snapshot.revision, prazoProducao: '' },
  } as any;
  assert.equal(
    renderQuotationDocument(canonicalSnapshot, template).viewModel.secoes.prazo_producao.enabled,
    true,
  );
});

test('canonical seam resolves a historical built-in v1 by key and hash', () => {
  const builtIn = getQuotationTemplate('padrao');
  assert.ok(builtIn);
  const legacySnapshot = {
    ...snapshot,
    revision: {
      ...snapshot.revision,
      templatePadrao: builtIn.key,
      templateHash: builtIn.hash,
      templateVersionId: null,
    },
    templateVersion: null,
  } as any;

  const document = renderQuotationDocument(legacySnapshot);

  assert.equal(document.template, builtIn);
  assert.match(document.html, /ORC-20260001/);
});

type SectionVisibility = {
  prazo_producao: boolean;
  pagamento: boolean;
  condicoes_gerais: boolean;
};

function snapshotWithSectionVisibility(visibility: SectionVisibility) {
  const sections = snapshot.revision.sectionsSnapshot;
  return {
    ...snapshot,
    revision: {
      ...snapshot.revision,
      sectionsSnapshot: {
        ...sections,
        prazo_producao: {
          ...sections.prazo_producao,
          current: { ...sections.prazo_producao.current, enabled: visibility.prazo_producao },
        },
        pagamento: {
          ...sections.pagamento,
          current: { ...sections.pagamento.current, enabled: visibility.pagamento },
        },
        condicoes_gerais: {
          ...sections.condicoes_gerais,
          current: { ...sections.condicoes_gerais.current, enabled: visibility.condicoes_gerais },
        },
      },
    },
    sectionsSnapshot: null,
  } as any;
}

test('canonical seam redacts every disabled-section combination and preserves the snapshot', () => {
  const keys = ['prazo_producao', 'pagamento', 'condicoes_gerais'] as const;
  for (let mask = 0; mask < 2 ** keys.length; mask += 1) {
    const visibility = Object.fromEntries(
      keys.map((key, index) => [key, Boolean(mask & (1 << index))])
    ) as SectionVisibility;
    const document = renderQuotationDocument(snapshotWithSectionVisibility(visibility), template);
    const expected = [
      [visibility.prazo_producao, 'Prazo'],
      [visibility.prazo_producao, '5 dias'],
      [visibility.pagamento, 'Pagamento customizado'],
      [visibility.pagamento, '&lt;script&gt;alert(1)&lt;/script&gt;<br>Saldo'],
      [visibility.condicoes_gerais, 'Não mostrar'],
      [visibility.condicoes_gerais, 'segredo'],
      [visibility.condicoes_gerais, 'legacy delivery must be hidden'],
    ] as const;

    for (const [visible, value] of expected) {
      assert.equal(
        document.html.includes(value),
        visible,
        `combinação ${mask}: ${visible ? 'esperava' : 'não esperava'} ${value}`
      );
    }
    assert.doesNotMatch(document.html, /legacy payment must be hidden|legacy observation must be hidden/);
  }

  const hiddenSnapshot = snapshotWithSectionVisibility({
    prazo_producao: false,
    pagamento: false,
    condicoes_gerais: false,
  });
  renderQuotationDocument(hiddenSnapshot, template);
  const current = hiddenSnapshot.revision.sectionsSnapshot;
  assert.equal(current.prazo_producao.current.title, 'Prazo');
  assert.equal(current.pagamento.current.title, 'Pagamento customizado');
  assert.equal(current.pagamento.current.body, '<script>alert(1)</script>\nSaldo');
  assert.equal(current.condicoes_gerais.current.title, 'Não mostrar');
  assert.equal(current.condicoes_gerais.current.body, 'segredo');
  assert.equal(hiddenSnapshot.revision.pagamento, 'legacy payment must be hidden');
  assert.equal(hiddenSnapshot.revision.entrega, 'legacy delivery must be hidden');
  assert.equal(hiddenSnapshot.revision.observacoes, 'legacy observation must be hidden');
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
