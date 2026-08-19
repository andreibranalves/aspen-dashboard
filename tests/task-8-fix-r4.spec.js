import { expect, test } from '@playwright/test';

const revisionId = '22222222-2222-4222-8222-222222222201';
const quotationId = 'ORC-20260001';
const quotationUuid = '11111111-1111-4111-8111-111111111101';

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

const successBody = (flowId = 'flow-1') => ({
  success: true,
  dry_run: false,
  send_status: 'completed',
  duplicate_warning: false,
  duplicate_message: '',
  flow_id: flowId,
  flow_name: flowId === 'flow-1' ? 'Fluxo 1' : 'Fluxo 2',
  quotation_id: quotationId,
  deal_id: null,
  phone: '5511999990000',
  product_summary: 'cangas',
  categories: ['canga'],
  steps_count: 1,
  steps: [],
  send_event_id: null,
});

async function setupAuto(page) {
  await page.route('**/api/settings**', (route) => json(route, {}));
  await page.route('**/api/quotation-templates**', (route) => json(route, {
    templates: [{ key: 'padrao', name: 'Padrão', is_default: true }],
    default_key: 'padrao',
  }));
  await page.route('**/api/quotations**', (route) => json(route, { data: [] }));
  await page.route('**/api/extract**', (route) => json(route, {
    orders: [{ nome: 'Cliente teste', email: 'cliente@example.test', telefone: '11999990000', items: [{ item_code: 'CNG-001', qty: 1 }] }],
  }));
  await page.route('**/api/pricing-lookup**', (route) => json(route, { success: true, items: [{ rate: 9, item_name: 'Canga' }] }));
  await page.route('**/api/quotation-issues**', (route) => json(route, {
    quotation_id: quotationUuid,
    business_number: quotationId,
    revision_id: revisionId,
    revision_number: 1,
    status: 'emitido',
    issued_at: '2026-08-13T00:00:00.000Z',
    valid_until: '2026-08-28',
    pdf_url: `/api/quotation-preview?id=${quotationUuid}&format=pdf`,
  }));
  await page.route('**/api/communication-flows**', (route) => json(route, {
    success: true,
    flows: [
      { id: 'flow-1', name: 'Fluxo 1', context: 'manual', channel: 'whatsapp', vendor_name: 'Juliana', enabled: true, delay_min_seconds: 0, delay_max_seconds: 0, max_media_per_product_group: 1, steps: [{ id: 'step-1', type: 'text', template: 'Olá' }] },
      { id: 'flow-2', name: 'Fluxo 2', context: 'manual', channel: 'whatsapp', vendor_name: 'Juliana', enabled: true, delay_min_seconds: 0, delay_max_seconds: 0, max_media_per_product_group: 1, steps: [{ id: 'step-2', type: 'text', template: 'Olá 2' }] },
    ],
    selectedFlowId: 'flow-1',
  }));
  await page.goto('/#/auto');
  await page.locator('textarea').first().fill('1 canga');
  await page.getByRole('button', { name: 'Extrair' }).click();
  await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Gerar orçamento' }).click();
  await expect(page.getByText('Emitido', { exact: true })).toBeVisible();
  const send = page.getByRole('button', { name: 'Enviar WhatsApp' });
  await expect(send).toBeVisible({ timeout: 10000 });
  return send;
}

test('accepted partial stays accepted and blocks automatic replay @quotations @critical', async ({ page }) => {
  await setupAuto(page);
  let sendCount = 0;
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCount += 1;
    return json(route, {
      error: 'O transporte foi aceito e aguarda reconciliação.',
      send_status: 'accepted_partial',
      accepted_partial: true,
      provider_accepted: true,
    }, 503);
  });
  const send = page.getByRole('button', { name: 'Enviar WhatsApp' });
  await send.click();
  await expect(page.getByText('Envio aceito', { exact: true }).first()).toBeVisible();
  const accepted = page.getByRole('button', { name: 'Envio aceito' });
  await expect(accepted).toBeDisabled();
  await accepted.click({ force: true });
  expect(sendCount).toBe(1);
});

