import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePublicQuotationUrl } from '../../src/lib/printFormats.ts';
import {
  DEFAULT_QUOTATION_SECTIONS,
  combineLegacyConditions,
  createQuotationSectionsSnapshot,
  normalizeQuotationSections,
  toSafeMultilineHtml,
  validateQuotationSections,
} from '../../api/modules/quotation-content.js';

const legacy = {
  pagamento: '50% na aprovação',
  entrega: '3 dias úteis',
  observacoes: 'A arte precisa ser aprovada antes da produção.',
};

test('aceita somente links públicos revision-bound para clientes', () => {
  assert.equal(normalizePublicQuotationUrl('/api/view?q=ORC-1'), '');
  assert.equal(normalizePublicQuotationUrl('/api/public-quotation?token=' + 'A'.repeat(32)), '/api/public-quotation?token=' + 'A'.repeat(32));
  assert.equal(normalizePublicQuotationUrl('/api/public-quotation?token=short'), '');
  assert.equal(normalizePublicQuotationUrl('https://app.test/api/public-quotation?token=' + 'A'.repeat(32), 'https://app.test'), 'https://app.test/api/public-quotation?token=' + 'A'.repeat(32));
  assert.equal(normalizePublicQuotationUrl('https://evil.test/api/public-quotation?token=' + 'A'.repeat(32), 'https://app.test'), '');
  assert.equal(normalizePublicQuotationUrl('https://app.test/api/view?q=ORC-1', 'https://app.test'), '');
});

test('normaliza três seções e combina campos legados em condições gerais', () => {
  const sections = normalizeQuotationSections(undefined, legacy);
  assert.equal(sections.schema_version, 1);
  assert.equal(sections.pagamento.body, '50% na aprovação');
  assert.equal(
    sections.condicoes_gerais.body,
    'Prazo de entrega:\n3 dias úteis\n\nObservações:\nA arte precisa ser aprovada antes da produção.'
  );
});

test('cria base e current independentes', () => {
  const snapshot = createQuotationSectionsSnapshot(DEFAULT_QUOTATION_SECTIONS);
  snapshot.pagamento.current.title = 'Alterado';
  assert.equal(snapshot.pagamento.base.title, DEFAULT_QUOTATION_SECTIONS.pagamento.title);
});

test('combina somente os valores legados existentes', () => {
  assert.equal(combineLegacyConditions('', 'Observação'), 'Observações:\nObservação');
  assert.equal(combineLegacyConditions('Entrega', ''), 'Prazo de entrega:\nEntrega');
  assert.equal(combineLegacyConditions('', ''), '');
});

test('valida seções: rejeita entrada inválida', () => {
  assert.throws(() => validateQuotationSections(null), /Seções devem ser um objeto/);
  assert.throws(() => validateQuotationSections([]), /Seções devem ser um objeto/);
  assert.throws(
    () => validateQuotationSections({ pagamento: 'string' }),
    /Seção "pagamento" deve ser um objeto/
  );
  assert.throws(
    () => validateQuotationSections({ pagamento: { enabled: 'yes', title: 'Test' } }),
    /Campo "enabled" da seção "pagamento" deve ser booleano/
  );
  assert.throws(
    () => validateQuotationSections({ pagamento: { enabled: true, title: '' } }),
    /Título da seção "pagamento" não pode ser vazio/
  );
  assert.throws(
    () =>
      validateQuotationSections({
        pagamento: { enabled: true, title: 'x'.repeat(121) },
      }),
    /Título da seção "pagamento" excede 120 caracteres/
  );
});

test('normaliza seções com entrada parcial', () => {
  const input = {
    pagamento: { enabled: false, title: 'Pgto Custom' },
  };
  const sections = normalizeQuotationSections(input);
  assert.equal(sections.schema_version, 1);
  assert.equal(sections.pagamento.enabled, false);
  assert.equal(sections.pagamento.title, 'Pgto Custom');
  assert.equal(sections.prazo_producao.enabled, DEFAULT_QUOTATION_SECTIONS.prazo_producao.enabled);
  assert.equal(sections.prazo_producao.title, DEFAULT_QUOTATION_SECTIONS.prazo_producao.title);
});

