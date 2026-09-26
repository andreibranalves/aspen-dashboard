import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveServerIssuedPublicLink } from '../../api/_modules/send-whatsapp-flow.js';
import { renderTemplate } from '../../api/_modules/communication-flow-preview.js';
import { isRevisionBoundPublicQuotationUrl } from '../../api/_modules/public-quotation.js';

const token = 'A'.repeat(32);
const relativePublicUrl = `/api/public-quotation?token=${token}`;
const applicationOrigin = 'https://app.test';
const absolutePublicUrl = `${applicationOrigin}${relativePublicUrl}`;

test('public link validator accepts only same-origin or relative revision links', () => {
  assert.equal(isRevisionBoundPublicQuotationUrl(relativePublicUrl, applicationOrigin), true);
  assert.equal(isRevisionBoundPublicQuotationUrl(absolutePublicUrl, applicationOrigin), true);
  assert.equal(isRevisionBoundPublicQuotationUrl('https://evil.test' + relativePublicUrl, applicationOrigin), false);
  assert.equal(isRevisionBoundPublicQuotationUrl('//' + 'evil.test' + relativePublicUrl, applicationOrigin), false);
  assert.equal(isRevisionBoundPublicQuotationUrl(absolutePublicUrl), false);
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
