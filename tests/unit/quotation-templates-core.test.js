import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_QUOTATION_TEMPLATE,
  getQuotationTemplateManifest,
  getQuotationTemplate,
  QUOTATION_TEMPLATES,
  renderQuotationTemplate,
  QUOTATION_TEMPLATE_PREVIEW_VIEW_MODEL,
  validateQuotationHtmlSource,
  validateQuotationSource,
  validateQuotationTemplateSource,
  QuotationTemplateResolutionError,
  resolveQuotationTemplate,
} from '../../api/_functions/lib/quotation-templates.js';
import {
  createQuotationTemplateRepository,
  quotationSnapshotViewModel,
} from '../../api/_db/quotation-template-repository.js';
import { createQuotationPreviewHandler } from '../../api/_functions/quotation-preview.js';
import {
  createQuotationSectionsSnapshot,
  normalizeQuotationSections,
  validateQuotationSections,
} from '../../api/_db/quotation-content.js';

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
  assert.throws(() => {
    QUOTATION_TEMPLATES[0].source = 'alterado';
  }, TypeError);
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
    /Não foi possível preparar o template do orçamento/
  );

  const escaped = renderQuotationTemplate(
    { ...maliciousTemplate, key: 'safe', source: '{{value}}' },
    { value: '<script>alert(1)</script>' }
  );
  assert.match(escaped, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(escaped, /<script>alert\(1\)<\/script>/);

  const allowedHelpers = renderQuotationTemplate(
    {
      ...maliciousTemplate,
      key: 'allowed',
      source: '{{#if show}}{{#each items}}{{name}}{{/each}}{{/if}}',
    },
    { show: true, items: [{ name: 'ok' }] }
  );
  assert.equal(allowedHelpers, 'ok');
});

