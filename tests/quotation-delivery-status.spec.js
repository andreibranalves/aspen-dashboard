import { expect, test } from '@playwright/test';
import { withCanonicalQuotationDetail } from './fixtures/quotation-detail.js';

const revisionId = '22222222-2222-4222-8222-222222222901';
const quotationId = 'ORC-20260009';
const quotationUuid = '11111111-1111-4111-8111-111111111901';
const flowId = 'flow-1';
const updatedAt = '2026-08-17T12:00:00.000Z';

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function stepState(state) {
  return {
    queued: 'queued',
    processing: 'sending',
    provider_accepted: 'server_ack',
    reconciling: 'reconciling',
    retry_scheduled: 'retry_scheduled',
    needs_review: 'needs_review',
    delivered: 'delivered',
    failed: 'failed',
  }[state];
}

function delivery(state, selectedFlowId = flowId, selectedRevisionId = revisionId) {
  const delivered = state === 'delivered';
  return {
    id: `delivery-${selectedRevisionId}-${selectedFlowId}`,
    revision_id: selectedRevisionId,
    business_number: quotationId,
    client_name: 'Cliente teste',
    phone: '5511999990000',
    flow_id: selectedFlowId,
    flow_name: selectedFlowId === flowId ? 'Fluxo 1' : 'Fluxo 2',
    state,
    public_error: state === 'failed' ? 'Falha antes do transporte.' : null,
    completion_source: delivered ? 'provider_receipt' : null,
    progress: { delivered: delivered ? 1 : 0, total: 1 },
    steps: [{
      id: `step-${selectedFlowId}`,
      position: 0,
      type: 'text',
      state: stepState(state),
      attempt_count: 1,
      public_error: state === 'failed' ? 'Falha antes do transporte.' : null,
      updated_at: updatedAt,
    }],
    next_attempt_at: state === 'retry_scheduled' ? '2026-08-17T12:01:00.000Z' : null,
    action_deadline: state === 'provider_accepted'
      ? '2099-01-01T00:00:00.000Z'
      : null,
    reconciliation_deadline: state === 'reconciling'
      ? '2099-01-01T00:00:00.000Z'
      : null,
    delivered_at: delivered ? updatedAt : null,
    updated_at: updatedAt,
  };
}


function deliveryPage(data = []) {
  return {
    data,
    total: data.length,
    page: 1,
    page_size: 1,
    summary: {
      active: 0,
      requires_action: 0,
      retry_scheduled: 0,
      delayed: 0,
      delivered_last_24_hours: data.filter((item) => item.state === 'delivered').length,
    },
  };
}

function issuedQuotationDetail() {
  return withCanonicalQuotationDetail({
    id: quotationId,
    quotation_id: quotationId,
    quotation_name: quotationId,
    quotation_uuid: quotationUuid,
    revision_id: revisionId,
    revision: 1,
    revision_number: 1,
    status: 'Emitido',
    status_canonical: 'emitido',
    cliente: 'Cliente teste',
    client_id: '33333333-3333-4333-8333-333333333901',
    cliente_snapshot: {
      id: '33333333-3333-4333-8333-333333333901',
      nome: 'Cliente teste',
      email: 'cliente@example.test',
      telefone: '5511999990000',
    },
    validade_dias: 15,
    validade: '2026-08-28',
    data: '2026-08-17',
    pagamento: '',
    entrega: '',
    frete_padrao: '0.00',
    frete: '0.00',
    observacoes: '',
    prazo_producao: '',
    template_key: 'padrao',
    template_hash: 'a'.repeat(64),
    template_version_id: null,
    template_version: null,
    secoes: {
      schema_version: 1,
      prazo_producao: {
        base: { enabled: true, title: 'Prazo de produção', value: '' },
        current: { enabled: true, title: 'Prazo de produção', value: '' },
      },
      pagamento: {
        base: { enabled: true, title: 'Pagamento', body: '' },
        current: { enabled: true, title: 'Pagamento', body: '' },
      },
      condicoes_gerais: {
        base: { enabled: true, title: 'Condições gerais', body: '' },
        current: { enabled: true, title: 'Condições gerais', body: '' },
      },
    },
    items: [{
      item_code: 'CNG-001',
      sku: 'CNG-001',
      item_name: 'Canga',
      nome: 'Canga',
      qty: '1.000',
      suggested_unit_price: '9.00',
      applied_unit_price: '9.00',
      price_difference: '0.00',
      line_total: '9.00',
      manual_rate: false,
    }],
    subtotal: '9.00',
    total: '9.00',
    valor: '9.00',
    revision_history: [],
    derived_expired: false,
    concurrency_token: updatedAt,
    updated_at: updatedAt,
    email_sent: false,
    email_sent_at: null,
  });
}

