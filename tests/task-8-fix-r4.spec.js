import { expect, test } from '@playwright/test';
import { withCanonicalQuotationDetail } from './fixtures/quotation-detail.js';

const revisionId = '22222222-2222-4222-8222-222222222201';
const quotationId = 'ORC-20260001';
const quotationUuid = '11111111-1111-4111-8111-111111111101';
const updatedAt = '2026-08-17T12:00:00.000Z';

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
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

function delivery(state, flowId = 'flow-1', revision = revisionId) {
  const delivered = state === 'delivered';
  return {
    id: `delivery-${revision}-${flowId}`,
    revision_id: revision,
    business_number: quotationId,
    client_name: 'Cliente teste',
    phone: '5511999990000',
    flow_id: flowId,
    flow_name: flowId === 'flow-1' ? 'Fluxo 1' : 'Fluxo 2',
    state,
    public_error: state === 'failed' ? 'Falha antes do transporte.' : null,
    completion_source: delivered ? 'provider_receipt' : null,
    progress: { delivered: delivered ? 1 : 0, total: 1 },
    steps: [{
      id: `step-${flowId}`,
      position: 0,
      type: 'text',
      state: stepState(state),
      attempt_count: 1,
      public_error: state === 'failed' ? 'Falha antes do transporte.' : null,
      updated_at: updatedAt,
    }],
    next_attempt_at: state === 'retry_scheduled' ? '2026-08-17T12:01:00.000Z' : null,
    reconciliation_deadline: state === 'provider_accepted' || state === 'reconciling'
      ? '2099-01-01T00:00:00.000Z'
      : null,
    delivered_at: delivered ? updatedAt : null,
    updated_at: updatedAt,
  };
}


function enqueueResponse(state, flowId = 'flow-1', { omitPhone = false } = {}) {
  const body = delivery(state, flowId);
  if (omitPhone) delete body.phone;
  return {
    success: true,
    delivery_id: delivery(state, flowId).id,
    revision_id: revisionId,
    flow_id: flowId,
    send_status: state,
    delivery: body,
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
    client_id: '33333333-3333-4333-8333-333333333201',
    cliente_snapshot: {
      id: '33333333-3333-4333-8333-333333333201',
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

async function setupAuto(page) {
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
        id: 'flow-1',
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
    selectedFlowId: 'flow-1',
  }));
  // Safety net: delivery lookups fire as soon as the issued card renders,
  // possibly before a test registers its own delivery routes. Answer them
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    return url.searchParams.has('revision_id') && !url.searchParams.has('flow_id')
      ? json(route, deliveryPage())
      : json(route, { error: 'not found' }, 404);
  });
  await page.goto('/#/auto');
  await page.locator('textarea').first().fill('1 canga');
  await page.getByRole('button', { name: 'Extrair' }).click();
  await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Emitir orçamento' }).click();
  await expect(page.getByText('Emitido', { exact: true })).toBeVisible();
}

async function installDurableRoutes(page, stateForFlow = () => 'delivered') {
  const active = new Map();
  const requests = [];
  await page.route('**/api/send-whatsapp-flow', (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const state = stateForFlow(body.flow_id);
    active.set(body.flow_id, state);
    return json(route, enqueueResponse(state, body.flow_id));
  });
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.has('revision_id') && !url.searchParams.has('flow_id')) {
      const flowId = [...active.keys()][0];
      const state = flowId ? active.get(flowId) : undefined;
      return json(route, deliveryPage(flowId && state ? [delivery(state, flowId)] : []));
    }
    const deliveryId = url.searchParams.get('id');
    const flowId = url.searchParams.get('flow_id') || [...active.keys()].find((candidate) => delivery('delivered', candidate).id === deliveryId);
    const state = flowId ? active.get(flowId) : undefined;
    if (!flowId || !state) return json(route, { error: 'not found' }, 404);
    return json(route, delivery(state, flowId));
  });
  return { requests, active };
}