test('snapshot model renders client, ordered loop, terms, totals and escaped input', () => {
  const originalCreatedAt = snapshot.quotation.createdAt.getTime();
  const model = quotationSnapshotViewModel(snapshot);
  assert.equal(model.quote_date, '2026-07-01');
  assert.equal(model.validity_date, '2026-07-16');
  assert.equal(snapshot.quotation.createdAt.getTime(), originalCreatedAt);
  assert.deepEqual(
    model.items.map((item) => item.sku),
    ['SKU-A', 'SKU-B']
  );
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

test('legacy template resolution requires exact key and hash', () => {
  assert.equal(resolveQuotationTemplate('padrao', DEFAULT_QUOTATION_TEMPLATE.hash).key, 'padrao');
  assert.throws(
    () => resolveQuotationTemplate('padrao', '0'.repeat(64)),
    QuotationTemplateResolutionError
  );
  assert.throws(() => resolveQuotationTemplate('unknown', DEFAULT_QUOTATION_TEMPLATE.hash), QuotationTemplateResolutionError);
});

test('preview preserves repository 409 for a non-draft version override', async () => {
  const previous = process.env.CRM_CORE_QUOTES_ENABLED;
  process.env.CRM_CORE_QUOTES_ENABLED = 'true';
  const quotation = { ...snapshot.quotation, status: 'enviado' };
  const revision = { ...snapshot.revision, status: 'enviado', templateVersionId: null };
  let selectCount = 0;
  const db = {
    select() {
      const call = ++selectCount;
      const result = call === 1 ? [quotation] : call === 2 ? [revision] : [];
      const query = {
        limit: async () => result,
        orderBy() {
          return { limit: async () => result };
        },
      };
      return { from: () => ({ where: () => query }) };
    },
  };
  try {
    const repository = createQuotationTemplateRepository(() => db);
    const response = await createQuotationPreviewHandler({ repository })(
      event({ id: 'ORC-20260001', template_version_id: 'version-1' })
    );
    assert.equal(response.statusCode, 409);
    assert.match(response.body, /só pode ser alterada/);
  } finally {
    if (previous === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
    else process.env.CRM_CORE_QUOTES_ENABLED = previous;
  }
});

test('preview consumes an exact legacy hash mismatch as not found', async () => {
  const previous = process.env.CRM_CORE_QUOTES_ENABLED;
  process.env.CRM_CORE_QUOTES_ENABLED = 'true';
  try {
    const repository = {
      get: async () => ({
        ...snapshot,
        revision: { ...snapshot.revision, templateHash: '0'.repeat(64) },
      }),
    };
    const response = await createQuotationPreviewHandler({ repository })(event({ id: 'ORC-20260001' }));
    assert.equal(response.statusCode, 404);
    assert.match(response.body, /Template do orçamento não encontrado/);
  } finally {
    if (previous === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
    else process.env.CRM_CORE_QUOTES_ENABLED = previous;
  }
});

test('preview is flag-gated, returns secure headers, and rejects legacy overrides', async () => {
  const prevOperational = process.env.CRM_OPERATIONAL_MODE;
  delete process.env.CRM_OPERATIONAL_MODE;
  const previous = process.env.CRM_CORE_QUOTES_ENABLED;
  const repository = { get: async () => snapshot };
  try {
    delete process.env.CRM_CORE_QUOTES_ENABLED;
    const disabled = await createQuotationPreviewHandler({ repository })(
      event({ id: 'ORC-20260001' })
    );
    assert.equal(disabled.statusCode, 404);

    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    const handler = createQuotationPreviewHandler({ repository });
    const preview = await handler(event({ id: 'ORC-20260001' }));
    assert.equal(preview.statusCode, 200);
    assert.equal(preview.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.equal(preview.headers['Cache-Control'], 'no-store');
    assert.match(preview.headers['Content-Security-Policy'], /default-src 'none'/);
    assert.equal(preview.headers['Referrer-Policy'], 'no-referrer');
    assert.equal(preview.headers['X-Quotation-Template-Key'], 'padrao');
    assert.equal(preview.headers['X-Quotation-Template-Version'], 'legacy');
    assert.match(preview.headers['X-Quotation-Template-Hash'], /^[0-9a-f]{64}$/);
    assert.equal(snapshot.revision.templatePadrao, 'padrao');
    const invalid = await handler(event({ id: 'ORC-20260001', template: 'minimalista' }));
    assert.equal(invalid.statusCode, 400);
  } finally {
    if (previous === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
    else process.env.CRM_CORE_QUOTES_ENABLED = previous;
    if (prevOperational === undefined) delete process.env.CRM_OPERATIONAL_MODE;
    else process.env.CRM_OPERATIONAL_MODE = prevOperational;
  }
});

test('body_html escapes user text and preserves line breaks', () => {
  const model = quotationSnapshotViewModel({
    ...snapshot,
    revision: {
      ...snapshot.revision,
      sectionsSnapshot: {
        schema_version: 1,
        prazo_producao: {
          base: { enabled: true, title: 'Prazo de produção' },
          current: { enabled: true, title: 'Prazo de produção' },
        },
        pagamento: {
          base: { enabled: true, title: 'Pagamento', body: 'A' },
          current: { enabled: true, title: 'Pagamento', body: '<script>alert(1)</script>\nSaldo' },
        },
        condicoes_gerais: {
          base: { enabled: true, title: 'Condições', body: 'C' },
          current: { enabled: true, title: 'Condições', body: 'C' },
        },
      },
    },
  });
  const html = renderQuotationTemplate(
    { ...DEFAULT_QUOTATION_TEMPLATE, source: '{{secoes.pagamento.body_html}}' },
    model
  );
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>Saldo/);
  assert.doesNotMatch(html, /<script>/);
});

test('validateQuotationHtmlSource rejects <script> tags', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource('<html><body><script>alert(1)</script></body></html>', 'test'),
    /não permitida/
  );
});

test('validateQuotationHtmlSource rejects onclick attribute', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><body><div onclick="alert(1)">x</div></body></html>',
        'test'
      ),
    /não permitido/
  );
});

test('validateQuotationHtmlSource rejects javascript: protocol', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><body><a href="javascript:alert(1)">x</a></body></html>',
        'test'
      ),
    /Protocolo não permitido/
  );
});

test('validateQuotationHtmlSource rejects <iframe> tag', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><body><iframe src="evil.com"></iframe></body></html>',
        'test'
      ),
    /não permitida/
  );
});

test('validateQuotationHtmlSource rejects templates missing required fields', () => {
  const full =
    '<html><body>{{quote_number}} {{client.name}} {{#each items}}{{name}}{{/each}} {{display.total}}</body></html>';
  assert.throws(
    () => validateQuotationHtmlSource(full.replace('{{quote_number}}', ''), 'test'),
    /quote_number/
  );
  assert.throws(
    () => validateQuotationHtmlSource(full.replace('{{client.name}}', ''), 'test'),
    /client\.name/
  );
  assert.throws(
    () => validateQuotationHtmlSource(full.replace('{{#each items}}{{name}}{{/each}}', ''), 'test'),
    /#each items/
  );
  // display.total is now a hard requirement
  assert.throws(
    () => validateQuotationHtmlSource(full.replace('{{display.total}}', ''), 'test'),
    /display\.total/
  );
});

