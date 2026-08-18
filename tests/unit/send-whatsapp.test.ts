import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handler as sendWhatsapp,
  loadPostgresSendContext,
} from '../../api/modules/send-whatsapp.js';
import {
  canonicalFlowQuotationId,
  flowProductSummary,
  handler as sendWhatsappFlow,
} from '../../api/modules/send-whatsapp-flow.js';
import { handler as communicationFlowPreview } from '../../api/modules/communication-flow-preview.js';
import {
  normalizeOwnedBlobUrl,
  normalizePostgresMediaUrl,
} from '../../api/modules/postgres-media.js';
import { normalizeEvolutionDelivery } from '../../api/_functions/lib/evolution-delivery.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/modules/quotation-template-catalog.js';
import { createFakeWhatsappReservationStore } from '../fixtures/fake-whatsapp-reservation-store.mjs';
import {
  createDeliverQuotation,
  type DeliverQuotationDependencies,
  type DeliverQuotationInput,
} from '../../api/modules/quotation-delivery.js';

const quotationId = 'quote-00000000-0000-4000-8000-000000000001';
const revisionId = 'revision-0000-0000-4000-8000-000000000001';
const businessNumber = 'ORC-20260001';
const publicToken = 'A'.repeat(32);
const ownedMediaUrl = 'https://store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg';
const quotationPdfStep = { type: 'document', source: 'quotation_pdf' };

function deliveryPolicyHarness(overrides: Partial<DeliverQuotationDependencies> = {}) {
  const states: Array<Record<string, unknown>> = [];
  let transportCalls = 0;
  const dependencies: DeliverQuotationDependencies = {
    now: () => new Date('2026-08-13T12:00:00.000Z'),
    evolutionConfigured: () => true,
    prepareDelivery: async ({ revisionId: selectedRevision, phone, flowId }) => ({
      delivery: {
        id: 'delivery-1', revisionId: selectedRevision, phone, flowId, state: 'pending',
        providerAcceptanceId: null, publicError: null,
        diagnosticsExpiresAt: new Date('2026-11-11T12:00:00.000Z'),
        resumableUntil: new Date('2026-09-12T12:00:00.000Z'),
        createdAt: new Date('2026-08-13T12:00:00.000Z'), updatedAt: new Date('2026-08-13T12:00:00.000Z'), readOnly: false,
      },
      pdf: Buffer.from('%PDF-1.7\nbody\n%%EOF'), pdfSize: 20, pdfSignature: 'a'.repeat(64),
      validUntil: new Date('2026-08-20T12:00:00.000Z'),
    }),
    issuePublicLink: async ({ expiresInSeconds }) => ({ url: 'https://app.test/api/public-quotation?token=' + 'A'.repeat(32), expiresInSeconds }),
    reserveTransport: async () => ({ kind: 'reserved' }),
    recordState: async (input) => { states.push(input); },
    transport: async () => { transportCalls += 1; return { accepted: true, acceptanceId: 'accept-1' }; },
    ...overrides,
  };
  return {
    deliver: createDeliverQuotation(dependencies),
    states,
    get transportCalls() { return transportCalls; },
  };
}

function validDeliveryInput(overrides: Partial<DeliverQuotationInput> = {}): DeliverQuotationInput {
  return {
    revisionId: '22222222-2222-4222-8222-222222222222',
    phone: '11999990000',
    flowId: 'already-talking',
    steps: [quotationPdfStep],
    maxDelayMs: 0,
    ...overrides,
  };
}


test('delivery policy requires exactly one quotation PDF before transport', async () => {
  for (const steps of [[{ type: 'text' }], [quotationPdfStep, quotationPdfStep]]) {
    const harness = deliveryPolicyHarness();
    await assert.rejects(harness.deliver(validDeliveryInput({ steps })), /exatamente um PDF/i);
    assert.equal(harness.transportCalls, 0);
  }
});

test('delivery policy validates phone, Evolution and 45 second budget before transport', async () => {
  const missingPhone = deliveryPolicyHarness();
  await assert.rejects(missingPhone.deliver(validDeliveryInput({ phone: '' })), /telefone/i);
  assert.equal(missingPhone.transportCalls, 0);

  const missingEvolution = deliveryPolicyHarness({ evolutionConfigured: () => false });
  await assert.rejects(missingEvolution.deliver(validDeliveryInput()), /não configurada/i);
  assert.equal(missingEvolution.transportCalls, 0);

  const overBudget = deliveryPolicyHarness();
  await assert.rejects(overBudget.deliver(validDeliveryInput({ maxDelayMs: 45_001 })), /45 segundos/i);
  assert.equal(overBudget.transportCalls, 0);
});

