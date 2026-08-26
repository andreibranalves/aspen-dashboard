import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toSafeMultilineHtml } from '../../api/_modules/quotation-content.js';
import {
  HISTORICAL_QUOTATION_TEMPLATES,
  QUOTATION_TEMPLATES,
  QUOTATION_TEMPLATE_PREVIEW_VIEW_MODEL,
  renderQuotationTemplate,
  quotationTemplateFromVersion,
  resolveQuotationTemplate,
} from '../../api/_modules/quotation-template-catalog.js';
import {
  assertQuotationCompanyBackfill,
  DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
  normalizeCompleteQuotationCompanyConfiguration,
  normalizeQuotationCompanyConfiguration,
  verifyQuotationCompanyBackfill,
} from '../../api/_modules/quotation-company.js';

const company = normalizeQuotationCompanyConfiguration({
  schema_version: 1,
  identity: { legal_name: 'Empresa Nova LTDA', document: '12.345.678/0001-95' },
  banking: {
    bank_name: 'Banco Novo',
    bank_code: '999',
    branch: '1234',
    account: '5678-9',
    pix_key: 'pix@empresa.example',
  },
  contacts: {
    website: 'https://empresa.example',
    phone: '(11) 98888-7777',
    email: 'contato@empresa.example',
    instagram: 'https://instagram.com/empresa',
  },
});

function model(visibility = { prazo: true, pagamento: true, condicoes: true }) {
  return {
    ...QUOTATION_TEMPLATE_PREVIEW_VIEW_MODEL,
    company,
    secoes: {
      prazo_producao: {
        enabled: visibility.prazo,
        title: 'Prazo customizado',
        value: 'Entrega em 20 dias',
        value_html: toSafeMultilineHtml('Entrega em 20 dias'),
      },
      pagamento: {
        enabled: visibility.pagamento,
        title: 'Pagamento customizado',
        body_html: toSafeMultilineHtml('<script>alert(1)</script>\nPix em duas parcelas'),
      },
      condicoes_gerais: {
        enabled: visibility.condicoes,
        title: 'Condições customizadas',
        body_html: toSafeMultilineHtml('Condição A\nCondição B'),
      },
    },
  };
}

test('official catalog publishes five v2 templates while retaining immutable v1 history', () => {
  assert.deepEqual(
    QUOTATION_TEMPLATES.map((template) => template.key),
    ['padrao', 'minimalista', 'branded', 'comparativo', 'simples']
  );
  assert.ok(QUOTATION_TEMPLATES.every((template) => template.contract_version === 2));
  assert.ok(HISTORICAL_QUOTATION_TEMPLATES.every((template) => template.contract_version === 1));
  for (const template of QUOTATION_TEMPLATES) {
    assert.match(template.source, /secoes\.prazo_producao/);
    assert.match(template.source, /secoes\.pagamento/);
    assert.match(template.source, /secoes\.condicoes_gerais/);
    assert.match(template.source, /display\.total/);
    assert.doesNotMatch(
      template.source,
      /15 a 20 dias úteis|Formas de pagamento:|55\.458\.072\/0001-79/
    );
    const historical = HISTORICAL_QUOTATION_TEMPLATES.find((item) => item.key === template.key)!;
    assert.notEqual(template.hash, historical.hash);
    assert.equal(resolveQuotationTemplate(template.key, historical.hash), historical);
    assert.equal(
      quotationTemplateFromVersion({
        source: historical.source,
        sourceHash: historical.hash,
        contractVersion: 1,
        template: { key: historical.key, name: historical.name },
      }),
      historical
    );
  }
});