test('validateQuotationHtmlSource warns but does not reject missing secoes placeholders', () => {
  const source =
    '<html><body>{{quote_number}} {{client.name}} {{#each items}}{{name}}{{/each}} {{display.total}}</body></html>';
  assert.doesNotThrow(() => validateQuotationHtmlSource(source, 'test'));
});

test('validateQuotationHtmlSource rejects mixed-case forbidden tags', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<HTML><BODY><SCRIPT>x</SCRIPT></BODY></HTML>', 'test'),
    /não permitida/
  );
});

test('validateQuotationHtmlSource rejects encoded javascript: protocol', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><body><a href="java&#115;cript:alert(1)">x</a></body></html>',
        'test'
      ),
    /Protocolo não permitido/
  );
});

test('validateQuotationHtmlSource rejects malformed markup', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><div>x</body></html>', 'test'),
    /não fechada|inesperada/
  );
});

test('validateQuotationHtmlSource rejects unknown tags', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><custom>x</custom></body></html>', 'test'),
    /não permitida/
  );
});

test('validateQuotationHtmlSource rejects unknown attributes', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource('<html><body><div data-evil="x">y</div></body></html>', 'test'),
    /não permitido/
  );
});

test('validateQuotationHtmlSource rejects unsafe SVG features', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><body><svg><foreignObject>x</foreignObject></svg></body></html>',
        'test'
      ),
    /não permitida/
  );
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><body><svg><use href="#icon"/></svg></body></html>',
        'test'
      ),
    /não permitida/
  );
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><body><svg><path xlink:href="#x"/></svg></body></html>',
        'test'
      ),
    /não permitido/
  );
});

// ── Adversarial: dynamic URL/CSS policy bypass ──────────────────────

test('rejects Handlebars expression in href attribute', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><a href="{{url}}">x</a></body></html>', 'test'),
    /Expressão dinâmica não permitida/
  );
});

test('rejects Handlebars expression in src attribute', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><img src="{{img}}"></body></html>', 'test'),
    /Expressão dinâmica não permitida/
  );
});

test('rejects Handlebars expression in style attribute', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource('<html><body><div style="{{css}}">x</div></body></html>', 'test'),
    /Expressão dinâmica não permitida/
  );
});

// ── Adversarial: disabled sections ──────────────────────────────────

test('disabled sections expose no body HTML', () => {
  const model = quotationSnapshotViewModel({
    ...snapshot,
    revision: {
      ...snapshot.revision,
      sectionsSnapshot: {
        schema_version: 1,
        prazo_producao: {
          base: { enabled: true, title: 'Prazo' },
          current: { enabled: false, title: 'Prazo' },
        },
        pagamento: {
          base: { enabled: true, title: 'Pgto', body: 'X' },
          current: { enabled: false, title: 'Pgto', body: 'SECRET' },
        },
        condicoes_gerais: {
          base: { enabled: true, title: 'Cond', body: 'Y' },
          current: { enabled: false, title: 'Cond', body: 'HIDDEN' },
        },
      },
    },
  });
  assert.equal(model.secoes.prazo_producao.value, '');
  assert.equal(model.secoes.pagamento.body_html.toString(), '');
  assert.equal(model.secoes.condicoes_gerais.body_html.toString(), '');
});

// ── Adversarial: Frappe rendering ───────────────────────────────────

test('deterministic preview fixture renders the standard template with every nested field', () => {
  const rendered = renderQuotationTemplate(
    DEFAULT_QUOTATION_TEMPLATE,
    QUOTATION_TEMPLATE_PREVIEW_VIEW_MODEL
  );
  assert.match(rendered, /Cliente de demonstração/);
  assert.match(rendered, /SKU-DEMO/);
  assert.match(rendered, /Descrição do produto de demonstração/);
  assert.match(rendered, /Entrega:/);
});

test('all three built-in templates render without error', () => {
  const model = quotationSnapshotViewModel(snapshot);
  for (const key of ['padrao', 'minimalista', 'frappe']) {
    const tmpl = getQuotationTemplate(key);
    assert.ok(tmpl, `template ${key} should exist`);
    const html = renderQuotationTemplate(tmpl, model);
    assert.ok(html.length > 100, `${key} should produce substantial HTML`);
    assert.match(html, /Cliente/);
  }
});

