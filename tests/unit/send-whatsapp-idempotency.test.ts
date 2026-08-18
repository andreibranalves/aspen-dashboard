import assert from 'node:assert/strict';
import test from 'node:test';

import { handler as sendWhatsappFlow } from '../../api/modules/send-whatsapp-flow.js';
import { QuotationDeliveryConflictError, QuotationDeliveryPdfError } from '../../api/infrastructure/db/repositories/quotation-delivery-repository.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/modules/quotation-template-catalog.js';
import { createFakeWhatsappReservationStore } from '../fixtures/fake-whatsapp-reservation-store.mjs';

const quotationId = 'quote-00000000-0000-4000-8000-000000000001';
const revisionId = 'revision-0000-0000-4000-8000-000000000001';
const businessNumber = 'ORC-20260001';
const publicToken = 'A'.repeat(32);

function snapshot() {
  return {
    quotation: {
      id: quotationId,
      businessNumber,
      clientId: 'client-1',
      status: 'enviado',
      createdAt: new Date('2026-08-08T10:00:00.000Z'),
      updatedAt: new Date('2026-08-08T10:00:00.000Z'),
    },
    revision: {
      id: revisionId,
      quotationId,
      version: 1,
      status: 'enviado',
      validadeDias: 30,
      pagamento: 'Pix',
      entrega: '30 dias',
      templatePadrao: 'padrao',
      templateHash: DEFAULT_QUOTATION_TEMPLATE.hash,
      fretePadrao: '0.00',
      frete: '0.00',
      observacoes: '',
      prazoProducao: '30 dias',
      clienteNome: 'Cliente Teste',
      clienteTelefone: '11999990000',
      clienteEmail: 'cliente@example.test',
      clienteDocumento: null,
      clienteEndereco: null,
      clienteNumero: null,
      clienteBairro: null,
      clienteComplemento: null,
      clienteMunicipio: null,
      clienteUf: null,
      clienteCep: null,
      clienteNotas: null,
      subtotal: '20.00',
      total: '20.00',
      createdAt: new Date('2026-08-08T10:00:00.000Z'),
      templateVersionId: null,
      sectionsSnapshot: null,
      statusOriginal: null,
      orderLinkage: null,
      orderPending: false,
    },
    templateVersion: null,
    sectionsSnapshot: null,
    items: [{
      id: 'item-1',
      revisionId,
      position: 0,
      produtoSku: 'CNG-001',
      productSku: 'CNG-001',
      produtoNome: 'Canga',
      produtoDescricao: 'Canga teste',
      produtoUnidade: 'UN',
      produtoCategoria: 'canga',
      produtoMarca: '',
      quantidade: '2',
      precoSugerido: '10.00',
      precoAplicado: '10.00',
      diferencaPreco: '0.00',
      totalLinha: '20.00',
      precoFonte: 'catalogo',
      precoMinimoFaixa: '0.00',
      manualRate: false,
    }],
  } as any;
}

function repository() {
  return { get: async (id: string) => id === revisionId ? snapshot() : null } as any;
}

function tokenStore() {
  const values = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (values.get(key) as T | undefined) || null,
    set: async (key: string, value: unknown) => { values.set(key, value); return 'OK'; },
    del: async (key: string) => values.delete(key),
  };
}

function event(body: Record<string, unknown>) {
  return {
    httpMethod: 'POST',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    body: JSON.stringify(body),
  } as any;
}

function flowDependencies(reservationStore: unknown, overrides: Record<string, unknown> = {}) {
  return {
    reservationStore,
    resolveFlow: async () => ({
      id: 'flow-id',
      name: 'Fluxo',
      delay_min_seconds: 0,
      delay_max_seconds: 0,
      steps: [{ type: 'text', template: 'Olá' }, { type: 'document', source: 'quotation_pdf' }],
    }),
    repository: repository(),
    store: tokenStore(),
    token: () => publicToken,
    renderPdf: async () => Buffer.from('%PDF-1.7\nbody\n%%EOF'),
    recordSendEvent: async () => 'event-1',
    ...overrides,
  } as any;
}

