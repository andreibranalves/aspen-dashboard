import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handler as sendWhatsapp,
  loadPostgresSendContext,
} from '../../api/_functions/send-whatsapp.js';
import {
  canonicalFlowQuotationId,
  flowProductSummary,
  handler as sendWhatsappFlow,
} from '../../api/_functions/send-whatsapp-flow.js';
import { handler as communicationFlowPreview } from '../../api/_functions/communication-flow-preview.js';
import { QuotationOutboxDurabilityError } from '../../api/_db/quotation-outbox-repository.js';
import { normalizePostgresMediaUrl } from '../../api/_functions/lib/postgres-media.js';
import { normalizeEvolutionDelivery } from '../../api/_functions/lib/evolution-delivery.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_functions/lib/quotation-templates.js';

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

function event(body: Record<string, unknown>) {
  return {
    httpMethod: 'POST',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    body: JSON.stringify(body),
  } as any;
}

test('send-whatsapp rejects PostgreSQL send without quotation before provider', async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response('{}', { status: 202 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(
      event({ source: 'postgres', revision_id: revisionId, template: 'Olá' }),
    );
    assert.equal(response.statusCode, 400);
    assert.match(response.body || '', /Cotação PostgreSQL é obrigatória/);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('send-whatsapp-flow rejects PostgreSQL send without quotation before provider', async () => {
  const response = await sendWhatsappFlow(
    event({
      source: 'postgres',
      flow: { id: 'flow-1', name: 'Teste', steps: [{ type: 'text', template: 'Olá' }] },
      flow_id: 'flow-1',
      revision_id: revisionId,
    }),
  );
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /Cotação PostgreSQL é obrigatória/);
});

test('communication preview rejects PostgreSQL send without revision before Frappe', async () => {
  const response = await communicationFlowPreview(
    event({ source: 'postgres', quotation_id: businessNumber }),
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
    mediaCandidates: ['/media/reference.jpg'],
  });
  assert.equal(context.quotationUuid, quotationId);
  assert.equal(context.revisionId, revisionId);
  assert.equal(context.businessNumber, businessNumber);
  assert.equal(context.phone, '5511999990000');
  assert.equal(context.view.client.name, 'Cliente Teste');
  assert.equal(context.view.items[0]?.item_code, 'CNG-001');
  assert.equal(context.publicLink, `https://app.test/api/public-quotation?token=${publicToken}`);
  assert.deepEqual(context.permittedMedia, ['https://app.test/media/reference.jpg']);
  assert.equal(tokenStore.values.size, 1);
});

test('PostgreSQL media policy rejects Frappe, arbitrary, credentialed and data URLs', () => {
  const allowed = normalizePostgresMediaUrl('/media/reference.jpg', 'https://app.test');
  assert.equal(allowed, 'https://app.test/media/reference.jpg');
  assert.match(
    normalizePostgresMediaUrl('https://ASSET.public.blob.vercel-storage.com/a.jpg', 'https://app.test'),
    /public\.blob\.vercel-storage\.com\/a\.jpg$/,
  );
  for (const value of [
    'https://aspenestamparia.l.frappe.cloud/files/a.jpg',
    'https://ASPENESTAMPARIA.L.FRAPPE.CLOUD/files/a.jpg',
    'https://user@aspenestamparia.l.frappe.cloud/files/a.jpg',
    '//aspenestamparia.l.frappe.cloud/files/a.jpg',
    'https://evil.test/a.jpg',
    'data:image/png;base64,abc',
    'https://user@public.blob.vercel-storage.com/a.jpg',
  ]) {
    assert.throws(() => normalizePostgresMediaUrl(value, 'https://app.test'), /Mídia pública|Mídia Frappe/);
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
      mediaCandidates: ['/media/a.jpg', 'https://evil.test/b.jpg'],
    }),
    /Mídia pública inválida/,
  );
  assert.equal(tokenStore.values.size, 0);
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
  assert.equal(flowProductSummary(false, 'texto legado', [{ item_code: 'CNG-001' }]), 'texto legado');
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
        source: 'postgres',
        quotation_id: businessNumber,
        revision_id: revisionId,
        telefone: '11988880000',
        sequence: { steps: [{ type: 'text', template: 'Olá' }] },
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

test('PostgreSQL endpoint enqueues only after provider acceptance', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  const queued: Array<{ quotationId: string; payload: Record<string, unknown> }> = [];
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-postgres' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(
      event({
        source: 'postgres',
        quotation_id: businessNumber,
        revision_id: revisionId,
        sequence: { steps: [{ type: 'text', template: 'Olá (primeiro_nome)' }] },
      }),
      {
        repository: repositoryFor(),
        store: store(),
        token: () => publicToken,
        enqueueSentEvent: async (quotationId, payload) => queued.push({ quotationId, payload }),
      },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(providerCalls, 1);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.quotationId, businessNumber);
    assert.equal(queued[0]?.payload.source, 'postgres');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('PostgreSQL endpoint exposes durable outbox failure without partial-send false positive', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ accepted: true, message_id: 'provider-durable' }), { status: 200 })) as typeof fetch;
  try {
    const response = await sendWhatsapp(
      event({
        source: 'postgres',
        quotation_id: businessNumber,
        revision_id: revisionId,
        sequence: { steps: [{ type: 'text', template: 'Olá' }] },
      }),
      {
        repository: repositoryFor(),
        store: store(),
        token: () => publicToken,
        enqueueSentEvent: async () => {
          throw new QuotationOutboxDurabilityError(new Error('synthetic outbox failure'));
        },
      },
    );
    const body = JSON.parse(response.body || '{}');
    assert.equal(response.statusCode, 503);
    assert.equal(body.provider_accepted, true);
    assert.equal(body.outbox_durable, false);
    assert.equal(body.partial_send, false);
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
        source: 'postgres',
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
        source: 'postgres',
        quotation_id: businessNumber,
        revision_id: revisionId,
        sequence: {
          steps: [{ type: 'image', media: 'https://evil.test/reference.jpg' }],
        },
      }),
      { repository: repositoryFor(), store: store(), token: () => publicToken },
    );
    assert.equal(response.statusCode, 400);
    assert.match(response.body || '', /Mídia pública inválida/i);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PostgreSQL flow endpoint uses snapshot summary and canonical duplicate key', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  const duplicateKeys: string[] = [];
  const queued: Record<string, unknown>[] = [];
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ accepted: true, message_id: 'provider-flow' }), { status: 200 })) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(
      event({
        source: 'postgres',
        flow_id: 'flow-postgres',
        quotation_id: quotationId,
        revision_id: revisionId,
      }),
      {
        resolveFlow: async () => ({
          id: 'flow-postgres',
          name: 'Fluxo PostgreSQL',
          steps: [{ type: 'text', template: '(produto_resumo)' }],
        }),
        repository: repositoryFor(),
        store: store(),
        token: () => publicToken,
        checkDuplicate: async (id) => {
          duplicateKeys.push(id);
          return true;
        },
        recordSendEvent: async () => 'synthetic-flow-event',
        enqueueSentEvent: async (_id, payload) => queued.push(payload),
      },
    );
    const body = JSON.parse(response.body || '{}');
    assert.equal(response.statusCode, 200);
    assert.equal(body.product_summary, 'cangas');
    assert.equal(body.duplicate_warning, true);
    assert.deepEqual(duplicateKeys, [businessNumber]);
    assert.equal(queued.length, 1);
    assert.equal(queued[0]?.source, 'postgres');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('PostgreSQL flow reports complete provider delivery separately from outbox failure', async () => {
  const restoreEnv = withEvolutionEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ accepted: true, message_id: 'provider-flow-durable' }), { status: 200 })) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(
      event({
        source: 'postgres',
        flow_id: 'flow-durable',
        quotation_id: businessNumber,
        revision_id: revisionId,
      }),
      {
        resolveFlow: async () => ({
          id: 'flow-durable',
          name: 'Fluxo durável',
          steps: [{ type: 'text', template: 'Olá' }],
        }),
        repository: repositoryFor(),
        store: store(),
        token: () => publicToken,
        recordSendEvent: async () => 'synthetic-flow-event',
        enqueueSentEvent: async () => {
          throw new QuotationOutboxDurabilityError(new Error('synthetic flow outbox failure'));
        },
      },
    );
    const body = JSON.parse(response.body || '{}');
    assert.equal(response.statusCode, 503);
    assert.equal(body.provider_accepted, true);
    assert.equal(body.outbox_durable, false);
    assert.equal(body.partial_send, false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
});

test('PostgreSQL preview rejects Frappe media before rendering output', async () => {
  const response = await communicationFlowPreview(
    event({
      source: 'postgres',
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
        const error = new Error('Mídia Frappe proibida') as Error & { statusCode?: number };
        error.statusCode = 400;
        throw error;
      },
    },
  );
  assert.equal(response.statusCode, 400);
  assert.match(response.body || '', /Mídia Frappe proibida/);
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

test('legacy caller PostgreSQL references cannot enqueue quotation.sent', async () => {
  const restoreEnv = withEvolutionEnv();
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://127.0.0.1:1/should-not-connect';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ accepted: true, message_id: 'provider-legacy' }), { status: 200 })) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({
      telefone: '11999990000',
      mensagem: 'Olá',
      quotation_uuid: quotationId,
      revision_id: revisionId,
      business_number: businessNumber,
    }));
    assert.equal(response.statusCode, 200);
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
