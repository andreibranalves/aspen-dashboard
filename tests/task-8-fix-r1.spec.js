import { expect, test } from '@playwright/test';

const revisionId = '22222222-2222-4222-8222-222222222222';
const quotationId = 'ORC-20260001';
const quotationUuid = '11111111-1111-4111-8111-111111111111';

function json(route, body, status = 200, contentType = 'application/json') {
  return route.fulfill({ status, contentType, body: JSON.stringify(body) });
}

test('lista de orçamentos abre o snapshot PostgreSQL da revisão clicada @quotations @critical', async ({ page }) => {
  const requests = [];
  await page.route('**/api/quotations**', (route) => json(route, {
    data: [{
      id: quotationId,
      revision_id: revisionId,
      cliente: 'Cliente local',
      data: '2026-08-10',
      valor: '90.00',
      status: 'Enviado',
      status_canonical: 'enviado',
    }],
    pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
    status_summary: { Rascunho: 1, Enviado: 2, Aprovado: 3, Perdido: 4 },
  }));
  await page.route('**/api/quotation-preview**', (route) => {
    requests.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<p>snapshot</p>' });
  });

  await page.goto('/#/quotations');
  await expect(page.getByText(quotationId, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Enviado', { exact: true }).first()).toContainText('Enviado');
  await expect(page.getByText('(2)', { exact: true })).toBeVisible();
  const popup = page.waitForEvent('popup');
  await page.getByLabel(`Abrir PDF do orçamento ${quotationId}`).click();
  const opened = await popup;
  const url = new globalThis.URL(opened.url());
  expect(url.pathname).toBe('/api/quotation-preview');
  expect(url.searchParams.get('id')).toBe(revisionId);
  expect(url.searchParams.get('format')).toBe('pdf');
  expect(url.pathname).not.toBe('/api/view');
  await opened.close();
});

test('pedidos usa métricas canônicas, nomes neutros e somente status suportados @quotations @critical', async ({ page }) => {
  const sentStatuses = [];
  await page.route('**/api/sales-dashboard**', (route) => json(route, {
    success: true,
    period: { label: '30 dias', from: '2026-07-11', to: '2026-08-10' },
    summary: { total_revenue: 1234.5, revenue_delta: 12.5, orders_count: 2, orders_delta: 10, avg_ticket: 617.25, avg_ticket_delta: -3.5, open_orders: 1, conversion_rate: 0.5, conversion_delta: -2.5 },
  }));
  await page.route('**/api/sales-orders**', (route) => {
    const url = new globalThis.URL(route.request().url());
    const status = url.searchParams.get('status');
    if (status) sentStatuses.push(status);
    return json(route, {
      success: true,
      items: [{
        id: 'PED-2026-0001',
        date: '2026-08-10',
        customer_name: 'Cliente pedido',
        customer: '11111111-1111-4111-8111-111111111111',
        grand_total: 1234.5,
        rounded_total: 1234.5,
        status: 'Completed',
        delivery_date: '',
        per_delivered: 0,
        per_billed: 0,
        source_quotation: null,
      }],
      page: 1,
      limit: 10,
      total: 1,
      has_more: false,
    });
  });

  await page.goto('/#/sales-orders');
  await expect(page.getByText('R$ 1.234,50').first()).toBeVisible();
  await expect(page.getByText('2', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('R$ 617,25').first()).toBeVisible();
  await expect(page.getByText('+12.5% vs período anterior', { exact: true })).toBeVisible();
  await expect(page.getByText('-3.5% vs período anterior', { exact: true })).toBeVisible();
  const statusSelect = page.getByLabel('Filtrar por status');
  const optionValues = await statusSelect.locator('option').evaluateAll((options) => options.map((option) => option.value));
  expect(optionValues).not.toContain('On Hold');
  expect(optionValues).not.toContain('To Pay');
  for (const value of optionValues.filter(Boolean)) {
    await statusSelect.selectOption(value);
  }
  await expect.poll(() => sentStatuses.length).toBe(optionValues.filter(Boolean).length);
  expect(new Set(sentStatuses)).toEqual(new Set(optionValues.filter(Boolean)));
  await expect(page.getByText('Cliente pedido', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('11111111-1111-4111-8111-111111111111', { exact: true })).toHaveCount(0);
});

test('detalhe de pedido não expõe UUID quando customer_name falta @quotations @critical', async ({ page }) => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  await page.route('**/api/sales-orders**', (route) => json(route, {
    id: 'PED-2026-0001',
    status: 'Completed',
    customer: uuid,
    customer_name: null,
    date: '2026-08-10',
    items: [],
  }));
  await page.goto('/#/sales-orders/PED-2026-0001');
  await expect(page.getByText('Cliente não identificado', { exact: true })).toBeVisible();
  await expect(page.getByText(uuid, { exact: true })).toHaveCount(0);
});

test('envio parcialmente aceito fica em reconciliação sem reenvio @quotations @critical', async ({ page }) => {
  let sendCount = 0;
  await page.route('**/api/quotation-templates**', (route) => json(route, {
    templates: [{ key: 'padrao', name: 'Padrão', is_default: true, current_version_id: revisionId }],
    default_key: 'padrao',
  }));
  await page.route('**/api/quotations**', (route) => json(route, { data: [] }));
  await page.route('**/api/quote-leads**', (route) => json(route, { data: [] }));
  await page.route('**/api/communication-flows**', (route) => json(route, {
    success: true,
    flows: [{
      id: 'flow-test', name: 'Fluxo de teste', context: 'manual', channel: 'whatsapp', vendor_name: 'Juliana', enabled: true,
      delay_min_seconds: 0, delay_max_seconds: 0, max_media_per_product_group: 1,
      steps: [{ id: 'step-1', type: 'text', template: 'Olá' }],
    }],
    selectedFlowId: 'flow-test',
  }));
  await page.route('**/api/extract**', (route) => json(route, {
    orders: [{ nome: 'Cliente envio', email: 'cliente@example.test', telefone: '11999990000', origem: 'WhatsApp', items: [{ item_code: 'SKU-1', qty: 10 }] }],
  }));
  await page.route('**/api/pricing-lookup**', (route) => json(route, { success: true, items: [{ rate: 9, item_name: 'Produto' }] }));
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
  await page.route('**/api/send-whatsapp-flow**', (route) => {
    sendCount += 1;
    return json(route, {
      error: 'O transporte foi aceito e aguarda reconciliação.',
      send_status: 'accepted_partial',
      accepted_partial: true,
      provider_accepted: true,
      partial_send: true,
    }, 503);
  });

  await page.goto('/#/auto');
  await page.locator('textarea').first().fill('10 produtos');
  await page.getByRole('button', { name: 'Extrair' }).click();
  await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Gerar orçamento' }).click();
  await expect(page.getByText('Emitido', { exact: true })).toBeVisible();
  const send = page.getByRole('button', { name: 'Enviar WhatsApp' });
  await expect(send).toBeVisible({ timeout: 10000 });
  await send.click();
  await expect(page.getByText('Envio aceito', { exact: true }).first()).toBeVisible({ timeout: 10000 });
  const acceptedButton = page.getByRole('button', { name: 'Envio aceito' });
  await expect(acceptedButton).toBeVisible();
  await expect(acceptedButton).toBeDisabled();
  expect(sendCount).toBe(1);
  await acceptedButton.click({ force: true });
  expect(sendCount).toBe(1);
});

test('projeções locais descartam marcadores proibidos de cliente e cotação @quotations @critical', async ({ page }) => {
  const marker = 'FORBIDDEN_MARKER';
  await page.route('**/api/leads-clients**', (route) => json(route, {
    data: [{ id: '33333333-3333-4333-8333-333333333333', nome: 'Cliente legítimo', provider_marker: marker }],
    pagination: { page: 1, limit: 10, total_pages: 1, total: 1 },
  }));
  await page.route('**/api/client-detail**', (route) => json(route, {
    id: '33333333-3333-4333-8333-333333333333', nome: 'Cliente legítimo', display_name: 'Cliente legítimo',
    latest_quotation: { name: quotationId, provider_marker: marker }, deal: { name: 'Negócio local', raw_payload: marker },
    provider_marker: marker,
  }));
  await page.route('**/api/quotations**', (route) => json(route, {
    id: quotationId, quotation_id: quotationId, quotation_uuid: '11111111-1111-4111-8111-111111111111', revision_id: revisionId,
    revision: 1, revision_number: 1, status: 'Enviado', status_canonical: 'enviado', cliente: 'Cliente legítimo', client_id: '33333333-3333-4333-8333-333333333333',
    data: '2026-08-10', validade: '2026-08-25', validade_dias: 15, pagamento: '', entrega: '', frete_padrao: '0.00', frete: '0.00', observacoes: '', prazo_producao: '',
    template_key: 'padrao', template_padrao: 'padrao', template_hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e', template_version_id: null, template_version: null,
    secoes: { schema_version: 1, prazo_producao: { base: { enabled: true, title: 'Prazo' }, current: { enabled: true, title: 'Prazo' } }, pagamento: { base: { enabled: true, title: 'Pagamento', body: '' }, current: { enabled: true, title: 'Pagamento', body: '' } }, condicoes_gerais: { base: { enabled: true, title: 'Condições', body: '' }, current: { enabled: true, title: 'Condições', body: '' } } },
    items: [{ item_code: 'SKU-1', item_name: 'Produto legítimo', sku: 'SKU-1', nome: 'Produto legítimo', qty: '1.000', quantidade: '1.000', suggested_unit_price: '9.00', preco_sugerido: '9.00', applied_unit_price: '9.00', preco_aplicado: '9.00', rate: '9.00', price_difference: '0.00', diferenca_preco: '0.00', line_total: '9.00', total_linha: '9.00', manual_rate: false, provider_marker: marker }],
    subtotal: '9.00', total: '9.00', valor: '9.00', revision_history: [], derived_expired: false, expiration_derived: false, is_expired: false, expirada: false, concurrency_token: '2026-08-10T00:00:00.000Z',
    provider_marker: marker, raw_payload: marker,
  }));
  await page.route('**/api/quotation-templates**', (route) => json(route, { templates: [] }));

  await page.goto('/#/leads');
  await expect(page.getByText('Cliente legítimo', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
  await page.goto(`/#/quotations/${quotationId}`);
  await expect(page.getByText('Produto legítimo', { exact: true })).toBeVisible();
  await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
  await expect(page.locator('a[href="https://evil.test"]')).toHaveCount(0);
});

test('métricas ausentes ou contagens inválidas exibem erro e não inventam zeros @quotations @critical', async ({ page }) => {
  let summary = { total_revenue: 0, revenue_delta: 0, orders_count: 0, orders_delta: 0, avg_ticket: 0, avg_ticket_delta: 0, open_orders: 0, conversion_rate: 0, conversion_delta: 0 };
  await page.route('**/api/sales-dashboard**', (route) => json(route, { success: true, summary }));
  await page.route('**/api/sales-orders**', (route) => json(route, { success: true, items: [], has_more: false }));
  await page.goto('/#/sales-orders');
  await expect(page.getByText('R$ 0,00').first()).toBeVisible();
  for (const invalid of [
    { ...summary, open_orders: undefined },
    { ...summary, orders_count: '0' },
    { ...summary, orders_count: -1 },
    { ...summary, orders_count: 1.5 },
  ]) {
    summary = invalid;
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Tente novamente');
    await expect(page.getByText('R$ 0,00')).toHaveCount(0);
  }
});
