import assert from 'node:assert/strict';
import test from 'node:test';

import { loadQuotationSendContext } from '../../api/_modules/quotation-send-context.js';
import {
  canonicalFlowQuotationId,
  createDeliveryPlan,
  flowProductSummary,
  handler as sendWhatsappFlow,
} from '../../api/_modules/send-whatsapp-flow.js';
import { handler as communicationFlowPreview } from '../../api/_modules/communication-flow-preview.js';
import {
  normalizeOwnedBlobUrl,
  normalizePostgresMediaUrl,
} from '../../api/_modules/postgres-media.js';
import { normalizeEvolutionDelivery } from '../../api/_infrastructure/integrations/evolution/evolution-delivery.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_modules/quotation-template-catalog.js';
import {
  createQuotationSectionsSnapshot,
  normalizeQuotationSections,
  withQuotationProductionDeadline,
  type QuotationSectionsSnapshot,
} from '../../api/_modules/quotation-content.js';

const quotationId = 'quote-00000000-0000-4000-8000-000000000001';
const revisionId = 'revision-0000-0000-4000-8000-000000000001';
const businessNumber = 'ORC-20260001';
const publicToken = 'A'.repeat(32);
const ownedMediaUrl = 'https://store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg';

function canonicalSectionsSnapshot(
  legacy: { pagamento: string; entrega: string; observacoes: string; prazoProducao: string }
): QuotationSectionsSnapshot {
  const sections = withQuotationProductionDeadline(
    normalizeQuotationSections(undefined),
    legacy.prazoProducao
  );
  sections.pagamento.body = legacy.pagamento;
  sections.condicoes_gerais.body = [legacy.entrega ? `Prazo de entrega:\n${legacy.entrega}` : '',
    legacy.observacoes ? `Observações:\n${legacy.observacoes}` : ''].filter(Boolean).join('\n\n');
  return createQuotationSectionsSnapshot(sections);
}

