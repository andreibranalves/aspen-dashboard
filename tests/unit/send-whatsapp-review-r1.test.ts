import assert from 'node:assert/strict';
import test from 'node:test';

import { handler as sendWhatsapp, loadPostgresSendContext, MAX_QUOTATION_PDF_BYTES } from '../../api/_functions/send-whatsapp.js';
import { handler as sendWhatsappFlow } from '../../api/_functions/send-whatsapp-flow.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_functions/lib/quotation-templates.js';
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

function event(body: Record<string, unknown>) {
  return {
    httpMethod: 'POST',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    body: JSON.stringify(body),
  } as any;
}

function evolutionEnv() {
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

function validPdf(size = 16): Buffer {
  const pdf = Buffer.alloc(size, 0x61);
  pdf.write('%PDF-', 0, 'ascii');
  pdf.write('%%EOF', Math.max(5, size - 5), 'ascii');
  return pdf;
}

test('snapshot path ignores obsolete caller/deal/name/items metadata', async () => {
  const restore = evolutionEnv();
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body || '{}'));
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
      sequence: { delay_min_ms: 0, delay_max_ms: 0, steps: [{ type: 'text', template: '(primeiro_nome)' }] },
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
    assert.equal((body as any)?.number, '5511999990000');
    assert.equal((body as any)?.text, 'Cliente');
    assert.equal((body as any)?.quotation_uuid, undefined);
    assert.equal((body as any)?.revision_id, undefined);
    assert.equal((body as any)?.nome, undefined);
    assert.equal((body as any)?.deal_id, undefined);
    assert.equal((body as any)?.items, undefined);
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
  let providerBody: Record<string, unknown> | null = null;
  globalThis.fetch = (async (_input, init) => {
    providerBody = JSON.parse(String(init?.body || '{}'));
    return new Response(JSON.stringify({ accepted: true, message_id: 'provider-selected' }), { status: 200 });
  }) as typeof fetch;
  try {
    const response = await sendWhatsapp(event({
      quotation_id: businessNumber,
      revision_id: selectedRevisionId,
      nome: 'Caller Name',
      sequence: { steps: [{ type: 'text', template: '(nome) - (produto_resumo)' }] },
    }), {
      repository: {
        get: async (id: string) => id === selectedRevisionId ? selected : id === latestRevisionId ? latest : null,
      } as any,
      store: store(),
      token: () => publicToken,
    });
    assert.equal(response.statusCode, 200);
    const capturedBody: any = providerBody;
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
        ],
      }),
      repository: repository(),
      store: store(),
      token: () => publicToken,
      reservationStore: reservationStore(),
      mediaRecords: [],
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
    });
    assert.equal(response.statusCode, 200);
    assert.equal(providerBodies.length, 2);
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
        steps: [{ type: 'product_media', max_items: 1 }],
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
      sequence: { delay_min_ms: 0, delay_max_ms: 0, steps: [{ type: 'video', media: videoUrl }] },
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
    assert.equal(providerBodies.length, 1);
    assert.equal(providerBodies[0]?.mediatype, 'video');
    assert.equal(providerBodies[0]?.mimetype, 'video/mp4');
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test('generated PDF is capped and redacted from response', async () => {
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
