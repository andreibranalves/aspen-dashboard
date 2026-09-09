import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CommunicationSendError,
  communicationFlowSummary,
  createMedia,
  executeFlow,
  fetchDeliveryStatus,
  fetchProductCategories,
  isQuotationDeliveryFlow,
  mediaGroupPathSegment,
  projectDeliveryFailure,
  projectDeliveryState,
  renderableFlowStepCount,
} from '../../src/lib/api/communicationApi.ts';
import { getQuotationIssue, issuePersistedDraft, QuotationIssueApiError } from '../../src/lib/api/quotationIssueApi.ts';

const payload = {
  quotation_id: 'ORC-20260001',
  revision_id: 'revision-1',
  flow_id: 'flow-1',
};

const validIssue = {
  quotationId: 'q-1', businessNumber: 'ORC-20260001', revisionId: 'r-1', revisionNumber: 1,
  status: 'emitido', issuedAt: '2026-08-13T00:00:00.000Z', validUntil: '2026-08-28', pdfUrl: '/api/quotation-preview?id=q-1&format=pdf',
};

const validResponse = {
  success: true,
  dry_run: false,
  send_status: 'completed',
  duplicate_warning: false,
  duplicate_message: '',
  flow_id: 'flow-1',
  flow_name: 'Fluxo',
  quotation_id: 'ORC-20260001',
  deal_id: null,
  phone: '5511999990000',
  product_summary: 'cangas',
  categories: ['canga'],
  steps_count: 1,
  steps: [],
  send_event_id: 'event-1',
};

