import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  renderQuotationEmailTemplate,
  validateQuotationEmailTemplate,
} from '../../api/_lib/quotation-email-template.js';

const renderInput = {
  customerName: '<Maria & Filhos>',
  businessNumber: 'ORC-42',
  publicUrl: 'https://app.example.com/api/public-quotation?token=abc',
};

test('default template preserves the current quotation email', () => {
  const rendered = renderQuotationEmailTemplate(DEFAULT_QUOTATION_EMAIL_TEMPLATE, renderInput);
  assert.equal(rendered.subject, 'Orçamento ORC-42 - Aspen');
  assert.match(rendered.html, /Olá, &lt;Maria &amp; Filhos&gt;\./);
  assert.match(rendered.html, /Segue o orçamento ORC-42 em anexo\./);
  assert.match(rendered.html, />Ver orçamento<\/a>/);
  assert.match(rendered.html, /Atenciosamente,<br>Aspen/);
  assert.match(rendered.text, /Ver orçamento: https:\/\/app\.example\.com/);
});

test('validator normalizes valid fields and rejects unknown tokens', () => {
  const valid = validateQuotationEmailTemplate({
    subject: '  Orçamento {{numero_orcamento}}  ',
    greeting: 'Olá, {{nome_cliente}}.',
    message: 'Linha 1\r\nLinha 2',
    button_label: 'Abrir',
    signature: '',
  });
  assert.equal(valid.ok, true);
  if (valid.ok) assert.equal(valid.value.message, 'Linha 1\nLinha 2');

  const invalid = validateQuotationEmailTemplate({
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    message: 'Olá, {{cliente_nome}}',
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.match(invalid.fields.message || '', /cliente_nome/);
});

test('validator enforces required fields and exact limits', () => {
  const invalid = validateQuotationEmailTemplate({
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    subject: '',
    message: 'M'.repeat(4001),
    button_label: 'B'.repeat(81),
  });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.ok(invalid.fields.subject);
    assert.ok(invalid.fields.message);
    assert.ok(invalid.fields.button_label);
  }
});

test('renderer escapes configured text and omits optional empty blocks', () => {
  const rendered = renderQuotationEmailTemplate({
    ...DEFAULT_QUOTATION_EMAIL_TEMPLATE,
    greeting: '',
    message: '<script>alert(1)</script>\nSegundo parágrafo',
    signature: '',
  }, renderInput);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html, /Atenciosamente/);
  assert.doesNotMatch(rendered.html, /<p><\/p>/);
});
