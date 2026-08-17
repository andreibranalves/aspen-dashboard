import assert from 'node:assert/strict';
import test from 'node:test';
import type { FunctionEvent, FunctionResult } from '../../api/_lib/types.js';
import type {
  QuotationEmailDelivery,
  QuotationEmailDeliveryRepository,
} from '../../api/_db/quotation-email-delivery-repository.js';
import {
  handler,
  type SendQuotationEmailDependencies,
} from '../../api/_functions/send-quotation-email.js';
import {
  ResendTransportError,
  sendQuotationEmailViaResend,
} from '../../api/_functions/lib/quotation-email.js';

const quotationId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const otherRevisionId = '55555555-5555-4555-8555-555555555555';
const attemptId = '33333333-3333-4333-8333-333333333333';
const otherAttemptId = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-08-17T12:00:00.000Z');

function event(
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): FunctionEvent {
  return {
    httpMethod: method,
    headers: { host: 'localhost:5173', 'x-forwarded-proto': 'https', ...headers },
    queryStringParameters: {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function payload(id = attemptId, revision = revisionId, email = 'cliente@example.com') {
  return { revision_id: revision, recipient: email, attempt_id: id };
}

function snapshot(status = 'emitido') {
  return {
    quotation: { id: quotationId, businessNumber: 'ORC-42' },
    revision: { id: revisionId, status, clienteNome: 'Cliente Teste' },
  } as any;
}

function delivery(
  overrides: Partial<QuotationEmailDelivery> = {},
): QuotationEmailDelivery {
  return {
    id: attemptId,
    revisionId,
    recipient: 'cliente@example.com',
    publicToken: 'stable-public-token',
    state: 'pending',
    providerEmailId: null,
    publicError: null,
    acceptedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

type DeliveryOptions = {
  initial?: QuotationEmailDelivery | null;
  reserved?: QuotationEmailDelivery;
  markAcceptedError?: Error;
  markFailedError?: Error;
};

function fakeDeliveries(calls: string[], options: DeliveryOptions = {}): QuotationEmailDeliveryRepository {
  let current = options.initial ?? null;
  return {
    async get() {
      return current;
    },
    async reserve(input) {
      calls.push('reserve');
      if (!current) {
        current = options.reserved || delivery({
          id: input.attemptId,
          revisionId: input.revisionId,
          recipient: input.recipient,
          publicToken: input.publicToken,
        });
      }
      return { kind: current.id === input.attemptId ? 'existing' : 'reserved', delivery: current };
    },
    async markAccepted(input) {
      calls.push('markAccepted');
      if (options.markAcceptedError) throw options.markAcceptedError;
      current = delivery({
        ...current,
        state: 'accepted',
        providerEmailId: input.providerEmailId,
        publicToken: null,
        acceptedAt: NOW,
      });
      return current;
    },
    async markFailed(input) {
      calls.push('markFailed');
      if (options.markFailedError) throw options.markFailedError;
      current = delivery({
        ...current,
        state: 'failed',
        publicToken: null,
        publicError: input.publicError,
      });
      return current;
    },
  };
}

function snapshots(value: unknown) {
  return { get: async () => value } as SendQuotationEmailDependencies['snapshots'];
}

function parse(result: FunctionResult): Record<string, any> {
  return JSON.parse(result.body || '{}');
}

function acceptedToken() {
  return async (
    input?: NonNullable<Parameters<NonNullable<SendQuotationEmailDependencies['issueToken']>>[0]>,
  ) => {
    assert.equal(input?.token?.(), 'stable-public-token');
    return {
      token: 'public-token',
      expiresAt: Date.now() + 60_000,
      revisionId,
      quotationId,
      businessNumber: 'ORC-42',
    };
  };
}

test('accepted Resend response marks attempt and returns safe projection', async () => {
  const calls: string[] = [];
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries(calls),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async (input) => {
      calls.push('transport');
      assert.equal(input.recipient, 'cliente@example.com');
      assert.match(input.publicUrl, /public-quotation\?token=public-token$/);
      assert.match(input.attachmentUrl, /public-quotation\?token=public-token&format=pdf$/);
      return { id: 'resend-email-1' };
    },
    token: () => 'stable-public-token',
    now: () => NOW,
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(parse(result), {
    success: true,
    delivery: {
      state: 'accepted',
      recipient: 'cliente@example.com',
      accepted_at: '2026-08-17T12:00:00.000Z',
    },
  });
  assert.deepEqual(calls, ['reserve', 'transport', 'markAccepted']);
});

test('normalizes recipient and never accepts a body-provided base URL', async () => {
  let sentUrl = '';
  const result = await handler(event('POST', {
    ...payload(attemptId, revisionId, ' CLIENTE@EXAMPLE.COM '),
    base_url: 'https://evil.example',
  }), {
    deliveries: fakeDeliveries([]),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async (input) => {
      sentUrl = input.publicUrl;
      return { id: 'resend-email-1' };
    },
    token: () => 'stable-public-token',
    now: () => NOW,
  });

  assert.equal(result.statusCode, 200);
  assert.match(sentUrl, /^https:\/\/localhost:5173\/api\/public-quotation/);
  assert.doesNotMatch(sentUrl, /evil\.example/);
});

test('uses the trusted deployment origin instead of request host or body origin', async () => {
  let sentUrl = '';
  const result = await handler(event('POST', {
    ...payload(),
    base_url: 'https://body-attacker.example',
  }, {
    host: 'attacker.example.com',
    'x-forwarded-host': 'attacker.example.com',
  }), {
    deliveries: fakeDeliveries([]),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async (input) => {
      sentUrl = input.publicUrl;
      return { id: 'resend-email-1' };
    },
    env: { VERCEL_PROJECT_PRODUCTION_URL: 'trusted.example.com' },
    token: () => 'stable-public-token',
    now: () => NOW,
  });

  assert.equal(result.statusCode, 200);
  assert.match(sentUrl, /^https:\/\/trusted\.example\.com\/api\/public-quotation/);
  assert.doesNotMatch(sentUrl, /attacker|body-attacker/);
});

test('rejects an untrusted production request host without sending', async () => {
  let transportCalls = 0;
  const result = await handler(event('POST', payload(), {
    host: 'attacker.example.com',
    'x-forwarded-host': 'attacker.example.com',
  }), {
    deliveries: fakeDeliveries([]),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async () => {
      transportCalls += 1;
      return { id: 'resend-email-1' };
    },
    env: {},
    token: () => 'stable-public-token',
    now: () => NOW,
  });

  assert.equal(result.statusCode, 500);
  assert.deepEqual(parse(result), { error: 'Erro interno. Tente novamente.' });
  assert.equal(transportCalls, 0);
  assert.doesNotMatch(result.body || '', /attacker\.example\.com|stable-public-token/);
});

test('classifies a provider HTTP 5xx as uncertain and keeps the attempt pending', async () => {
  const providerBody = 'provider-secret-body';
  const calls: string[] = [];
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries(calls),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async (input, transportDependencies) => sendQuotationEmailViaResend(input, {
      env: transportDependencies?.env,
      fetchFn: async () => new Response(JSON.stringify({ error: providerBody }), { status: 503 }),
    }),
    env: {
      RESEND_API_KEY: 'secret-test-key',
      RESEND_FROM_EMAIL: 'Aspen <orcamentos@example.com>',
    },
    token: () => 'stable-public-token',
    now: () => NOW,
  });

  assert.equal(result.statusCode, 503);
  assert.deepEqual(parse(result), {
    error: 'O resultado do envio não pôde ser confirmado. Tente novamente.',
    retry_same_attempt: true,
  });
  assert.deepEqual(calls, ['reserve']);
  assert.doesNotMatch(result.body || '', /provider-secret-body|secret-test-key/);
});

test('rejects non-POST, malformed JSON, invalid UUID and invalid e-mail', async () => {
  assert.equal((await handler(event('GET', payload()))).statusCode, 405);
  assert.equal((await handler(event('POST', '{'))).statusCode, 400);
  assert.equal((await handler(event('POST', payload('not-a-uuid')))).statusCode, 400);
  assert.equal((await handler(event('POST', payload(attemptId, 'not-a-uuid')))).statusCode, 400);
  const invalidEmail = await handler(event('POST', payload(attemptId, revisionId, 'not-an-email')));
  assert.equal(invalidEmail.statusCode, 400);
  assert.equal(parse(invalidEmail).error, 'E-mail inválido.');
});

test('returns 404 for an unknown revision and 409 for a draft', async () => {
  const unknown = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries([]),
    snapshots: snapshots(null),
  });
  assert.equal(unknown.statusCode, 404);

  const draft = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries([]),
    snapshots: snapshots(snapshot('rascunho')),
  });
  assert.equal(draft.statusCode, 409);
  assert.equal(parse(draft).error, 'Emita o orçamento antes de enviar por e-mail.');
});

