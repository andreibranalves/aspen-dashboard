import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getGoogleDataManagerClient,
  GoogleDataManagerTransportError,
} from '../../api/_infrastructure/integrations/google-data-manager/client.js';
import type { GoogleDataManagerConfig } from '../../api/_infrastructure/integrations/google-data-manager/config.js';

const CONFIG: GoogleDataManagerConfig = {
  clientId: 'synthetic-client',
  clientSecret: 'synthetic-secret',
  refreshToken: 'synthetic-refresh',
  operatingAccountId: '1234567890',
  productDestinationId: '9876543210',
  productDestinationType: 'UPLOAD_CLICKS',
  apiVersion: 'v1',
  oauthScope: 'https://www.googleapis.com/auth/datamanager',
};

const PAYLOAD = {
  destinations: [
    {
      operatingAccount: {
        accountType: 'GOOGLE_ADS' as const,
        accountId: CONFIG.operatingAccountId,
      },
      productDestinationId: CONFIG.productDestinationId,
    },
  ],
  events: [
    {
      transactionId: 'aspen-pedido-iniciado:11111111-1111-4111-8111-111111111111',
      eventTimestamp: '2026-09-01T12:00:00.000Z',
      conversionValue: 12.34,
      currency: 'BRL' as const,
      eventSource: 'OTHER' as const,
      adIdentifiers: { gclid: 'opaque-synthetic-click' },
      consent: {
        adUserData: 'CONSENT_GRANTED' as const,
        adPersonalization: 'CONSENT_GRANTED' as const,
      },
    },
  ],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('simulated Data Manager transport refreshes OAuth and sends one v1 ingest event', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = getGoogleDataManagerClient({
    getConfig: () => CONFIG,
    assertWritesAllowed: () => undefined,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('oauth2.googleapis.com'))
        return response({ access_token: 'synthetic-access' });
      return response({
        requestId: 'request-synthetic-1',
        fieldWarnings: [{ field: 'events[0]', reason: 'WARNING_REASON_GENERIC', extra: 'ignored' }],
      });
    },
  });
  const result = await client.ingest(PAYLOAD);
  assert.deepEqual(result, {
    kind: 'accepted',
    requestId: 'request-synthetic-1',
    httpStatus: 200,
    fieldWarnings: [
      { code: 'GOOGLE_DM_FIELD_WARNING', field: 'events[0]', reason: 'WARNING_REASON_GENERIC' },
    ],
  });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /datamanager\.googleapis\.com\/v1\/events:ingest$/);
  const headers = calls[1].init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer synthetic-access');
  assert.equal('developer-token' in headers, false);
  const sent = JSON.parse(String(calls[1].init?.body));
  assert.equal(sent.events.length, 1);
  assert.equal(sent.events[0].transactionId, PAYLOAD.events[0].transactionId);
  assert.equal('validateOnly' in sent, false);
});

test('simulated diagnostics use requestStatus:retrieve and preserve status categories', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = getGoogleDataManagerClient({
    getConfig: () => CONFIG,
    assertWritesAllowed: () => undefined,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('oauth2.googleapis.com'))
        return response({ access_token: 'synthetic-access' });
      return response({
        requestStatusPerDestination: [
          {
            requestStatus: 'FAILED',
            errorInfo: {
              errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_INVALID_EVENT', recordCount: '2' }],
            },
            warningInfo: {
              warningCounts: [
                { reason: 'PROCESSING_WARNING_REASON_INTERNAL_ERROR', recordCount: '1' },
              ],
            },
          },
        ],
      });
    },
  });
  assert.deepEqual(await client.retrieveStatus('request-synthetic-1'), {
    status: 'failure',
    errorCounts: [{ reason: 'PROCESSING_ERROR_REASON_INVALID_EVENT', recordCount: 2 }],
    warningCounts: [{ reason: 'PROCESSING_WARNING_REASON_INTERNAL_ERROR', recordCount: 1 }],
  });
  const diagnostic = calls.at(-1)!;
  assert.match(diagnostic.url, /\/v1\/requestStatus:retrieve\?requestId=request-synthetic-1$/);
  assert.equal(diagnostic.init?.method, 'GET');
  assert.equal('body' in (diagnostic.init || {}), false);
});

test('diagnostic network errors do not retain the provider message', async () => {
  const secret = 'Authorization: Bearer synthetic-secret';
  const client = getGoogleDataManagerClient({
    getConfig: () => CONFIG,
    assertWritesAllowed: () => undefined,
    fetchImpl: async (url) => {
      if (String(url).includes('oauth2.googleapis.com'))
        return response({ access_token: 'synthetic-access' });
      throw new Error(secret);
    },
  });
  await assert.rejects(
    () => client.retrieveStatus('request-synthetic-1'),
    (error: unknown) =>
      error instanceof GoogleDataManagerTransportError && !error.message.includes(secret)
  );
});

test('Data Manager transport is blocked before any OAuth or network call', async () => {
  let fetchCalls = 0;
  const client = getGoogleDataManagerClient({
    getConfig: () => CONFIG,
    assertWritesAllowed: () => {
      throw new Error('external writes disabled');
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      return response({ access_token: 'must-not-be-used' });
    },
  });
  await assert.rejects(() => client.ingest(PAYLOAD), /external writes disabled/);
  assert.equal(fetchCalls, 0);
});

test('Data Manager treats server errors as ambiguous and client errors as permanent', async () => {
  const client = getGoogleDataManagerClient({
    getConfig: () => CONFIG,
    assertWritesAllowed: () => undefined,
    fetchImpl: async (url) => {
      if (String(url).includes('oauth2.googleapis.com'))
        return response({ access_token: 'synthetic-access' });
      return response({}, 503);
    },
  });
  await assert.rejects(
    () => client.ingest(PAYLOAD),
    (error: unknown) =>
      error instanceof GoogleDataManagerTransportError &&
      error.kind === 'ambiguous' &&
      error.httpStatus === 503
  );
  const permanent = getGoogleDataManagerClient({
    getConfig: () => CONFIG,
    assertWritesAllowed: () => undefined,
    fetchImpl: async (url) => {
      if (String(url).includes('oauth2.googleapis.com'))
        return response({ access_token: 'synthetic-access' });
      return response({}, 400);
    },
  });
  await assert.rejects(
    () => permanent.ingest(PAYLOAD),
    (error: unknown) =>
      error instanceof GoogleDataManagerTransportError &&
      error.kind === 'permanent' &&
      error.httpStatus === 400
  );
});