test('accepted provider state stays accepted and blocks automatic replay', async ({ page }) => {
  await setupAuto(page);
  const { requests } = await installDurableRoutes(page, () => 'provider_accepted');
  const send = page.getByRole('button', { name: /enviar whatsapp/i });
  await send.click();
  await expect(page.getByText('Aceito', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
  await send.click({ force: true });
  expect(requests).toHaveLength(1);
});

test('reconciling state blocks duplicate send', async ({ page }) => {
  await setupAuto(page);
  const { requests } = await installDurableRoutes(page, () => 'reconciling');
  const send = page.getByRole('button', { name: /enviar whatsapp/i });
  await send.click();
  await expect(page.getByText('Reconciliação em andamento', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
  await send.click({ force: true });
  expect(requests).toHaveLength(1);
});

test('delivered replay without phone remains a durable completed UI status', async ({ page }) => {
  await setupAuto(page);
  const active = new Map();
  let sendCount = 0;
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCount += 1;
    active.set('flow-1', 'delivered');
    return json(route, enqueueResponse('delivered', 'flow-1', { omitPhone: true }));
  });
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.has('revision_id') && !url.searchParams.has('flow_id')) {
      return json(route, deliveryPage(active.has('flow-1') ? [delivery(active.get('flow-1'))] : []));
    }
    if (!active.has('flow-1')) return json(route, { error: 'not found' }, 404);
    return json(route, delivery(active.get('flow-1')));
  });
  const send = page.getByRole('button', { name: /enviar whatsapp/i });
  await send.click();
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(page.getByText('undefined', { exact: true })).toHaveCount(0);
  expect(sendCount).toBe(1);
});

test('completed delivery locks the flow for the issued revision', async ({ page }) => {
  await setupAuto(page);
  const { requests } = await installDurableRoutes(page, () => 'delivered');
  const send = page.getByRole('button', { name: /enviar whatsapp/i });
  await send.click();
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Fluxo WhatsApp')).toBeDisabled();
  await expect(send).toBeDisabled();
  expect(requests).toEqual([
    { quotation_id: quotationId, revision_id: revisionId, flow_id: 'flow-1' },
  ]);
});

test('same component double click sends one backend request and unsafe failure stays blocked', async ({ page }) => {
  await setupAuto(page);
  let sendCount = 0;
  let releaseFirst;
  await page.route('**/api/send-whatsapp-flow', async (route) => {
    sendCount += 1;
    if (sendCount === 1) {
      await new Promise((resolve) => { releaseFirst = resolve; });
      return json(route, { error: 'Falha temporária.' }, 503);
    }
    return json(route, enqueueResponse('delivered'));
  });
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    return url.searchParams.has('revision_id') && !url.searchParams.has('flow_id')
      ? json(route, deliveryPage())
      : json(route, { error: 'not found' }, 404);
  });
  // The send button stays disabled while the delivery-status lookup settles.
  const send = page.getByRole('button', { name: /enviar whatsapp/i });
  await expect(send).toBeEnabled();
  await send.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect.poll(() => sendCount).toBe(1);
  releaseFirst?.();
  await expect(page.getByText('Não foi possível iniciar o envio.', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
  expect(sendCount).toBe(1);
});

test('lost enqueue response rediscovers the durable delivery without a second send', async ({ page }) => {
  await setupAuto(page);
  let sendCount = 0;
  let durable = null;
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCount += 1;
    const body = route.request().postDataJSON();
    // The server persisted and dispatched, but the answer never reached the browser.
    durable = { state: 'provider_accepted', flowId: body.flow_id };
    return json(route, { error: 'Não foi possível processar o envio. Tente novamente.' }, 503);
  });
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    // Identity lookup misses on purpose: only the revision read is authoritative.
    if (url.searchParams.has('flow_id')) return json(route, { error: 'not found' }, 404);
    return json(
      route,
      durable ? deliveryPage([delivery(durable.state, durable.flowId)]) : deliveryPage(),
    );
  });

  const send = page.getByRole('button', { name: /enviar whatsapp/i });
  await send.click();
  // The durable provider_accepted delivery is rediscovered and exposes the
  // delayed manual-resolution control instead of a repeat send.
  await expect(
    page.getByRole('button', { name: 'Cliente confirmou recebimento' }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Não foi possível iniciar o envio.', { exact: true })).toHaveCount(0);
  const deliveredSend = page.getByRole('button', { name: 'Enviado' });
  await expect(deliveredSend).toBeDisabled();
  await deliveredSend.click({ force: true });
  expect(sendCount).toBe(1);
});