test('returns an already accepted attempt without token or transport', async () => {
  const calls: string[] = [];
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries(calls, {
      initial: delivery({ state: 'accepted', publicToken: null, providerEmailId: 'resend-email-1', acceptedAt: NOW }),
    }),
    snapshots: {
      get: async () => { throw new Error('snapshot must not be read'); },
    } as any,
    issueToken: async () => { throw new Error('token must not be issued'); },
    transport: async () => { throw new Error('transport must not run'); },
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(parse(result).delivery, {
    state: 'accepted',
    recipient: 'cliente@example.com',
    accepted_at: '2026-08-17T12:00:00.000Z',
  });
  assert.deepEqual(calls, []);
});

test('rejects accepted attempts with mismatched revision or recipient before side effects', async () => {
  for (const request of [
    payload(attemptId, otherRevisionId),
    payload(attemptId, revisionId, 'outro@example.com'),
  ]) {
    const calls: string[] = [];
    const result = await handler(event('POST', request), {
      deliveries: fakeDeliveries(calls, {
        initial: delivery({
          state: 'accepted',
          publicToken: null,
          providerEmailId: 'resend-email-1',
          acceptedAt: NOW,
        }),
      }),
      snapshots: {
        get: async () => { throw new Error('snapshot must not be read'); },
      } as any,
      issueToken: async () => { throw new Error('token must not be issued'); },
      transport: async () => { throw new Error('transport must not run'); },
    });

    assert.equal(result.statusCode, 409);
    assert.deepEqual(parse(result), {
      error: 'O identificador pertence a outra tentativa.',
      retry_same_attempt: false,
    });
    assert.doesNotMatch(result.body || '', /cliente@example.com|resend-email-1/);
    assert.deepEqual(calls, []);
  }
});

