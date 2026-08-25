import assert from 'node:assert/strict';
import test from 'node:test';

import { handler as sendWhatsapp, loadPostgresSendContext, MAX_QUOTATION_PDF_BYTES } from '../../api/_modules/send-whatsapp.js';
import { sendFrozenStep } from '../../api/_modules/evolution-transport.js';
import { createDeliveryPlan, type DeliveryFlow } from '../../api/_modules/quotation-delivery-plan.js';
import { handler as sendWhatsappFlow } from '../../api/_modules/send-whatsapp-flow.js';
import { renderQuotationDocument } from '../../api/_modules/quotation-document.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_modules/quotation-template-catalog.js';
import { createFakeWhatsappReservationStore } from '../fixtures/fake-whatsapp-reservation-store.mjs';

const quotationId = 'quote-00000000-0000-4000-8000-000000000001';
const revisionId = '00000000-0000-4000-8000-000000000001';
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

function store() {
  const values = new Map<string, unknown>();
  return {
    values,
    get: async <T>(key: string) => (values.get(key) as T | undefined) || null,
    set: async (key: string, value: unknown) => { values.set(key, value); return 'OK'; },
    del: async (key: string) => values.delete(key),
  };
}

function reservationStore() {
  return createFakeWhatsappReservationStore() as any;
}