class AtomicReservationStore {
  readonly delegate = createFakeWhatsappReservationStore();
  readonly records = this.delegate.records;

  reserve(input: any) { return this.delegate.reserve(input); }
  compareAndSet(input: any) { return this.delegate.compareAndSet(input); }
  cas(input: any) { return this.delegate.cas(input); }
  resolve(input: any) { return this.delegate.resolve(input); }
  transition(input: any) { return this.delegate.transition(input); }
  get(key: string) { return this.delegate.get(key); }
}

function evolutionEnv(
  overrides: { appEnv?: string; writes?: string } = {},
) {
  const previous = {
    baseUrl: process.env.EVOLUTION_BASE_URL,
    apiKey: process.env.EVOLUTION_API_KEY,
    instance: process.env.EVOLUTION_INSTANCE,
    appEnv: process.env.APP_ENV,
    writes: process.env.EXTERNAL_WRITES_ENABLED,
  };
  process.env.EVOLUTION_BASE_URL = 'https://evolution.test';
  process.env.EVOLUTION_API_KEY = 'test-key';
  process.env.EVOLUTION_INSTANCE = 'test-instance';
  process.env.APP_ENV = overrides.appEnv || 'production';
  process.env.EXTERNAL_WRITES_ENABLED = overrides.writes || '1';
  return () => {
    for (const [key, value] of Object.entries({
      EVOLUTION_BASE_URL: previous.baseUrl,
      EVOLUTION_API_KEY: previous.apiKey,
      EVOLUTION_INSTANCE: previous.instance,
      APP_ENV: previous.appEnv,
      EXTERNAL_WRITES_ENABLED: previous.writes,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('delivery PDF preparation failure preserves verified public classification before transport', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const states: Array<{ state: string; publicError?: string }> = [];
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'unexpected' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-pdf-failure' }),
      flowDependencies(new AtomicReservationStore(), {
        deliveryRepository: {
          prepareDelivery: async () => { throw new QuotationDeliveryPdfError(); },
          reserve: async () => { throw new Error('unreachable'); },
          recordState: async (input: { state: string; publicError?: string }) => { states.push(input); },
        },
      }),
    );
    assert.equal(response.statusCode, 503);
    const responseBody = JSON.parse(response.body || '{}');
    assert.deepEqual(responseBody, {
      error: 'PDF indisponível. Tentar novamente.',
      send_status: 'retryable',
    });
    assert.deepEqual(states, [{ revisionId, state: 'retryable', publicError: 'PDF indisponível. Tentar novamente.' }]);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('PDF persistence failure returns conservative reconciliation without transport', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const states: Array<{ state: string; publicError?: string }> = [];
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'unexpected' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-pdf-persistence-failure' }),
      flowDependencies(new AtomicReservationStore(), {
        deliveryRepository: {
          prepareDelivery: async () => { throw new QuotationDeliveryPdfError(); },
          reserve: async () => { throw new Error('unreachable'); },
          recordState: async (input: { state: string; publicError?: string }) => {
            states.push(input);
            if (input.state === 'retryable') throw new Error('CAS failed');
          },
        },
      }),
    );
    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body || '{}'), {
      error: 'O envio permanece em reconciliação. Não reenvie automaticamente.',
      send_status: 'reconciling',
      reconciliation_required: true,
    });
    assert.deepEqual(states.map(({ state }) => state), ['retryable', 'reconciling']);
    assert.equal(states.at(-1)?.publicError, 'A falha do PDF não pôde ser persistida. Reconciliação necessária.');
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('generic delivery preparation failure is not mislabeled as a PDF failure', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const states: Array<{ state: string; publicError?: string }> = [];
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'unexpected' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-generic-preparation-failure' }),
      flowDependencies(new AtomicReservationStore(), {
        deliveryRepository: {
          prepareDelivery: async () => { throw Object.assign(new Error('Não foi possível preparar a entrega do orçamento.'), { statusCode: 503 }); },
          reserve: async () => { throw new Error('unreachable'); },
          recordState: async (input: { state: string; publicError?: string }) => { states.push(input); },
        },
      }),
    );
    const responseBody = JSON.parse(response.body || '{}');
    assert.equal(response.statusCode, 503);
    assert.doesNotMatch(String(responseBody.error), /PDF indisponível/i);
    assert.equal(responseBody.send_status, undefined);
    assert.equal(states.some((state) => /PDF indisponível/i.test(String(state.publicError))), false);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('missing KV never resends completed or reconciling PostgreSQL delivery', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls += 1; return new Response(JSON.stringify({ key: { id: 'provider-id' } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    for (const state of ['completed', 'reconciling']) {
      const response = await sendWhatsappFlow(
        event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: `flow-pg-${state}` }),
        flowDependencies(new AtomicReservationStore(), {
          deliveryRepository: {
            prepareDelivery: async () => { throw new QuotationDeliveryConflictError(`Entrega ${state} bloqueia reenvio.`); },
            reserve: async () => { throw new Error('unreachable'); },
            recordState: async () => { throw new Error('unreachable'); },
          },
        }),
      );
      assert.equal(response.statusCode, 409);
    }
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('provider response without acceptance persists reconciling summary', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const states: string[] = [];
  globalThis.fetch = (async () => new Response(JSON.stringify({ accepted: false }), { status: 200 })) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-no-acceptance' }),
      flowDependencies(new AtomicReservationStore(), {
        deliveryRepository: {
          prepareDelivery: async ({ revisionId: selectedRevision, flowId }: { revisionId: string; flowId: string }) => ({
            delivery: { id: 'delivery', revisionId: selectedRevision, phone: '5511999990000', flowId, state: 'pending' },
            pdf: Buffer.from('%PDF-1.7\\nbody\\n%%EOF'), pdfSize: 20, pdfSignature: 'a'.repeat(64), validUntil: new Date('2026-09-12T00:00:00.000Z'),
          }),
          reserve: async () => ({ id: 'delivery', state: 'pending' }),
          recordState: async (input: { state: string }) => { states.push(input.state); },
        },
      }),
    );
    assert.equal(response.statusCode, 503);
    assert.ok(states.includes('reconciling'));
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('different flow keys reserve independently', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const reservationStore = new AtomicReservationStore();
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: `provider-${providerCalls}` }), { status: 200 });
  }) as typeof fetch;
  try {
    const first = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-a' }),
      flowDependencies(reservationStore),
    );
    const second = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-b' }),
      flowDependencies(reservationStore),
    );
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(providerCalls, 4);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('same exact quotation revision flow reserves before transport and calls provider once', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const reservationStore = new AtomicReservationStore();
  let providerCalls = 0;
  let releaseProvider!: () => void;
  const providerStarted = new Promise<void>((resolve) => { releaseProvider = resolve; });
  globalThis.fetch = (async () => {
    providerCalls += 1;
    await providerStarted;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-secret' }), { status: 200 });
  }) as typeof fetch;
  try {
    const input = event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-id' });
    const first = sendWhatsappFlow(input, flowDependencies(reservationStore));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = sendWhatsappFlow(input, flowDependencies(reservationStore));
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseProvider();
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    assert.equal(providerCalls, 2);
    assert.ok([200, 409, 503].includes(firstResponse.statusCode || 0));
    assert.ok([200, 409, 503].includes(secondResponse.statusCode || 0));
    assert.equal(JSON.stringify(firstResponse).includes('provider-secret'), false);
    assert.equal(JSON.stringify(secondResponse).includes('provider-secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('completed replay projects a neutral result without recipient phone', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const reservationStore = new AtomicReservationStore();
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: `provider-${providerCalls}` }), { status: 200 });
  }) as typeof fetch;
  try {
    const first = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-replay' }),
      flowDependencies(reservationStore),
    );
    assert.equal(first.statusCode, 200);
    const replay = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-replay' }),
      flowDependencies(reservationStore),
    );
    assert.equal(replay.statusCode, 200);
    const body = JSON.parse(replay.body || '{}');
    assert.equal(body.send_status, 'completed');
    assert.equal(body.phone, undefined);
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('safe pre-transport failure transitions to explicit retryable state', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const reservationStore = new AtomicReservationStore();
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-safe-retry' }), { status: 200 });
  }) as typeof fetch;
  try {
    const first = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-retry' }),
      {
        ...flowDependencies(reservationStore),
        beforeTransport: async () => { throw new Error('falha antes do transporte'); },
      },
    );
    assert.equal(first.statusCode, 500);
    assert.equal(JSON.parse(first.body || '{}').send_status, 'retryable');
    assert.equal(providerCalls, 0);

    const second = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-retry' }),
      flowDependencies(reservationStore),
    );
    assert.equal(second.statusCode, 200);
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('provider response without explicit acceptance stays in reconciliation and never resends', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const reservationStore = new AtomicReservationStore();
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  }) as typeof fetch;
  try {
    const first = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-unknown' }),
      flowDependencies(reservationStore),
    );
    assert.equal(first.statusCode, 503);
    assert.equal(JSON.parse(first.body || '{}').send_status, 'reconciling');
    assert.equal(providerCalls, 1);

    const second = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-unknown' }),
      flowDependencies(reservationStore),
    );
    assert.equal(second.statusCode, 409);
    assert.equal(JSON.parse(second.body || '{}').reconciliation_required, true);
    assert.equal(providerCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('accepted transport failure persists reconciliation and never resends', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const reservationStore = new AtomicReservationStore();
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-unknown' }), { status: 200 });
  }) as typeof fetch;
  try {
    const first = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-accepted' }),
      {
        ...flowDependencies(reservationStore),
        recordSendEvent: async () => { throw new Error('crash after provider acceptance'); },
      },
    );
    assert.equal(first.statusCode, 503);
    assert.equal(JSON.parse(first.body || '{}').send_status, 'accepted_partial');
    assert.equal(providerCalls, 2);

    const second = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-accepted' }),
      flowDependencies(reservationStore),
    );
    assert.equal(second.statusCode, 503);
    assert.equal(JSON.parse(second.body || '{}').send_status, 'accepted_partial');
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