test('rejects an accepted reservation with mismatched ownership before side effects', async () => {
  const calls: string[] = [];
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries(calls, {
      reserved: delivery({
        state: 'accepted',
        revisionId: otherRevisionId,
        recipient: 'outro@example.com',
        publicToken: null,
        providerEmailId: 'resend-email-2',
        acceptedAt: NOW,
      }),
    }),
    snapshots: snapshots(snapshot()),
    issueToken: async () => { throw new Error('token must not be issued'); },
    transport: async () => { throw new Error('transport must not run'); },
  });

  assert.equal(result.statusCode, 409);
  assert.deepEqual(parse(result), {
    error: 'O identificador pertence a outra tentativa.',
    retry_same_attempt: false,
  });
  assert.doesNotMatch(result.body || '', /outro@example.com|resend-email-2/);
  assert.deepEqual(calls, ['reserve']);
});

test('requires a new attempt after a failed attempt', async () => {
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries([], {
      initial: delivery({ state: 'failed', publicToken: null, publicError: 'A Resend não aceitou o e-mail.' }),
    }),
    snapshots: {
      get: async () => { throw new Error('snapshot must not be read'); },
    } as any,
  });

  assert.equal(result.statusCode, 409);
  assert.equal(parse(result).retry_same_attempt, false);
});

test('marks configuration failures and returns a safe 503', async () => {
  const calls: string[] = [];
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries(calls),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async () => {
      throw new ResendTransportError('provider secret', 'configuration');
    },
    token: () => 'stable-public-token',
  });

  assert.equal(result.statusCode, 503);
  assert.equal(parse(result).error, 'Envio por e-mail não configurado.');
  assert.equal(parse(result).retry_same_attempt, false);
  assert.deepEqual(calls, ['reserve', 'markFailed']);
});

test('marks rejected Resend responses failed and forbids same-attempt retry', async () => {
  const calls: string[] = [];
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries(calls),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async () => {
      throw new ResendTransportError('provider secret', 'rejected');
    },
    token: () => 'stable-public-token',
  });

  assert.equal(result.statusCode, 502);
  assert.equal(parse(result).error, 'A Resend não aceitou o e-mail.');
  assert.equal(parse(result).retry_same_attempt, false);
  assert.deepEqual(calls, ['reserve', 'markFailed']);
});

