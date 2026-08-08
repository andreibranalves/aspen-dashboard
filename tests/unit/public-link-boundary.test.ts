import assert from 'node:assert/strict';
import test from 'node:test';

import { handler as sendWhatsapp } from '../../api/_functions/send-whatsapp.js';
import { resolveServerIssuedPublicLink } from '../../api/_functions/send-whatsapp-flow.js';
import { renderTemplate } from '../../api/_functions/communication-flow-preview.js';
import { buildQuoteResponse } from '../../api/_functions/lib/quote-response.js';
import { isRevisionBoundPublicQuotationUrl } from '../../api/_functions/public-quotation.js';

const token = 'A'.repeat(32);
const relativePublicUrl = `/api/public-quotation?token=${token}`;
const applicationOrigin = 'https://app.test';
const absolutePublicUrl = `${applicationOrigin}${relativePublicUrl}`;

function event(body: Record<string, unknown>) {
  return {
    httpMethod: 'POST',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    body: JSON.stringify(body),
  } as any;
}

test('public link validator accepts only same-origin or relative revision links', () => {
  assert.equal(isRevisionBoundPublicQuotationUrl(relativePublicUrl, applicationOrigin), true);
  assert.equal(isRevisionBoundPublicQuotationUrl(absolutePublicUrl, applicationOrigin), true);
  assert.equal(isRevisionBoundPublicQuotationUrl('https://evil.test' + relativePublicUrl, applicationOrigin), false);
  assert.equal(isRevisionBoundPublicQuotationUrl('//' + 'evil.test' + relativePublicUrl, applicationOrigin), false);
  assert.equal(isRevisionBoundPublicQuotationUrl(absolutePublicUrl), false);
});

test('send-whatsapp ignores caller public links for legacy dry-run messages', async () => {
  const response = await sendWhatsapp(
    event({
      dry_run: true,
      quotation_id: 'LEGACY-QUOTE-001',
      telefone: '11999990000',
      public_link: absolutePublicUrl,
      template: 'Segue: (link_orcamento)',
    }),
  );
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || '{}');
  assert.equal(body.message, 'Segue: ');
  assert.doesNotMatch(body.message, /public-quotation|api\/view/);
});

test('send-whatsapp-flow accepts server-issued links only on PostgreSQL path', () => {
  assert.equal(resolveServerIssuedPublicLink(false, absolutePublicUrl, applicationOrigin), '');
  assert.equal(resolveServerIssuedPublicLink(false, relativePublicUrl, applicationOrigin), '');
  assert.equal(resolveServerIssuedPublicLink(true, relativePublicUrl, applicationOrigin), relativePublicUrl);
  assert.equal(resolveServerIssuedPublicLink(true, 'https://evil.test' + relativePublicUrl, applicationOrigin), '');
});

test('communication preview removes administrative and foreign links', () => {
  assert.equal(
    renderTemplate('Link: (link_orcamento)', { link: '/api/view?q=LEGACY-1' }, applicationOrigin),
    'Link: ',
  );
  assert.equal(
    renderTemplate('Link: (link_orcamento)', { link: 'https://evil.test/api/public-quotation?token=' + token }, applicationOrigin),
    'Link: ',
  );
  assert.equal(
    renderTemplate('Link: (link_orcamento)', { link: relativePublicUrl }, applicationOrigin),
    `Link: ${relativePublicUrl}`,
  );
});

test('quote response keeps only full public URL and never calls TinyURL', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/printview')) return new Response('<html><head></head><body>PDF</body></html>', { status: 200 });
    return new Response(JSON.stringify({ data: { items: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const result = await buildQuoteResponse({
      event: { headers: { host: 'app.test', 'x-forwarded-proto': 'https' } },
      quotationId: 'LEGACY-QUOTE-002',
      dealId: 'DEAL-1',
      entityId: 'CUSTOMER-1',
      entityType: 'Customer',
      customerIsNew: false,
      nomeCliente: 'Cliente Teste',
      urgente: false,
      savedItems: [],
      origem: 'teste',
      publicUrl: absolutePublicUrl,
    });
    assert.equal(result.public_url, absolutePublicUrl);
    assert.equal(Object.hasOwn(result, 'short_url'), false);
    assert.equal(Object.hasOwn(result, 'view_url'), false);
    assert.equal(calls.some((url) => url.includes('tinyurl.com')), false);

    const rejected = await buildQuoteResponse({
      event: { headers: { host: 'app.test', 'x-forwarded-proto': 'https' } },
      quotationId: 'LEGACY-QUOTE-003',
      dealId: 'DEAL-1',
      entityId: 'CUSTOMER-1',
      entityType: 'Customer',
      customerIsNew: false,
      nomeCliente: 'Cliente Teste',
      urgente: false,
      savedItems: [],
      origem: 'teste',
      publicUrl: 'https://evil.test' + relativePublicUrl,
    });
    assert.equal(rejected.public_url, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