test('delivery policy rejects draft, expired and PDF failures before transport', async () => {
  for (const error of [
    new Error('Somente revisões emitidas podem ser entregues.'),
    new Error('A revisão do orçamento está vencida.'),
    new Error('PDF indisponível. Tentar novamente.'),
  ]) {
    const harness = deliveryPolicyHarness({ prepareDelivery: async () => { throw error; } });
    await assert.rejects(harness.deliver(validDeliveryInput()), new RegExp(error.message.split('.')[0], 'i'));
    assert.equal(harness.transportCalls, 0);
  }
});

test('delivery policy accepts approved revision contract, freezes operation and bounds link TTL', async () => {
  let prepared: Record<string, unknown> | undefined;
  let linkTtl = 0;
  const harness = deliveryPolicyHarness({
    prepareDelivery: async (input) => {
      prepared = input;
      return {
        delivery: { id: 'delivery-1', revisionId: input.revisionId, phone: '5511999990000', flowId: input.flowId, state: 'pending' } as any,
        pdf: Buffer.from('%PDF-1.7\nbody\n%%EOF'), pdfSize: 20, pdfSignature: 'a'.repeat(64),
        validUntil: new Date('2026-10-13T12:00:00.000Z'),
      };
    },
    issuePublicLink: async ({ expiresInSeconds }) => {
      linkTtl = expiresInSeconds;
      return { url: 'https://app.test/api/public-quotation?token=' + 'A'.repeat(32), expiresInSeconds };
    },
  });
  const result = await harness.deliver(validDeliveryInput());
  assert.deepEqual(prepared, {
    revisionId: validDeliveryInput().revisionId,
    phone: '5511999990000',
    flowId: validDeliveryInput().flowId,
  });
  assert.equal(linkTtl, 30 * 24 * 60 * 60);
  assert.equal(result.status, 'completed');
  assert.deepEqual(harness.states.map((entry) => entry.state), ['pending', 'transporting', 'accepted_partial', 'completed']);
});

test('delivery policy persists retryable before acceptance and reconciling after uncertain acceptance', async () => {
  const retryable = deliveryPolicyHarness({ transport: async () => { throw new Error('provider unavailable'); } });
  await assert.rejects(retryable.deliver(validDeliveryInput()), /provider unavailable/i);
  assert.equal(retryable.states.at(-1)?.state, 'retryable');

  const pdfFailure = deliveryPolicyHarness({ prepareDelivery: async () => { throw new Error('Não foi possível gerar o PDF da revisão.'); } });
  await assert.rejects(pdfFailure.deliver(validDeliveryInput()), /PDF da revisão/i);
  assert.equal(pdfFailure.states.at(-1)?.state, 'retryable');

  const reconciling = deliveryPolicyHarness({ transport: async () => ({ accepted: true }), recordState: async (input) => {
    reconciling.states.push(input);
    if (input.state === 'accepted_partial') throw new Error('CAS uncertain');
  } });
  await assert.rejects(reconciling.deliver(validDeliveryInput()), /reconciliação/i);
  assert.equal(reconciling.states.at(-1)?.state, 'reconciling');
});

function mediaRecords() {
  return [{
    id: 'media-1',
    product_group: 'canga',
    blob_url: ownedMediaUrl,
    active: true,
    content_type: 'image/jpeg',
    size_bytes: 11,
    pathname: 'aspen-media/canga/reference.jpg',
  }];
}

function mediaHeadResult(overrides: Record<string, unknown> = {}) {
  return {
    url: ownedMediaUrl,
    pathname: 'aspen-media/canga/reference.jpg',
    contentType: 'image/jpeg',
    size: 11,
    ...overrides,
  } as any;
}

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
    items: [
      {
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
      },
    ],
  } as any;
}

function repositoryFor(value = snapshot()) {
  return {
    get: async (id: string) => (id === revisionId ? value : null),
  } as any;
}