test('malformed 2xx cannot render sent and leaves no local success authority', async ({ page }) => {
  await setupAuto(page);
  let sendCount = 0;
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCount += 1;
    return json(route, { success: true });
  });
  await page.route('**/api/quotation-deliveries**', (route) => {
    const url = new globalThis.URL(route.request().url());
    return url.searchParams.has('revision_id') && !url.searchParams.has('flow_id')
      ? json(route, deliveryPage())
      : json(route, { error: 'not found' }, 404);
  });
  await page.evaluate(() => globalThis.localStorage.setItem(
    'aspen.whatsapp-send-locks-v1',
    JSON.stringify({ accepted: true }),
  ));
  const send = page.getByRole('button', { name: /enviar whatsapp/i });
  await send.click();
  await expect(page.getByText('Resposta inválida da entrega WhatsApp.', { exact: true })).toBeVisible();
  await expect(page.getByText('Entregue', { exact: true })).toHaveCount(0);
  await expect(send).toBeDisabled();
  expect(sendCount).toBe(1);
});

// ── Per-key authoritative generations ──
// Two issued drafts share one hook instance (NewQuotationPage tracks every
// active draft's identity). A mutation for draft A must never discard a late
// authoritative read for draft B: otherwise B silently loses its delivery (or
// its blocking error) and offers an unnecessary POST.

const revisionA = '22222222-2222-4222-8222-2222222222a1';
const revisionB = '22222222-2222-4222-8222-2222222222b1';

function issuedDraft(index, nome, revision, quotationUuid, businessNumber) {
  return {
    index,
    original: { nome },
    edited: {
      nome,
      email: 'cliente@example.test',
      telefone: '5511999990000',
      urgente: false,
      origem: 'Google Ads',
      cnpj: '',
      prazo_producao: '',
      endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
      items: [{ item_code: 'CNG-001', item_name: 'Canga', qty: 1, rate: 9, _rateManual: false }],
      template_key: 'padrao',
    },
    approved: false,
    discarded: false,
    issueIdempotencyKey: quotationUuid.replace(/[^0-9a-f]/gi, '0').padEnd(36, '0').slice(0, 36),
    issue: {
      quotationId: quotationUuid,
      businessNumber,
      revisionId: revision,
      revisionNumber: 1,
      status: 'emitido',
      issuedAt: updatedAt,
      validUntil: '2026-08-28',
      pdfUrl: `/api/quotation-preview?id=${quotationUuid}&format=pdf`,
    },
  };
}

function draftDelivery(state, revision, flow) {
  const body = delivery(state, flow, revision);
  body.id = `delivery-${revision}-${flow}`;
  body.business_number = revision === revisionA ? 'ORC-20260091' : 'ORC-20260092';
  body.client_name = revision === revisionA ? 'Cliente A' : 'Cliente B';
  return body;
}

async function setupTwoIssuedDrafts(page, { heldB }) {
  const drafts = [
    issuedDraft(0, 'Cliente A', revisionA, '11111111-1111-4111-8111-1111111119a1', 'ORC-20260091'),
    issuedDraft(1, 'Cliente B', revisionB, '11111111-1111-4111-8111-1111111119b1', 'ORC-20260092'),
  ];
  await page.addInitScript(
    (initial) => globalThis.sessionStorage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: initial })),
    drafts,
  );
  const state = {
    sendCount: 0,
    bIdentityReads: 0,
    resolveCount: 0,
    resolvedIds: new Set(),
  };
  await page.route('**/api/settings**', (route) => json(route, {}));
  await page.route('**/api/quotation-templates**', (route) => json(route, {
    templates: [{ key: 'padrao', name: 'Padrão', is_default: true, hash: 'a'.repeat(64) }],
  }));
  await page.route('**/api/pricing-lookup**', (route) => json(route, {
    success: true,
    items: [{ item_code: 'CNG-001', item_name: 'Canga', rate: 9 }],
  }));
  await page.route('**/api/communication-flows**', (route) => json(route, {
    success: true,
    selectedFlowId: 'flow-1',
    flows: [{
      id: 'flow-1',
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
    }],
  }));
  await page.route('**/api/send-whatsapp-flow', (route) => {
    state.sendCount += 1;
    return json(route, enqueueResponse('delivered', 'flow-1'));
  });
  await page.route('**/api/quotation-deliveries**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'PATCH') {
      state.resolveCount += 1;
      const id = url.searchParams.get('id');
      if (id) state.resolvedIds.add(id);
      return json(route, draftDelivery('delivered', revisionA, 'flow-1'));
    }
    if (url.searchParams.has('flow_id')) {
      const revision = url.searchParams.get('revision_id');
      if (revision === revisionB) {
        state.bIdentityReads += 1;
        if (state.bIdentityReads === 1) return heldB(route, state);
      }
      if (revision !== revisionA && revision !== revisionB) {
        return json(route, { error: 'not found' }, 404);
      }
      const target = revision === revisionB ? revisionB : revisionA;
      const durable =
        target === revisionA && state.resolvedIds.has(draftDelivery('provider_accepted', revisionA, 'flow-1').id)
          ? 'delivered'
          : 'provider_accepted';
      return json(route, draftDelivery(durable, target, 'flow-1'));
    }
    // Revision-wide reads stay empty: only the identity read is authoritative.
    return json(route, deliveryPage());
  });
  return state;
}

