import assert from 'node:assert/strict';
import test from 'node:test';
import { renderQuotationEmail } from '../../api/_shared/quotation-email.js';

const input = {
  customerName: '<Maria & Filhos>',
  businessNumber: 'ORC-42',
  publicUrl: 'https://app.example.com/api/public-quotation?token=abc',
};

test('renders a readable quotation email with HTML and plain text alternatives', async () => {
  const rendered = await renderQuotationEmail(input);

  assert.equal(rendered.subject, 'Orçamento ORC-42 - Aspen');
  assert.match(rendered.html, /lang="pt-BR"/);
  assert.match(rendered.html, /&lt;Maria &amp; Filhos&gt;/);
  assert.match(rendered.html, /ORC-42/);
  assert.match(rendered.html, /href="https:\/\/app\.example\.com\/api\/public-quotation\?token=abc"/);
  assert.match(rendered.html, /Se o botão não funcionar/);
  assert.match(rendered.text, /ORC-42/);
  assert.match(rendered.text, /https:\/\/app\.example\.com\/api\/public-quotation\?token=abc/);
  assert.match(rendered.text, /PDF do orçamento está anexado/);
});