function store() {
  const values = new Map<string, unknown>();
  return {
    values,
    get: async <T>(key: string) => (values.get(key) as T | undefined) || null,
    set: async (key: string, value: unknown) => {
      values.set(key, value);
      return 'OK';
    },
    del: async (key: string) => values.delete(key),
  };
}

function reservationStore() {
  return createFakeWhatsappReservationStore() as any;
}

function event(body: Record<string, unknown>) {
  return {
    httpMethod: 'POST',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    body: JSON.stringify(body),
  } as any;
}

test('send-whatsapp rejects PostgreSQL send without quotation before transport', async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(
      event({ revision_id: revisionId, template: 'Olá' }),
    );
    assert.equal(response.statusCode, 400);
    assert.match(response.body || '', /Cotação PostgreSQL é obrigatória/);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PostgreSQL revision send does not resolve quotation data externally', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-local-context' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(
      event({
        quotation_id: businessNumber,
        revision_id: revisionId,
        sequence: { steps: [{ type: 'text', template: 'Olá (primeiro_nome)' }, { type: 'document', source: 'quotation_pdf' }] },
      }),
      {
        repository: repositoryFor(),
        store: store(),
        token: () => publicToken,
      },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(calls.every((url) => url.startsWith('https://evolution.test')), true);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('send-whatsapp-flow rejects PostgreSQL send without quotation before transport', async () => {
  const response = await sendWhatsappFlow(
    event({
      flow: { id: 'flow-1', name: 'Teste', steps: [{ type: 'text', template: 'Olá' }] },
      flow_id: 'flow-1',
      revision_id: revisionId,
    }),
  );
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /Cotação PostgreSQL é obrigatória/);
});

test('communication preview rejects PostgreSQL send without revision before transport', async () => {
  const response = await communicationFlowPreview(
    event({ quotation_id: businessNumber }),
  );
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /Revisão PostgreSQL do orçamento é obrigatória/);
});

test('loadPostgresSendContext rejects a revision owned by another quotation', async () => {
  const calls = { store: 0 };
  const tokenStore = store();
  const originalSet = tokenStore.set;
  tokenStore.set = async (...args: Parameters<typeof originalSet>) => {
    calls.store += 1;
    return originalSet(...args);
  };
  await assert.rejects(
    loadPostgresSendContext({
      quotationId: 'ORC-20260002',
      revisionId,
      needPdf: false,
      baseUrl: 'https://app.test',
      repository: repositoryFor(),
      store: tokenStore,
      token: () => publicToken,
    }),
    /não corresponde à revisão PostgreSQL/i,
  );
  assert.equal(calls.store, 0);
});

test('loadPostgresSendContext rejects caller phone not belonging to snapshot', async () => {
  const tokenStore = store();
  await assert.rejects(
    loadPostgresSendContext({
      quotationId: businessNumber,
      revisionId,
      recipientPhone: '11988880000',
      needPdf: false,
      baseUrl: 'https://app.test',
      repository: repositoryFor(),
      store: tokenStore,
      token: () => publicToken,
    }),
    /telefone informado não pertence/i,
  );
  assert.equal(tokenStore.values.size, 0);
});

test('loadPostgresSendContext returns canonical immutable revision context', async () => {
  const tokenStore = store();
  const context = await loadPostgresSendContext({
    quotationId: businessNumber,
    revisionId,
    businessNumber,
    needPdf: false,
    baseUrl: 'https://app.test',
    repository: repositoryFor(),
    store: tokenStore,
    token: () => publicToken,
    mediaCandidates: [ownedMediaUrl],
    mediaRecords: mediaRecords(),
    resolveDeal: async (resolvedQuotationId, resolvedBusinessNumber) => {
      assert.equal(resolvedQuotationId, quotationId);
      assert.equal(resolvedBusinessNumber, businessNumber);
      return { id: 'deal-local', quotationId: resolvedQuotationId } as any;
    },
  });
  assert.equal(context.quotationUuid, quotationId);
  assert.equal(context.revisionId, revisionId);
  assert.equal(context.businessNumber, businessNumber);
  assert.equal(context.dealId, 'deal-local');
  assert.equal(context.phone, '5511999990000');
  const view = context.view as {
    client: { name?: string };
    items: Array<{ item_code?: string }>;
  };
  assert.equal(view.client.name, 'Cliente Teste');
  assert.equal(view.items[0]?.item_code, 'CNG-001');
  assert.equal(context.publicLink, `https://app.test/api/public-quotation?token=${publicToken}`);
  assert.deepEqual(context.permittedMedia, [ownedMediaUrl]);
  assert.equal(tokenStore.values.size, 1);
});

