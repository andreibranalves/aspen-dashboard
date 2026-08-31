import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getGoogleAdsConfig, isGoogleAdsConfigured } from '../../api/_infrastructure/integrations/google-ads/config.ts';
import { getGoogleAdsSpendClient } from '../../api/_infrastructure/integrations/google-ads/client.ts';

describe('Google Ads spend client', () => {
  it('does not call the network when env keys are missing', async () => {
    let fetchCalls = 0;
    const client = getGoogleAdsSpendClient({
      getConfig: () => getGoogleAdsConfig({}),
      fetchImpl: (async () => {
        fetchCalls += 1;
        throw new Error('should not fetch');
      }) as typeof fetch,
    });

    const result = await client.fetchSpend({ start: '2026-08-01', end: '2026-08-31' });
    assert.deepEqual(result, { amount: 0, available: false });
    assert.equal(fetchCalls, 0);
    assert.equal(isGoogleAdsConfigured(getGoogleAdsConfig({})), false);
  });

  it('sums cost micros for the requested interval and fails open on HTTP errors', async () => {
    const requests: string[] = [];
    const client = getGoogleAdsSpendClient({
      getConfig: () =>
        getGoogleAdsConfig({
          GOOGLE_ADS_CLIENT_ID: 'id',
          GOOGLE_ADS_CLIENT_SECRET: 'secret',
          GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
          GOOGLE_ADS_DEVELOPER_TOKEN: 'dev',
          GOOGLE_ADS_CUSTOMER_ID: '276-255-5809',
          GOOGLE_ADS_API_VERSION: 'v24',
        }),
      fetchImpl: (async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify({ access_token: 'token' }), { status: 200 });
        }
        const body = JSON.parse(String(init?.body || '{}')) as { query?: string };
        assert.match(body.query || '', /BETWEEN '2026-08-01' AND '2026-08-31'/);
        assert.match(url, /customers\/2762555809\/googleAds:search/);
        return new Response(
          JSON.stringify({
            results: [{ metrics: { costMicros: '1500000' } }, { metrics: { cost_micros: '500000' } }],
          }),
          { status: 200 }
        );
      }) as typeof fetch,
    });

    const spent = await client.fetchSpend({ start: '2026-08-01', end: '2026-08-31' });
    assert.deepEqual(spent, { amount: 2, available: true });
    assert.equal(requests.length, 2);

    const failing = getGoogleAdsSpendClient({
      getConfig: () =>
        getGoogleAdsConfig({
          GOOGLE_ADS_CLIENT_ID: 'id',
          GOOGLE_ADS_CLIENT_SECRET: 'secret',
          GOOGLE_ADS_REFRESH_TOKEN: 'refresh',
          GOOGLE_ADS_DEVELOPER_TOKEN: 'dev',
          GOOGLE_ADS_CUSTOMER_ID: '2762555809',
        }),
      fetchImpl: (async () => new Response('nope', { status: 503 })) as typeof fetch,
    });
    assert.deepEqual(await failing.fetchSpend({ start: '2026-08-01', end: '2026-08-31' }), {
      amount: 0,
      available: false,
    });
  });
});
