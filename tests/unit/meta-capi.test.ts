import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { hashForMeta, sendMetaLeadEvent } from '../../api/infrastructure/integrations/meta-capi/meta-capi.js';

const ORIGINAL_ENV = {
  META_CAPI_ACCESS_TOKEN: process.env.META_CAPI_ACCESS_TOKEN,
  META_PIXEL_ID: process.env.META_PIXEL_ID,
};
const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  if (ORIGINAL_ENV.META_CAPI_ACCESS_TOKEN === undefined) {
    delete process.env.META_CAPI_ACCESS_TOKEN;
  } else {
    process.env.META_CAPI_ACCESS_TOKEN = ORIGINAL_ENV.META_CAPI_ACCESS_TOKEN;
  }

  if (ORIGINAL_ENV.META_PIXEL_ID === undefined) {
    delete process.env.META_PIXEL_ID;
  } else {
    process.env.META_PIXEL_ID = ORIGINAL_ENV.META_PIXEL_ID;
  }

  globalThis.fetch = ORIGINAL_FETCH;
});

describe('meta-capi', () => {
  it('hashForMeta normalizes and hashes email', () => {
    const hash = hashForMeta(' TESTE@Example.COM ');
    assert.equal(
      hash,
      'af4b24cd2b0d2bda9f39d1dfee0596e5361a626f9ef8cf13b397a176d03f32fb'
    );
  });

  it('sendMetaLeadEvent returns missing_token when token is not set', async () => {
    delete process.env.META_CAPI_ACCESS_TOKEN;

    const result = await sendMetaLeadEvent({
      eventId: 'test-123',
      email: 'teste@example.com',
    });
    assert.deepEqual(result, { sent: false, reason: 'missing_token' });
  });

  it('sendMetaLeadEvent posts to Graph API v25.0 with correct pixel id', async () => {
    process.env.META_CAPI_ACCESS_TOKEN = 'test-token';
    process.env.META_PIXEL_ID = '565904716543317';

    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = (async (url, options = {}) => {
      const parsed = typeof options.body === 'string' ? JSON.parse(options.body) : null;
      calls.push({ url: url as string, body: parsed });
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    }) as typeof globalThis.fetch;

    const result = await sendMetaLeadEvent({
      eventId: 'evt-001',
      email: 'cliente@empresa.com',
      phone: '5511999999999',
      eventSourceUrl: 'https://aspenestamparia.com/produto',
      quantity: '100 unidades',
    });

    assert.equal(result.sent, true);
    assert.equal(calls.length, 1);

    const requestUrl = calls[0].url as string;
    assert.ok(requestUrl.includes('v25.0'));
    assert.ok(requestUrl.includes('565904716543317'));
    assert.ok(requestUrl.includes('access_token=test-token'));

    const body = calls[0].body as Record<string, unknown>;
    assert.ok(body.data);
    assert.equal((body.data as Record<string, unknown>[]).length, 1);

    const event = (body.data as Record<string, unknown>[])[0];
    assert.equal(event.event_name, 'Lead');
    assert.equal(event.event_id, 'evt-001');
    assert.equal(event.action_source, 'website');
    assert.equal(
      event.event_source_url,
      'https://aspenestamparia.com/produto'
    );

    const userData = event.user_data as Record<string, string[]>;
    assert.ok(userData.em);
    assert.equal(userData.em.length, 1);
    assert.ok(userData.ph);
    assert.equal(userData.ph.length, 1);

    const customData = event.custom_data as Record<string, string>;
    assert.equal(customData.content_name, 'qualified_typebot_lead');
    assert.equal(customData.lead_type, 'corporate_quote');
    assert.equal(customData.quantity, '100 unidades');
  });
});