async function routeCommonAuto(page) {
  await page.route('**/api/settings**', (route) => json(route, {}));
  await page.route('**/api/quotation-templates**', (route) => json(route, {
    templates: [{ key: 'padrao', name: 'Padrão', is_default: true }],
    default_key: 'padrao',
  }));
  await page.route('**/api/quotations**', (route) => {
    const url = new globalThis.URL(route.request().url());
    return json(
      route,
      route.request().method() === 'GET' && url.searchParams.has('id')
        ? issuedQuotationDetail()
        : { data: [] }
    );
  });
  await page.route('**/api/quote-leads**', (route) => json(route, { data: [] }));
  await page.route('**/api/extract**', (route) => json(route, {
    orders: [{
      nome: 'Cliente teste',
      email: 'cliente@example.test',
      telefone: '11999990000',
      origem: 'Google Ads',
      items: [{ item_code: 'CNG-001', qty: 1 }],
    }],
  }));
  await page.route('**/api/pricing-lookup**', (route) => json(route, {
    success: true,
    items: [{ rate: 9, item_name: 'Canga' }],
  }));
  await page.route('**/api/orcamento**', (route) => json(route, {
    success: true,
    quotation_id: quotationId,
    quotation_name: quotationId,
    quotation_uuid: quotationUuid,
    revision_id: revisionId,
    quote_revision_id: revisionId,
    revision_number: 1,
    concurrency_token: '2026-08-13T00:00:00.000Z',
    items: [{ item_code: 'CNG-001', nome: 'Canga', qty: 1, applied_unit_price: 9, manual_rate: false }],
    frete: '0.00',
    total: '9.00',
  }));
  await page.route('**/api/quotation-issues**', (route) => json(route, {
    quotationId: quotationUuid,
    businessNumber: quotationId,
    revisionId,
    revisionNumber: 1,
    status: 'emitido',
    issuedAt: updatedAt,
    validUntil: '2026-08-28',
    pdfUrl: `/api/quotation-preview?id=${quotationUuid}&format=pdf`,
  }));
  await page.route('**/api/communication-flows**', (route) => json(route, {
    success: true,
    flows: [
      {
        id: flowId,
        name: 'Fluxo 1',
        context: 'manual',
        channel: 'whatsapp',
        vendor_name: 'Juliana',
        enabled: true,
        delay_min_seconds: 0,
        delay_max_seconds: 0,
        max_media_per_product_group: 1,
        steps: [
          { id: 'step-1', type: 'text', template: 'Olá' },
          { id: 'document-1', type: 'document', source: 'quotation_pdf' },
        ],
      },
      {
        id: 'flow-2',
        name: 'Fluxo 2',
        context: 'manual',
        channel: 'whatsapp',
        vendor_name: 'Juliana',
        enabled: true,
        delay_min_seconds: 0,
        delay_max_seconds: 0,
        max_media_per_product_group: 1,
        steps: [
          { id: 'step-2', type: 'text', template: 'Olá 2' },
          { id: 'document-2', type: 'document', source: 'quotation_pdf' },
        ],
      },
    ],
    selectedFlowId: flowId,
  }));
  await page.route('**/api/quotation-deliveries**', (route) => json(route, deliveryPage()));
}

async function issueAutoQuote(page, { expectWhatsApp = true } = {}) {
  await page.goto('/#/novo-orcamento');
  await page.locator('textarea').first().fill('1 canga');
  await page.getByRole('button', { name: 'Extrair' }).click();
  await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Emitir orçamento' }).click();
  await expect(page).toHaveURL(/#\/novo-orcamento$/);
  await expect(page.getByText('Emitido', { exact: true })).toBeVisible();
  if (expectWhatsApp) {
    await expect(page.getByRole('button', { name: /enviar whatsapp/i })).toBeVisible();
  }
}

async function mockDeliveryLifecycle(page, states) {
  let stateIndex = -1;
  let sendCount = 0;
  let lastSendBody = null;
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCount += 1;
    lastSendBody = route.request().postDataJSON();
    stateIndex = 0;
    const state = states[stateIndex];
    return json(route, {
      success: true,
      delivery_id: delivery(state).id,
      revision_id: revisionId,
      flow_id: flowId,
      send_status: state,
      delivery: delivery(state),
    });
  });
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.has('revision_id') && !url.searchParams.has('flow_id')) {
      return json(route, deliveryPage(stateIndex < 0 ? [] : [delivery(states[stateIndex])]));
    }
    if (stateIndex < 0) return json(route, { error: 'not found' }, 404);
    const state = states[stateIndex];
    if (state !== 'provider_accepted' && stateIndex < states.length - 1) stateIndex += 1;
    return json(route, delivery(state));
  });
  return { getSendCount: () => sendCount, getLastSendBody: () => lastSendBody };
}

