import { expect, test } from '@playwright/test';

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
    reconciliation_deadline: state === 'provider_accepted' || state === 'reconciling'
      ? '2099-01-01T00:00:00.000Z'
      : null,
    delivered_at: delivered ? updatedAt : null,
    updated_at: updatedAt,
  };
}

function statusResponse(state, selectedFlowId = flowId, selectedRevisionId = revisionId) {
  return {
    revision_id: selectedRevisionId,
    flow_id: selectedFlowId,
    delivery_id: delivery(state, selectedFlowId, selectedRevisionId).id,
    phase: state,
    error: null,
    updated_at: updatedAt,
  };
}

async function routeCommonAuto(page) {
  await page.route('**/api/settings**', (route) => json(route, {}));
  await page.route('**/api/quotation-templates**', (route) => json(route, {
    templates: [{ key: 'padrao', name: 'Padrão', is_default: true }],
    default_key: 'padrao',
  }));
  await page.route('**/api/quotations**', (route) => json(route, { data: [] }));
  await page.route('**/api/quote-leads**', (route) => json(route, { data: [] }));
  await page.route('**/api/extract**', (route) => json(route, {
    orders: [{
      nome: 'Cliente teste',
      email: 'cliente@example.test',
      telefone: '11999990000',
      items: [{ item_code: 'CNG-001', qty: 1 }],
    }],
  }));
  await page.route('**/api/pricing-lookup**', (route) => json(route, {
    success: true,
    items: [{ rate: 9, item_name: 'Canga' }],
  }));
  await page.route('**/api/quotation-issues**', (route) => json(route, {
    quotation_id: quotationUuid,
    business_number: quotationId,
    revision_id: revisionId,
    revision_number: 1,
    status: 'emitido',
    issued_at: updatedAt,
    valid_until: '2026-08-28',
    pdf_url: `/api/quotation-preview?id=${quotationUuid}&format=pdf`,
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
        steps: [{ id: 'step-1', type: 'text', template: 'Olá' }],
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
        steps: [{ id: 'step-2', type: 'text', template: 'Olá 2' }],
      },
    ],
    selectedFlowId: flowId,
  }));
}

async function issueAutoQuote(page) {
  await page.goto('/#/auto');
  await page.locator('textarea').first().fill('1 canga');
  await page.getByRole('button', { name: 'Extrair' }).click();
  await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Gerar orçamento' }).click();
  await expect(page.getByText('Emitido', { exact: true })).toBeVisible();
}

async function mockDeliveryLifecycle(page, states) {
  let stateIndex = -1;
  let providerAcceptedReads = 0;
  let sendCount = 0;
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCount += 1;
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
  await page.route('**/api/whatsapp-send-status**', (route) => {
    if (stateIndex < 0) return json(route, { error: 'not found' }, 404);
    if (states[stateIndex] === 'provider_accepted') {
      providerAcceptedReads += 1;
      if (providerAcceptedReads > 2 && stateIndex < states.length - 1) stateIndex += 1;
    }
    return json(route, statusResponse(states[stateIndex]));
  });
  await page.route('**/api/quotation-deliveries**', (route) => {
    if (stateIndex < 0) return json(route, { error: 'not found' }, 404);
    const state = states[stateIndex];
    if (state !== 'provider_accepted' && stateIndex < states.length - 1) stateIndex += 1;
    return json(route, delivery(state));
  });
  return { getSendCount: () => sendCount };
}

async function mockDetail(page, state = 'delivered', selectedFlowId = flowId) {
  await page.route('**/api/settings**', (route) => json(route, {}));
  await page.route('**/api/quotation-templates**', (route) => json(route, {
    templates: [{ key: 'padrao', name: 'Padrão', is_default: true, hash: 'a'.repeat(64) }],
  }));
  await page.route('**/api/quotations**', (route) => json(route, {
    id: quotationId,
    quotation_id: quotationId,
    quotation_uuid: quotationUuid,
    revision_id: revisionId,
    revision: 1,
    revision_number: 1,
    client_id: '33333333-3333-4333-8333-333333333901',
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
  }));
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
  await page.route('**/api/whatsapp-send-status**', (route) => json(route, statusResponse(state, selectedFlowId)));
  await page.route('**/api/quotation-deliveries**', (route) => json(route, delivery(state, selectedFlowId)));
}

test('single click persists status across reload and never offers blind retry', async ({ page }) => {
  await routeCommonAuto(page);
  const lifecycle = await mockDeliveryLifecycle(page, ['queued', 'processing', 'provider_accepted', 'delivered']);
  await issueAutoQuote(page);
  await page.getByRole('button', { name: /enviar via whatsapp/i }).click();
  await expect(page.getByText('Aceito pela Evolution')).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.getByText('Aceito pela Evolution')).toBeVisible();
  await expect(page.getByRole('button', { name: /enviar via whatsapp/i })).toBeDisabled();
  await expect(page.getByText('Entregue')).toBeVisible({ timeout: 10000 });
  expect(lifecycle.getSendCount()).toBe(1);
});

test('quotation detail loads the same durable delivery without clicking send', async ({ page }) => {
  await mockDetail(page);
  await page.goto(`/#/quotations/${quotationId}`);
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /enviar via whatsapp/i })).toBeDisabled();
});