test('não sobrescreve condicoes_gerais existente com legado', () => {
  const input = {
    condicoes_gerais: { enabled: true, title: 'Custom', body: 'Corpo custom' },
  };
  const sections = normalizeQuotationSections(input, legacy);
  assert.equal(sections.condicoes_gerais.body, 'Corpo custom');
});

test('toSafeMultilineHtml escapa HTML e preserva quebras de linha', () => {
  const result = toSafeMultilineHtml('<script>alert(1)</script>\nSaldo');
  const str = result.toString();
  assert.equal(typeof str, 'string');
  assert.match(str, /&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>Saldo/);
  assert.doesNotMatch(str, /<script>/);
});

test('toSafeMultilineHtml retorna string vazia para valor vazio', () => {
  const result = toSafeMultilineHtml('');
  assert.equal(result.toString(), '');
});

test('toSafeMultilineHtml escapa apóstrofos, crases e iguais via Handlebars.escapeExpression', () => {
  const result = toSafeMultilineHtml("a='b' c=`d` e=f");
  const str = result.toString();
  // Handlebars.escapeExpression uses hex entities for these chars
  assert.ok(str.includes('&#x27;'), 'should escape apostrophe');
  assert.ok(str.includes('&#x60;'), 'should escape backtick');
  assert.ok(str.includes('&#x3D;'), 'should escape equals');
});

test('recupera espelhos legados quando JSON contém apenas o default da migração', () => {
  const sections = normalizeQuotationSections(DEFAULT_QUOTATION_SECTIONS, legacy);
  assert.equal(sections.pagamento.body, legacy.pagamento);
  assert.equal(
    sections.condicoes_gerais.body,
    combineLegacyConditions(legacy.entrega, legacy.observacoes)
  );
});

test('normalização rejeita chaves desconhecidas', () => {
  assert.throws(
    () => normalizeQuotationSections({ unknown_key: { enabled: true, title: 'X' } }),
    /Campo desconhecido "unknown_key"/
  );
});

test('normalização rejeita body em prazo_producao', () => {
  assert.throws(
    () => normalizeQuotationSections({ prazo_producao: { enabled: true, title: 'P', body: 'x' } }),
    /Campo desconhecido "body" na seção "prazo_producao"/
  );
});

test('normalização rejeita body oversized', () => {
  assert.throws(
    () =>
      normalizeQuotationSections({
        pagamento: { enabled: true, title: 'P', body: 'x'.repeat(4001) },
      }),
    /excede 4000 caracteres/
  );
});

test('normalização rejeita título oversized', () => {
  assert.throws(
    () => normalizeQuotationSections({ pagamento: { enabled: true, title: 'x'.repeat(121) } }),
    /excede 120 caracteres/
  );
});

test('legado só é derivado quando chave condicoes_gerais está ausente', () => {
  // condicoes_gerais present with valid object: should NOT derive from legacy
  const sections = normalizeQuotationSections(
    { condicoes_gerais: { enabled: true, title: 'Custom', body: '' } },
    legacy
  );
  assert.equal(sections.condicoes_gerais.body, '');
  // condicoes_gerais absent: SHOULD derive from legacy
  const sections2 = normalizeQuotationSections({}, legacy);
  assert.ok(sections2.condicoes_gerais.body.includes('Prazo de entrega'));
});

test('DEFAULT_QUOTATION_SECTIONS é congelado', () => {
  assert.throws(() => {
    (DEFAULT_QUOTATION_SECTIONS as any).schema_version = 2;
  }, TypeError);
  assert.throws(() => {
    (DEFAULT_QUOTATION_SECTIONS.pagamento as any).title = 'X';
  }, TypeError);
});

test('createQuotationSectionsSnapshot produz forma per-section compatível com repositório', () => {
  const snap = createQuotationSectionsSnapshot(DEFAULT_QUOTATION_SECTIONS);
  // Must have per-section {base, current} shape
  assert.ok(snap.prazo_producao.base);
  assert.ok(snap.prazo_producao.current);
  assert.ok(snap.pagamento.base);
  assert.ok(snap.pagamento.current);
  assert.ok(snap.condicoes_gerais.base);
  assert.ok(snap.condicoes_gerais.current);
  // Deep independence
  snap.pagamento.current.body = 'changed';
  assert.equal(snap.pagamento.base.body, '');
});
