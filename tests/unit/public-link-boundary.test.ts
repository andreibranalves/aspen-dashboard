import assert from 'node:assert/strict';
import test from 'node:test';

import { handler as sendWhatsapp } from '../../api/_functions/send-whatsapp.js';
import { resolveServerIssuedPublicLink } from '../../api/_functions/send-whatsapp-flow.js';
import { renderTemplate } from '../../api/_functions/communication-flow-preview.js';
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

test('send-whatsapp rejects quote links without an immutable revision', async () => {
  const response = await sendWhatsapp(
    event({
      dry_run: true,
      quotation_id: 'LEGACY-QUOTE-001',
      telefone: '11999990000',
      public_link: absolutePublicUrl,
      template: 'Segue: (link_orcamento)',
    }),
  );
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /Revisão PostgreSQL do orçamento é obrigatória/);
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
