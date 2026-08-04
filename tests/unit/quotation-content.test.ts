import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_QUOTATION_SECTIONS,
  combineLegacyConditions,
  createQuotationSectionsSnapshot,
  normalizeQuotationSections,
  toSafeMultilineHtml,
  validateQuotationSections,
} from '../../api/_db/quotation-content.js';

const legacy = {
  pagamento: '50% na aprovação',
  entrega: '3 dias úteis',
  observacoes: 'A arte precisa ser aprovada antes da produção.',
};

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
  snapshot.current.pagamento.title = 'Alterado';
  assert.equal(snapshot.base.pagamento.title, DEFAULT_QUOTATION_SECTIONS.pagamento.title);
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