function seedReserved(store: AtomicReservationStore, flowId: string, updatedAt: number, evidence: Record<string, unknown> = {}) {
  const key = `aspen:whatsapp-flow:v2|${encodeURIComponent(quotationId)}|${encodeURIComponent(revisionId)}|${flowId}`;
  store.records.set(key, {
    key,
    quotationId,
    revisionId,
    flowId,
    schema: 3,
    stepsCount: 2,
    phase: 'reserved',
    owner: 'stale-owner',
    version: 1,
    createdAt: updatedAt,
    updatedAt,
    reservedAt: updatedAt,
    acceptedSteps: [],
    ...evidence,
  });
  return key;
}

test('crashed stale reserved reservation is taken over and sends once', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const reservationStore = new AtomicReservationStore();
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-stale' }), { status: 200 });
  }) as typeof fetch;
  try {
    const staleAt = Date.now() - 5 * 60 * 1000 - 1;
    seedReserved(reservationStore, 'flow-stale', staleAt);
    const response = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, quotation_uuid: quotationId, revision_id: revisionId, flow_id: 'flow-stale' }),
      flowDependencies(reservationStore),
    );
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body || '{}').send_status, 'completed');
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('two concurrent stale takeovers elect one provider sender', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const reservationStore = new AtomicReservationStore();
  let providerCalls = 0;
  let releaseProvider!: () => void;
  const providerStarted = new Promise<void>((resolve) => { releaseProvider = resolve; });
  globalThis.fetch = (async () => {
    providerCalls += 1;
    await providerStarted;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-race' }), { status: 200 });
  }) as typeof fetch;
  try {
    const staleAt = Date.now() - 5 * 60 * 1000 - 1;
    seedReserved(reservationStore, 'flow-race', staleAt);
    const request = event({ quotation_id: businessNumber, quotation_uuid: quotationId, revision_id: revisionId, flow_id: 'flow-race' });
    const first = sendWhatsappFlow(request, flowDependencies(reservationStore));
    const second = sendWhatsappFlow(request, flowDependencies(reservationStore));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(providerCalls, 1);
    releaseProvider();
    const responses = await Promise.all([first, second]);
    assert.ok(responses.some((response) => response.statusCode === 200));
    assert.ok(responses.some((response) => response.statusCode === 409 || response.statusCode === 503));
    assert.equal(providerCalls, 2);
  } finally {
    releaseProvider?.();
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('fresh reserved reservation stays neutral and does not call provider', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const reservationStore = new AtomicReservationStore();
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-fresh' }), { status: 200 });
  }) as typeof fetch;
  try {
    seedReserved(reservationStore, 'flow-fresh', Date.now());
    const response = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, quotation_uuid: quotationId, revision_id: revisionId, flow_id: 'flow-fresh' }),
      flowDependencies(reservationStore),
    );
    assert.equal(response.statusCode, 409);
    assert.equal(JSON.parse(response.body || '{}').send_status, 'reserved');
    assert.equal(JSON.parse(response.body || '{}').reconciliation_required, true);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('stale reservation with transport evidence fails closed before provider', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-evidence' }), { status: 200 });
  }) as typeof fetch;
  try {
    const staleAt = Date.now() - 5 * 60 * 1000 - 1;
    for (const [index, evidence] of [
      { transportStartedAt: staleAt },
      { currentStep: 0 },
      { acceptedSteps: [{ step: 0, kind: 'text', acceptedAt: staleAt }] },
    ].entries()) {
      const reservationStore = new AtomicReservationStore();
      seedReserved(reservationStore, `flow-evidence-${index}`, staleAt, evidence);
      const response = await sendWhatsappFlow(
        event({ quotation_id: businessNumber, quotation_uuid: quotationId, revision_id: revisionId, flow_id: `flow-evidence-${index}` }),
        flowDependencies(reservationStore),
      );
      assert.equal(response.statusCode, 503);
      assert.equal(providerCalls, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('bare CAS transition results fail closed and never report send success', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const base = new AtomicReservationStore();
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-bare-result' }), { status: 200 });
  }) as typeof fetch;
  const bareStore = {
    reserve: (input: any) => base.reserve(input),
    get: (key: string) => base.get(key),
    compareAndSet: async (input: any) => base.records.get(input.key),
    cas: async (input: any) => base.records.get(input.key),
    resolve: (input: any) => base.resolve(input),
    transition: (input: any) => base.transition(input),
  };
  try {
    const response = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-bare-result' }),
      flowDependencies(bareStore),
    );
    assert.ok([409, 503].includes(response.statusCode || 0));
    assert.notEqual(response.statusCode, 200);
    const legacyOnlyStore = {
      reserve: (input: any) => base.reserve(input),
      get: (key: string) => base.get(key),
      transition: async (input: any) => base.records.get(input.key),
    };
    const legacyResponse = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-legacy-only' }),
      flowDependencies(legacyOnlyStore),
    );
    assert.ok([409, 503].includes(legacyResponse.statusCode || 0));
    assert.notEqual(legacyResponse.statusCode, 200);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('reservation storage errors fail closed in Portuguese before provider', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-storage' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(
      event({ quotation_id: businessNumber, revision_id: revisionId, flow_id: 'flow-storage' }),
      flowDependencies({
        reserve: async () => { throw new Error('KV indisponível'); },
        transition: async () => null,
        get: async () => null,
      }),
    );
    assert.equal(response.statusCode, 503);
    assert.match(response.body || '', /estado durável|Não foi possível/i);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
