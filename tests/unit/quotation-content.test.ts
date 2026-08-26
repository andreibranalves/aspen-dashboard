import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizePublicQuotationUrl } from '../../src/lib/formatting/printFormats.ts';
import {
  DEFAULT_QUOTATION_SECTIONS,
  createQuotationSectionsSnapshot,
  normalizeQuotationSections,
  sanitizeQuotationRichText,
  toSafeMultilineHtml,
  toSafeRichTextHtml,
  validateQuotationSections,
  withQuotationProductionDeadline,
} from '../../api/_modules/quotation-content.js';

test('aceita somente links públicos revision-bound para clientes', () => {
  assert.equal(normalizePublicQuotationUrl('/api/view?q=ORC-1'), '');
  assert.equal(normalizePublicQuotationUrl('/api/public-quotation?token=' + 'A'.repeat(32)), '/api/public-quotation?token=' + 'A'.repeat(32));
  assert.equal(normalizePublicQuotationUrl('/api/public-quotation?token=short'), '');
  assert.equal(normalizePublicQuotationUrl('https://app.test/api/public-quotation?token=' + 'A'.repeat(32), 'https://app.test'), 'https://app.test/api/public-quotation?token=' + 'A'.repeat(32));
  assert.equal(normalizePublicQuotationUrl('https://evil.test/api/public-quotation?token=' + 'A'.repeat(32), 'https://app.test'), '');
  assert.equal(normalizePublicQuotationUrl('https://app.test/api/view?q=ORC-1', 'https://app.test'), '');
});

test('normaliza três seções a partir dos defaults canônicos', () => {
  const sections = normalizeQuotationSections(undefined);
  assert.equal(sections.schema_version, 1);
  assert.equal(sections.pagamento.body, '');
  assert.equal(sections.condicoes_gerais.body, '');
});

test('cria base e current independentes', () => {
  const snapshot = createQuotationSectionsSnapshot(
    withQuotationProductionDeadline(DEFAULT_QUOTATION_SECTIONS, '5 dias')
  );
  snapshot.pagamento.current.title = 'Alterado';
  snapshot.prazo_producao.current.value = '7 dias';
  assert.equal(snapshot.pagamento.base.title, DEFAULT_QUOTATION_SECTIONS.pagamento.title);
  assert.equal(snapshot.prazo_producao.base.value, '5 dias');
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
    prazo_producao: { enabled: true, title: 'Prazo', value: '5 dias' },
  };
  const sections = normalizeQuotationSections(input);
  assert.equal(sections.schema_version, 1);
  assert.equal(sections.pagamento.enabled, false);
  assert.equal(sections.pagamento.title, 'Pgto Custom');
  assert.equal(sections.prazo_producao.enabled, DEFAULT_QUOTATION_SECTIONS.prazo_producao.enabled);
  assert.equal(sections.prazo_producao.title, 'Prazo');
  assert.equal(sections.prazo_producao.value, '5 dias');
});

test('preserva condicoes_gerais fornecido sem derivar de campos legados', () => {
  const input = {
    condicoes_gerais: { enabled: true, title: 'Custom', body: 'Corpo custom' },
  };
  const sections = normalizeQuotationSections(input);
  assert.equal(sections.condicoes_gerais.body, 'Corpo custom');
});

test('toSafeMultilineHtml escapa HTML e preserva quebras de linha', () => {
  const result = toSafeMultilineHtml('<script>alert(1)</script>\nSaldo');
  const str = result.toString();
  assert.equal(typeof str, 'string');
  assert.match(str, /&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>Saldo/);
  assert.doesNotMatch(str, /<script>/);
});

test('rich text preserva apenas formatação comercial permitida', () => {
  const input = '<p><strong>50% de entrada</strong></p><ul><li>Pix</li></ul><img src=x onerror=alert(1)><script>alert(2)</script>';
  const sanitized = sanitizeQuotationRichText(input);
  assert.equal(sanitized, '<p><strong>50% de entrada</strong></p><ul><li>Pix</li></ul>');
  assert.equal(toSafeRichTextHtml(sanitized).toString(), sanitized);
});

test('preferência de resumo é normalizada e preservada no snapshot', () => {
  assert.equal(normalizeQuotationSections(undefined).show_summary, true);
  const sections = normalizeQuotationSections({ show_summary: false, rich_text: true });
  assert.equal(sections.show_summary, false);
  assert.equal(sections.rich_text, true);
  assert.equal(createQuotationSectionsSnapshot(sections).show_summary, false);
  assert.throws(() => normalizeQuotationSections({ show_summary: 'não' }), /show_summary deve ser booleano/);
  assert.throws(() => normalizeQuotationSections({ rich_text: 'sim' }), /rich_text deve ser booleano/);
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

test('normalização rejeita chaves desconhecidas', () => {
  assert.throws(
    () => normalizeQuotationSections({ unknown_key: { enabled: true, title: 'X' } }),
    /Campo desconhecido "unknown_key"/
  );
});

test('normalização rejeita value inválido ou oversized em prazo_producao', () => {
  assert.throws(
    () => normalizeQuotationSections({ prazo_producao: { enabled: true, title: 'P', value: 5 } }),
    /Campo "value" da seção "prazo_producao" deve ser string/
  );
  assert.throws(
    () => normalizeQuotationSections({ prazo_producao: { enabled: true, title: 'P', value: 'x'.repeat(501) } }),
    /Valor da seção "prazo_producao" excede 500 caracteres/
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
