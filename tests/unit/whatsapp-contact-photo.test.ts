import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createContactPhotoHandler } from '../../api/_modules/whatsapp-contact-photo.js';

const id = randomUUID();
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const cdnUrl = 'https://pps.whatsapp.net/v/t61.24694-24/photo.jpg?oe=68E30000';

function photoHandler(input: {
  instance?: string;
  lookupStatus?: number;
  profilePictureUrl?: unknown;
  image?: Response;
} = {}) {
  const calls = { lookup: [] as { path: string; body?: Record<string, unknown> }[], image: [] as { url: string; init?: RequestInit }[] };
  const handler = createContactPhotoHandler({
    findConversation: async (conversationId) => conversationId === id
      ? { instance: input.instance || 'installed', providerConversationId: '123456789@lid' }
      : null,
    client: {
      config: () => ({ instance: 'installed', baseUrl: 'https://example.test', apiKey: 'test' }),
      request: async (path, body, options) => {
        assert.equal(options?.externalWrite, false);
        calls.lookup.push({ path, body });
        return new Response(JSON.stringify({
          wuid: '123456789@lid',
          profilePictureUrl: 'profilePictureUrl' in input ? input.profilePictureUrl : cdnUrl,
        }), { status: input.lookupStatus || 200 });
      },
    },
    fetchImpl: async (url, init) => {
      calls.image.push({ url: String(url), init });
      return input.image || new Response(jpeg, { status: 200 });
    },
  });
  return {
    calls,
    get: (conversationId: string = id, httpMethod = 'GET') =>
      handler({ httpMethod, headers: {}, queryStringParameters: { id: conversationId }, body: '' }),
  };
}

test('contact photo proxies the WhatsApp CDN image for the conversation JID', async () => {
  const flow = photoHandler();
  const result = await flow.get();
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers?.['Content-Type'], 'image/jpeg');
  assert.equal(result.headers?.['Cache-Control'], 'private, max-age=86400');
  assert.equal(result.headers?.['X-Content-Type-Options'], 'nosniff');
  assert.equal(result.isBase64Encoded, true);
  assert.deepEqual(Buffer.from(result.body || '', 'base64'), jpeg);
  assert.deepEqual(flow.calls.lookup, [{ path: '/chat/fetchProfilePictureUrl/installed', body: { number: '123456789@lid' } }]);
  assert.equal(flow.calls.image[0].url, cdnUrl);
  assert.equal(flow.calls.image[0].init?.redirect, 'error');
});

test('hidden photos, foreign instances and non-CDN URLs answer a cacheable 404 without fetching', async () => {
  for (const flow of [
    photoHandler({ profilePictureUrl: null }),
    photoHandler({ instance: 'another' }),
    photoHandler({ profilePictureUrl: 'http://pps.whatsapp.net/photo.jpg' }),
    photoHandler({ profilePictureUrl: 'https://169.254.169.254/latest/meta-data' }),
    photoHandler({ profilePictureUrl: 'https://pps.whatsapp.net.evil.test/photo.jpg' }),
  ]) {
    const result = await flow.get();
    assert.equal(result.statusCode, 404);
    assert.equal(result.headers?.['Cache-Control'], 'private, max-age=86400');
    assert.equal(flow.calls.image.length, 0);
  }
});

test('invalid requests and origin failures are not cached', async () => {
  const flow = photoHandler();
  assert.equal((await flow.get('not-a-uuid')).statusCode, 400);
  assert.equal((await flow.get(id, 'POST')).statusCode, 405);
  const unknown = await flow.get(randomUUID());
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.headers?.['Cache-Control'], 'no-store');
  assert.equal((await photoHandler({ lookupStatus: 500 }).get()).statusCode, 503);
  assert.equal((await photoHandler({ image: new Response('', { status: 403 }) }).get()).statusCode, 503);
  assert.equal((await photoHandler({ image: new Response('<html></html>', { status: 200 }) }).get()).statusCode, 422);
  const oversized = new Response(jpeg, { status: 200, headers: { 'content-length': String(1024 * 1024) } });
  assert.equal((await photoHandler({ image: oversized }).get()).statusCode, 413);
});
