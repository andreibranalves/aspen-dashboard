import assert from 'node:assert/strict';
import test from 'node:test';

import { loadQuotationSendContext } from '../../api/_modules/quotation-send-context.js';
import { sendFrozenStep } from '../../api/_modules/evolution-transport.js';
import { createDeliveryPlan, type DeliveryFlow } from '../../api/_modules/quotation-delivery-plan.js';
import { handler as sendWhatsappFlow } from '../../api/_modules/send-whatsapp-flow.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_modules/quotation-template-catalog.js';
import {
  createQuotationSectionsSnapshot,
  normalizeQuotationSections,
  withQuotationProductionDeadline,
} from '../../api/_modules/quotation-content.js';

const quotationId = 'quote-00000000-0000-4000-8000-000000000001';
const revisionId = '00000000-0000-4000-8000-000000000001';

function canonicalSectionsSnapshot() {
  const sections = withQuotationProductionDeadline(
    normalizeQuotationSections(undefined),
    '30 dias'
  );
  sections.pagamento.body = 'Pix';
  return createQuotationSectionsSnapshot(sections);
}
const businessNumber = 'ORC-20260001';
const publicToken = 'A'.repeat(32);

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
      sectionsSnapshot: canonicalSectionsSnapshot(),
      templateVersionId: null,
      statusOriginal: null,
      orderLinkage: null,
      orderPending: false,
    },
    templateVersion: null,
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