test('preserves ambiguous retry when failed persistence is not confirmed', async () => {
  const calls: string[] = [];
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries(calls, {
      markFailedError: new Error('database secret'),
    }),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async () => {
      throw new ResendTransportError('provider secret', 'configuration');
    },
    token: () => 'stable-public-token',
  });

  assert.equal(result.statusCode, 503);
  assert.deepEqual(parse(result), {
    error: 'O resultado do envio não pôde ser confirmado. Tente novamente.',
    retry_same_attempt: true,
  });
  assert.doesNotMatch(result.body || '', /database secret|provider secret/);
  assert.deepEqual(calls, ['reserve', 'markFailed']);
});

test('keeps uncertain provider results pending for same-attempt retry', async () => {
  const calls: string[] = [];
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries(calls),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async () => {
      throw new ResendTransportError('provider secret', 'uncertain');
    },
    token: () => 'stable-public-token',
  });

  assert.equal(result.statusCode, 503);
  assert.equal(parse(result).error, 'O resultado do envio não pôde ser confirmado. Tente novamente.');
  assert.equal(parse(result).retry_same_attempt, true);
  assert.deepEqual(calls, ['reserve']);
});

test('keeps pending after markAccepted failure and allows same-attempt retry', async () => {
  const calls: string[] = [];
  const deliveries = fakeDeliveries(calls, {
    markAcceptedError: new Error('database secret'),
  });
  const result = await handler(event('POST', payload()), {
    deliveries,
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async () => ({ id: 'resend-email-1' }),
    token: () => 'stable-public-token',
  });

  assert.equal(result.statusCode, 503);
  assert.equal(parse(result).retry_same_attempt, true);
  assert.doesNotMatch(result.body || '', /database secret|resend-email-1|Cliente Teste|public-token/);
  assert.deepEqual(calls, ['reserve', 'markAccepted']);
});

test('uses the stable token when another reservation wins the insert race', async () => {
  let issuedToken = '';
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries([], {
      reserved: delivery({ publicToken: 'racing-stable-token' }),
    }),
    snapshots: snapshots(snapshot()),
    issueToken: async (input) => {
      issuedToken = input?.token?.() || '';
      return {
        token: 'public-token',
        expiresAt: Date.now() + 60_000,
        revisionId,
        quotationId,
        businessNumber: 'ORC-42',
      };
    },
    transport: async () => ({ id: 'resend-email-1' }),
    token: () => 'discarded-racing-token',
  });

  assert.equal(result.statusCode, 200);
  assert.equal(issuedToken, 'racing-stable-token');
});

test('uses safe internal 500 responses for unrelated pre-provider failures', async () => {
  const cases: Array<[string, SendQuotationEmailDependencies]> = [
    [
      'lookup secret',
      {
        deliveries: {
          get: async () => { throw new Error('lookup secret'); },
          reserve: async () => { throw new Error('must not reserve'); },
          markAccepted: async () => { throw new Error('must not accept'); },
          markFailed: async () => { throw new Error('must not fail'); },
        },
      },
    ],
    [
      'snapshot secret',
      {
        deliveries: fakeDeliveries([]),
        snapshots: { get: async () => { throw new Error('snapshot secret'); } } as any,
      },
    ],
    [
      'token secret',
      {
        deliveries: fakeDeliveries([]),
        snapshots: snapshots(snapshot()),
        issueToken: async () => { throw new Error('token secret'); },
      },
    ],
    [
      'host secret',
      {
        deliveries: fakeDeliveries([]),
        snapshots: snapshots(snapshot()),
        issueToken: acceptedToken(),
        transport: async () => { throw new Error('must not send'); },
      },
    ],
  ];

  for (const [failure, dependencies] of cases) {
    const request = failure === 'host secret'
      ? event('POST', payload(), { host: 'invalid host' })
      : event('POST', payload());
    const result = await handler(request, dependencies);

    assert.equal(result.statusCode, 500, failure);
    assert.deepEqual(parse(result), { error: 'Erro interno. Tente novamente.' }, failure);
    assert.doesNotMatch(result.body || '', /secret|stack trace|Error/, failure);
  }
});
