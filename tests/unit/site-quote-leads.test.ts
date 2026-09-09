import assert from 'node:assert/strict';
import test from 'node:test';

import { createSiteQuoteLeadsHandler } from '../../api/_modules/site-quote-leads.js';

const CURRENT_TOKEN = 'c'.repeat(32);
const PREVIOUS_TOKEN = 'p'.repeat(32);
const validPayload = {
  externalId: 'siteQuote.018f47a8-7b6c-7d3e-8f90-123456789abc',
  payloadFingerprint: 'a'.repeat(64),
  originalCreatedAt: '2026-09-05T12:00:00.000Z',
  nome: 'Cliente Sintético',
  email: 'synthetic@example.invalid',
  whatsapp: '21999990000',
  produto: 'Cangas',
  quantidade: '100',
  mensagem: 'Evento sintético',
  gclid: 'opaque-click-fixture',
  consent: { given: true, source: 'site_quote_form' },
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${CURRENT_TOKEN}` },
    queryStringParameters: {},
    body: JSON.stringify(validPayload),
    ...overrides,
  };
}

test('machine ingestion authenticates current and rotation token, then rejects a revoked token', async () => {
  const ingest = async () => ({ result: 'created' as const });
  const rotating = createSiteQuoteLeadsHandler({
    ingest,
    environment: {
      QUOTE_LEADS_INGEST_TOKEN: CURRENT_TOKEN,
      QUOTE_LEADS_INGEST_PREVIOUS_TOKEN: PREVIOUS_TOKEN,
    },
    correlationId: () => 'correlation-fixture',
  });
  assert.equal((await rotating(event())).statusCode, 201);
  assert.equal(
    (await rotating(event({ headers: { authorization: `Bearer ${PREVIOUS_TOKEN}` } }))).statusCode,
    201
  );

  const revoked = createSiteQuoteLeadsHandler({
    ingest,
    environment: { QUOTE_LEADS_INGEST_TOKEN: CURRENT_TOKEN },
  });
  assert.equal(
    (await revoked(event({ headers: { authorization: `Bearer ${PREVIOUS_TOKEN}` } }))).statusCode,
    401
  );
  assert.equal(
    (await revoked(event({ headers: { cookie: 'aspen_token=session' } }))).statusCode,
    401
  );
  const unconfigured = createSiteQuoteLeadsHandler({ ingest, environment: {} });
  assert.equal((await unconfigured(event())).statusCode, 401);
  const weak = createSiteQuoteLeadsHandler({
    ingest,
    environment: { QUOTE_LEADS_INGEST_TOKEN: 'too-short' },
  });
  assert.equal(
    (await weak(event({ headers: { authorization: 'Bearer too-short' } }))).statusCode,
    401
  );
});

test('machine ingestion fixes source, rejects non-allowlisted fields and never returns PII', async () => {
  let received: Record<string, unknown> | undefined;
  const handler = createSiteQuoteLeadsHandler({
    environment: { QUOTE_LEADS_INGEST_TOKEN: CURRENT_TOKEN },
    ingest: async (input) => {
      received = input;
      return { result: 'deduplicated' };
    },
    correlationId: () => 'correlation-fixture',
  });
  const accepted = await handler(event());
  assert.equal(accepted.statusCode, 200);
  assert.equal(received?.source, 'site_form');
  assert.deepEqual(JSON.parse(accepted.body || ''), {
    result: 'deduplicated',
    correlationId: 'correlation-fixture',
  });
  assert.equal((accepted.body || '').includes(validPayload.email), false);

  for (const forbidden of ['status', 'quotationId', 'crmDealId', 'raw']) {
    const response = await handler(
      event({ body: JSON.stringify({ ...validPayload, [forbidden]: 'forbidden' }) })
    );
    assert.equal(response.statusCode, 400, forbidden);
  }
});

test('machine ingestion enforces POST and actual 16 KiB body limit before mutation', async () => {
  let writes = 0;
  const handler = createSiteQuoteLeadsHandler({
    environment: { QUOTE_LEADS_INGEST_TOKEN: CURRENT_TOKEN },
    ingest: async () => {
      writes += 1;
      return { result: 'created' };
    },
  });
  assert.equal((await handler(event({ httpMethod: 'GET' }))).statusCode, 405);
  assert.equal(
    (
      await handler(
        event({ body: JSON.stringify({ ...validPayload, mensagem: 'á'.repeat(9_000) }) })
      )
    ).statusCode,
    413
  );
  assert.equal(writes, 0);
});

test('strict ad-consent grant passes verbatim; generic and legacy variants never promote', async () => {
  const received: Array<Record<string, unknown>> = [];
  const handler = createSiteQuoteLeadsHandler({
    environment: { QUOTE_LEADS_INGEST_TOKEN: CURRENT_TOKEN },
    ingest: async (input) => {
      received.push(input);
      return { result: 'created' };
    },
  });
  const grant = {
    adUserData: 'CONSENT_GRANTED',
    adPersonalization: 'CONSENT_GRANTED',
    policyVersion: '2026-08-18',
    reviewedAt: '2026-09-05T11:30:00.000Z',
    source: 'site_cookie_preferences',
    evidenceId: '018f47a8-7b6c-7d3e-8f90-123456789abf',
  };
  const granted = await handler(
    event({ body: JSON.stringify({ ...validPayload, consent: grant }) })
  );
  assert.equal(granted.statusCode, 201);
  assert.deepEqual(received.at(-1)?.consent, grant);
  // Click id byte-a-byte: whitespace preserved, never trimmed.
  const padded = '  opaque click\t ';
  await handler(event({ body: JSON.stringify({ ...validPayload, gclid: padded }) }));
  assert.equal(received.at(-1)?.gclid, padded);
  // Rejections: malformed/legacy evidence is never demoted to generic consent.
  for (const consent of [
    { ...grant, policyVersion: '2025-01-01' },
    { ...grant, source: 'site_quote_form' },
    { ...grant, adUserData: 'CONSENT_DENIED' },
    { ...grant, reviewedAt: '2026-09-05T11:30:00Z' },
    { given: true, source: 'site_quote_form', policyVersion: '2026-08-18' },
    { given: false, source: 'site_quote_form' },
    'granted',
  ]) {
    const response = await handler(
      event({ body: JSON.stringify({ ...validPayload, consent }) })
    );
    assert.equal(response.statusCode, 400, JSON.stringify(consent));
  }
  // Oversized or ambiguous click ids are rejected before the immutable snapshot.
  const oversized = await handler(
    event({ body: JSON.stringify({ ...validPayload, gclid: 'a'.repeat(501) }) })
  );
  assert.equal(oversized.statusCode, 400);
  const ambiguous = await handler(
    event({
      body: JSON.stringify({ ...validPayload, gclid: 'opaque-gclid', wbraid: 'opaque-wbraid' }),
    })
  );
  assert.equal(ambiguous.statusCode, 400);
});