test('PostgreSQL media policy requires an owned Blob record and rejects unsafe URLs', () => {
  assert.equal(normalizeOwnedBlobUrl(ownedMediaUrl, 'https://app.test'), ownedMediaUrl);
  assert.equal(normalizePostgresMediaUrl(ownedMediaUrl, 'https://app.test', [ownedMediaUrl]), ownedMediaUrl);
  for (const value of [
    '/media/reference.jpg',
    'https://ASSET.public.blob.vercel-storage.com/a.jpg',
    'https://external-crm.invalid/files/a.jpg',
    'https://EXTERNAL-CRM.INVALID/files/a.jpg',
    'https://user@external-crm.invalid/files/a.jpg',
    '//external-crm.invalid/files/a.jpg',
    'https://evil.test/a.jpg',
    'data:image/png;base64,abc',
    'https://user@public.blob.vercel-storage.com/a.jpg',
  ]) {
    assert.throws(() => normalizePostgresMediaUrl(value, 'https://app.test'), /Mídia pública/);
  }
});

test('PostgreSQL context rejects mixed media before provider configuration', async () => {
  const tokenStore = store();
  await assert.rejects(
    loadPostgresSendContext({
      quotationId: businessNumber,
      revisionId,
      needPdf: false,
      baseUrl: 'https://app.test',
      repository: repositoryFor(),
      store: tokenStore,
      token: () => publicToken,
      mediaRecords: [],
      mediaCandidates: ['/media/a.jpg', 'https://evil.test/b.jpg'],
    }),
    /Mídia pública inválida/,
  );
  assert.equal(tokenStore.values.size, 0);
});

test('loadPostgresSendContext rejects draft PDF sharing before rendering', async () => {
  const draft = snapshot();
  draft.quotation = { ...draft.quotation, status: 'rascunho' };
  draft.revision = { ...draft.revision, status: 'rascunho' };
  await assert.rejects(
    loadPostgresSendContext({
      quotationId: businessNumber,
      revisionId,
      needPdf: true,
      baseUrl: 'https://app.test',
      repository: repositoryFor(draft),
      store: store(),
      token: () => publicToken,
      renderPdf: async () => { throw new Error('renderer must not run'); },
    }),
    (error: unknown) => {
      assert.equal((error as { statusCode?: number }).statusCode, 409);
      assert.equal((error as Error).message, 'Emita o orçamento antes de enviar WhatsApp.');
      return true;
    },
  );
});

test('loadPostgresSendContext reports PDF preparation failure without provider access', async () => {
  const tokenStore = store();
  await assert.rejects(
    loadPostgresSendContext({
      quotationId: businessNumber,
      revisionId,
      needPdf: true,
      baseUrl: 'https://app.test',
      repository: repositoryFor(),
      store: tokenStore,
      token: () => publicToken,
      renderPdf: async () => { throw new Error('synthetic PDF failure'); },
    }),
    /PDF do orçamento/,
  );
  assert.equal(tokenStore.values.size, 0);
});

test('flow PostgreSQL content and duplicate keys use canonical snapshot values', () => {
  assert.equal(canonicalFlowQuotationId('quote-uuid', businessNumber), businessNumber);
  assert.equal(flowProductSummary(true, 'texto adulterado', [{ item_code: 'CNG-001' }]), 'cangas');
  assert.equal(flowProductSummary(false, 'texto legado', [{ item_code: 'CNG-001' }]), 'cangas');
});

test('Evolution response requires explicit provider acceptance', () => {
  assert.deepEqual(
    normalizeEvolutionDelivery({ accepted: true, message_id: 'provider-1' }),
    { accepted: true, providerMessageId: 'provider-1' },
  );
  assert.deepEqual(
    normalizeEvolutionDelivery({ key: { id: 'provider-2' }, status: 'PENDING' }),
    { accepted: true, providerMessageId: 'provider-2' },
  );
  assert.deepEqual(normalizeEvolutionDelivery({ accepted: true }), {
    accepted: true,
    providerMessageId: 'accepted',
  });
  assert.equal(
    normalizeEvolutionDelivery({ accepted: false, message_id: 'rejected-1', status: 'ERROR' }),
    null,
  );
  assert.equal(
    normalizeEvolutionDelivery({ accepted: false, key: { id: 'rejected-2' }, message: 'rejected' }),
    null,
  );
  assert.equal(normalizeEvolutionDelivery({}), null);
});