test('a late authoritative success for another draft survives a same-hook mutation', async ({ page }) => {
  const held = Promise.withResolvers();
  const state = await setupTwoIssuedDrafts(page, {
    heldB: async (route) => {
      await held.promise;
      return json(route, draftDelivery('provider_accepted', revisionB, 'flow-1'));
    },
  });

  await page.goto('/#/novo-orcamento');
  // Draft A resolves while draft B's identity read is still in flight.
  await page.getByLabel('Rascunho ativo').selectOption('0');
  const resolveControl = page.getByRole('button', { name: 'Cliente confirmou recebimento' });
  await expect(resolveControl).toBeVisible();
  await resolveControl.click();
  const dialog = page.getByRole('dialog', { name: 'Confirmar resolução' });
  await dialog.getByLabel('Justificativa').fill('Cliente A confirmou o recebimento.');
  await dialog.getByRole('button', { name: 'Confirmar resolução' }).click();
  // A is delivered: the provider-acceptance action is gone, the send stays locked.
  await expect(resolveControl).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enviado' })).toBeDisabled();
  expect(state.resolveCount).toBe(1);

  // B's read — started before A's mutation — now returns its authoritative row.
  held.resolve();
  await expect.poll(() => state.bIdentityReads >= 1).toBe(true);
  await page.getByLabel('Rascunho ativo').selectOption('1');
  await expect(resolveControl).toBeVisible({ timeout: 15000 });

  const send = page.getByRole('button', { name: 'Enviado' });
  await expect(send).toBeDisabled();
  await send.click({ force: true });
  expect(state.sendCount).toBe(0);
});

test('a late rejection for another draft still blocks with a safe error after a same-hook mutation', async ({ page }) => {
  const held = Promise.withResolvers();
  const state = await setupTwoIssuedDrafts(page, {
    heldB: async (route) => {
      await held.promise;
      return json(route, { error: 'status unavailable' }, 503);
    },
  });

  await page.goto('/#/novo-orcamento');
  await page.getByLabel('Rascunho ativo').selectOption('0');
  const resolveControl = page.getByRole('button', { name: 'Cliente confirmou recebimento' });
  await expect(resolveControl).toBeVisible();
  await resolveControl.click();
  const dialog = page.getByRole('dialog', { name: 'Confirmar resolução' });
  await dialog.getByLabel('Justificativa').fill('Cliente A confirmou o recebimento.');
  await dialog.getByRole('button', { name: 'Confirmar resolução' }).click();
  await expect(resolveControl).toHaveCount(0);

  // B's read rejects after A's mutation: the blocking warning must survive for
  // B; only B's own generation is relevant.
  held.resolve();
  await expect.poll(() => state.bIdentityReads >= 1).toBe(true);
  await page.getByLabel('Rascunho ativo').selectOption('1');
  const send = page.getByRole('button', { name: 'Falha no envio' });
  await expect(send).toBeVisible({ timeout: 15000 });
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute('title', 'Não foi possível atualizar a entrega.');
  await send.click({ force: true });
  expect(state.sendCount).toBe(0);
});