test('fetchProductCategories loads categories used by active products', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    assert.equal(String(input), '/api/products?view=categories');
    return new Response(JSON.stringify({ categories: ['Boné', 'Canga personalizada'] }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await fetchProductCategories(), ['Boné', 'Canga personalizada']);
    assert.equal(await mediaGroupPathSegment('Necessaire'), 'a0d87da082ceacbbf006dd4a1a5866ad');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createMedia preserves the uploaded Blob metadata write path', async () => {
  const originalFetch = globalThis.fetch;
  const payload = {
    title: 'Referência',
    product_group: 'canga' as const,
    kind: 'image' as const,
    blob_url: 'https://store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg',
    pathname: 'aspen-media/canga/reference.jpg',
    content_type: 'image/jpeg',
    size_bytes: 11,
  };
  let request: { url: string; method: string; body?: string } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = {
      url: String(input),
      method: init?.method || 'GET',
      body: init?.body as string | undefined,
    };
    return new Response(JSON.stringify({ success: true, item: payload }), { status: 201 });
  }) as typeof fetch;
  try {
    const response = await createMedia(payload);
    assert.equal(request?.url, '/api/communication-media');
    assert.equal(request?.method, 'POST');
    assert.deepEqual(JSON.parse(request?.body || '{}'), payload);
    assert.deepEqual(response.item, payload);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('issuePersistedDraft sends only the revision reference and idempotency header', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; method: string; headers: Headers; body?: string };
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), method: init?.method || 'GET', headers: new Headers(init?.headers), body: init?.body as string | undefined };
    return new Response(JSON.stringify(validIssue), { status: 200 });
  }) as typeof fetch;
  try {
    const key = '550e8400-e29b-41d4-a716-446655440000';
    await issuePersistedDraft('r-1', '2026-08-10T12:00:00.000Z', key);
    assert.equal(request!.headers.get('Idempotency-Key'), key);
    assert.equal(request!.url, '/api/quotation-issues');
    assert.deepEqual(JSON.parse(request!.body || '{}'), {
      revision_id: 'r-1',
      concurrency_token: '2026-08-10T12:00:00.000Z',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getQuotationIssue preserves processing then completed recovery without posting', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    { state: 'processing', retryAfterMs: 100 },
    { state: 'completed', ...validIssue },
  ];
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    assert.equal(init?.method || 'GET', 'GET');
    return new Response(JSON.stringify(responses.shift()), { status: 200 });
  }) as typeof fetch;
  try {
    const key = '550e8400-e29b-41d4-a716-446655440000';
    const processing = await getQuotationIssue(key);
    const completed = await getQuotationIssue(key);
    assert.deepEqual(processing, { state: 'processing', retryAfterMs: 100 });
    assert.equal(completed.state, 'completed');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getQuotationIssue exposes safe GET failures for retryable recovery', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
  try {
    await assert.rejects(getQuotationIssue('550e8400-e29b-41d4-a716-446655440000'), /network down/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getQuotationIssue never posts work', async () => {
  const originalFetch = globalThis.fetch;
  let request: { url: string; method: string };
  globalThis.fetch = (async (input, init) => {
    request = { url: String(input), method: init?.method || 'GET' };
    return new Response(JSON.stringify({ state: 'processing', retryAfterMs: 1000 }), { status: 200 });
  }) as typeof fetch;
  try {
    await getQuotationIssue('550e8400-e29b-41d4-a716-446655440000');
    assert.equal(request!.method, 'GET');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow rejects malformed HTTP 2xx instead of rendering sent', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(executeFlow(payload), (error: unknown) => {
      assert.match(String((error as Error).message), /Resposta inválida|envio de WhatsApp/i);
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow accepts only a complete neutral successful shape', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(validResponse), { status: 200 })) as typeof fetch;
  try {
    const response = await executeFlow(payload);
    assert.equal(response.success, true);
    assert.equal((response as unknown as { send_status: string }).send_status, 'completed');
    assert.deepEqual(response.steps, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow accepts a strictly shaped completed replay without recipient PII', async () => {
  const originalFetch = globalThis.fetch;
  const replay = { ...validResponse };
  delete (replay as Partial<typeof validResponse>).phone;
  globalThis.fetch = (async () => new Response(JSON.stringify(replay), { status: 200 })) as typeof fetch;
  try {
    const response = await executeFlow(payload);
    assert.equal(response.success, true);
    assert.equal(response.phone, undefined);
    assert.equal(response.send_status, 'completed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow rejects malformed phone values instead of rendering a replay', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ ...validResponse, phone: 123 }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(executeFlow(payload), /Resposta inválida|envio de WhatsApp/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow maps accepted partial responses only at the boundary', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: 'O transporte foi aceito e aguarda reconciliação.',
    send_status: 'accepted_partial',
    accepted_partial: true,
    provider_accepted: true,
  }), { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(executeFlow(payload), (error: unknown) => {
      assert.ok(error instanceof CommunicationSendError);
      assert.equal((error as CommunicationSendError).deliveryAccepted, true);
      assert.equal((error as CommunicationSendError & { sendStatus?: string }).sendStatus, 'accepted_partial');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow maps reserved responses to a neutral in-progress status', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: 'Já existe uma reserva para esta revisão e fluxo. Aguarde a reconciliação.',
    send_status: 'reserved',
    reconciliation_required: true,
  }), { status: 409 })) as typeof fetch;
  try {
    await assert.rejects(executeFlow(payload), (error: unknown) => {
      assert.ok(error instanceof CommunicationSendError);
      assert.equal((error as CommunicationSendError).deliveryAccepted, false);
      assert.equal((error as CommunicationSendError & { sendStatus?: string }).sendStatus, 'reserved');
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('projects provider acceptance without claiming delivery', () => {
  const result = projectDeliveryState({
    send_status: 'accepted_partial',
    provider_accepted: true,
  });
  assert.equal(result.label, 'Envio aceito');
  assert.notEqual(result.label, 'Entregue');
  assert.equal(result.retryable, false);
});

test('projects retryable causes, reconciling, completed and read-only delivery states safely', () => {
  assert.deepEqual(projectDeliveryState({ phase: 'retryable', error: 'PDF indisponível. Tentar novamente.' }), {
    kind: 'retryable', label: 'PDF indisponível. Tentar novamente', retryable: true,
  });
  assert.deepEqual(projectDeliveryState({ phase: 'retryable', error: 'Falha de transporte.' }), {
    kind: 'retryable', label: 'Falha antes do transporte. Tentar novamente.', retryable: true,
  });
  assert.deepEqual(projectDeliveryState({ phase: 'reconciling' }), {
    kind: 'reconciling', label: 'Reconciliação necessária', retryable: false,
  });
  assert.deepEqual(projectDeliveryState({ phase: 'completed' }), {
    kind: 'completed', label: 'Enviado', retryable: false,
  });
  assert.deepEqual(projectDeliveryState({ phase: 'retryable', read_only: true }), {
    kind: 'readonly', label: 'Operação somente leitura. Crie uma nova revisão.', retryable: false,
  });
});

test('unknown delivery failures never claim a PDF cause or allow unsafe retry', () => {
  assert.deepEqual(projectDeliveryFailure(new Error('network down')), {
    kind: 'reconciling', label: 'Não foi possível confirmar o envio. Consulte o status antes de tentar novamente.', retryable: false,
  });
  assert.deepEqual(projectDeliveryFailure(new CommunicationSendError('Falha do provedor.', false, 'retryable')), {
    kind: 'retryable', label: 'Falha antes do transporte. Tentar novamente.', retryable: true,
  });
  assert.doesNotMatch(projectDeliveryFailure(new Error('PDF qualquer')).label, /PDF indisponível/);
});

test('fetchDeliveryStatus loads durable revision state and treats missing delivery as idle', async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (input) => {
    urls.push(String(input));
    if (urls.length === 1) return new Response(JSON.stringify({ phase: 'accepted_partial', revision_id: 'revision-1', flow_id: 'already-talking' }), { status: 200 });
    return new Response(JSON.stringify({ error: 'Estado de envio não encontrado.' }), { status: 404 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await fetchDeliveryStatus({ quotationId: 'quotation-uuid', revisionId: 'revision-1', flowId: 'already-talking' }), {
      phase: 'accepted_partial', revision_id: 'revision-1', flow_id: 'already-talking',
    });
    assert.equal(await fetchDeliveryStatus({ quotationId: 'quotation-uuid', revisionId: 'revision-1', flowId: 'already-talking' }), null);
    assert.match(urls[0], /whatsapp-send-status/);
    assert.match(urls[0], /quotation_uuid=quotation-uuid/);
    assert.match(urls[0], /revision_id=revision-1/);
    assert.match(urls[0], /flow_id=already-talking/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeFlow rejects 2xx provider markers without success contract', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ provider_accepted: true }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(executeFlow(payload), /Resposta inválida|envio de WhatsApp/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('renderableFlowStepCount mirrors the backend delivery plan step semantics', () => {
  assert.equal(renderableFlowStepCount(null), 0);
  assert.equal(
    renderableFlowStepCount({
      steps: [
        { id: 't1', type: 'text', template: '   ' },
        { id: 't2', type: 'text', template: 'Olá!' },
        { id: 'd1', type: 'document', source: 'quotation_pdf' },
        { id: 'd2', type: 'document', source: 'arquivo_invalido' } as never,
        { id: 'm1', type: 'product_media' },
      ],
    } as never),
    3
  );
});

test('isQuotationDeliveryFlow accepts only enabled flows with exactly one quotation output', () => {
  const flow = (enabled: boolean, steps: unknown[]) => ({ enabled, steps }) as never;
  const pdf = { id: 'pdf', type: 'document', source: 'quotation_pdf' };
  const webp = { id: 'webp', type: 'document', source: 'quotation_webp' };
  const text = { id: 'text', type: 'text', template: 'Olá' };

  assert.equal(isQuotationDeliveryFlow(flow(true, [text, pdf])), true);
  assert.equal(isQuotationDeliveryFlow(flow(true, [webp])), true);
  assert.equal(isQuotationDeliveryFlow(flow(false, [pdf])), false);
  assert.equal(isQuotationDeliveryFlow(flow(true, [text])), false);
  assert.equal(isQuotationDeliveryFlow(flow(true, [pdf, webp])), false);
});

test('communicationFlowSummary summarizes messages, documents and product media in PT-BR', () => {
  const flow = {
    steps: [
      { id: 'a', type: 'text', template: '(Saudacao), (primeiro_nome)!' },
      { id: 'b', type: 'text', template: '' },
      { id: 'c', type: 'document', source: 'quotation_pdf' },
      { id: 'd', type: 'document', source: 'quotation_webp' },
      { id: 'e', type: 'product_media' },
    ],
  } as never;
  assert.equal(communicationFlowSummary(flow), '1 mensagem + PDF + WebP + mídia da biblioteca');
  const textOnly = { steps: [{ id: 'x', type: 'text', template: 'oi' }, { id: 'y', type: 'text', template: 'tchau' }] } as never;
  assert.equal(communicationFlowSummary(textOnly), '2 mensagens');
  assert.equal(communicationFlowSummary({ steps: [] }), 'vazio');
});
