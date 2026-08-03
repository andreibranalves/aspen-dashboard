import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_QUOTATION_TEMPLATE,
  getQuotationTemplateManifest,
  getQuotationTemplate,
  QUOTATION_TEMPLATES,
  renderQuotationTemplate,
  validateQuotationTemplateSource,
} from '../../api/_functions/lib/quotation-templates.js';
import { quotationSnapshotViewModel } from '../../api/_db/quotation-template-repository.js';
import { createQuotationPreviewHandler } from '../../api/_functions/quotation-preview.js';

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
    version: 2,
    status: 'rascunho',
    validadeDias: 15,
    pagamento: 'À vista',
    entrega: '10 dias',
    fretePadrao: '0.00',
    frete: '12.50',
    observacoes: '<script>alert(1)</script>',
    prazoProducao: '5 dias',
    templatePadrao: 'padrao',
    templateHash: DEFAULT_QUOTATION_TEMPLATE.hash,
    clienteNome: '<b>Cliente</b>',
    clienteDocumento: '12345678000195',
    clienteEmail: 'cliente@example.com',
    clienteTelefone: '5511999999999',
    clienteEndereco: 'Rua A',
    clienteNumero: '10',
    clienteBairro: 'Centro',
    clienteComplemento: null,
    clienteMunicipio: 'São Paulo',
    clienteUf: 'SP',
    clienteCep: '01001000',
    clienteNotas: null,
    subtotal: '110.00',
    total: '122.50',
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
  },
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      revisionId: '33333333-3333-4333-8333-333333333333',
      position: 1,
      productSku: 'SKU-B',
      quantidade: '2.000',
      produtoSku: 'SKU-B',
      produtoNome: 'Segundo',
      produtoDescricao: '',
      produtoUnidade: 'Cx',
      produtoCategoria: null,
      produtoMarca: null,
      precoFonte: 'base',
      precoMinimoFaixa: null,
      precoSugerido: '50.00',
      precoAplicado: '50.00',
      diferencaPreco: '0.00',
      totalLinha: '100.00',
      manualRate: false,
    },
    {
      id: '55555555-5555-4555-8555-555555555555',
      revisionId: '33333333-3333-4333-8333-333333333333',
      position: 0,
      productSku: 'SKU-A',
      quantidade: '1.000',
      produtoSku: 'SKU-A',
      produtoNome: 'Primeiro',
      produtoDescricao: '',
      produtoUnidade: 'Und',
      produtoCategoria: null,
      produtoMarca: null,
      precoFonte: 'base',
      precoMinimoFaixa: null,
      precoSugerido: '10.00',
      precoAplicado: '10.00',
      diferencaPreco: '0.00',
      totalLinha: '10.00',
      manualRate: false,
    },
  ],
};

function event(query = {}) {
  return { httpMethod: 'GET', headers: {}, queryStringParameters: query, body: '' };
}

test('manifest has one default and server-computed hashes without source', () => {
  const manifest = getQuotationTemplateManifest();
  assert.equal(manifest.length >= 2, true);
  assert.equal(manifest.filter((template) => template.is_default).length, 1);
  assert.equal(new Set(manifest.map((template) => template.key)).size, manifest.length);
  for (const template of manifest) {
    assert.match(template.hash, /^[0-9a-f]{64}$/);
    assert.equal('source' in template, false);
  }
});

test('exported template entries are immutable and manifest metadata is detached', () => {
  assert.equal(Object.isFrozen(QUOTATION_TEMPLATES), true);
  assert.equal(Object.isFrozen(QUOTATION_TEMPLATES[0]), true);
  const source = QUOTATION_TEMPLATES[0].source;
  const hash = QUOTATION_TEMPLATES[0].hash;
  assert.throws(() => { QUOTATION_TEMPLATES[0].source = 'alterado'; }, TypeError);
  assert.equal(QUOTATION_TEMPLATES[0].source, source);
  assert.equal(QUOTATION_TEMPLATES[0].hash, hash);
  const metadata = getQuotationTemplateManifest();
  metadata[0].name = 'alterado';
  assert.notEqual(QUOTATION_TEMPLATES[0].name, 'alterado');
});