function snapshot() {
  const issuedAt = new Date(Date.now() - 86_400_000);
  return {
    quotation: {
      id: quotationId,
      businessNumber,
      clientId: 'client-1',
      status: 'enviado',
      createdAt: issuedAt,
      updatedAt: issuedAt,
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
      createdAt: issuedAt,
      sectionsSnapshot: canonicalSectionsSnapshot({
        pagamento: 'Pix',
        entrega: '30 dias',
        observacoes: '',
        prazoProducao: '30 dias',
      }),
      templateVersionId: null,
      statusOriginal: null,
      orderLinkage: null,
      orderPending: false,
    },
    templateVersion: null,
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

test('loadQuotationSendContext rejects a revision owned by another quotation', async () => {
  const calls = { store: 0 };
  const tokenStore = store();
  const originalSet = tokenStore.set;
  tokenStore.set = async (...args: Parameters<typeof originalSet>) => {
    calls.store += 1;
    return originalSet(...args);
  };
  await assert.rejects(
    loadQuotationSendContext({
      quotationId: 'ORC-20260002',
      revisionId,
      baseUrl: 'https://app.test',
      repository: repositoryFor(),
      store: tokenStore,
      token: () => publicToken,
    }),
    /não corresponde à revisão PostgreSQL/i,
  );
  assert.equal(calls.store, 0);
});

test('loadQuotationSendContext rejects caller phone not belonging to snapshot', async () => {
  const tokenStore = store();
  await assert.rejects(
    loadQuotationSendContext({
      quotationId: businessNumber,
      revisionId,
      recipientPhone: '11988880000',
      baseUrl: 'https://app.test',
      repository: repositoryFor(),
      store: tokenStore,
      token: () => publicToken,
    }),
    /telefone informado não pertence/i,
  );
  assert.equal(tokenStore.values.size, 0);
});

test('loadQuotationSendContext returns canonical immutable revision context', async () => {
  const tokenStore = store();
  const context = await loadQuotationSendContext({
    quotationId: businessNumber,
    revisionId,
    businessNumber,
    baseUrl: 'https://app.test',
    repository: repositoryFor(),
    store: tokenStore,
    token: () => publicToken,
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

test('flow PostgreSQL content and duplicate keys use canonical snapshot values', () => {
  assert.equal(canonicalFlowQuotationId('quote-uuid', businessNumber), businessNumber);
  assert.equal(flowProductSummary(true, 'texto adulterado', [{ item_code: 'CNG-001' }]), 'cangas');
  assert.equal(flowProductSummary(false, 'texto legado', [{ item_code: 'CNG-001' }]), 'cangas');
});

test('flow planner keeps dry-run PDF references free of binary content', async () => {
  const plan = await createDeliveryPlan({
    revisionId,
    flowId: 'flow-plan',
    businessNumber,
    baseUrl: 'https://app.test',
    context: { businessNumber, nome: 'Cliente Teste', phone: '5511999990000', items: [] },
    flow: {
      id: 'flow-plan',
      steps: [
        { type: 'text', template: 'Olá (nome)' },
        { type: 'document', source: 'quotation_pdf' },
      ],
    },
    random: () => 0,
  });
  assert.equal(plan.steps.at(-1)?.type, 'quotation_pdf');
  assert.equal(JSON.stringify(plan.steps).includes('base64'), false);
});

test('send-whatsapp-flow dry-run uses the extracted planner without rendering or transport', async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'must-not-send' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(
      event({ flow_id: 'flow-dry-run', quotation_id: quotationId, revision_id: revisionId, dry_run: true }),
      {
        resolveFlow: async () => ({
          id: 'flow-dry-run',
          name: 'Fluxo dry-run',
          steps: [
            { type: 'text', template: 'Olá (nome)' },
            { type: 'document', source: 'quotation_pdf', caption: 'Orçamento (numero_pedido)' },
          ],
        }),
        repository: repositoryFor(),
        store: store(),
        token: () => publicToken,
      },
    );
    const body = JSON.parse(response.body || '{}');
    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.dry_run, true);
    assert.equal(body.send_status, 'dry_run');
    assert.deepEqual(body.steps.map((step: { type: string }) => step.type), ['text', 'document']);
    assert.equal(JSON.stringify(body.steps).includes('base64'), false);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function durableDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery-fixture',
    revisionId,
    businessNumber,
    clientName: 'Cliente Teste',
    phone: '5511999990000',
    flowId: 'flow-fixture',
    flowName: 'Fluxo fixture',
    state: 'provider_accepted',
    completionSource: null,
    publicError: null,
    nextAttemptAt: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    createdAt: new Date('2026-08-17T12:00:00.000Z'),
    updatedAt: new Date('2026-08-17T12:00:00.000Z'),
    steps: [],
    ...overrides,
  } as any;
}

test('send-whatsapp-flow returns durable provider state from the outbox module', async () => {
  let enqueueInput: unknown;
  const deliveryModule = {
    async enqueue(input: unknown) {
      enqueueInput = input;
      return {
        id: 'delivery-1',
        revisionId,
        businessNumber,
        clientName: 'Cliente Teste',
        phone: '5511999990000',
        flowId: 'flow-durable',
        flowName: 'Fluxo durável',
        state: 'provider_accepted',
        completionSource: null,
        publicError: null,
        nextAttemptAt: null,
        reconciliationDeadline: null,
        deliveredAt: null,
        createdAt: new Date('2026-08-17T12:00:00.000Z'),
        updatedAt: new Date('2026-08-17T12:00:00.000Z'),
        steps: [
          { id: 'step-1', position: 0, type: 'text', state: 'server_ack', attemptCount: 1, publicError: null, nextAttemptAt: null, acceptedAt: new Date(), deliveredAt: null, readAt: null, updatedAt: new Date() },
          { id: 'step-2', position: 1, type: 'quotation_pdf', state: 'queued', attemptCount: 0, publicError: null, nextAttemptAt: null, acceptedAt: null, deliveredAt: null, readAt: null, updatedAt: new Date() },
        ],
      };
    },
  } as any;
  const response = await sendWhatsappFlow(
    event({ flow_id: 'flow-durable', quotation_id: quotationId, revision_id: revisionId }),
    { deliveryModule },
  );
  const body = JSON.parse(response.body || '{}');
  assert.equal(response.statusCode, 202);
  assert.equal(body.success, true);
  assert.equal(body.delivery_id, 'delivery-1');
  assert.equal(body.send_status, 'provider_accepted');
  assert.deepEqual(enqueueInput, { revisionId, flowId: 'flow-durable' });
  assert.equal(body.phone, undefined);
  assert.equal(body.delivery.phone, undefined);
});

test('send-whatsapp-flow preserves 200 success for a delivered durable state', async () => {
  const response = await sendWhatsappFlow(
    event({ flow_id: 'flow-delivered', quotation_id: quotationId, revision_id: revisionId }),
    { deliveryModule: { async enqueue() { return durableDelivery({ state: 'delivered' }); } } } as any,
  );
  const body = JSON.parse(response.body || '{}');
  assert.equal(response.statusCode, 200);
  assert.equal(body.success, true);
  assert.equal(body.send_status, 'delivered');
});

test('send-whatsapp-flow returns an accepted durable failed projection', async () => {
  const response = await sendWhatsappFlow(
    event({ flow_id: 'flow-failed', quotation_id: quotationId, revision_id: revisionId }),
    {
      deliveryModule: {
        async enqueue() {
          return durableDelivery({ state: 'failed', publicError: 'A revisão do orçamento não está disponível para envio.' });
        },
      },
    } as any,
  );
  const body = JSON.parse(response.body || '{}');
  assert.equal(response.statusCode, 202);
  assert.equal(body.success, true);
  assert.equal(body.send_status, 'failed');
  assert.equal(body.delivery.state, 'failed');
  assert.equal(
    body.delivery.public_error,
    'A revisão do orçamento não está disponível para envio.',
  );
});

test('send-whatsapp-flow sanitizes outbox failures', async () => {
  const response = await sendWhatsappFlow(
    event({ flow_id: 'flow-failure', quotation_id: quotationId, revision_id: revisionId }),
    { deliveryModule: { async enqueue() { throw new Error('provider secret'); } } as any },
  );
  assert.equal(response.statusCode, 503);
  assert.doesNotMatch(response.body || '', /provider secret/i);
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

test('PostgreSQL flow endpoint accepts an injected durable delivery module', async () => {
  const response = await sendWhatsappFlow(
    event({ flow_id: 'flow-postgres', quotation_id: quotationId, revision_id: revisionId }),
    {
      deliveryModule: {
        async enqueue() {
          return {
            id: 'delivery-postgres',
            revisionId,
            businessNumber,
            clientName: 'Cliente Teste',
            phone: '5511999990000',
            flowId: 'flow-postgres',
            flowName: 'Fluxo PostgreSQL',
            state: 'delivered',
            completionSource: 'provider_receipt',
            publicError: null,
            nextAttemptAt: null,
            reconciliationDeadline: null,
            deliveredAt: new Date('2026-08-17T12:00:00.000Z'),
            createdAt: new Date('2026-08-17T12:00:00.000Z'),
            updatedAt: new Date('2026-08-17T12:00:00.000Z'),
            steps: [],
          };
        },
      } as any,
    },
  );
  const body = JSON.parse(response.body || '{}');
  assert.equal(response.statusCode, 200);
  assert.equal(body.send_status, 'delivered');
  assert.equal(body.delivery.completion_source, 'provider_receipt');
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
