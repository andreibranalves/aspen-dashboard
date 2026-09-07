import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSanityQuoteRequestsQuery,
  createSanityQuoteRequestsPageReader,
} from '../../api/_infrastructure/integrations/sanity/quote-requests.js';

test('Sanity quote request reader owns provider URL, auth and deterministic query', async () => {
  let requestedUrl: URL | undefined;
  let requestedInit: RequestInit | undefined;
  const readPage = createSanityQuoteRequestsPageReader(
    {
      SANITY_PROJECT_ID: 'synthetic-project',
      SANITY_DATASET: 'synthetic_dataset',
      SANITY_API_TOKEN: 'synthetic-read-token',
    },
    async (input, init) => {
      requestedUrl = new URL(String(input));
      requestedInit = init;
      return Response.json({ result: [{ _id: 'siteQuote.synthetic' }] });
    }
  );

  assert.deepEqual(
    await readPage({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      cursorDate: '2026-09-01T00:00:00.000Z',
      cursorId: '',
      limit: 100,
    }),
    [{ _id: 'siteQuote.synthetic' }]
  );
  assert.equal(requestedUrl?.hostname, 'synthetic-project.api.sanity.io');
  assert.equal(requestedUrl?.pathname, '/v2024-10-01/data/query/synthetic_dataset');
  assert.equal(requestedUrl?.searchParams.get('query'), buildSanityQuoteRequestsQuery());
  assert.equal(requestedUrl?.searchParams.get('$limit'), '100');
  assert.equal(
    new Headers(requestedInit?.headers).get('authorization'),
    'Bearer synthetic-read-token'
  );
  assert.ok(requestedInit?.signal);
});

test('Sanity quote request reader fails closed on config and response contracts', async () => {
  assert.throws(
    () => createSanityQuoteRequestsPageReader({ SANITY_API_TOKEN: 'synthetic-read-token' }),
    /Configuração Sanity incompleta/
  );
  const environment = {
    SANITY_PROJECT_ID: 'synthetic-project',
    SANITY_DATASET: 'synthetic_dataset',
    SANITY_API_TOKEN: 'synthetic-read-token',
  };
  await assert.rejects(
    createSanityQuoteRequestsPageReader(environment, async () =>
      Response.json({}, { status: 503 })
    )({ from: '', to: '', cursorDate: '', cursorId: '', limit: 1 }),
    /sanity_read_failed/
  );
  await assert.rejects(
    createSanityQuoteRequestsPageReader(environment, async () => Response.json({ result: {} }))({
      from: '',
      to: '',
      cursorDate: '',
      cursorId: '',
      limit: 1,
    }),
    /sanity_contract_failed/
  );
});