function withEvolutionEnv() {
  const previous = {
    baseUrl: process.env.EVOLUTION_BASE_URL,
    apiKey: process.env.EVOLUTION_API_KEY,
    instance: process.env.EVOLUTION_INSTANCE,
  };
  process.env.EVOLUTION_BASE_URL = 'https://evolution.test';
  process.env.EVOLUTION_API_KEY = 'test-key';
  process.env.EVOLUTION_INSTANCE = 'test-instance';
  return () => {
    for (const [key, value] of Object.entries({
      EVOLUTION_BASE_URL: previous.baseUrl,
      EVOLUTION_API_KEY: previous.apiKey,
      EVOLUTION_INSTANCE: previous.instance,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test('PostgreSQL endpoint rejects recipient ownership before provider setup', async () => {
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-owner' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(
      event({
        quotation_id: businessNumber,
        revision_id: revisionId,
        telefone: '11988880000',
        sequence: { steps: [{ type: 'text', template: 'Olá' }, { type: 'document', source: 'quotation_pdf' }] },
      }),
      { repository: repositoryFor(), store: store(), token: () => publicToken },
    );
    assert.equal(response.statusCode, 400);
    assert.match(response.body || '', /telefone informado não pertence/i);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PostgreSQL endpoint completes local send after Evolution acceptance', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-postgres' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(
      event({
        quotation_id: businessNumber,
        revision_id: revisionId,
        sequence: { steps: [{ type: 'text', template: 'Olá (primeiro_nome)' }, { type: 'document', source: 'quotation_pdf' }] },
      }),
      {
        repository: repositoryFor(),
        store: store(),
        token: () => publicToken,
      },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(providerCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('PostgreSQL endpoint rejects PDF preparation before provider setup', async () => {
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-pdf' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(
      event({
        quotation_id: businessNumber,
        revision_id: revisionId,
        sequence: {
          steps: [{ type: 'document', source: 'quotation_pdf' }],
        },
      }),
      {
        repository: repositoryFor(),
        store: store(),
        token: () => publicToken,
        renderPdf: async () => {
          throw new Error('synthetic PDF failure');
        },
      },
    );
    assert.equal(response.statusCode, 503);
    assert.match(response.body || '', /PDF do orçamento/i);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PostgreSQL endpoint rejects arbitrary media before provider setup', async () => {
  let providerCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-media' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(
      event({
        quotation_id: businessNumber,
        revision_id: revisionId,
        sequence: {
          steps: [{ type: 'image', media: 'https://evil.test/reference.jpg' }, { type: 'document', source: 'quotation_pdf' }],
        },
      }),
      { repository: repositoryFor(), store: store(), token: () => publicToken },
    );
    assert.equal(response.statusCode, 503);
    assert.match(response.body || '', /validar as mídias cadastradas/i);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PostgreSQL send downloads only an owned Blob media before Evolution', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  const evolutionBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (input, init) => {
    if (String(input) === ownedMediaUrl) return new Response('image-bytes', {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '11' },
    });
    evolutionBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-owned-media' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(
      event({
        quotation_id: businessNumber,
        revision_id: revisionId,
        sequence: {
          delay_min_ms: 0,
          delay_max_ms: 0,
          steps: [{ type: 'image', media: ownedMediaUrl }, { type: 'document', source: 'quotation_pdf' }],
        },
      }),
      {
        repository: repositoryFor(),
        store: store(),
        token: () => publicToken,
        mediaRecords: mediaRecords(),
        headBlob: async () => mediaHeadResult(),
      },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(evolutionBodies.length, 2);
    assert.equal(evolutionBodies[0]?.media, Buffer.from('image-bytes').toString('base64'));
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('PostgreSQL send rejects stale or foreign-store media before provider transport', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-should-not-run' }), { status: 200 });
  }) as typeof fetch;
  try {
    for (const dependencies of [
      { headBlob: async () => mediaHeadResult({ size: 12 }) },
      { headBlob: async () => { throw new Error('BlobAccessError'); } },
      { headBlob: async () => mediaHeadResult(), blobStoreId: 'different-store' },
    ]) {
      const response = await sendWhatsapp(
        event({
          quotation_id: businessNumber,
          revision_id: revisionId,
          sequence: { steps: [{ type: 'image', media: ownedMediaUrl }, { type: 'document', source: 'quotation_pdf' }] },
        }),
        {
          repository: repositoryFor(),
          store: store(),
          token: () => publicToken,
          mediaRecords: mediaRecords(),
          ...dependencies,
        },
      );
      assert.ok([400, 503].includes(response.statusCode || 0));
    }
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('PostgreSQL flow endpoint uses snapshot summary and canonical duplicate key', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  const duplicateKeys: string[] = [];
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ accepted: true, message_id: 'provider-flow' }), { status: 200 })) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(
      event({
        flow_id: 'flow-postgres',
        quotation_id: quotationId,
        revision_id: revisionId,
      }),
      {
        resolveFlow: async () => ({
          id: 'flow-postgres',
          name: 'Fluxo PostgreSQL',
          steps: [{ type: 'text', template: '(produto_resumo)' }, { type: 'document', source: 'quotation_pdf' }],
        }),
        repository: repositoryFor(),
        store: store(),
        token: () => publicToken,
        renderPdf: async () => Buffer.from('%PDF-1.7\nbody\n%%EOF'),
        reservationStore: reservationStore(),
        checkDuplicate: async (id) => {
          duplicateKeys.push(id);
          return true;
        },
        recordSendEvent: async () => 'synthetic-flow-event',
      },
    );
    const body = JSON.parse(response.body || '{}');
    assert.equal(response.statusCode, 200);
    assert.equal(body.product_summary, 'cangas');
    assert.equal(body.duplicate_warning, true);
    assert.deepEqual(duplicateKeys, [businessNumber]);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('PostgreSQL preview rejects external media before rendering output', async () => {
  const response = await communicationFlowPreview(
    event({
      flow_id: 'preview-postgres',
      quotation_id: businessNumber,
      revision_id: revisionId,
    }),
    {
      resolveFlow: async () => ({
        id: 'preview-postgres',
        steps: [{ type: 'product_media' }],
      }),
      resolvePostgresContext: async () => ({
        nome: 'Cliente Teste',
        quotationId: businessNumber,
        link: '',
        vendorName: 'Juliana',
        empresa: 'Aspen Estamparia',
        productSummary: 'cangas',
        categories: ['canga'],
      }),
      resolveMedia: async () => {
        const error = new Error('Mídia externa proibida') as Error & { statusCode?: number };
        error.statusCode = 400;
        throw error;
      },
    },
  );
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /Mídia externa proibida/);
});

test('non-dry legacy endpoint requires explicit provider acceptance', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ accepted: true, message_id: 'provider-1' }), { status: 200 })) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({ telefone: '11999990000', mensagem: 'Olá' }));
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body || '{}').evolution.providerMessageId, 'provider-1');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('quotation references without a local revision cannot use the direct send path', async () => {
  const restoreEnv = withEvolutionEnv();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/should-not-connect';
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-unexpected' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({
      telefone: '11999990000',
      mensagem: 'Olá',
      quotation_uuid: quotationId,
      revision_id: revisionId,
      business_number: businessNumber,
    }));
    assert.equal(response.statusCode, 400);
    assert.match(response.body || '', /exatamente um PDF/i);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('non-dry endpoint rejects a successful HTTP response without provider acceptance', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({ telefone: '11999990000', mensagem: 'Olá' }));
    assert.equal(response.statusCode, 502);
    assert.match(response.body || '', /provedor não confirmou/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('multi-step send exposes partial provider acceptance', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? new Response(JSON.stringify({ accepted: true, message_id: 'provider-1' }), { status: 200 })
      : new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({
      telefone: '11999990000',
      sequence: {
        delay_min_ms: 0,
        delay_max_ms: 0,
        steps: [
          { type: 'text', template: 'Primeira' },
          { type: 'text', template: 'Segunda' },
        ],
      },
    }));
    const body = JSON.parse(response.body || '{}');
    assert.equal(response.statusCode, 502);
    assert.equal(body.provider_accepted, true);
    assert.equal(body.partial_send, true);
    assert.equal(body.accepted_steps, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});
