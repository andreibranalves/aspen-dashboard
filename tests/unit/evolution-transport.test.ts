import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EvolutionTransportError,
  sendFrozenStep,
} from '../../api/_modules/evolution-transport.js';
import type { FrozenDeliveryStep } from '../../api/_infrastructure/db/repositories/quotation-delivery-outbox-repository.js';

const config = {
  baseUrl: 'https://evolution.test',
  apiKey: 'test-key',
  instance: 'test-instance',
};
const textStep: FrozenDeliveryStep = {
  position: 0,
  type: 'text',
  payload: { text: 'Olá' },
  delayMs: 0,
};

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function errorOf(error: unknown): EvolutionTransportError {
  assert.ok(error instanceof EvolutionTransportError);
  return error;
}

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('Expected promise rejection.');
}

test('transport classifies provider outcomes without guessing network delivery', async () => {
  const ambiguous = await rejected(
    sendFrozenStep({ phone: '5511999990000', step: textStep }, {
      ...config,
      fetch: async () => { throw new Error('socket closed'); },
    }),
  );
  assert.equal(errorOf(ambiguous).kind, 'ambiguous');

  const transient = await rejected(
    sendFrozenStep({ phone: '5511999990000', step: textStep }, {
      ...config,
      fetch: async () => response(429, { error: 'rate limit' }),
    }),
  );
  assert.equal(errorOf(transient).kind, 'transient_pre_transport');
});

test('transport rejects disallowed control characters and oversized text before provider access', async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return response(200, { accepted: true, message_id: 'unexpected' });
  };
  for (const text of ['Olá\rCliente', 'x'.repeat(4_001)]) {
    const error = await rejected(
      sendFrozenStep({ phone: '5511999990000', step: { ...textStep, payload: { text } } }, {
        ...config,
        fetch,
      }),
    );
    assert.equal(errorOf(error).kind, 'permanent_pre_transport');
  }
  assert.equal(calls, 0);
});

test('transport accepts newline and tab in outbound text', async () => {
  const bodies: unknown[] = [];
  await sendFrozenStep(
    { phone: '5511999990000', step: { ...textStep, payload: { text: 'Olá\nCliente\t1' } } },
    {
      ...config,
      fetch: async (_url: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body || '{}')));
        return response(200, { key: { id: 'provider-1' } });
      },
    },
  );
  assert.deepEqual(bodies, [{ number: '5511999990000', text: 'Olá\nCliente\t1' }]);
});

test('transport classifies malformed success, server failures and validation rejection', async () => {
  for (const body of [{}, { accepted: true }, 'not-json']) {
    const error = await rejected(
      sendFrozenStep({ phone: '5511999990000', step: textStep }, {
        ...config,
        fetch: async () => response(200, body),
      }),
    );
    assert.equal(errorOf(error).kind, 'ambiguous');
  }
  const serverError = await rejected(
    sendFrozenStep({ phone: '5511999990000', step: textStep }, {
      ...config,
      fetch: async () => response(503, { error: 'provider detail' }),
    }),
  );
  assert.equal(errorOf(serverError).kind, 'ambiguous');
  const validationError = await rejected(
    sendFrozenStep({ phone: '5511999990000', step: textStep }, {
      ...config,
      fetch: async () => response(400, { phone: 'private' }),
    }),
  );
  assert.equal(errorOf(validationError).kind, 'permanent_pre_transport');
});

test('transport accepts Evolution key.id and requires a prepared quotation document', async () => {
  const accepted = await sendFrozenStep({ phone: '5511999990000', step: textStep }, {
    ...config,
    fetch: async () => response(200, { key: { id: 'provider-1' }, status: 'PENDING' }),
  });
  assert.deepEqual(accepted, { accepted: true, providerMessageId: 'provider-1' });

  const pdfStep: FrozenDeliveryStep = {
    position: 1,
    type: 'quotation_pdf',
    payload: { revisionId: 'revision-1', fileName: 'ORC-1.pdf', caption: '' },
    delayMs: 0,
  };
  const error = await rejected(
    sendFrozenStep({ phone: '5511999990000', step: pdfStep }, {
      ...config,
      fetch: async () => response(200, { accepted: true, message_id: 'unexpected' }),
    }),
  );
  assert.equal(errorOf(error).kind, 'permanent_pre_transport');
});

test('transport sends a prepared quotation WebP as image media', async () => {
  let request: { path: string; body: Record<string, unknown> } | undefined;
  const webpStep: FrozenDeliveryStep = {
    position: 0,
    type: 'quotation_webp',
    payload: {
      revisionId: 'revision-1',
      fileName: 'ORC-1.pagina-1.webp',
      caption: 'Orçamento',
      page: 1,
      pageCount: 2,
    },
    delayMs: 0,
  };
  const image = Buffer.from('RIFF-test-WEBP');
  const accepted = await sendFrozenStep(
    {
      phone: '5511999990000',
      step: webpStep,
      image: {
        webp: image,
        webpSize: image.length,
        webpSignature: 'test',
        page: 1,
        pageCount: 2,
        validUntil: new Date(Date.now() + 86_400_000),
      },
    },
    {
      ...config,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        request = {
          path: String(input),
          body: JSON.parse(String(init?.body || '{}')) as Record<string, unknown>,
        };
        return response(200, { key: { id: 'webp-provider-1' }, status: 'PENDING' });
      },
    },
  );
  assert.deepEqual(accepted, { accepted: true, providerMessageId: 'webp-provider-1' });
  assert.equal(request?.path, 'https://evolution.test/message/sendMedia/test-instance');
  assert.equal(request?.body.mediatype, 'image');
  assert.equal(request?.body.mimetype, 'image/webp');
  assert.equal(request?.body.fileName, 'ORC-1.pagina-1.webp');
  assert.equal(request?.body.media, image.toString('base64'));
});

test('transport converts blocked external writes into a safe pre-transport failure', async () => {
  let calls = 0;
  const error = await rejected(
    sendFrozenStep({ phone: '5511999990000', step: textStep }, {
      client: {
        config: () => config,
        request: async () => {
          calls += 1;
          throw Object.assign(new Error('blocked'), { statusCode: 503 });
        },
      },
    }),
  );
  assert.equal(errorOf(error).kind, 'permanent_pre_transport');
  assert.equal(errorOf(error).code, 'EXTERNAL_WRITES_DISABLED');
  assert.equal(calls, 1);
});

test('transport rejects missing configuration and never logs request or response data', async () => {
  const logs: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const error = await rejected(
      sendFrozenStep({ phone: '5511999990000', step: textStep }, {
        fetch: async () => response(200, { accepted: true, message_id: 'provider-1' }),
        baseUrl: '',
        apiKey: '',
        instance: '',
      }),
    );
    assert.equal(errorOf(error).kind, 'permanent_pre_transport');
  } finally {
    console.error = original;
  }
  assert.deepEqual(logs, []);
});