test('failed delivery stays blocked until a new revision', async ({ page }) => {
  await routeCommonAuto(page);
  const lifecycle = await mockDeliveryLifecycle(page, ['failed']);
  await issueAutoQuote(page);
  const send = page.getByRole('button', { name: /enviar via whatsapp/i });
  await send.click();
  await expect(page.getByText('Falhou', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Nova revisão' })).toBeVisible();
  await send.click({ force: true });
  expect(lifecycle.getSendCount()).toBe(1);
});

test('initial identity lookup disables send before its first response', async ({ page }) => {
  await mockDetail(page, 'delivered');
  let lookupStarted = false;
  let releaseLookup;
  const lookupReleased = new Promise((resolve) => { releaseLookup = resolve; });
  await page.route('**/api/whatsapp-send-status**', async (route) => {
    lookupStarted = true;
    await lookupReleased;
    return json(route, statusResponse('delivered'));
  });
  await page.goto(`/#/quotations/${quotationId}`);
  const send = page.getByRole('button', { name: /enviar via whatsapp/i });
  await expect(send).toBeVisible();
  await expect.poll(() => lookupStarted).toBe(true);
  await expect(send).toBeDisabled();
  releaseLookup?.();
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
});

test('initial identity lookup failure keeps warning and blocks blind send', async ({ page }) => {
  await mockDetail(page, 'delivered');
  await page.route('**/api/whatsapp-send-status**', (route) =>
    json(route, { error: 'status unavailable' }, 503));
  await page.goto(`/#/quotations/${quotationId}`);
  const send = page.getByRole('button', { name: /enviar via whatsapp/i });
  await expect(page.getByText('status unavailable', { exact: true })).toBeVisible();
  await expect(send).toBeDisabled();
});

test('flow switching uses a distinct revision and flow status', async ({ page }) => {
  await routeCommonAuto(page);
  const indexes = new Map();
  let sendCount = 0;
  let flow2LookupStarted = false;
  let releaseFlow2Lookup;
  const flow2LookupReleased = new Promise((resolve) => { releaseFlow2Lookup = resolve; });
  const states = { [flowId]: ['delivered'], 'flow-2': ['queued'] };
  await page.route('**/api/send-whatsapp-flow', (route) => {
    const body = route.request().postDataJSON();
    const selectedFlowId = body.flow_id;
    sendCount += 1;
    indexes.set(selectedFlowId, 0);
    const state = states[selectedFlowId][0];
    return json(route, {
      success: true,
      delivery_id: delivery(state, selectedFlowId).id,
      revision_id: revisionId,
      flow_id: selectedFlowId,
      send_status: state,
      delivery: delivery(state, selectedFlowId),
    });
  });
  await page.route('**/api/whatsapp-send-status**', async (route) => {
    const selectedFlowId = new globalThis.URL(route.request().url()).searchParams.get('flow_id');
    const index = indexes.get(selectedFlowId);
    if (index === undefined) {
      if (selectedFlowId === 'flow-2') {
        flow2LookupStarted = true;
        await flow2LookupReleased;
      }
      return json(route, { error: 'not found' }, 404);
    }
    return json(route, statusResponse(states[selectedFlowId][index], selectedFlowId));
  });
  await page.route('**/api/quotation-deliveries**', (route) => {
    const selectedFlowId = [...indexes.keys()].find((candidate) => route.request().url().includes(encodeURIComponent(`delivery-${revisionId}-${candidate}`)));
    if (!selectedFlowId) return json(route, { error: 'not found' }, 404);
    const index = indexes.get(selectedFlowId);
    const state = states[selectedFlowId][index];
    return json(route, delivery(state, selectedFlowId));
  });
  await issueAutoQuote(page);
  await page.getByRole('button', { name: /enviar via whatsapp/i }).click();
  await expect(page.getByText('Entregue', { exact: true })).toBeVisible();
  const send = page.getByRole('button', { name: /enviar via whatsapp/i });
  await page.getByText('Fluxo de WhatsApp', { exact: true }).locator('..').getByRole('combobox').selectOption('flow-2');
  await expect.poll(() => flow2LookupStarted).toBe(true);
  await expect(send).toBeDisabled();
  expect(sendCount).toBe(1);
  releaseFlow2Lookup?.();
  await expect(send).toBeEnabled();
  await send.click();
  await expect(page.getByText('Na fila', { exact: true })).toBeVisible();
  await expect.poll(() => sendCount).toBe(2);
  expect([...indexes.keys()]).toEqual([flowId, 'flow-2']);
});

test('needs_review exposes only the two explicit manual decisions', async ({ page }) => {
  await mockDetail(page, 'needs_review');
  await page.goto(`/#/quotations/${quotationId}`);
  await expect(page.getByText('Revisão necessária', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cliente confirmou recebimento' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmado que não recebeu, reenviar' })).toBeVisible();
  await expect(page.getByRole('button', { name: /enviar via whatsapp/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: /cliente confirmou recebimento|confirmado que não recebeu, reenviar/i })).toHaveCount(2);
});

test('polling failure keeps the last delivery status and shows a non-destructive warning', async ({ page }) => {
  await mockDetail(page, 'provider_accepted');
  let statusReads = 0;
  await page.route('**/api/whatsapp-send-status**', (route) => {
    statusReads += 1;
    return statusReads === 1
      ? json(route, statusResponse('provider_accepted'))
      : json(route, { error: 'status unavailable' }, 503);
  });
  await page.goto(`/#/quotations/${quotationId}`);
  await expect(page.getByText('Aceito pela Evolution', { exact: true })).toBeVisible();
  await expect(page.getByText('status unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Aceito pela Evolution', { exact: true })).toBeVisible();
});