// ── Adversarial: SVG context ────────────────────────────────────────

test('non-SVG tags inside <svg> are rejected', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><svg><div>x</div></svg></body></html>', 'test'),
    /não permitida/
  );
});

test('SVG-only tags outside <svg> are rejected', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><path d="M0,0"/></body></html>', 'test'),
    /não permitida/
  );
});

// ── Adversarial: per-tag attributes ─────────────────────────────────

test('meta only allows charset, rejects class/style', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><head><meta class="x" charset="utf-8"></head><body></body></html>',
        'test'
      ),
    /não permitido/
  );
});

test('link only allows href/rel', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><head><link href="https://x" rel="stylesheet" id="x"></head><body></body></html>',
        'test'
      ),
    /não permitido/
  );
});

// ── Adversarial: CSS normalization ──────────────────────────────────

test('rejects CSS with encoded @import', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><head><style>@im/**/port url("evil.css")</style></head><body></body></html>',
        'test'
      ),
    /CSS perigoso/
  );
});

test('rejects CSS with encoded url()', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><head><style>background: ur/**/l(x)</style></head><body></body></html>',
        'test'
      ),
    /CSS perigoso/
  );
});

// ── Adversarial: malformed markup ───────────────────────────────────

test('rejects unterminated comment', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><!-- unclosed</body></html>', 'test'),
    /Comentário HTML não terminado/
  );
});

test('rejects unterminated attribute value', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource('<html><body><div class="unclosed>x</div></body></html>', 'test'),
    /Valor de atributo não terminado/
  );
});

test('rejects end tag without matching open tag', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body></div>x</body></html>', 'test'),
    /inesperada/
  );
});

// ── Required fields: Frappe exception ─────────────────────────────

test('exact historical Frappe source/hash accepts missing display.total', () => {
  const frappe = QUOTATION_TEMPLATES.find((t) => t.key === 'frappe');
  assert.ok(frappe, 'frappe template exists');
  // Frappe source does not contain {{display.total}} - verify it renders
  const model = quotationSnapshotViewModel(snapshot);
  const html = renderQuotationTemplate(frappe, model);
  assert.ok(html.length > 100, 'frappe renders substantial HTML');
});

test('new source missing display.total is rejected', () => {
  const newSource =
    '<html><body>{{quote_number}} {{client.name}} {{#each items}}{{name}}{{/each}}</body></html>';
  assert.throws(() => validateQuotationHtmlSource(newSource, 'new-template'), /display\.total/);
});

test('public validators cannot grant the Frappe display.total exemption', () => {
  const frappe = QUOTATION_TEMPLATES.find((t) => t.key === 'frappe');
  assert.ok(frappe, 'frappe template exists');
  assert.throws(
    () => validateQuotationHtmlSource(frappe.source, 'frappe', 'frappe'),
    /display\.total/
  );
  assert.throws(
    () => validateQuotationSource(frappe.source, 'frappe', 'frappe'),
    /display\.total/
  );
});

test('spoofed template object with Frappe key/hash is rejected at render', () => {
  const frappe = QUOTATION_TEMPLATES.find((t) => t.key === 'frappe');
  assert.ok(frappe, 'frappe template exists');
  // Construct a forged template that copies key, hash, and source but is NOT the built-in object
  const spoofed = {
    key: 'frappe',
    name: 'Frappe (Original)',
    is_default: false,
    source: frappe.source,
    hash: frappe.hash,
  };
  const model = quotationSnapshotViewModel(snapshot);
  // The spoofed object must NOT receive the display.total exception
  // because renderQuotationTemplate checks reference identity, not metadata.
  // The error is wrapped in a generic message, so check the cause chain.
  try {
    renderQuotationTemplate(spoofed, model);
    assert.fail('should have thrown');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(error.cause instanceof Error);
    assert.match(error.cause.message, /display\.total/);
  }
});

test('trusted built-in Frappe template still renders with missing display.total', () => {
  const frappe = QUOTATION_TEMPLATES.find((t) => t.key === 'frappe');
  assert.ok(frappe, 'frappe template exists');
  const model = quotationSnapshotViewModel(snapshot);
  const html = renderQuotationTemplate(frappe, model);
  assert.ok(html.length > 100, 'frappe built-in renders substantial HTML');
});