test('every official v2 template renders customized company and commercial sections safely', () => {
  for (const template of QUOTATION_TEMPLATES) {
    const html = renderQuotationTemplate(template, model());
    if (['branded', 'comparativo', 'simples'].includes(template.key)) {
      assert.doesNotMatch(html, /Empresa Nova LTDA|12\.345\.678\/0001-95/);
    } else {
      assert.match(html, /Empresa Nova LTDA/);
    }
    assert.match(html, /Banco Novo/);
    assert.match(html, /Prazo customizado/);
    assert.match(html, /Pagamento customizado/);
    assert.match(html, /Condições customizadas/);
    assert.match(html, /Pix em duas parcelas/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /R\$ 10,00/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  }
});

test('disabled sections hide titles, content and payment company details in every official template', () => {
  const cases = [
    [
      'prazo',
      { prazo: false, pagamento: true, condicoes: true },
      /Prazo customizado|Entrega em 20 dias/,
    ],
    [
      'pagamento',
      { prazo: true, pagamento: false, condicoes: true },
      /Pagamento customizado|Banco Novo|Pix em duas parcelas/,
    ],
    [
      'condicoes',
      { prazo: true, pagamento: true, condicoes: false },
      /Condições customizadas|Condição A|Condição B/,
    ],
    [
      'todas',
      { prazo: false, pagamento: false, condicoes: false },
      /Prazo customizado|Entrega em 20 dias|Pagamento customizado|Banco Novo|Pix em duas parcelas|Condições customizadas|Condição A|Condição B/,
    ],
  ] as const;
  for (const template of QUOTATION_TEMPLATES) {
    for (const [, visibility, hidden] of cases) {
      const html = renderQuotationTemplate(template, model(visibility));
      assert.doesNotMatch(html, hidden);
      if (['branded', 'comparativo', 'simples'].includes(template.key)) {
        assert.doesNotMatch(html, /Empresa Nova LTDA|12\.345\.678\/0001-95/);
      } else {
        assert.match(html, /Empresa Nova LTDA/);
      }
    }
  }
});

test('company configuration rejects malformed identity and unsafe contact URLs', () => {
  assert.throws(
    () =>
      normalizeQuotationCompanyConfiguration({
        identity: { legal_name: 'Empresa', document: '123' },
      }),
    /CNPJ deve ter 14 dígitos/
  );
  assert.throws(
    () =>
      normalizeQuotationCompanyConfiguration({
        identity: { legal_name: 'Empresa', document: '12345678000195' },
        contacts: { website: 'javascript:alert(1)' },
      }),
    /URL https/
  );
  assert.throws(
    () =>
      normalizeQuotationCompanyConfiguration({
        identity: { legal_name: 'Empresa', document: '12345678000195' },
        contacts: { website: 'https://' },
      }),
    /URL https/
  );
  assert.throws(
    () => normalizeQuotationCompanyConfiguration({ identity: null }),
    /identidade empresarial.*objeto/
  );
});

test('company backfill verification reports aggregate semantic preservation without row data', () => {
  const verification = verifyQuotationCompanyBackfill([
    DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
    {
      ...DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
      identity: { ...DEFAULT_QUOTATION_COMPANY_CONFIGURATION.identity },
    },
  ]);
  assert.deepEqual(verification, {
    total: 2,
    valid_snapshots: 2,
    missing_snapshots: 0,
    invalid_snapshots: 0,
    official_default_mismatches: 0,
  });
  assertQuotationCompanyBackfill(verification);
  assert.equal('identity' in verification, false);

  const customized = verifyQuotationCompanyBackfill([
    normalizeQuotationCompanyConfiguration({
      ...DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
      identity: {
        ...DEFAULT_QUOTATION_COMPANY_CONFIGURATION.identity,
        legal_name: 'Empresa customizada',
      },
    }),
  ]);
  assert.equal(customized.official_default_mismatches, 1);
  assert.doesNotThrow(() => assertQuotationCompanyBackfill(customized));

  const incomplete = verifyQuotationCompanyBackfill([{ schema_version: 1 }]);
  assert.deepEqual(incomplete, {
    total: 1,
    valid_snapshots: 0,
    missing_snapshots: 0,
    invalid_snapshots: 1,
    official_default_mismatches: 0,
  });
  assert.throws(() => assertQuotationCompanyBackfill(incomplete), /snapshots incompletos/);
  assert.throws(
    () => normalizeCompleteQuotationCompanyConfiguration({ schema_version: 1 }),
    /identidade empresarial como objeto completo/
  );
});
