import assert from 'node:assert/strict';
import test from 'node:test';
import { publishQuotationFollowUp } from '../../api/_modules/quotation-follow-up-qstash.js';

const followUpId = '00000000-0000-4000-8000-000000000004';
const environment = {
  QSTASH_TOKEN: 'qstash-token',
  QSTASH_API_URL: 'https://qstash.upstash.io',
  CRON_SECRET: 'c'.repeat(32),
  QUOTATION_FOLLOW_UP_WORKER_URL: 'https://dashboard.aspenestamparia.com/api/quotation-follow-up-worker',
};

test('skips immediate publish once the daily cap is reached', async () => {
  let called = 0;
  const published = await publishQuotationFollowUp(
    { followUpId, approvalsCreatedTodayUtc: 100 },
    { environment, fetchImpl: async () => { called += 1; return new Response('ok', { status: 200 }); } },
  );
  assert.equal(published, false);
  assert.equal(called, 0);
});

test('publishes to the fixed production worker URL with retries disabled', async () => {
  const requests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const published = await publishQuotationFollowUp(
    { followUpId, approvalsCreatedTodayUtc: 1 },
    {
      environment,
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          headers: Object.fromEntries(Object.entries(init?.headers || {}).map(([key, value]) => [key, String(value)])),
          body: String(init?.body || ''),
        });
        return new Response('ok', { status: 201 });
      },
    },
  );
  assert.equal(published, true);
  assert.match(requests[0].url, /\/v2\/publish\/https%3A%2F%2Fdashboard\.aspenestamparia\.com%2Fapi%2Fquotation-follow-up-worker$/);
  assert.equal(requests[0].headers.Authorization, 'Bearer qstash-token');
  assert.equal(requests[0].headers['Upstash-Forward-Authorization'], `Bearer ${environment.CRON_SECRET}`);
  assert.equal(requests[0].headers['Upstash-Retries'], '0');
  assert.equal(requests[0].headers['Upstash-Deduplication-Id'], followUpId);
  assert.equal(requests[0].headers['Upstash-Redact-Fields'], 'header[Authorization]');
  assert.deepEqual(JSON.parse(requests[0].body), { follow_up_id: followUpId });
});

test('rejects preview vercel.app worker URLs', async () => {
  await assert.rejects(
    () =>
      publishQuotationFollowUp(
        { followUpId, approvalsCreatedTodayUtc: 0 },
        {
          environment: {
            ...environment,
            QUOTATION_FOLLOW_UP_WORKER_URL: 'https://aspen-dashboard-git-feat.vercel.app/api/quotation-follow-up-worker',
          },
          fetchImpl: async () => new Response('ok', { status: 200 }),
        },
      ),
    /não configurada/,
  );
});
