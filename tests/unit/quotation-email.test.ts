import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ResendTransportError,
  sendQuotationEmailViaResend,
} from '../../api/_functions/lib/quotation-email.js';

const input = {
  recipient: 'cliente@example.com',
  businessNumber: 'ORC-42',
  attachmentUrl: 'https://app.example.com/api/public-quotation?token=abc&format=pdf',
  attemptId: '11111111-1111-4111-8111-111111111111',
  subject: 'Proposta ORC-42',
  html: '<p>Olá, Cliente</p>',
  text: 'Olá, Cliente',
};

function expectTransportError(error: unknown, kind: ResendTransportError['kind']): boolean {
  return error instanceof ResendTransportError && error.kind === kind;
}

test('Resend request contains rendered content, sender, attachment and idempotency key', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  const result = await sendQuotationEmailViaResend(input, {
    env: {
      RESEND_API_KEY: 'secret-test-key',
      RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>',
      RESEND_REPLY_TO: 'vendas@example.com',
    },
    fetchFn: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ id: 'resend-email-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(result.id, 'resend-email-1');
  assert.equal(capturedUrl, 'https://api.resend.com/emails');
  const headers = new Headers(capturedInit?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer secret-test-key');
  assert.equal(headers.get('Idempotency-Key'), `quotation-email/${input.attemptId}`);
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.from, 'Aspen <orcamentos@example.com>');
  assert.deepEqual(body.to, ['cliente@example.com']);
  assert.equal(body.reply_to, 'vendas@example.com');
  assert.equal(body.subject, input.subject);
  assert.equal(body.html, input.html);
  assert.equal(body.text, input.text);
  assert.equal(body.attachments[0].filename, 'orcamento-ORC-42.pdf');
  assert.equal(body.attachments[0].path, input.attachmentUrl);
  assert.equal(body.attachments[0].content, undefined);
});

test('missing Resend configuration is rejected without a provider call', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    sendQuotationEmailViaResend(input, {
      env: { RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>' },
      fetchFn: async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
      },
    }),
    (error: unknown) => expectTransportError(error, 'configuration'),
  );
  assert.equal(fetchCalls, 0);
});

test('HTTP 422 from Resend is rejected', async () => {
  await assert.rejects(
    sendQuotationEmailViaResend(input, {
      env: { RESEND_API_KEY: 'secret-test-key', RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>' },
      fetchFn: async () => new Response('{}', { status: 422 }),
    }),
    (error: unknown) => expectTransportError(error, 'rejected'),
  );
});

test('HTTP 5xx from Resend is uncertain without exposing provider details', async () => {
  const providerBody = 'provider-secret-body';
  await assert.rejects(
    sendQuotationEmailViaResend(input, {
      env: { RESEND_API_KEY: 'secret-test-key', RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>' },
      fetchFn: async () => new Response(JSON.stringify({ error: providerBody }), { status: 503 }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof ResendTransportError);
      assert.equal(error.kind, 'uncertain');
      assert.equal(error.message, 'O resultado do envio não pôde ser confirmado.');
      assert.doesNotMatch(error.message, new RegExp(providerBody));
      assert.doesNotMatch(error.message, /secret-test-key/);
      return true;
    },
  );
});

test('network failures are uncertain', async () => {
  await assert.rejects(
    sendQuotationEmailViaResend(input, {
      env: { RESEND_API_KEY: 'secret-test-key', RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>' },
      fetchFn: async () => { throw new Error('network secret'); },
    }),
    (error: unknown) => expectTransportError(error, 'uncertain'),
  );
});

test('successful responses without an identifier are uncertain', async () => {
  await assert.rejects(
    sendQuotationEmailViaResend(input, {
      env: { RESEND_API_KEY: 'secret-test-key', RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>' },
      fetchFn: async () => new Response(JSON.stringify({}), { status: 200 }),
    }),
    (error: unknown) => expectTransportError(error, 'uncertain'),
  );
});

test('non-HTTPS attachment URLs are rejected before transport', async () => {
  let fetchCalls = 0;
  await assert.rejects(
    sendQuotationEmailViaResend(
      { ...input, attachmentUrl: 'http://app.example.com/api/public-quotation?token=abc&format=pdf' },
      {
        env: { RESEND_API_KEY: 'secret-test-key', RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>' },
        fetchFn: async () => {
          fetchCalls += 1;
          return new Response('{}', { status: 200 });
        },
      },
    ),
    (error: unknown) => expectTransportError(error, 'rejected'),
  );
  assert.equal(fetchCalls, 0);
});
