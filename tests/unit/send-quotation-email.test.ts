import assert from 'node:assert/strict';
import test from 'node:test';
import type { RenderedQuotationEmail } from '../../api/_modules/quotation-email-renderer.js';
import type { FunctionEvent, FunctionResult } from '../../api/_http/types.js';
import type {
  QuotationEmailDelivery,
  QuotationEmailDeliveryRepository,
} from '../../api/_infrastructure/db/repositories/quotation-email-delivery-repository.js';
import {
  handler,
  type SendQuotationEmailDependencies,
} from '../../api/_modules/send-quotation-email.js';
import {
  ResendTransportError,
  sendQuotationEmailViaResend,
} from '../../api/_modules/quotation-email.js';

const quotationId = '11111111-1111-4111-8111-111111111111';
const revisionId = '22222222-2222-4222-8222-222222222222';
const otherRevisionId = '55555555-5555-4555-8555-555555555555';
const attemptId = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-17T12:00:00.000Z');
const RESERVED_EMAIL: RenderedQuotationEmail = {
  subject: 'Modelo reservado ORC-42',
  html: '<!doctype html><html><body>Modelo reservado ORC-42</body></html>',
  text: 'Modelo reservado ORC-42',
};
const DEFAULT_RENDERED_EMAIL: RenderedQuotationEmail = {
  subject: 'Orçamento ORC-42 - Aspen',
  html: '<!doctype html><html><body>Orçamento ORC-42 - Aspen</body></html>',
  text: 'Orçamento ORC-42 - Aspen',
};

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
  const state = overrides.state || 'pending';
  const { templateSnapshot, ...rest } = overrides;
  return {
    id: attemptId,
    revisionId,
    recipient: 'cliente@example.com',
    publicToken: 'stable-public-token',
    state,
    providerEmailId: null,
    publicError: null,
    acceptedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...rest,
    templateSnapshot: templateSnapshot === undefined
      ? (state === 'pending' ? DEFAULT_RENDERED_EMAIL : null)
      : templateSnapshot,
  };
}