async function mockDetail(page, state = 'delivered', selectedFlowId = flowId) {
  await page.route('**/api/settings**', (route) => json(route, {}));
  await page.route('**/api/quotation-templates**', (route) => json(route, {
    templates: [{ key: 'padrao', name: 'Padrão', is_default: true, hash: 'a'.repeat(64) }],
  }));
  await page.route('**/api/quotations**', (route) => json(route, withCanonicalQuotationDetail({
    id: quotationId,
    quotation_id: quotationId,
    quotation_name: quotationId,
    quotation_uuid: quotationUuid,
    revision_id: revisionId,
    revision: 1,
    revision_number: 1,
    client_id: '33333333-3333-4333-8333-333333333901',
    cliente_snapshot: {
      id: '33333333-3333-4333-8333-333333333901',
      nome: 'Cliente teste',
      email: 'cliente@example.test',
      telefone: '5511999990000',
    },
    status: 'Emitido',
    status_canonical: 'emitido',
    cliente: 'Cliente teste',
    validade_dias: 15,
    validade: '2026-08-28',
    data: '2026-08-17',
    pagamento: '',
    entrega: '',
    frete_padrao: '0.00',
    frete: '0.00',
    observacoes: '',
    prazo_producao: '',
    template_key: 'padrao',
    template_hash: 'a'.repeat(64),
    template_version_id: null,
    template_version: 1,
    secoes: {
      schema_version: 1,
      prazo_producao: { base: { enabled: true, title: 'Prazo' }, current: { enabled: true, title: 'Prazo' } },
      pagamento: { base: { enabled: true, title: 'Pagamento', body: '' }, current: { enabled: true, title: 'Pagamento', body: '' } },
      condicoes_gerais: { base: { enabled: true, title: 'Condições', body: '' }, current: { enabled: true, title: 'Condições', body: '' } },
    },
    items: [{
      item_code: 'CNG-001',
      sku: 'CNG-001',
      item_name: 'Canga',
      nome: 'Canga',
      qty: '1.000',
      suggested_unit_price: '9.00',
      applied_unit_price: '9.00',
      price_difference: '0.00',
      line_total: '9.00',
      manual_rate: false,
    }],
    subtotal: '9.00',
    total: '9.00',
    valor: '9.00',
    revision_history: [],
    derived_expired: false,
    expiration_derived: false,
    is_expired: false,
    expirada: false,
    concurrency_token: updatedAt,
    updated_at: updatedAt,
    email_sent: false,
    email_sent_at: null,
  })));
  await page.route('**/api/communication-flows**', (route) => json(route, {
    success: true,
    selectedFlowId,
    flows: [{
      id: selectedFlowId,
      name: selectedFlowId === flowId ? 'Fluxo 1' : 'Fluxo 2',
      context: 'manual',
      channel: 'whatsapp',
      vendor_name: 'Juliana',
      enabled: true,
      delay_min_seconds: 0,
      delay_max_seconds: 0,
      max_media_per_product_group: 1,
      steps: [{ id: 'step-1', type: 'text', template: 'Olá' }],
    }],
  }));
  await page.route('**/api/quotation-deliveries**', (route) => json(route, delivery(state, selectedFlowId)));
}

test('single click persists status across reload and never offers blind retry', async ({ page }) => {
  await routeCommonAuto(page);
  const lifecycle = await mockDeliveryLifecycle(page, ['queued', 'processing', 'provider_accepted', 'delivered']);
  await issueAutoQuote(page);
  await page.getByRole('button', { name: /enviar whatsapp/i }).click();
  await expect(page.getByText('Aceito')).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.getByText('Aceito')).toBeVisible();
  await expect(page.getByRole('button', { name: /enviar whatsapp/i })).toBeDisabled();
  await expect(page.getByText('Entregue')).toBeVisible({ timeout: 10000 });
  expect(lifecycle.getSendCount()).toBe(1);
});

