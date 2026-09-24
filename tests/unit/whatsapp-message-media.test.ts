import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createReceivedMediaHandler } from '../../api/_modules/whatsapp-message-media.js';
import { validateOperatorMedia } from '../../api/_modules/whatsapp-media-validation.js';
import { sendOperatorMedia } from '../../api/_modules/evolution-transport.js';
import { whatsappAttachments } from '../../api/_modules/whatsapp-attachments.js';

const id = randomUUID();
const conversationId = randomUUID();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');

function mediaHandler(input: { direction?: string; type?: string; providerMessageId?: string | null; payload?: unknown; instance?: string; contentLength?: string } = {}) {
  let requestBody: Record<string, unknown> | null = null;
  const handler = createReceivedMediaHandler({
    findMessage: async (messageId) => messageId === id ? {
      id, conversationId, providerMessageId: input.providerMessageId === undefined ? 'provider-1' : input.providerMessageId,
      direction: input.direction || 'inbound', type: input.type || 'image',
      instance: input.instance || 'installed', providerConversationId: '5511999999999@s.whatsapp.net',
    } : null,
    client: {
      config: () => ({ instance: 'installed', baseUrl: 'https://example.test', apiKey: 'test' }),
      request: async (_path, body, options) => {
        requestBody = body || null;
        assert.equal(options?.externalWrite, false);
        return new Response(JSON.stringify(input.payload ?? { base64: png.toString('base64'), mimetype: 'image/png' }), {
          status: 200, headers: input.contentLength ? { 'content-length': input.contentLength } : {},
        });
      },
    },
  });
  return {
    get: (messageId = id) => handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: messageId }, body: '' }),
    get requestBody() { return requestBody; },
  };
}

test('received media uses local message scope and returns only validated private bytes', async () => {
  const flow = mediaHandler();
  const result = await flow.get();
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers?.['Cache-Control'], 'private, no-store');
  assert.equal(result.headers?.['X-Content-Type-Options'], 'nosniff');
  assert.equal(result.isBase64Encoded, true);
  assert.deepEqual(Buffer.from(result.body || '', 'base64'), png);
  assert.deepEqual((flow.requestBody?.message as { key: object }).key, {
    id: 'provider-1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false,
  });
  assert.equal((await flow.get(randomUUID())).statusCode, 404);
  assert.equal((await mediaHandler({ direction: 'outbound' }).get()).statusCode, 404);
  assert.equal((await mediaHandler({ instance: 'another' }).get()).statusCode, 410);
});

test('expired, spoofed and unsupported media keep the message unavailable', async () => {
  assert.equal((await mediaHandler({ providerMessageId: null }).get()).statusCode, 410);
  assert.equal((await mediaHandler({ payload: { base64: png.toString('base64'), mimetype: 'application/pdf' } }).get()).statusCode, 422);
  assert.equal((await mediaHandler({ type: 'audio' }).get()).statusCode, 422);
  assert.equal((await mediaHandler({ type: 'video' }).get()).statusCode, 404);
  assert.equal((await mediaHandler({ contentLength: '5000000' }).get()).statusCode, 413);
});

test('operator upload rejects forged MIME, oversized content and noncanonical base64', () => {
  const valid = validateOperatorMedia({ base64: png.toString('base64'), mimeType: 'image/png', fileName: '../../a.html' });
  assert.equal(valid.fileName, 'a.png');
  assert.throws(() => validateOperatorMedia({ base64: png.toString('base64'), mimeType: 'application/pdf', fileName: 'a.pdf' }));
  assert.throws(() => validateOperatorMedia({ base64: 'abc=', mimeType: 'image/png', fileName: 'a.png' }));
  assert.throws(() => validateOperatorMedia({ base64: Buffer.alloc(3 * 1024 * 1024 + 1).toString('base64'), mimeType: 'image/png', fileName: 'a.png' }));
});

test('validated operator media uses sendMedia with base64 rather than a browser URL', async () => {
  let path = '';
  let payload: Record<string, unknown> | undefined;
  const result = await sendOperatorMedia({
    phone: '5511999999999', mediaType: 'document', mimeType: 'application/pdf',
    base64: Buffer.from('%PDF-1.4\n%%EOF').toString('base64'), fileName: 'pedido.pdf', caption: 'Segue arquivo',
  }, {
    client: {
      config: () => ({ instance: 'installed', baseUrl: 'https://example.test', apiKey: 'test' }),
      request: async (requestPath, body) => {
        path = requestPath;
        payload = body;
        return new Response(JSON.stringify({ key: { id: 'provider-sent' }, status: 'PENDING' }), { status: 200 });
      },
    },
  });
  assert.equal(path, '/message/sendMedia/installed');
  assert.equal(payload?.media, Buffer.from('%PDF-1.4\n%%EOF').toString('base64'));
  assert.equal(payload?.mimetype, 'application/pdf');
  assert.equal(result.providerMessageId, 'provider-sent');
});

test('attachment upload refuses browser and public Blob URLs', async () => {
  const result = await whatsappAttachments({
    httpMethod: 'POST', headers: {}, queryStringParameters: {},
    body: JSON.stringify({ conversationId, url: 'https://example.test/internal', base64: png.toString('base64'), mimeType: 'image/png', fileName: 'a.png' }),
  });
  assert.equal(result.statusCode, 400);
  assert.match(result.body || '', /URL de anexo não permitida/);
});