type DeliveryOptions = {
  initial?: QuotationEmailDelivery | null;
  reserved?: QuotationEmailDelivery;
  reserveSnapshots?: RenderedQuotationEmail[];
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
      options.reserveSnapshots?.push(input.templateSnapshot);
      if (!current) {
        current = options.reserved || delivery({
          id: input.attemptId,
          revisionId: input.revisionId,
          recipient: input.recipient,
          publicToken: input.publicToken,
          templateSnapshot: input.templateSnapshot,
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
        templateSnapshot: null,
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
        templateSnapshot: null,
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
    const stableToken = input?.token?.() || '';
    assert.equal(stableToken, 'stable-public-token');
    return {
      token: stableToken,
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
      assert.match(input.html, /public-quotation\?token=stable-public-token/);
      assert.match(input.attachmentUrl, /public-quotation\?token=stable-public-token&format=pdf$/);
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

test('new attempt reserves and sends the code-defined rendered payload', async () => {
  const calls: string[] = [];
  const reserveSnapshots: RenderedQuotationEmail[] = [];
  let transportInput: Record<string, unknown> | undefined;

  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries(calls, { reserveSnapshots }),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async input => {
      calls.push('transport');
      transportInput = input as unknown as Record<string, unknown>;
      return { id: 'email_123' };
    },
    token: () => 'stable-public-token',
    now: () => NOW,
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    {
      subject: transportInput?.subject,
      html: transportInput?.html,
      text: transportInput?.text,
    },
    reserveSnapshots[0],
  );
  assert.equal(transportInput?.subject, 'Orçamento ORC-42 - Aspen');
  assert.match(String(transportInput?.html), /Cliente Teste/);
  assert.match(String(transportInput?.text), /https:\/\/localhost:5173\/api\/public-quotation/);
  assert.deepEqual(calls, ['reserve', 'transport', 'markAccepted']);
});

test('pending retry reuses the exact reserved rendered payload', async () => {
  let transportInput: Record<string, unknown> | undefined;

  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries([], { initial: delivery({ templateSnapshot: RESERVED_EMAIL }) }),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    renderEmail: async () => { throw new Error('renderer must not run'); },
    transport: async input => {
      transportInput = input as unknown as Record<string, unknown>;
      return { id: 'email_123' };
    },
    now: () => NOW,
  });

  assert.equal(result.statusCode, 200);
  assert.equal(transportInput?.subject, RESERVED_EMAIL.subject);
  assert.equal(transportInput?.html, RESERVED_EMAIL.html);
  assert.equal(transportInput?.text, RESERVED_EMAIL.text);
});

test('pending retry keeps the original quotation URL for the PDF attachment', async () => {
  let firstInput: Record<string, unknown> | undefined;
  let secondInput: Record<string, unknown> | undefined;
  const deliveries = fakeDeliveries([]);

  const first = await handler(event('POST', payload()), {
    deliveries,
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async input => {
      firstInput = input as unknown as Record<string, unknown>;
      throw new ResendTransportError('provider result unknown', 'uncertain');
    },
    token: () => 'stable-public-token',
    now: () => NOW,
  });

  const second = await handler(event('POST', payload()), {
    deliveries,
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async input => {
      secondInput = input as unknown as Record<string, unknown>;
      return { id: 'email_123' };
    },
    env: { VERCEL_PROJECT_PRODUCTION_URL: 'changed.example.com' },
    token: () => 'discarded-token',
    now: () => NOW,
  });

  assert.equal(first.statusCode, 503);
  assert.equal(second.statusCode, 200);
  assert.equal(secondInput?.html, firstInput?.html);
  assert.equal(secondInput?.text, firstInput?.text);
  assert.equal(secondInput?.attachmentUrl, firstInput?.attachmentUrl);
});

test('render failures stop before reservation and provider calls', async () => {
  const calls: string[] = [];
  let providerCalled = false;
  const result = await handler(event('POST', payload(), { host: 'app.example.com' }), {
    deliveries: fakeDeliveries(calls),
    snapshots: snapshots(snapshot()),
    renderEmail: async () => { throw new Error('renderer secret'); },
    transport: async () => {
      providerCalled = true;
      return { id: 'email_123' };
    },
    token: () => 'stable-public-token',
    now: () => NOW,
  });

  assert.equal(result.statusCode, 500);
  assert.deepEqual(parse(result), { error: 'Erro interno. Tente novamente.' });
  assert.deepEqual(calls, []);
  assert.equal(providerCalled, false);
});

test('normalizes recipient and never accepts a body-provided base URL', async () => {
  let sentHtml = '';
  const result = await handler(event('POST', {
    ...payload(attemptId, revisionId, ' CLIENTE@EXAMPLE.COM '),
    base_url: 'https://evil.example',
  }), {
    deliveries: fakeDeliveries([]),
    snapshots: snapshots(snapshot()),
    issueToken: acceptedToken(),
    transport: async (input) => {
      sentHtml = input.html;
      return { id: 'resend-email-1' };
    },
    token: () => 'stable-public-token',
    now: () => NOW,
  });

  assert.equal(result.statusCode, 200);
  assert.match(sentHtml, /https:\/\/localhost:5173\/api\/public-quotation/);
  assert.doesNotMatch(sentHtml, /evil\.example/);
});

test('uses the trusted deployment origin instead of request host or body origin', async () => {
  let sentHtml = '';
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
      sentHtml = input.html;
      return { id: 'resend-email-1' };
    },
    env: { VERCEL_PROJECT_PRODUCTION_URL: 'trusted.example.com' },
    token: () => 'stable-public-token',
    now: () => NOW,
  });

  assert.equal(result.statusCode, 200);
  assert.match(sentHtml, /https:\/\/trusted\.example\.com\/api\/public-quotation/);
  assert.doesNotMatch(sentHtml, /attacker|body-attacker/);
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
        token: 'racing-stable-token',
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

test('token issuance failure after reservation keeps the attempt retryable', async () => {
  const calls: string[] = [];
  const result = await handler(event('POST', payload()), {
    deliveries: fakeDeliveries(calls),
    snapshots: snapshots(snapshot()),
    issueToken: async () => { throw new Error('token secret'); },
  });

  assert.equal(result.statusCode, 503);
  assert.deepEqual(parse(result), {
    error: 'O resultado do envio não pôde ser confirmado. Tente novamente.',
    retry_same_attempt: true,
  });
  assert.deepEqual(calls, ['reserve']);
  assert.doesNotMatch(result.body || '', /token secret|stack trace|Error/);
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