test('reserved response shows reconciling label and blocks duplicate send @quotations @critical', async ({ page }) => {
  await setupAuto(page);
  let sendCount = 0;
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCount += 1;
    return json(route, {
      error: 'Já existe uma reserva para esta revisão e fluxo. Aguarde a reconciliação.',
      send_status: 'reserved',
      reconciliation_required: true,
    }, 409);
  });
  const send = page.getByRole('button', { name: 'Enviar WhatsApp' });
  await send.click();
  await expect(page.getByText('Reconciliação necessária', { exact: true }).first()).toBeVisible();
  const reconciling = page.getByRole('button', { name: 'Reconciliação necessária' });
  await expect(reconciling).toBeDisabled();
  await reconciling.click({ force: true });
  expect(sendCount).toBe(1);
});

test('completed neutral replay without phone remains a completed UI status @quotations @critical', async ({ page }) => {
  await setupAuto(page);
  let sendCount = 0;
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCount += 1;
    const replay = successBody();
    delete replay.phone;
    return json(route, replay);
  });
  await page.getByRole('button', { name: 'Enviar WhatsApp' }).click();
  await expect(page.getByText('Orçamento enviado com sucesso!', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviado' })).toBeDisabled();
  await expect(page.getByText('undefined', { exact: true })).toHaveCount(0);
  expect(sendCount).toBe(1);
});

test('flow switch gets an independent exact status key @quotations @critical', async ({ page }) => {
  await setupAuto(page);
  const sendRequests = [];
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendRequests.push(route.request().postDataJSON());
    return json(route, successBody(sendRequests.length === 1 ? 'flow-1' : 'flow-2'));
  });
  await page.getByRole('button', { name: 'Enviar WhatsApp' }).click();
  await expect(page.getByText('Orçamento enviado com sucesso!', { exact: true })).toBeVisible();
  await page
    .getByText('Fluxo de WhatsApp', { exact: true })
    .locator('..')
    .getByRole('combobox')
    .selectOption('flow-2');
  await expect(page.getByRole('button', { name: 'Enviar WhatsApp' })).toBeEnabled();
  await page.getByRole('button', { name: 'Enviar WhatsApp' }).click();
  await expect.poll(() => sendRequests.length).toBe(2);
  expect(sendRequests).toEqual(['flow-1', 'flow-2'].map((flowId) => ({
    quotation_id: quotationId,
    quotation_uuid: quotationUuid,
    business_number: quotationId,
    revision_id: revisionId,
    flow_id: flowId,
    idempotency_key: `aspen:whatsapp-send:v2|${quotationId}|${revisionId}|${flowId}`,
  })));
});

test('same component double click sends one backend request and failure cleanup re-enables button @quotations @critical', async ({ page }) => {
  await setupAuto(page);
  let sendCount = 0;
  let fail = true;
  let releaseFirst;
  await page.route('**/api/send-whatsapp-flow', async (route) => {
    sendCount += 1;
    if (fail && sendCount === 1) {
      await new Promise((resolve) => { releaseFirst = () => { resolve(); }; });
      return json(route, { error: 'Falha temporária.', send_status: 'retryable' }, 503);
    }
    if (fail) return json(route, { error: 'Falha temporária.', send_status: 'retryable' }, 503);
    return json(route, successBody());
  });
  const send = page.getByRole('button', { name: 'Enviar WhatsApp' });
  await send.evaluate((button) => {
    button.click();
    button.click();
  });
  await expect.poll(() => sendCount).toBe(1);
  releaseFirst?.();
  await expect(page.getByText('Falha antes do transporte. Tentar novamente.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar WhatsApp' })).toBeEnabled();
  fail = false;
  await page.getByRole('button', { name: 'Enviar WhatsApp' }).click();
  await expect(page.getByText('Orçamento enviado com sucesso!', { exact: true })).toBeVisible();
  expect(sendCount).toBe(2);
});

test('malformed 2xx cannot render sent and forged localStorage has no authority @quotations @critical', async ({ page }) => {
  await setupAuto(page);
  let sendCount = 0;
  await page.route('**/api/send-whatsapp-flow', (route) => {
    sendCount += 1;
    return json(route, { success: true });
  });
  await page.evaluate(() => globalThis.localStorage.setItem('aspen.whatsapp-send-locks-v1', JSON.stringify({ accepted: true })));
  await page.getByRole('button', { name: 'Enviar WhatsApp' }).click();
  await expect(page.getByText(/Não foi possível confirmar o envio/i)).toBeVisible();
  const reconciling = page.getByRole('button', { name: 'Reconciliação necessária' });
  await expect(reconciling).toBeDisabled();
  await reconciling.click({ force: true });
  await expect(page.getByText('Orçamento enviado com sucesso!', { exact: true })).toHaveCount(0);
  expect(sendCount).toBe(1);
});