test('does not offer delivery for inactive or invalid quotation flows', async ({ page }) => {
  await routeCommonAuto(page);
  await page.route('**/api/communication-flows**', (route) => json(route, {
    success: true,
    selectedFlowId: 'inactive',
    flows: [
      {
        id: 'inactive', name: 'Inativo', context: 'manual', channel: 'whatsapp', vendor_name: 'Juliana', enabled: false,
        delay_min_seconds: 0, delay_max_seconds: 0, max_media_per_product_group: 1,
        steps: [{ id: 'pdf', type: 'document', source: 'quotation_pdf' }],
      },
      {
        id: 'text-only', name: 'Só texto', context: 'manual', channel: 'whatsapp', vendor_name: 'Juliana', enabled: true,
        delay_min_seconds: 0, delay_max_seconds: 0, max_media_per_product_group: 1,
        steps: [{ id: 'text', type: 'text', template: 'Olá' }],
      },
      {
        id: 'two-documents', name: 'Dois documentos', context: 'manual', channel: 'whatsapp', vendor_name: 'Juliana', enabled: true,
        delay_min_seconds: 0, delay_max_seconds: 0, max_media_per_product_group: 1,
        steps: [
          { id: 'pdf-1', type: 'document', source: 'quotation_pdf' },
          { id: 'pdf-2', type: 'document', source: 'quotation_webp' },
        ],
      },
    ],
  }));

  await issueAutoQuote(page, { expectWhatsApp: false });
  await expect(page.getByText('Nenhum fluxo de WhatsApp disponível').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /enviar whatsapp/i })).toHaveCount(0);
});

test('finds a delivery from another flow and locks the selector against duplicate sends', async ({ page }) => {
  await routeCommonAuto(page);
  let sendCount = 0;
  await page.route('**/api/communication-flows**', (route) => json(route, {
    success: true,
    selectedFlowId: 'flow-2',
    flows: [
      {
        id: 'flow-2', name: 'Fluxo 2', context: 'manual', channel: 'whatsapp', vendor_name: 'Juliana', enabled: true,
        delay_min_seconds: 0, delay_max_seconds: 0, max_media_per_product_group: 1,
        steps: [{ id: 'pdf-2', type: 'document', source: 'quotation_pdf' }],
      },
    ],
  }));
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCount += 1;
    return json(route, { error: 'unexpected' }, 500);
  });
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    return url.searchParams.has('revision_id')
      ? json(route, deliveryPage([delivery('delivered', flowId)]))
      : json(route, delivery('delivered', flowId));
  });

  await issueAutoQuote(page);
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Fluxo WhatsApp')).toBeDisabled();
  await expect(page.getByRole('button', { name: /enviar whatsapp/i })).toBeDisabled();
  expect(sendCount).toBe(0);
});

test('polls and resolves a delivery found through a removed flow', async ({ page }) => {
  await routeCommonAuto(page);
  let state = 'needs_review';
  await page.route('**/api/communication-flows**', (route) => json(route, {
    success: true,
    selectedFlowId: 'flow-2',
    flows: [{
      id: 'flow-2', name: 'Fluxo atual', context: 'manual', channel: 'whatsapp', vendor_name: 'Juliana', enabled: true,
      delay_min_seconds: 0, delay_max_seconds: 0, max_media_per_product_group: 1,
      steps: [{ id: 'pdf-2', type: 'document', source: 'quotation_pdf' }],
    }],
  }));
  await page.route('**/api/quotation-deliveries**', (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'PATCH') {
      state = 'delivered';
      return json(route, delivery(state, 'removed-flow'));
    }
    return url.searchParams.has('revision_id')
      ? json(route, deliveryPage([delivery(state, 'removed-flow')]))
      : json(route, delivery(state, 'removed-flow'));
  });

  await issueAutoQuote(page);
  await expect(page.getByText('Revisão necessária', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cliente confirmou recebimento' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirmar resolução' });
  await dialog.getByLabel('Justificativa').fill('Cliente confirmou o recebimento.');
  await dialog.getByRole('button', { name: 'Confirmar resolução' }).click();
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /cliente confirmou recebimento/i })).toHaveCount(0);
});

test('quotation detail loads the same durable delivery without clicking send', async ({ page }) => {
  await mockDetail(page);
  await page.goto(`/#/quotations/${quotationId}`);
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /enviar whatsapp/i })).toBeDisabled();
});