test('AST validation rejects unescaped output and every helper surface outside if/each', () => {
  const rejectedSources = [
    '{{{value}}}',
    '{{{ value }}}',
    '{{&value}}',
    '{{ & value}}',
    '{{~&value}}',
    '{{if (lookup obj key)}}',
    '{{#if (unknown value)}}ok{{/if}}',
    '{{log value}}',
    '{{lookup obj key}}',
    '{{helperMissing value}}',
    '{{blockHelperMissing value}}',
    '{{unknown value}}',
    '{{#with value}}ok{{/with}}',
    '{{#unless value}}ok{{/unless}}',
    '{{#unknown value}}ok{{/unknown}}',
    '{{> quote}}',
    '{{#*inline "quote"}}ok{{/inline}}',
  ];

  for (const source of rejectedSources) {
    assert.throws(() => validateQuotationTemplateSource(source, 'unsafe'), source);
  }

  const maliciousTemplate = {
    key: 'unsafe',
    name: 'Unsafe',
    is_default: false,
    source: '{{~&value}}',
    hash: '0'.repeat(64),
  };
  assert.throws(
    () => renderQuotationTemplate(maliciousTemplate, { value: '<script>alert(1)</script>' }),
    /Não foi possível preparar o template do orçamento/,
  );

  const escaped = renderQuotationTemplate(
    { ...maliciousTemplate, key: 'safe', source: '{{value}}' },
    { value: '<script>alert(1)</script>' },
  );
  assert.match(escaped, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(escaped, /<script>alert\(1\)<\/script>/);

  const allowedHelpers = renderQuotationTemplate(
    { ...maliciousTemplate, key: 'allowed', source: '{{#if show}}{{#each items}}{{name}}{{/each}}{{/if}}' },
    { show: true, items: [{ name: 'ok' }] },
  );
  assert.equal(allowedHelpers, 'ok');
});

test('snapshot model renders client, ordered loop, terms, totals and escaped input', () => {
  const originalCreatedAt = snapshot.quotation.createdAt.getTime();
  const model = quotationSnapshotViewModel(snapshot);
  assert.equal(model.quote_date, '2026-07-01');
  assert.equal(model.validity_date, '2026-07-16');
  assert.equal(snapshot.quotation.createdAt.getTime(), originalCreatedAt);
  assert.deepEqual(model.items.map((item) => item.sku), ['SKU-A', 'SKU-B']);
  const standard = renderQuotationTemplate(DEFAULT_QUOTATION_TEMPLATE, model);
  const alternate = renderQuotationTemplate(getQuotationTemplate('minimalista'), model);
  assert.ok(standard.indexOf('Primeiro') < standard.indexOf('Segundo'));
  assert.match(standard, /À vista/);
  assert.match(standard, /R\$ 110,00/);
  assert.match(standard, /R\$ 12,50/);
  assert.match(standard, /R\$ 122,50/);
  assert.match(standard, /&lt;b&gt;Cliente&lt;\/b&gt;/);
  assert.match(standard, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.notEqual(standard, alternate);
});

test('preview is flag-gated, returns HTML headers, and alternate selection does not mutate snapshot', async () => {
  const prevOperational = process.env.CRM_OPERATIONAL_MODE;
  delete process.env.CRM_OPERATIONAL_MODE;
  const previous = process.env.CRM_CORE_QUOTES_ENABLED;
  const repository = { get: async () => snapshot };
  try {
    delete process.env.CRM_CORE_QUOTES_ENABLED;
    const disabled = await createQuotationPreviewHandler({ repository })(event({ id: 'ORC-20260001' }));
    assert.equal(disabled.statusCode, 404);

    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    const handler = createQuotationPreviewHandler({ repository });
    const preview = await handler(event({ id: 'ORC-20260001', template: 'minimalista' }));
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(preview.headers['Cache-Control'], 'no-store');
    assert.equal(preview.headers['X-Quotation-Template-Key'], 'minimalista');
    assert.match(preview.headers['X-Quotation-Template-Hash'], /^[0-9a-f]{64}$/);
    assert.equal(snapshot.revision.templatePadrao, 'padrao');
    const invalid = await handler(event({ id: 'ORC-20260001', template: 'unknown' }));
    assert.equal(invalid.statusCode, 400);
  } finally {
    if (previous === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
    else process.env.CRM_CORE_QUOTES_ENABLED = previous;
    if (prevOperational === undefined) delete process.env.CRM_OPERATIONAL_MODE;
    else process.env.CRM_OPERATIONAL_MODE = prevOperational;
  }
});
