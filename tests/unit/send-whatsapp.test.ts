import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handler as sendWhatsapp,
  loadPostgresSendContext,
} from '../../api/_functions/send-whatsapp.js';
import { handler as sendWhatsappFlow } from '../../api/_functions/send-whatsapp-flow.js';
import { handler as communicationFlowPreview } from '../../api/_functions/communication-flow-preview.js';

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
      templateHash: 'e'.repeat(64),
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
      event({ source: 'postgres', dry_run: true, revision_id: revisionId, template: 'Olá' }),
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
      dry_run: true,
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
  });
  assert.equal(context.quotationUuid, quotationId);
  assert.equal(context.revisionId, revisionId);
  assert.equal(context.businessNumber, businessNumber);
  assert.equal(context.phone, '5511999990000');
  assert.equal(context.view.client.name, 'Cliente Teste');
  assert.equal(context.view.items[0]?.item_code, 'CNG-001');
  assert.equal(context.publicLink, `https://app.test/api/public-quotation?token=${publicToken}`);
  assert.equal(tokenStore.values.size, 1);
});