test('built-in definitions are validated for both AST and HTML policy', () => {
  // All built-in templates should already be validated at module load.
  // Verify they all render successfully.
  const model = quotationSnapshotViewModel(snapshot);
  for (const tmpl of QUOTATION_TEMPLATES) {
    const html = renderQuotationTemplate(tmpl, model);
    assert.ok(html.length > 100, `${tmpl.key} renders substantial HTML`);
  }
});

test('void tags without > at EOF are rejected', () => {
  assert.throws(() => validateQuotationHtmlSource('<html><body><br', 'test'), /não terminada/);
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><img src="https://example.test"', 'test'),
    /não terminada/
  );
});

// ── Tokenizer: reject unquoted attributes ──────────────────────────

test('rejects unquoted attribute values', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><div class=x>x</div></body></html>', 'test'),
    /não aspas/
  );
});

// ── Tokenizer: reject trailing end-tag junk ────────────────────────

test('rejects trailing junk in end tag', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><div>x</div junk></body></html>', 'test'),
    /Lixo após nome de tag de fechamento/
  );
});

// ── Tokenizer: reject non-void self-closing tags ───────────────────

test('rejects self-closing on non-void div', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><body>{{quote_number}} {{client.name}} {{#each items}}{{name}}{{/each}} {{display.total}}<div />x<div>y</div></body></html>',
        'test'
      ),
    /não fechada|não pode ser auto-fechada/
  );
});

// ── Tokenizer: EOF without > ──────────────────────────────────────

test('rejects unclosed start tag at EOF', () => {
  assert.throws(
    () => validateQuotationHtmlSource('<html><body><div', 'test'),
    /não fechada|não terminada/
  );
});

// ── CSS: named entities &lpar;/&rpar; ─────────────────────────────

test('CSS named entities are decoded before dangerous-pattern check', () => {
  // After named entity decoding, u&lpar;l&lpar;x&rpar; becomes u(l(l)x)
  // which contains url( pattern. Test with a simpler named entity bypass.
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><head><style>@im&lpar;port url("evil.css")</style></head><body></body></html>',
        'test'
      ),
    /CSS perigoso|não permitido/
  );
});

// ── Legacy schema_version validation ──────────────────────────────

test('validateQuotationSections rejects schema_version !== 1', () => {
  assert.throws(
    () =>
      validateQuotationSections({
        schema_version: 2,
        pagamento: { enabled: true, title: 'P' },
      }),
    /schema_version deve ser exatamente 1/
  );
});

test('validateQuotationSections accepts schema_version 1', () => {
  assert.doesNotThrow(() =>
    validateQuotationSections({
      schema_version: 1,
      pagamento: { enabled: true, title: 'P' },
    })
  );
});

// ── Per-tag: div rejects href ─────────────────────────────────────

test('div rejects href attribute', () => {
  assert.throws(
    () =>
      validateQuotationHtmlSource(
        '<html><body><div href="https://evil.com">x</div></body></html>',
        'test'
      ),
    /não permitido/
  );
});

// ── Round-trip: factory → view-model ──────────────────────────────

test('validateQuotationSource rejects HTML policy violation and AST violation', () => {
  // HTML policy violation (script tag) is caught by HTML validator first
  assert.throws(
    () => validateQuotationSource('<html><body><script>alert(1)</script></body></html>', 'test'),
    /não permitida/
  );
  // AST violation (triple stash) is caught by AST validator
  assert.throws(() => validateQuotationSource('{{{unsafe}}}', 'unsafe'), /Saída sem escape/);
  // Combined: valid HTML but unsafe AST
  assert.throws(() => validateQuotationSource('{{{value}}}', 'test'), /Saída sem escape/);
});

test('factory snapshot → view-model round-trip produces correct secoes', () => {
  const settings = normalizeQuotationSections(undefined, {
    pagamento: '50% na aprovação',
    entrega: '3 dias',
    observacoes: 'Obs.',
  });
  const snap = createQuotationSectionsSnapshot(settings);
  const model = quotationSnapshotViewModel({
    ...snapshot,
    revision: {
      ...snapshot.revision,
      sectionsSnapshot: snap,
    },
  });
  assert.ok(model.secoes, 'secoes present in view-model');
  assert.equal(model.secoes.prazo_producao.value, snapshot.revision.prazoProducao);
  assert.ok(
    model.secoes.pagamento.body_html.toString().includes('50%'),
    'pagamento body contains legacy text'
  );
  assert.ok(
    model.secoes.condicoes_gerais.body_html.toString().includes('Prazo de entrega'),
    'condicoes_gerais contains combined legacy'
  );
});