test('browser reload during processing keeps the durable processing state', async ({ page }) => {
  await mockDetail(page, 'processing');
  let transportCalls = 0;
  await page.route('**/api/send-whatsapp-flow', (route) => {
    transportCalls += 1;
    return json(route, { error: 'reload must not send' }, 500);
  });
  await page.goto(`/#/quotations/${quotationId}`);
  await expect(page.getByText('Enviando', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Enviando', { exact: true })).toBeVisible();
  expect(transportCalls).toBe(0);
});

test('failed delivery stays blocked without a blind retry', async ({ page }) => {
  await routeCommonAuto(page);
  const lifecycle = await mockDeliveryLifecycle(page, ['failed']);
  await issueAutoQuote(page);
  const send = page.getByRole('button', { name: /enviar whatsapp/i });
  await send.click();
  await expect(page.getByText('Falhou', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
  await send.click({ force: true });
  expect(lifecycle.getSendCount()).toBe(1);
});

test('initial identity lookup disables send before its first response', async ({ page }) => {
  await mockDetail(page, 'delivered');
  let lookupStarted = false;
  let releaseLookup;
  const lookupReleased = new Promise((resolve) => { releaseLookup = resolve; });
  await page.route('**/api/quotation-deliveries**', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.has('revision_id') && url.searchParams.has('flow_id')) {
      lookupStarted = true;
      await lookupReleased;
      return json(route, delivery('delivered'));
    }
    return json(route, deliveryPage([delivery('delivered')]));
  });
  await page.goto(`/#/quotations/${quotationId}`);
  const send = page.getByRole('button', { name: /enviar whatsapp/i });
  await expect(send).toBeVisible();
  await expect.poll(() => lookupStarted).toBe(true);
  await expect(send).toBeDisabled();
  releaseLookup?.();
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
});

test('initial identity lookup failure keeps warning and blocks blind send', async ({ page }) => {
  await mockDetail(page, 'delivered');
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.has('revision_id') && url.searchParams.has('flow_id')) {
      return json(route, { error: 'status unavailable' }, 503);
    }
    return json(route, deliveryPage([delivery('delivered')]));
  });
  await page.goto(`/#/quotations/${quotationId}`);
  const send = page.getByRole('button', { name: /enviar whatsapp/i });
  await expect(page.getByText('Não foi possível atualizar a entrega.', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
});
test('completed delivery locks flow selection for the issued revision', async ({ page }) => {
  await routeCommonAuto(page);
  const lifecycle = await mockDeliveryLifecycle(page, ['delivered']);
  await issueAutoQuote(page);
  await page.getByRole('button', { name: /enviar whatsapp/i }).click();
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Fluxo WhatsApp')).toBeDisabled();
  await expect(page.getByRole('button', { name: /enviar whatsapp/i })).toBeDisabled();
  expect(lifecycle.getSendCount()).toBe(1);
  expect(lifecycle.getLastSendBody()).toEqual({
    quotation_id: quotationId,
    revision_id: revisionId,
    flow_id: flowId,
  });
});

test('needs_review exposes only the two explicit manual decisions', async ({ page }) => {
  await mockDetail(page, 'needs_review');
  await page.goto(`/#/quotations/${quotationId}`);
  await expect(page.getByText('Revisão necessária', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cliente confirmou recebimento' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmado que não recebeu, reenviar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /enviar whatsapp/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: /cliente confirmou recebimento|confirmado que não recebeu, reenviar/i })).toHaveCount(2);
});

test('polling failure keeps the last delivery status and shows a non-destructive warning', async ({ page }) => {
  await mockDetail(page, 'provider_accepted');
  let statusReads = 0;
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.has('revision_id') && url.searchParams.has('flow_id')) {
      statusReads += 1;
      return statusReads === 1
        ? json(route, delivery('provider_accepted'))
        : json(route, { error: 'status unavailable' }, 503);
    }
    return json(route, deliveryPage([delivery('provider_accepted')]));
  });
  await page.goto(`/#/quotations/${quotationId}`);
  await expect(page.getByText('Aceito', { exact: true })).toBeVisible();
  await expect.poll(() => statusReads, { timeout: 15000 }).toBeGreaterThan(1);
  await expect(page.getByText('Não foi possível atualizar a entrega.', { exact: true })).toBeVisible();
  await expect(page.getByText('Aceito', { exact: true })).toBeVisible();
});