function store() {
  const values = new Map<string, unknown>();
  return {
    values,
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

function validPdf(size = 16): Buffer {
  const pdf = Buffer.alloc(size, 0x61);
  pdf.write('%PDF-', 0, 'ascii');
  pdf.write('%%EOF', Math.max(5, size - 5), 'ascii');
  return pdf;
}

function durableDeliveryModule(options: {
  resolveFlow: (flowId: string) => Promise<DeliveryFlow | null>;
  repository: any;
  store: any;
  token: () => string;
  mediaRecords?: Array<Record<string, unknown>>;
  headBlob?: any;
  resolveMedia?: any;
}) {
  return {
    async enqueue(input: { revisionId: string; flowId: string }) {
      const plan = await createDeliveryPlan({
        quotationId: businessNumber,
        businessNumber,
        revisionId: input.revisionId,
        flowId: input.flowId,
        baseUrl: 'https://app.test',
        resolveFlow: options.resolveFlow,
        repository: options.repository,
        store: options.store,
        token: options.token,
        mediaRecords: options.mediaRecords,
        headBlob: options.headBlob,
        resolveMedia: options.resolveMedia,
      });
      const now = new Date('2026-08-20T12:00:00.000Z');
      const steps = [];
      for (const [position, step] of plan.steps.entries()) {
        const document = step.type === 'quotation_pdf'
          ? {
              pdf: validPdf(),
              pdfSize: validPdf().length,
              pdfSignature: 'test-signature',
              validUntil: new Date(now.getTime() + 86_400_000),
            }
          : undefined;
        await sendFrozenStep(
          { phone: plan.phone, step, document },
          {
            baseUrl: 'https://evolution.test',
            apiKey: 'test-key',
            instance: 'test-instance',
            fetch: globalThis.fetch,
          },
        );
        steps.push({
          id: `step-${position}`,
          position,
          type: step.type,
          state: 'delivered',
          attemptCount: 1,
          publicError: null,
          nextAttemptAt: null,
          acceptedAt: now,
          deliveredAt: now,
          readAt: null,
          updatedAt: now,
        });
      }
      return {
        id: 'delivery-test',
        revisionId: plan.revisionId,
        businessNumber: plan.businessNumber,
        clientName: plan.clientName,
        phone: plan.phone,
        flowId: plan.flowId,
        flowName: plan.flowName,
        state: 'delivered',
        completionSource: 'provider_receipt',
        publicError: null,
        nextAttemptAt: null,
        actionDeadline: null,
        reconciliationDeadline: null,
        deliveredAt: now,
        createdAt: now,
        updatedAt: now,
        steps,
      };
    },
  } as any;
}

test('selected non-latest revision remains the exact revision sent', async () => {
  const requested: string[] = [];
  const context = await loadQuotationSendContext({
    quotationId: businessNumber,
    revisionId,
    baseUrl: 'https://app.test',
    repository: {
      get: async (id: string) => {
        requested.push(id);
        return snapshot();
      },
    } as any,
    store: store(),
    token: () => publicToken,
  });
  assert.ok(requested.length >= 1);
  assert.equal(requested.every((id) => id === revisionId), true);
  assert.equal(context.revisionId, revisionId);
});

test('unresolved requested flow media fails before any text transport', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-should-not-run' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(event({
      flow_id: 'flow-media',
      quotation_id: businessNumber,
      revision_id: revisionId,
    }), {
      resolveFlow: async () => ({
        id: 'flow-media',
        name: 'Mídia',
        steps: [
          { type: 'text', template: 'Texto não deve ser enviado' },
          { type: 'product_media', max_items: 1 },
          { type: 'document', source: 'quotation_pdf' },
        ],
      }),
      repository: repository(),
      store: store(),
      token: () => publicToken,
      mediaRecords: [],
      deliveryModule: durableDeliveryModule({
        resolveFlow: async () => ({
          id: 'flow-media',
          name: 'Mídia',
          steps: [
            { type: 'text', template: 'Texto não deve ser enviado' },
            { type: 'product_media', max_items: 1 },
            { type: 'document', source: 'quotation_pdf' },
          ],
        }),
        repository: repository(),
        store: store(),
        token: () => publicToken,
        mediaRecords: [],
      }),
    });
    assert.equal(response.statusCode, 400);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('flow sends an active uploaded MP4 as Evolution video with a safe filename', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const videoUrl = 'https://store.public.blob.vercel-storage.com/aspen-media/canga/unsafe%20name.mp4';
  const videoPath = 'aspen-media/canga/unsafe name.mp4';
  const providerBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (input, init) => {
    if (String(input) === videoUrl) {
      return new Response('video-bytes', {
        status: 200,
        headers: { 'Content-Type': 'video/mp4', 'Content-Length': '11' },
      });
    }
    providerBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ accepted: true, message_id: `provider-${providerBodies.length}` }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(event({
      flow_id: 'flow-video',
      quotation_id: businessNumber,
      revision_id: revisionId,
    }), {
      resolveFlow: async () => ({
        id: 'flow-video',
        name: 'Fluxo vídeo',
        delay_min_seconds: 0,
        delay_max_seconds: 0,
        max_media_per_product_group: 1,
        steps: [
          { type: 'text', template: 'Antes do vídeo' },
          { type: 'product_media', max_items: 1 },
          { type: 'document', source: 'quotation_pdf' },
        ],
      }),
      repository: repository(),
      store: store(),
      token: () => publicToken,
      mediaRecords: [{
        id: 'video-1',
        product_group: 'canga',
        blob_url: videoUrl,
        pathname: videoPath,
        active: true,
        content_type: 'video/mp4',
        size_bytes: 11,
        kind: 'video',
      }],
      headBlob: async () => ({
        url: videoUrl,
        pathname: videoPath,
        contentType: 'video/mp4',
        size: 11,
      }) as any,
      recordSendEvent: async () => 'video-event',
      deliveryModule: durableDeliveryModule({
        resolveFlow: async () => ({
          id: 'flow-video',
          name: 'Fluxo vídeo',
          delay_min_seconds: 0,
          delay_max_seconds: 0,
          max_media_per_product_group: 1,
          steps: [
            { type: 'text', template: 'Antes do vídeo' },
            { type: 'product_media', max_items: 1 },
            { type: 'document', source: 'quotation_pdf' },
          ],
        }),
        repository: repository(),
        store: store(),
        token: () => publicToken,
        mediaRecords: [{
          id: 'video-1',
          product_group: 'canga',
          blob_url: videoUrl,
          pathname: videoPath,
          active: true,
          content_type: 'video/mp4',
          size_bytes: 11,
          kind: 'video',
        }],
        headBlob: async () => ({
          url: videoUrl,
          pathname: videoPath,
          contentType: 'video/mp4',
          size: 11,
        }) as any,
      }),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(providerBodies.length, 3);
    assert.equal(providerBodies[0]?.text, 'Antes do vídeo');
    assert.equal(providerBodies[1]?.mediatype, 'video');
    assert.equal(providerBodies[1]?.mimetype, 'video/mp4');
    assert.equal(providerBodies[1]?.fileName, 'unsafe_name.mp4');
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('flow send response strips every media internal alias recursively', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const mediaUrl = 'https://store.public.blob.vercel-storage.com/aspen-media/canga/redacted.jpg';
  globalThis.fetch = (async () => new Response('image-bytes', {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '11' },
  })) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(event({
      flow_id: 'flow-redaction',
      quotation_id: businessNumber,
      revision_id: revisionId,
      dry_run: true,
    }), {
      resolveFlow: async () => ({
        id: 'flow-redaction',
        name: 'Redação',
        max_media_per_product_group: 1,
        steps: [{ type: 'product_media', max_items: 1 }, { type: 'document', source: 'quotation_pdf' }],
      }),
      resolveMedia: async () => [{
        type: 'image',
        media: mediaUrl,
        mimetype: 'image/jpeg',
        fileName: 'redacted.jpg',
        approvedRecord: {
          id: 'approved',
          product_group: 'canga',
          blob_url: mediaUrl,
          pathname: 'aspen-media/canga/redacted.jpg',
          active: true,
          content_type: 'image/jpeg',
          size_bytes: 11,
          _recordVersion: 'canonical',
          recordVersion: 'record-version',
          version: 'version',
          _deleting: false,
          deleting: false,
        },
        nested: [{ _recordVersion: 'nested', deleting: true }],
      }] as any,
      repository: repository(),
      store: store(),
      token: () => publicToken,
      headBlob: async () => ({
        url: mediaUrl,
        pathname: 'aspen-media/canga/redacted.jpg',
        contentType: 'image/jpeg',
        size: 11,
      }) as any,
    });
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(response.body || '', /_recordVersion|recordVersion|version|_deleting|deleting/);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('flow rejects unsupported active media before sending preceding text', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-should-not-run' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsappFlow(event({
      flow_id: 'flow-invalid-media',
      quotation_id: businessNumber,
      revision_id: revisionId,
    }), {
      resolveFlow: async () => ({
        id: 'flow-invalid-media',
        name: 'Fluxo inválido',
        steps: [
          { type: 'text', template: 'Não enviar' },
          { type: 'product_media', max_items: 1 },
          { type: 'document', source: 'quotation_pdf' },
        ],
      }),
      repository: repository(),
      store: store(),
      token: () => publicToken,
      mediaRecords: [{
        id: 'invalid-1',
        product_group: 'canga',
        blob_url: 'https://store.public.blob.vercel-storage.com/aspen-media/canga/file.txt',
        pathname: 'aspen-media/canga/file.txt',
        active: true,
        content_type: 'text/plain',
        size_bytes: 11,
        kind: 'image',
      }],
      headBlob: async () => ({
        url: 'https://store.public.blob.vercel-storage.com/aspen-media/canga/file.txt',
        pathname: 'aspen-media/canga/file.txt',
        contentType: 'text/plain',
        size: 11,
      }) as any,
      deliveryModule: durableDeliveryModule({
        resolveFlow: async () => ({
          id: 'flow-invalid-media',
          name: 'Fluxo inválido',
          steps: [
            { type: 'text', template: 'Não enviar' },
            { type: 'product_media', max_items: 1 },
            { type: 'document', source: 'quotation_pdf' },
          ],
        }),
        repository: repository(),
        store: store(),
        token: () => publicToken,
        mediaRecords: [{
          id: 'invalid-1',
          product_group: 'canga',
          blob_url: 'https://store.public.blob.vercel-storage.com/aspen-media/canga/file.txt',
          pathname: 'aspen-media/canga/file.txt',
          active: true,
          content_type: 'text/plain',
          size_bytes: 11,
          kind: 'image',
        }],
        headBlob: async () => ({
          url: 'https://store.public.blob.vercel-storage.com/aspen-media/canga/file.txt',
          pathname: 'aspen-media/canga/file.txt',
          contentType: 'text/plain',
          size: 11,
        }) as any,
      }),
    });
    assert.equal(response.statusCode, 400);
    assert.match(response.body || '', /Falha antes do transporte|MIME|mídia/i);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