function deliveryBoundary(initialState?: string) {
  let current: any = initialState
    ? { id: 'delivery', revisionId, phone: '5511999990000', flowId: 'direct-send', state: initialState, readOnly: false }
    : null;
  let providerClaims = 0;
  const states: string[] = initialState ? [initialState] : [];
  return {
    get current() { return current; },
    get providerClaims() { return providerClaims; },
    get states() { return states; },
    async getByRevision() { return current; },
    async prepareDelivery(input: any) {
      current ||= { id: 'delivery', revisionId: input.revisionId, phone: '5511999990000', flowId: input.flowId, state: 'pending', readOnly: false };
      return { delivery: current, pdf: validPdf(), pdfSize: validPdf().length, pdfSignature: 'a'.repeat(64), validUntil: new Date(Date.now() + 86400000) };
    },
    async claimTransport() {
      if (current?.state !== 'pending' && current?.state !== 'retryable') return null;
      providerClaims += 1;
      current = { ...current, state: 'transporting' };
      states.push('transporting');
      return current;
    },
    async recordState(input: any) {
      current = { ...(current || {}), state: input.state, readOnly: false };
      states.push(input.state);
      return current;
    },
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

test('snapshot path ignores obsolete caller/deal/name/items metadata', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-1' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({
      quotation_id: businessNumber,
      quotation_uuid: 'caller-uuid',
      revision_id: revisionId,
      telefone: '11999990000',
      nome: 'Caller Name',
      deal_id: 'caller-deal',
      items: [{ item_code: 'EVIL-001' }],
      sequence: { delay_min_ms: 0, delay_max_ms: 0, steps: [{ type: 'text', template: '(primeiro_nome)' }, { type: 'document', source: 'quotation_pdf' }] },
    }), {
      repository: repository(),
      store: store(),
      token: () => publicToken,
    });
    assert.equal(response.statusCode, 200);
    const result = JSON.parse(response.body || '{}');
    assert.equal(result.message, undefined);
    assert.equal(result.number, '5511999990000');
    assert.equal(result.deal_id, null);
    assert.equal(bodies[0]?.number, '5511999990000');
    assert.equal(bodies[0]?.text, 'Cliente');
    assert.equal(bodies[0]?.quotation_uuid, undefined);
    assert.equal(bodies[0]?.revision_id, undefined);
    assert.equal(bodies[0]?.nome, undefined);
    assert.equal(bodies[0]?.deal_id, undefined);
    assert.equal(bodies[0]?.items, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('selected non-latest revision sends its recipient, name, and items instead of latest snapshot', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const selectedRevisionId = 'revision-selected-0000-0000-4000-8000-000000000001';
  const latestRevisionId = 'revision-latest-0000-0000-4000-8000-000000000001';
  const selected = snapshot();
  selected.revision.id = selectedRevisionId;
  selected.revision.clienteNome = 'Cliente Selecionado';
  selected.revision.clienteTelefone = '11999990000';
  selected.items[0].revisionId = selectedRevisionId;
  selected.items[0].produtoSku = 'CNG-001';
  const latest = snapshot();
  latest.revision.id = latestRevisionId;
  latest.revision.clienteNome = 'Cliente Mais Recente';
  latest.revision.clienteTelefone = '21999990000';
  latest.items[0].revisionId = latestRevisionId;
  latest.items[0].produtoSku = 'BNE-001';
  const providerBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    providerBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-selected' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({
      quotation_id: businessNumber,
      revision_id: selectedRevisionId,
      nome: 'Caller Name',
      sequence: { steps: [{ type: 'text', template: '(nome) - (produto_resumo)' }, { type: 'document', source: 'quotation_pdf' }] },
    }), {
      repository: {
        get: async (id: string) => id === selectedRevisionId ? selected : id === latestRevisionId ? latest : null,
      } as any,
      store: store(),
      token: () => publicToken,
    });
    assert.equal(response.statusCode, 200);
    const capturedBody: any = providerBodies[0];
    assert.equal(capturedBody?.number, '5511999990000');
    assert.equal(capturedBody?.text, 'Cliente Selecionado - cangas');
    assert.doesNotMatch(String(capturedBody?.text), /Mais Recente|Caller Name|bonés/i);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('selected non-latest revision remains the exact revision sent', async () => {
  const requested: string[] = [];
  const context = await loadPostgresSendContext({
    quotationId: businessNumber,
    revisionId,
    needPdf: false,
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

test('media-store read failure fails closed before provider or text steps', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => {
    providerCalls += 1;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-should-not-run' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({
      quotation_id: businessNumber,
      revision_id: revisionId,
      sequence: {
        steps: [
          { type: 'text', template: 'Texto não deve ser enviado' },
          { type: 'image', media: 'https://store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg' },
          { type: 'document', source: 'quotation_pdf' },
        ],
      },
    }), {
      repository: repository(),
      store: store(),
      token: () => publicToken,
      readMediaRecords: async () => { throw new Error('KV down'); },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
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
      reservationStore: reservationStore(),
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
      reservationStore: reservationStore(),
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
      reservationStore: reservationStore(),
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

test('direct PostgreSQL send delivers an owned MP4 as Evolution video', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const videoUrl = 'https://store.public.blob.vercel-storage.com/aspen-media/canga/direct.mp4';
  const videoPath = 'aspen-media/canga/direct.mp4';
  const providerBodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (input, init) => {
    if (String(input) === videoUrl) return new Response('video-bytes', {
      status: 200,
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': '11' },
    });
    providerBodies.push(JSON.parse(String(init?.body || '{}')) as Record<string, unknown>);
    return new Response(JSON.stringify({ accepted: true, message_id: `provider-${providerBodies.length}` }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({
      quotation_id: businessNumber,
      revision_id: revisionId,
      sequence: { delay_min_ms: 0, delay_max_ms: 0, steps: [{ type: 'video', media: videoUrl }, { type: 'document', source: 'quotation_pdf' }] },
    }), {
      repository: repository(),
      store: store(),
      token: () => publicToken,
      mediaRecords: [{
        id: 'direct-video',
        product_group: 'canga',
        blob_url: videoUrl,
        pathname: videoPath,
        active: true,
        content_type: 'video/mp4',
        size_bytes: 11,
        kind: 'video',
      }],
      headBlob: async () => ({ url: videoUrl, pathname: videoPath, contentType: 'video/mp4', size: 11 }) as any,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(providerBodies.length, 2);
    assert.equal(providerBodies[0]?.mediatype, 'video');
    assert.equal(providerBodies[0]?.mimetype, 'video/mp4');
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('direct production path uses durable boundary and blocks replay', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const boundary = deliveryBoundary();
  let providerCalls = 0;
  globalThis.fetch = (async (_input, init) => { providerCalls += 1; return new Response(JSON.stringify({ accepted: true, message_id: `provider-${providerCalls}` }), { status: 200 }); }) as typeof fetch;
  try {
    const dependencies = { repository: repository(), store: store(), token: () => publicToken, deliveryRepository: boundary } as any;
    const body = { quotation_id: businessNumber, revision_id: revisionId, sequence: { delay_min_ms: 0, delay_max_ms: 0, steps: [{ type: 'text', template: 'Olá' }, { type: 'document', source: 'quotation_pdf' }] } };
    const first = await sendWhatsapp(event(body), dependencies);
    const second = await sendWhatsapp(event(body), dependencies);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(providerCalls, 2);
    assert.equal(boundary.providerClaims, 1);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('business number plus quote revision alias constructs durable boundary', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const boundary = deliveryBoundary();
  let factoryCalls = 0;
  globalThis.fetch = (async () => new Response(JSON.stringify({ accepted: true, message_id: 'provider-alias' }), { status: 200 })) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({ business_number: businessNumber, quote_revision_id: revisionId, sequence: { steps: [{ type: 'document', source: 'quotation_pdf' }] } }), {
      repository: repository(), store: store(), token: () => publicToken,
      deliveryRepositoryFactory: () => { factoryCalls += 1; return boundary; },
    } as any);
    assert.equal(response.statusCode, 200);
    assert.equal(factoryCalls, 1);
    assert.equal(boundary.current.state, 'completed');
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('active and uncertain direct replays never call provider or overwrite state', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = (async () => { providerCalls += 1; return new Response('{}'); }) as typeof fetch;
  try {
    for (const state of ['transporting', 'accepted_partial']) {
      const boundary = deliveryBoundary(state);
      const response = await sendWhatsapp(event({ quotation_id: businessNumber, revision_id: revisionId, sequence: { steps: [{ type: 'document', source: 'quotation_pdf' }] } }), { repository: repository(), store: store(), token: () => publicToken, deliveryRepository: boundary } as any);
      assert.equal(response.statusCode, 409);
      assert.equal(boundary.current.state, state);
    }
    const reconciling = deliveryBoundary('reconciling');
    const response = await sendWhatsapp(event({ quotation_id: businessNumber, revision_id: revisionId, sequence: { steps: [] } }), { repository: repository(), store: store(), token: () => publicToken, deliveryRepository: reconciling } as any);
    assert.equal(response.statusCode, 400);
    assert.equal(reconciling.current.state, 'reconciling');
    assert.equal(providerCalls, 0);
  } finally { globalThis.fetch = originalFetch; restore(); }
});

test('retryable direct delivery is reclaimed once and overlapping replay cannot duplicate provider transport', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  const boundary = deliveryBoundary('retryable');
  let providerCalls = 0;
  let releaseProvider!: () => void;
  let notifyProviderStarted!: () => void;
  const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });
  const providerStarted = new Promise<void>((resolve) => { notifyProviderStarted = resolve; });
  globalThis.fetch = (async () => {
    providerCalls += 1;
    notifyProviderStarted();
    await providerGate;
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-owned' }), { status: 200 });
  }) as typeof fetch;
  try {
    const dependencies = { repository: repository(), store: store(), token: () => publicToken, deliveryRepository: boundary } as any;
    const request = event({ quotation_id: businessNumber, revision_id: revisionId, sequence: { steps: [{ type: 'document', source: 'quotation_pdf' }] } });
    const first = sendWhatsapp(request, dependencies);
    await providerStarted;
    const second = await sendWhatsapp(request, dependencies);
    assert.equal(second.statusCode, 409);
    assert.equal(providerCalls, 1);
    assert.equal(boundary.providerClaims, 1);
    releaseProvider();
    assert.equal((await first).statusCode, 200);
    assert.equal(boundary.current.state, 'completed');
  } finally { releaseProvider(); globalThis.fetch = originalFetch; restore(); }
});

test('revision identifier aliases finish uncertain provider failures in reconciling', async () => {
  for (const alias of ['revision_id', 'revisionId', 'quote_revision_id']) {
    const restore = evolutionEnv();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error('network uncertain'); }) as typeof fetch;
    const boundary = deliveryBoundary();
    try {
      const response = await sendWhatsapp(event({ quotation_id: businessNumber, [alias]: revisionId, sequence: { steps: [{ type: 'text', template: 'Olá' }, { type: 'document', source: 'quotation_pdf' }] } }), { repository: repository(), store: store(), token: () => publicToken, deliveryRepository: boundary } as any);
      assert.equal(response.statusCode, 502);
      assert.equal(boundary.current.state, 'reconciling');
      assert.equal(boundary.states.at(-1), 'reconciling');
      assert.equal(boundary.states.includes('retryable'), false);
    } finally { globalThis.fetch = originalFetch; restore(); }
  }
});

test('direct WhatsApp PDF is produced from the canonical document seam', async () => {
  let seamCalls = 0;
  let renderedHtml = '';
  await loadPostgresSendContext({
    quotationId: businessNumber,
    revisionId,
    needPdf: true,
    baseUrl: 'https://app.test',
    repository: repository(),
    store: store(),
    token: () => publicToken,
    renderDocument: (value) => {
      seamCalls += 1;
      return renderQuotationDocument(value);
    },
    renderPdf: async (html) => {
      renderedHtml = html;
      return validPdf();
    },
  });
  assert.equal(seamCalls, 1);
  assert.match(renderedHtml, /Cliente Teste/);
  assert.match(renderedHtml, /ORC-20260001/);
});

test('document rendering failures stay safe before WhatsApp transport', async () => {
  const result = await sendWhatsapp(event({
    quotation_id: businessNumber,
    revision_id: revisionId,
    sequence: { steps: [{ type: 'document', source: 'quotation_pdf' }] },
  }), {
    repository: repository(),
    store: store(),
    token: () => publicToken,
    renderDocument: () => {
      throw Object.assign(new Error('customer personal data and provider secret'), { statusCode: 500 });
    },
  });

  assert.equal(result.statusCode, 503);
  assert.deepEqual(JSON.parse(result.body || '{}'), {
    error: 'Não foi possível preparar o documento do orçamento.',
  });
  assert.doesNotMatch(result.body || '', /personal data|provider secret|stack/i);
});

test('unexpected PDF renderer status codes stay sanitized', async () => {
  const result = await sendWhatsapp(event({
    quotation_id: businessNumber,
    revision_id: revisionId,
    sequence: { steps: [{ type: 'document', source: 'quotation_pdf' }] },
  }), {
    repository: repository(),
    store: store(),
    token: () => publicToken,
    renderPdf: async () => {
      throw Object.assign(new Error('renderer secret'), { statusCode: 500 });
    },
  });

  assert.equal(result.statusCode, 503);
  assert.deepEqual(JSON.parse(result.body || '{}'), {
    error: 'Não foi possível preparar o PDF do orçamento.',
  });
  assert.doesNotMatch(result.body || '', /renderer secret|stack/i);
});

test('generated PDF is capped, validated, and redacted from response', async () => {
  await assert.rejects(
    loadPostgresSendContext({
      quotationId: businessNumber,
      revisionId,
      needPdf: true,
      baseUrl: 'https://app.test',
      repository: repository(),
      store: store(),
      token: () => publicToken,
      renderPdf: async () => Buffer.from('not a pdf'),
    }),
    /Não foi possível gerar o PDF/,
  );
  await assert.rejects(
    loadPostgresSendContext({
      quotationId: businessNumber,
      revisionId,
      needPdf: true,
      baseUrl: 'https://app.test',
      repository: repository(),
      store: store(),
      token: () => publicToken,
      renderPdf: async () => validPdf(MAX_QUOTATION_PDF_BYTES + 1),
    }),
    /PDF do orçamento excede/,
  );

  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const request = JSON.parse(String(init?.body || '{}'));
    if (request.media) {
      assert.equal(request.media, validPdf().toString('base64'));
    }
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-pdf' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({
      quotation_id: businessNumber,
      revision_id: revisionId,
      sequence: { delay_min_ms: 0, delay_max_ms: 0, steps: [{ type: 'document', source: 'quotation_pdf' }] },
    }), {
      repository: repository(),
      store: store(),
      token: () => publicToken,
      renderPdf: async () => validPdf(),
    });
    assert.equal(response.statusCode, 200);
    assert.doesNotMatch(response.body || '', /JVBER|__pdf-base64__/);
    const result = JSON.parse(response.body || '{}');
    assert.equal(result.steps[0].media, 'quotation_pdf');
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});
