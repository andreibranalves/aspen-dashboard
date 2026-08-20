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
  assert.match(rendered.html, /<strong>Olá, &lt;Maria &amp; Filhos&gt;, tudo bem\?<\/strong>/);
  assert.match(rendered.html, /Recebemos seu pedido de orçamento para nossos personalizados/);
  assert.match(rendered.html, /ORC-42/);
  assert.match(rendered.html, /src="https:\/\/app\.example\.com\/email-logo-light\.svg"/);
  assert.match(rendered.html, /background-color:#1e3159/);
  assert.match(rendered.html, /href="https:\/\/app\.example\.com\/api\/public-quotation\?token=abc"/);
  assert.match(rendered.html, /href="https:\/\/wa\.me\/5521969241265"/);
  assert.match(rendered.html, /href="mailto:contato@aspenestamparia\.com"/);
  assert.doesNotMatch(rendered.html, />https:\/\/app\.example\.com\/api\/public-quotation\?token=abc</);
  assert.match(rendered.text, /ORC-42/);
  assert.match(rendered.text, /Qualquer dúvida, estamos à disposição/);
  assert.match(rendered.text, /WhatsApp: \(21\) 96924-1265/);
  assert.match(rendered.text, /E-mail: contato@aspenestamparia\.com/);
  assert.match(rendered.text, /Atenciosamente,\s+Aspen Estamparia/);
  assert.doesNotMatch(rendered.text, /https:\/\/app\.example\.com\/api\/public-quotation\?token=abc/);
});
